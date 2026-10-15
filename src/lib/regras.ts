// ============================================================
// Regras de negócio puras (sem React). Recebem o estado e
// devolvem dados derivados ou um novo estado. O store usa estas
// funções; as páginas nunca aplicam regras por conta própria.
// ============================================================
import type {
  Agendamento,
  Emprestimo,
  Estado,
  Exemplar,
  Multa,
  Notificacao,
  SocioLeitor,
  TipoNotificacao,
  Turno,
} from "./types"
import { DIAS_LEMBRETE, MULTA_POR_DIA, labelTurno } from "./constants"
import { diffDias, diasAtraso, emailValido, formatCurrency, formatDate, primeiroNome, uuid } from "./utils"

export interface Resultado {
  ok: boolean
  mensagem: string
}

export const ok = (mensagem: string): Resultado => ({ ok: true, mensagem })
export const falha = (mensagem: string): Resultado => ({ ok: false, mensagem })

// ------------------------------------------------------------
// Acervo
// ------------------------------------------------------------
export const exemplarNoAcervo = (ex: Exemplar) => !ex.baixa

export function exemplaresDoLivro(e: Estado, livroId: string): Exemplar[] {
  return e.exemplares.filter((ex) => ex.livroId === livroId && exemplarNoAcervo(ex))
}

export function nomesAutores(e: Estado, autorIds: string[]): string[] {
  return autorIds.map((id) => e.autores.find((a) => a.id === id)?.nome ?? "Autor desconhecido")
}

export function emprestimoAtivoDoExemplar(e: Estado, exemplarId: string): Emprestimo | undefined {
  return e.emprestimos.find((emp) => emp.exemplarId === exemplarId && emp.status === "ativo")
}

export function reservaAtivaDoExemplar(e: Estado, exemplarId: string) {
  return e.reservas.find((r) => r.exemplarId === exemplarId && r.status === "ativa")
}

// ------------------------------------------------------------
// Situação do sócio-leitor
// ------------------------------------------------------------
export function emprestimosAtivos(e: Estado, socioId: string): Emprestimo[] {
  return e.emprestimos.filter((emp) => emp.socioId === socioId && emp.status === "ativo")
}

export function reservasAtivas(e: Estado, socioId: string) {
  return e.reservas.filter((r) => r.socioId === socioId && r.status === "ativa")
}

/** Multa em curso de um empréstimo ainda não devolvido (RN03). */
export function multaCorrente(emp: Emprestimo, hoje: string): number {
  if (emp.status !== "ativo") return 0
  return diasAtraso(emp.dataPrevista, hoje) * MULTA_POR_DIA
}

export interface Debitos {
  multasAbertas: Multa[] // pendentes ou com justificativa em análise
  atrasados: Emprestimo[]
  totalMultas: number
  totalCorrente: number // multa acumulando nos livros ainda não devolvidos
}

export function debitos(e: Estado, socioId: string, hoje: string): Debitos {
  const multasAbertas = e.multas.filter(
    (m) => m.socioId === socioId && (m.status === "pendente" || m.status === "em_analise"),
  )
  const atrasados = emprestimosAtivos(e, socioId).filter((emp) => diasAtraso(emp.dataPrevista, hoje) > 0)
  return {
    multasAbertas,
    atrasados,
    totalMultas: multasAbertas.reduce((acc, m) => acc + m.valor, 0),
    totalCorrente: atrasados.reduce((acc, emp) => acc + multaCorrente(emp, hoje), 0),
  }
}

/** RN08: multa em aberto ou devolução atrasada bloqueia novos empréstimos. */
export function socioBloqueado(e: Estado, socioId: string, hoje: string): boolean {
  const d = debitos(e, socioId, hoje)
  return d.multasAbertas.length > 0 || d.atrasados.length > 0
}

export function motivoBloqueio(e: Estado, socioId: string, hoje: string): string | null {
  const d = debitos(e, socioId, hoje)
  const partes: string[] = []
  if (d.atrasados.length > 0) partes.push(`${d.atrasados.length} devolução(ões) em atraso`)
  if (d.multasAbertas.length > 0) partes.push(`multas em aberto de ${formatCurrency(d.totalMultas)}`)
  return partes.length ? partes.join(" e ") : null
}

// ------------------------------------------------------------
// Mesas de estudo
// ------------------------------------------------------------
export const FIM_TURNO: Record<Turno, number> = { manha: 12, tarde: 17, noite: 21 }

