// ============================================================
// Regras de negócio puras (sem React). Recebem o estado e
// devolvem dados derivados ou um novo estado. O store usa estas
// funções; as páginas nunca aplicam regras por conta própria.
// ============================================================
import type {
  Agendamento,
  CriancaKids,
  Emprestimo,
  EntradaFila,
  EspacoMesa,
  Estado,
  Exemplar,
  MesaEstudo,
  Multa,
  Notificacao,
  SituacaoAgendamento,
  SocioLeitor,
  TipoNotificacao,
  Turno,
} from "./types"
import {
  DIAS_LEMBRETE,
  IDADE_MAXIMA_KIDS,
  IDADE_MINIMA_RESPONSAVEL_KIDS,
  IDADE_MINIMA_SOCIO,
  MULTA_POR_DIA,
  TOLERANCIA_USO_MINUTOS,
  labelTurno,
} from "./constants"
import {
  cpfValido,
  dataValida,
  diffDias,
  diasAtraso,
  emailValido,
  formatCurrency,
  formatDate,
  idade,
  paraISO,
  primeiroNome,
  somenteDigitos,
  uuid,
} from "./utils"

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
export const INICIO_TURNO: Record<Turno, number> = { manha: 8, tarde: 13, noite: 18 }
export const FIM_TURNO: Record<Turno, number> = { manha: 12, tarde: 17, noite: 21 }

export function turnoEncerrado(data: string, turno: Turno, hoje: string, horaAtual: number): boolean {
  if (data < hoje) return true
  return data === hoje && horaAtual >= FIM_TURNO[turno]
}

export const espacoDaMesa = (m: MesaEstudo): EspacoMesa => m.espaco ?? "estudo"
export const espacoDaFila = (f: EntradaFila): EspacoMesa => f.espaco ?? (f.crianca ? "kids" : "estudo")

export function mesasDoEspaco(e: Estado, espaco: EspacoMesa): MesaEstudo[] {
  return e.mesas.filter((m) => espacoDaMesa(m) === espaco)
}

export function espacoDoAgendamento(e: Estado, a: Agendamento): EspacoMesa {
  const mesa = e.mesas.find((m) => m.id === a.mesaId)
  return mesa ? espacoDaMesa(mesa) : a.crianca ? "kids" : "estudo"
}

export function agendamentosDoTurno(e: Estado, data: string, turno: Turno, espaco?: EspacoMesa): Agendamento[] {
  return e.agendamentos.filter(
    (a) =>
      a.data === data &&
      a.turno === turno &&
      a.status === "confirmado" &&
      (!espaco || espacoDoAgendamento(e, a) === espaco),
  )
}

export function mesaLivre(e: Estado, mesaId: string, data: string, turno: Turno): boolean {
  return !agendamentosDoTurno(e, data, turno).some((a) => a.mesaId === mesaId)
}

export function mesasLivres(e: Estado, data: string, turno: Turno, espaco: EspacoMesa = "estudo") {
  return mesasDoEspaco(e, espaco).filter((m) => mesaLivre(e, m.id, data, turno))
}

/** RN05: agendamento do próprio sócio-leitor numa mesa de estudo (o do Espaço Kids é da criança). */
export function agendamentoNoDia(e: Estado, socioId: string, data: string) {
  return e.agendamentos.find((a) => a.socioId === socioId && a.data === data && a.status === "confirmado" && !a.crianca)
}

/** RN05 aplicada à criança: um turno por dia no Espaço Kids. */
export function agendamentoKidsNoDia(e: Estado, cpfCrianca: string, data: string) {
  return e.agendamentos.find((a) => a.crianca?.cpf === cpfCrianca && a.data === data && a.status === "confirmado")
}

export function filaDoTurno(e: Estado, data: string, turno: Turno, espaco: EspacoMesa = "estudo") {
  return e.fila
    .filter((f) => f.data === data && f.turno === turno && f.status === "aguardando" && espacoDaFila(f) === espaco)
    .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))
}