export function turnoEncerrado(data: string, turno: Turno, hoje: string, horaAtual: number): boolean {
  if (data < hoje) return true
  return data === hoje && horaAtual >= FIM_TURNO[turno]
}

export function agendamentosDoTurno(e: Estado, data: string, turno: Turno): Agendamento[] {
  return e.agendamentos.filter((a) => a.data === data && a.turno === turno && a.status === "confirmado")
}

export function mesaLivre(e: Estado, mesaId: string, data: string, turno: Turno): boolean {
  return !agendamentosDoTurno(e, data, turno).some((a) => a.mesaId === mesaId)
}

export function mesasLivres(e: Estado, data: string, turno: Turno) {
  return e.mesas.filter((m) => mesaLivre(e, m.id, data, turno))
}

export function agendamentoNoDia(e: Estado, socioId: string, data: string) {
  return e.agendamentos.find((a) => a.socioId === socioId && a.data === data && a.status === "confirmado")
}

export function filaDoTurno(e: Estado, data: string, turno: Turno) {
  return e.fila
    .filter((f) => f.data === data && f.turno === turno && f.status === "aguardando")
    .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))
}

/**
 * RF11: enquanto houver mesa livre no turno, contempla o primeiro da fila.
 * Quem já tem agendamento confirmado no dia é pulado (RN05) e sai da fila.
 */
export function processarFila(e: Estado, data: string, turno: Turno, agora: string): Estado {
  let estado = e
  for (const entrada of filaDoTurno(e, data, turno)) {
    if (agendamentoNoDia(estado, entrada.socioId, data)) {
      estado = {
        ...estado,
        fila: estado.fila.map((f) => (f.id === entrada.id ? { ...f, status: "desistiu" } : f)),
      }
      continue
    }
    const livre = mesasLivres(estado, data, turno)[0]
    if (!livre) break
    const ag: Agendamento = {
      id: uuid(),
      mesaId: livre.id,
      socioId: entrada.socioId,
      data,
      turno,
      status: "confirmado",
      origem: "fila",
      criadoEm: agora,
    }
    estado = {
      ...estado,
      agendamentos: [...estado.agendamentos, ag],
      fila: estado.fila.map((f) =>
        f.id === entrada.id ? { ...f, status: "contemplado", agendamentoId: ag.id } : f,
      ),
    }
  }
  return estado
}

// ------------------------------------------------------------
// Notificações por e-mail (RF05)
// ------------------------------------------------------------
function montarNotificacao(
  socio: SocioLeitor,
  emp: Emprestimo,
  titulo: string,
  tipo: TipoNotificacao,
  hoje: string,
  agora: string,
): Notificacao {
  const nome = primeiroNome(socio.nome)
  const prazo = formatDate(emp.dataPrevista)
  const textos: Record<TipoNotificacao, { assunto: string; corpo: string }> = {
    lembrete: {
      assunto: `Lembrete: devolução de "${titulo}" em ${prazo}`,
      corpo: `Olá, ${nome}! O prazo de devolução do livro "${titulo}" termina em ${prazo} (faltam ${diffDias(hoje, emp.dataPrevista)} dia(s)). Se precisar de mais tempo, procure a biblioteca para renovar. Após o prazo, é cobrada multa de R$ 1,00 por dia.`,
    },
    vencimento: {
      assunto: `Hoje é o último dia para devolver "${titulo}"`,
      corpo: `Olá, ${nome}! O livro "${titulo}" deve ser devolvido hoje (${prazo}). A partir de amanhã é cobrada multa de R$ 1,00 por dia de atraso.`,
    },
    atraso: {
      assunto: `Devolução em atraso: "${titulo}"`,
      corpo: `Olá, ${nome}. O livro "${titulo}" deveria ter sido devolvido em ${prazo} e está com ${diasAtraso(emp.dataPrevista, hoje)} dia(s) de atraso. A multa é de R$ 1,00 por dia e novos empréstimos ficam bloqueados até a regularização.`,
    },
  }
  const semEmail = !socio.email || !emailValido(socio.email)
  return {
    id: uuid(),
    socioId: socio.id,
    emprestimoId: emp.id,
    tipo,
    referencia: emp.dataPrevista,
    destinatario: socio.email || "(sem e-mail)",
    assunto: textos[tipo].assunto,
    corpo: textos[tipo].corpo,
    data: agora,
    status: semEmail ? "falha" : "enviado",
    motivoFalha: semEmail ? "Cadastro sem e-mail válido. Atualize o cadastro do sócio-leitor." : undefined,
  }
}