/**
 * US29: confere os dados da criança do Espaço Kids. A idade vale na data do
 * agendamento. Devolve o campo com erro, para a tela apontá-lo.
 */
export function validarCrianca(
  e: Estado,
  c: CriancaKids,
  hoje: string,
  dataAgendamento: string,
): { campo: keyof CriancaKids; mensagem: string } | null {
  if (c.nome.trim().split(/\s+/).length < 2) return { campo: "nome", mensagem: "Informe o nome completo da criança." }
  if (!cpfValido(c.cpf)) return { campo: "cpf", mensagem: "CPF da criança inválido. Confira os dígitos." }
  const cpf = somenteDigitos(c.cpf)
  if (e.socios.some((s) => s.cpf === cpf)) {
    return {
      campo: "cpf",
      mensagem: "Este CPF pertence a um sócio-leitor cadastrado. O Espaço Kids é para crianças sem cadastro próprio.",
    }
  }
  if (!dataValida(c.dataNascimento)) return { campo: "dataNascimento", mensagem: "Informe a data de nascimento da criança." }
  if (c.dataNascimento > hoje) return { campo: "dataNascimento", mensagem: "A data de nascimento não pode estar no futuro." }
  if (idade(c.dataNascimento, dataAgendamento) > IDADE_MAXIMA_KIDS) {
    return {
      campo: "dataNascimento",
      mensagem: `O Espaço Kids é só para crianças de até ${IDADE_MAXIMA_KIDS} anos. A partir dos ${IDADE_MINIMA_SOCIO} anos, ela pode criar a própria conta de sócio-leitor, mas só pode ser responsável e agendar o Espaço Kids para uma criança a partir dos ${IDADE_MINIMA_RESPONSAVEL_KIDS} anos.`,
    }
  }
  return null
}

/**
 * US29: só o sócio-leitor de 18 anos ou mais pode ser responsável e agendar o Espaço
 * Kids (ou entrar na fila dele) para uma criança. A idade vale na data do agendamento;
 * cadastro sem data de nascimento não tem como comprovar a idade.
 */
export function validarResponsavelKids(socio: SocioLeitor, dataAgendamento: string): string | null {
  if (!socio.dataNascimento) {
    return `O cadastro de ${primeiroNome(socio.nome)} está sem data de nascimento. Para ser responsável no Espaço Kids é preciso ter ${IDADE_MINIMA_RESPONSAVEL_KIDS} anos ou mais: a data de nascimento precisa ser informada no cadastro.`
  }
  if (idade(socio.dataNascimento, dataAgendamento) < IDADE_MINIMA_RESPONSAVEL_KIDS) {
    return `Somente sócios-leitores a partir dos ${IDADE_MINIMA_RESPONSAVEL_KIDS} anos podem ser responsáveis e agendar o Espaço Kids para uma criança.`
  }
  return null
}

/**
 * RF11: enquanto houver mesa livre no turno, contempla o primeiro da fila.
 * Quem já tem agendamento confirmado no dia é pulado (RN05) e sai da fila;
 * no Espaço Kids, o limite vale para a criança.
 */