function tituloDoEmprestimo(e: Estado, emp: Emprestimo): string {
  const ex = e.exemplares.find((x) => x.id === emp.exemplarId)
  return e.livros.find((l) => l.id === ex?.livroId)?.titulo ?? "Obra"
}

/** Gera as notificações devidas hoje. Cada aviso é enviado uma única vez por prazo. */
export function gerarNotificacoes(e: Estado, hoje: string, agora: string): Notificacao[] {
  const novas: Notificacao[] = []
  for (const emp of e.emprestimos.filter((x) => x.status === "ativo")) {
    const faltam = diffDias(hoje, emp.dataPrevista)
    let tipo: TipoNotificacao | null = null
    if (faltam > 0 && faltam <= DIAS_LEMBRETE) tipo = "lembrete"
    else if (faltam === 0) tipo = "vencimento"
    else if (faltam < 0) tipo = "atraso"
    if (!tipo) continue
    const jaEnviada = e.notificacoes.some(
      (n) => n.emprestimoId === emp.id && n.tipo === tipo && n.referencia === emp.dataPrevista,
    )
    if (jaEnviada) continue
    const socio = e.socios.find((s) => s.id === emp.socioId)
    if (!socio) continue
    novas.push(montarNotificacao(socio, emp, tituloDoEmprestimo(e, emp), tipo, hoje, agora))
  }
  return novas
}

// ------------------------------------------------------------
// Rotina diária: vencimentos, reservas, fila e notificações
// ------------------------------------------------------------
export interface RelatorioRotina {
  notificacoes: number
  falhas: number
  reservasExpiradas: number
  filaExpirada: number
  contemplados: number
}

export function aplicarRotinas(
  e: Estado,
  hoje: string,
  agora: string,
  horaAtual: number,
): { estado: Estado; relatorio: RelatorioRotina } {
  let estado = e
  const relatorio: RelatorioRotina = {
    notificacoes: 0,
    falhas: 0,
    reservasExpiradas: 0,
    filaExpirada: 0,
    contemplados: 0,
  }

  // 1. Reservas não retiradas no prazo liberam o exemplar
  const expiradas = estado.reservas.filter((r) => r.status === "ativa" && r.expiraEm < hoje)
  if (expiradas.length > 0) {
    const ids = new Set(expiradas.map((r) => r.exemplarId))
    estado = {
      ...estado,
      reservas: estado.reservas.map((r) =>
        r.status === "ativa" && r.expiraEm < hoje ? { ...r, status: "expirada" } : r,
      ),
      exemplares: estado.exemplares.map((ex) =>
        ids.has(ex.id) && ex.status === "reservado" ? { ...ex, status: "disponivel" } : ex,
      ),
    }
    relatorio.reservasExpiradas = expiradas.length
  }

  // 2. Fila de espera de turnos já encerrados expira
  const filaVencida = estado.fila.filter(
    (f) => f.status === "aguardando" && turnoEncerrado(f.data, f.turno, hoje, horaAtual),
  )
  if (filaVencida.length > 0) {
    const ids = new Set(filaVencida.map((f) => f.id))
    estado = {
      ...estado,
      fila: estado.fila.map((f) => (ids.has(f.id) ? { ...f, status: "expirada" } : f)),
    }
    relatorio.filaExpirada = filaVencida.length
  }

  // 3. Mesas liberadas contemplam a fila
  const antes = estado.fila.filter((f) => f.status === "contemplado").length
  const turnos = new Set(
    estado.fila.filter((f) => f.status === "aguardando").map((f) => `${f.data}|${f.turno}`),
  )
  for (const chave of turnos) {
    const [data, turno] = chave.split("|") as [string, Turno]
    estado = processarFila(estado, data, turno, agora)
  }
  relatorio.contemplados = estado.fila.filter((f) => f.status === "contemplado").length - antes

  // 4. Notificações de prazo (RF05)
  const novas = gerarNotificacoes(estado, hoje, agora)
  if (novas.length > 0) {
    estado = { ...estado, notificacoes: [...novas, ...estado.notificacoes] }
    relatorio.notificacoes = novas.length
    relatorio.falhas = novas.filter((n) => n.status === "falha").length
  }

  estado = { ...estado, ultimaRotina: hoje }
  return { estado, relatorio }
}

export function descricaoTurno(t: Turno) {
  return labelTurno[t]
}