export function processarFila(
  e: Estado,
  data: string,
  turno: Turno,
  agora: string,
  espaco: EspacoMesa = "estudo",
): Estado {
  let estado = e
  for (const entrada of filaDoTurno(e, data, turno, espaco)) {
    const jaAgendado = entrada.crianca
      ? agendamentoKidsNoDia(estado, entrada.crianca.cpf, data)
      : agendamentoNoDia(estado, entrada.socioId, data)
    if (jaAgendado) {
      estado = {
        ...estado,
        fila: estado.fila.map((f) => (f.id === entrada.id ? { ...f, status: "desistiu" } : f)),
      }
      continue
    }
    const livre = mesasLivres(estado, data, turno, espaco)[0]
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
      ...(entrada.crianca ? { crianca: entrada.crianca } : {}),
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

/**
 * US30: prazo para o funcionário confirmar que o espaço está em uso. Conta a
 * partir do início do turno ou, se o agendamento veio depois (direto ou pela
 * fila), a partir do momento em que ele foi feito.
 */
export function prazoConfirmacaoUso(a: Agendamento): Date {
  const inicio = inicioDoTurno(a.data, a.turno)
  const criado = new Date(a.criadoEm)
  const base = criado > inicio ? criado : inicio
  return new Date(base.getTime() + TOLERANCIA_USO_MINUTOS * 60_000)
}

export function inicioDoTurno(data: string, turno: Turno): Date {
  const [ano, mes, dia] = data.split("-").map(Number)
  return new Date(ano, mes - 1, dia, INICIO_TURNO[turno])
}

/** Turno em andamento ou o próximo do dia; depois das 17h, a noite. */
export function turnoDoMomento(hora: number): Turno {
  if (hora < FIM_TURNO.manha) return "manha"
  if (hora < FIM_TURNO.tarde) return "tarde"
  return "noite"
}

/** US30: situação do agendamento vista no acompanhamento (ver SituacaoAgendamento). */
export function situacaoAgendamento(a: Agendamento, agora: Date): SituacaoAgendamento {
  if (a.status === "cancelado") return "cancelado"
  if (a.status === "nao_compareceu") return "nao_compareceu"
  const encerrado = turnoEncerrado(a.data, a.turno, paraISO(agora), agora.getHours())
  if (a.usoConfirmadoEm) return encerrado ? "utilizado" : "em_uso"
  if (encerrado) return "encerrado"
  if (agora < inicioDoTurno(a.data, a.turno)) return "agendado"
  return agora < prazoConfirmacaoUso(a) ? "aguardando_uso" : "prazo_esgotado"
}

/** Para onde foi a vaga de um agendamento sem uso: o próximo agendamento da mesma mesa no turno. */
export type DestinoVaga = { tipo: "fila" | "direto"; agendamento: Agendamento } | { tipo: "livre" }

export function destinoDaVaga(e: Estado, a: Agendamento): DestinoVaga {
  const desde = new Date(a.criadoEm).getTime()
  const seguinte = e.agendamentos
    .filter(
      (x) =>
        x.id !== a.id &&
        x.mesaId === a.mesaId &&
        x.data === a.data &&
        x.turno === a.turno &&
        x.status !== "cancelado" &&
        new Date(x.criadoEm).getTime() >= desde,
    )
    .sort((x, y) => new Date(x.criadoEm).getTime() - new Date(y.criadoEm).getTime())[0]
  if (!seguinte) return { tipo: "livre" }
  return { tipo: seguinte.origem === "fila" ? "fila" : "direto", agendamento: seguinte }
}

/**
 * Compara a fila e os agendamentos antes e depois de liberar a vaga de `ag`: quem
 * da fila foi contemplado com a mesa e quantos foram pulados por já terem
 * agendamento no dia (RN05). Serve tanto para o estado local quanto para a
 * resposta da API.
 */
export function transferenciaDaVaga(
  antes: Estado,
  depois: Estado,
  ag: Agendamento,
): { contemplado: Agendamento | null; ignorados: number } {
  const espaco = espacoDoAgendamento(antes, ag)
  const existentes = new Set(antes.agendamentos.map((a) => a.id))
  const contemplado =
    depois.agendamentos.find(
      (a) =>
        !existentes.has(a.id) && a.origem === "fila" && a.mesaId === ag.mesaId && a.data === ag.data && a.turno === ag.turno,
    ) ?? null
  const aguardando = new Set(filaDoTurno(depois, ag.data, ag.turno, espaco).map((f) => f.id))
  const sairam = filaDoTurno(antes, ag.data, ag.turno, espaco).filter((f) => !aguardando.has(f.id)).length
  return { contemplado, ignorados: Math.max(0, sairam - (contemplado ? 1 : 0)) }
}

/**
 * US30: o administrador registra o não comparecimento de um agendamento. A vaga
 * vai para o primeiro da fila daquele turno e espaço que não tenha agendamento no
 * dia; sem fila, a mesa fica livre para novo agendamento.
 */
export function registrarNaoComparecimentoNoEstado(
  e: Estado,
  agendamentoId: string,
  agora: string,
): { estado: Estado; contemplado: Agendamento | null; ignorados: number } {
  const ag = e.agendamentos.find((a) => a.id === agendamentoId)
  if (!ag) return { estado: e, contemplado: null, ignorados: 0 }
  const marcado: Estado = {
    ...e,
    agendamentos: e.agendamentos.map((a) => (a.id === agendamentoId ? { ...a, status: "nao_compareceu" } : a)),
  }
  const estado = processarFila(marcado, ag.data, ag.turno, agora, espacoDoAgendamento(e, ag))
  return { estado, ...transferenciaDaVaga(marcado, estado, ag) }
}

/** Linha do tempo do turno: agendamentos, contemplações, usos confirmados e não comparecimentos. */
export interface MovimentoMesa {
  id: string
  quando: string // ISO datetime
  tipo: "agendado" | "contemplado" | "uso_confirmado" | "nao_compareceu"
  agendamento: Agendamento
  destino?: DestinoVaga // só no não comparecimento
}

export function movimentacoesDoTurno(e: Estado, data: string, turno: Turno, espaco?: EspacoMesa): MovimentoMesa[] {
  const movimentos: MovimentoMesa[] = []
  for (const a of e.agendamentos) {
    if (a.data !== data || a.turno !== turno || a.status === "cancelado") continue
    if (espaco && espacoDoAgendamento(e, a) !== espaco) continue
    movimentos.push({ id: `${a.id}-criado`, quando: a.criadoEm, tipo: a.origem === "fila" ? "contemplado" : "agendado", agendamento: a })
    if (a.usoConfirmadoEm) {
      movimentos.push({ id: `${a.id}-uso`, quando: a.usoConfirmadoEm, tipo: "uso_confirmado", agendamento: a })
    }
    if (a.status === "nao_compareceu") {
      movimentos.push({
        id: `${a.id}-ausente`,
        quando: prazoConfirmacaoUso(a).toISOString(),
        tipo: "nao_compareceu",
        agendamento: a,
        destino: destinoDaVaga(e, a),
      })
    }
  }
  // mais recentes primeiro; no mesmo instante, a contemplação vem antes da ausência que a gerou
  const ordem: Record<MovimentoMesa["tipo"], number> = { contemplado: 0, uso_confirmado: 1, nao_compareceu: 2, agendado: 3 }
  return movimentos.sort(
    (x, y) => new Date(y.quando).getTime() - new Date(x.quando).getTime() || ordem[x.tipo] - ordem[y.tipo],
  )
}

/** US29: com o uso do Espaço Kids confirmado, os demais da fila daquele turno saem dela. */
export function confirmarUsoNoEstado(e: Estado, agendamentoId: string, agora: string): { estado: Estado; retirados: number } {
  const ag = e.agendamentos.find((a) => a.id === agendamentoId)
  if (!ag) return { estado: e, retirados: 0 }
  const espaco = espacoDoAgendamento(e, ag)
  const retirar = espaco === "kids" ? new Set(filaDoTurno(e, ag.data, ag.turno, "kids").map((f) => f.id)) : new Set<string>()
  return {
    estado: {
      ...e,
      agendamentos: e.agendamentos.map((a) => (a.id === agendamentoId ? { ...a, usoConfirmadoEm: agora } : a)),
      fila: e.fila.map((f) => (retirar.has(f.id) ? { ...f, status: "retirada" } : f)),
    },
    retirados: retirar.size,
  }
}

/**
 * US30: agendamentos de hoje sem confirmação de uso depois da tolerância são
 * marcados como "não compareceu" e a vaga passa para o primeiro da fila.
 */
export function liberarVagasSemUso(e: Estado, hoje: string, agora: string): { estado: Estado; liberadas: number } {
  const momento = new Date(agora)
  const vencidos = e.agendamentos.filter(
    (a) =>
      a.status === "confirmado" &&
      !a.usoConfirmadoEm &&
      a.data === hoje &&
      momento.getHours() < FIM_TURNO[a.turno] &&
      momento >= prazoConfirmacaoUso(a),
  )
  if (vencidos.length === 0) return { estado: e, liberadas: 0 }
  const ids = new Set(vencidos.map((a) => a.id))
  let estado: Estado = {
    ...e,
    agendamentos: e.agendamentos.map((a) => (ids.has(a.id) ? { ...a, status: "nao_compareceu" } : a)),
  }
  const turnos = new Set(vencidos.map((a) => `${a.turno}|${espacoDoAgendamento(e, a)}`))
  for (const chave of turnos) {
    const [turno, espaco] = chave.split("|") as [Turno, EspacoMesa]
    estado = processarFila(estado, hoje, turno, agora, espaco)
  }
  return { estado, liberadas: vencidos.length }
}

/** Sócio inativado ou anonimizado: as mesas futuras dele voltam para a fila. */
export function liberarMesasDoSocio(e: Estado, socioId: string, hoje: string, horaAtual: number, agora: string): Estado {
  const liberados = e.agendamentos.filter(
    (a) => a.socioId === socioId && a.status === "confirmado" && !turnoEncerrado(a.data, a.turno, hoje, horaAtual),
  )
  const ids = new Set(liberados.map((a) => a.id))
  let estado: Estado = {
    ...e,
    agendamentos: e.agendamentos.map((a) => (ids.has(a.id) ? { ...a, status: "cancelado" } : a)),
    fila: e.fila.map((f) => (f.socioId === socioId && f.status === "aguardando" ? { ...f, status: "desistiu" } : f)),
  }
  for (const a of liberados) estado = processarFila(estado, a.data, a.turno, agora, espacoDoAgendamento(e, a))
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
  vagasLiberadas: number // US30: uso não confirmado na tolerância
}

export function aplicarRotinas(
  e: Estado,
  hoje: string,
  agora: string,
  horaAtual: number,
  // com os dados no banco, quem expira as reservas e cuida da fila e das vagas sem uso é o
  // servidor. O navegador nem conseguiria: só conhece os agendamentos dos outros sem identificação.
  { expirarReservas = true, cuidarDaFila = true }: { expirarReservas?: boolean; cuidarDaFila?: boolean } = {},
): { estado: Estado; relatorio: RelatorioRotina } {
  let estado = e
  const relatorio: RelatorioRotina = {
    notificacoes: 0,
    falhas: 0,
    reservasExpiradas: 0,
    filaExpirada: 0,
    contemplados: 0,
    vagasLiberadas: 0,
  }

  // 1. Reservas não retiradas no prazo liberam o exemplar
  const expiradas = expirarReservas ? estado.reservas.filter((r) => r.status === "ativa" && r.expiraEm < hoje) : []
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
    (f) => cuidarDaFila && f.status === "aguardando" && turnoEncerrado(f.data, f.turno, hoje, horaAtual),
  )
  if (filaVencida.length > 0) {
    const ids = new Set(filaVencida.map((f) => f.id))
    estado = {
      ...estado,
      fila: estado.fila.map((f) => (ids.has(f.id) ? { ...f, status: "expirada" } : f)),
    }
    relatorio.filaExpirada = filaVencida.length
  }

  // 3. Mesas liberadas contemplam a fila; antes, libera as vagas sem uso confirmado (US30)
  const antes = estado.fila.filter((f) => f.status === "contemplado").length
  const semUso = cuidarDaFila ? liberarVagasSemUso(estado, hoje, agora) : { estado, liberadas: 0 }
  estado = semUso.estado
  relatorio.vagasLiberadas = semUso.liberadas
  const turnos = new Set(
    estado.fila
      .filter((f) => cuidarDaFila && f.status === "aguardando")
      .map((f) => `${f.data}|${f.turno}|${espacoDaFila(f)}`),
  )
  for (const chave of turnos) {
    const [data, turno, espaco] = chave.split("|") as [string, Turno, EspacoMesa]
    estado = processarFila(estado, data, turno, agora, espaco)
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
