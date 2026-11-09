import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type {
  Administrador,
  Agendamento,
  ArquivoDigital,
  CriancaKids,
  Desbaste,
  Emprestimo,
  EntradaFila,
  Estado,
  Exemplar,
  Instituicao,
  MesaEstudo,
  Livro,
  Movimentacao,
  Multa,
  Notificacao,
  OcorrenciaDano,
  PastaHistorica,
  PerfilUsuario,
  Publicacao,
  Reserva,
  Sessao,
  SocioLeitor,
  StatusExemplar,
  Turno,
} from "./types"
import { completarEstado, criarEstadoInicial } from "./mock-data"
import {
  MAX_DOACOES_PESSOA_FISICA,
  MAX_EXEMPLARES_SIMULTANEOS,
  MAX_RENOVACOES,
  MIN_JUSTIFICATIVA,
  MULTA_POR_DIA,
  PRAZO_EMPRESTIMO_DIAS,
  PRAZO_RESERVA_DIAS,
  STATUS_DESBASTAVEIS,
  LETRAS_SECAO,
  IDADE_MAXIMA_KIDS,
  IDADE_MINIMA_SOCIO,
  TOLERANCIA_USO_MINUTOS,
  categoriaEmprestavel,
  labelCategoria,
  labelStatus,
  labelTurno,
} from "./constants"
import {
  addDays,
  agoraISO,
  cepValido,
  cnpjValido,
  cpfValido,
  dataValida,
  diasAtraso,
  emailValido,
  formatCurrency,
  formatDate,
  hojeISO,
  idade,
  isbnValido,
  normalizar,
  primeiroNome,
  somenteDigitos,
  telefoneValido,
  uuid,
} from "./utils"
import { validarAutores } from "./catalogacao"
import { conferirSenha, hashSenha } from "./seguranca"
import {
  agendamentoKidsNoDia,
  agendamentoNoDia,
  aplicarRotinas,
  confirmarUsoNoEstado,
  liberarMesasDoSocio,
  espacoDoAgendamento,
  validarCrianca,
  debitos as calcDebitos,
  emprestimoAtivoDoExemplar,
  emprestimosAtivos,
  exemplaresDoLivro,
  falha,
  filaDoTurno,
  mesaLivre,
  mesasLivres,
  motivoBloqueio,
  nomesAutores,
  ok,
  processarFila,
  reservaAtivaDoExemplar,
  reservasAtivas,
  socioBloqueado as calcBloqueio,
  turnoEncerrado,
  type Debitos,
  type RelatorioRotina,
  type Resultado,
} from "./regras"
import {
  backupAutomaticoDoDia,
  carregarEstado,
  carregarSessao,
  criarBackup,
  lerBackup,
  salvarEstado,
  salvarSessao,
  validarEstadoImportado,
} from "./persistencia"
import { garantirArquivosDemo } from "./demo-arquivos"
import { aguardarAntesDeLer, removerArquivos } from "./arquivos"
import {
  acervoDaApi,
  acervoPublicoDaApi,
  adicionarExemplaresNaApi,
  alterarEmprestimoNaApi,
  alternarAtivoSocioNaApi,
  anexarDocumentoNaApi,
  agendarNaApi,
  anonimizarSocioNaApi,
  cancelarAgendamentoNaApi,
  confirmarUsoNaApi,
  desistirDaFilaNaApi,
  entrarNaFilaNaApi,
  excluirInstituicaoNaApi,
  mesasDaApi,
  parceriasDaApi,
  registrarAquisicaoNaApi,
  registrarDoacaoNaApi,
  salvarInstituicaoNaApi,
  type EstadoMesasApi,
  type ParceriasApi,
  type PedidoMesa,
  cadastroNaApi,
  cancelarEmprestimoNaApi,
  cancelarReservaNaApi,
  circulacaoDaApi,
  desbastarNaApi,
  devolverNaApi,
  editarExemplarNaApi,
  emprestarNaApi,
  excluirDocumentoNaApi,
  excluirExemplarNaApi,
  excluirLivroNaApi,
  excluirPastaNaApi,
  importarObrasNaApi,
  julgarMultaNaApi,
  justificarMultaNaApi,
  loginNaApi,
  minhaCirculacaoDaApi,
  muralDaApi,
  salvarPublicacaoNaApi,
  excluirPublicacaoNaApi,
  quitarMultaNaApi,
  redefinirSenhaSocioNaApi,
  renovarNaApi,
  repositorioDaApi,
  reservarNaApi,
  salvarLivroNaApi,
  salvarPastaNaApi,
  salvarSocioNaApi,
  usuarioDoToken,
  type AcervoApi,
  type CirculacaoApi,
  type ExemplarApi,
  type LivroApi,
  type LoginApi,
  type RepositorioApi,
  type RespostaApi,
} from "./api"
import type { LinhaObra, LinhaSocio, ErroLinha } from "./csv"

export type { Resultado } from "./regras"

// ------------------------------------------------------------
// Formulários (dados de entrada das ações)
// ------------------------------------------------------------
export interface DadosLivro {
  titulo: string
  autores: string[] // nomes em ordem; o primeiro é a entrada principal (RN19)
  editora: string
  edicao: string
  ano: number
  categoria: Livro["categoria"]
  secao: string
  isbn: string
  sinopse?: string
}

export interface DadosSocio {
  nome: string
  cpf: string
  rg: string
  telefone: string
  email: string
  dataNascimento: string // AAAA-MM-DD; só a partir dos 12 anos (US29)
  endereco: SocioLeitor["endereco"]
  fotoId?: string
  senha?: string // obrigatória no cadastro
  consentimentoLgpd: boolean
}

export interface DadosDano {
  relatorio: string
  imagemIds: string[]
  valor: number
}

export interface DadosReceptor {
  tipo: Instituicao["tipo"]
  nome: string
  documento: string
  endereco: string
  contato: string
}

export interface ResultadoImportacao extends Resultado {
  erros?: ErroLinha[]
}

export interface ResultadoAgendamento extends Resultado {
  ofereceFila?: boolean
  campo?: keyof CriancaKids // Espaço Kids: campo da criança com erro (US29)
}

// ------------------------------------------------------------
// Contexto
// ------------------------------------------------------------
interface StoreContextType extends Estado {
  hoje: string
  sessao: Sessao
  perfil: PerfilUsuario
  socioLogado: SocioLeitor | null
  adminLogado: Administrador | null
  alertaLogin: boolean
  fecharAlertaLogin: () => void
  ultimaRotinaRelatorio: RelatorioRotina | null
  persistenciaOk: boolean

  // sessão (RNF02)
  entrar: (usuario: string, senha: string) => Promise<Resultado & { perfil?: PerfilUsuario }>
  cadastrarConta: (dados: DadosSocio) => Promise<Resultado>
  sair: () => void

  // seletores
  getLivro: (id: string) => Livro | undefined
  autoresDoLivro: (livro: Livro) => string[]
  exemplaresDoLivro: (livroId: string) => Exemplar[]
  livroDoExemplar: (exemplarId: string) => Livro | undefined
  tituloDoExemplar: (exemplarId: string) => string
  getSocio: (id: string) => SocioLeitor | undefined
  debitos: (socioId: string) => Debitos
  socioBloqueado: (socioId: string) => boolean
  motivoBloqueio: (socioId: string) => string | null
  historicoDoSocio: (socioId: string) => Emprestimo[] | null // RN23
  reservasDoSocio: (socioId: string) => Reserva[] | null // RN28

  // acervo (RF01 / RF16)
  salvarLivro: (dados: DadosLivro, id?: string) => Promise<Resultado>
  excluirLivro: (id: string) => Promise<Resultado>
  adicionarExemplares: (livroId: string, tombamentos: string[], localizacao?: string) => Promise<Resultado>
  editarExemplar: (
    id: string,
    dados: { tombamento: string; status: StatusExemplar; localizacao?: string },
  ) => Promise<Resultado>
  excluirExemplar: (id: string) => Promise<Resultado>
  desbastarExemplar: (id: string, relatorio: string) => Promise<Resultado>

  // sócios-leitores (RF02)
  salvarSocio: (dados: DadosSocio, id?: string) => Promise<Resultado>
  alternarAtivoSocio: (id: string) => Promise<Resultado>
  redefinirSenhaSocio: (id: string, novaSenha: string) => Promise<Resultado>
  anonimizarSocio: (id: string) => Promise<Resultado>

  // circulação (RF03 / RF07 / RF09 / RF15)
  realizarEmprestimo: (socioId: string, exemplarId: string) => Promise<Resultado>
  renovarEmprestimo: (id: string) => Promise<Resultado>
  alterarEmprestimo: (id: string, novaDataPrevista: string, motivo: string) => Promise<Resultado>
  cancelarEmprestimo: (id: string, motivo: string) => Promise<Resultado>
  devolverEmprestimo: (id: string, dano?: DadosDano) => Promise<Resultado>
  quitarMulta: (id: string) => Promise<Resultado>
  registrarJustificativa: (multaId: string, texto: string) => Promise<Resultado>
  julgarJustificativa: (multaId: string, decisao: "deferido" | "indeferido", parecer: string) => Promise<Resultado>

  // reservas (RF14)
  reservarLivro: (livroId: string, socioId?: string) => Promise<Resultado>
  cancelarReserva: (id: string) => Promise<Resultado>

  // notificações (RF05)
  executarRotinaAgora: () => RelatorioRotina | null
  reenviarNotificacao: (id: string) => Resultado

  // mesas (RF10 / RF11)
  agendarMesa: (socioId: string, data: string, turno: Turno, mesaId?: string) => Promise<ResultadoAgendamento>
  entrarNaFila: (socioId: string, data: string, turno: Turno) => Promise<ResultadoAgendamento>
  cancelarAgendamento: (id: string) => Promise<Resultado>
  desistirDaFila: (id: string) => Promise<Resultado>
  // Espaço Kids (US29) e confirmação de uso (US30)
  agendarKids: (
    socioId: string,
    data: string,
    turno: Turno,
    crianca: CriancaKids,
    mesaId?: string,
  ) => Promise<ResultadoAgendamento>
  entrarNaFilaKids: (socioId: string, data: string, turno: Turno, crianca: CriancaKids) => Promise<ResultadoAgendamento>
  confirmarUso: (agendamentoId: string) => Promise<Resultado>

  // parcerias (RF13 / RN25 / RN26)
  salvarReceptor: (dados: DadosReceptor, id?: string) => Promise<Resultado>
  excluirReceptor: (id: string) => Promise<Resultado>
  registrarDoacao: (receptorId: string, exemplarIds: string[], observacao?: string) => Promise<Resultado>
  registrarAquisicao: (receptorId: string, livroId: string, tombamentos: string[], observacao?: string) => Promise<Resultado>

  // repositório digital (RF08 / RF17)
  adicionarArquivo: (arq: Omit<ArquivoDigital, "id" | "dataUpload">, idArmazenado: string) => Promise<Resultado>
  excluirArquivo: (id: string) => Promise<Resultado>
  salvarPasta: (dados: Omit<PastaHistorica, "id">, id?: string) => Promise<Resultado>
  excluirPasta: (id: string) => Promise<Resultado>

  // mural (RF12)
  salvarPublicacao: (dados: Omit<Publicacao, "id">, id?: string) => Promise<Resultado>
  excluirPublicacao: (id: string) => Promise<Resultado>

  // importação CSV (RN21 / RNF03)
  importarObras: (linhas: LinhaObra[]) => Promise<ResultadoImportacao>
  importarSocios: (linhas: LinhaSocio[]) => ResultadoImportacao

  // backups (RNF05)
  gerarBackup: () => Resultado
  restaurarBackup: (id: string) => Resultado
  importarBackup: (dados: unknown) => Resultado
  restaurarDemonstracao: () => Resultado
  exportarEstado: () => Estado
}

const StoreContext = createContext<StoreContextType | null>(null)

// Registros do acervo vindos da API (banco) no formato do estado local
const exemplarDaApi = (e: ExemplarApi): Exemplar => ({
  id: e.id,
  livroId: e.livroId,
  tombamento: e.tombamento,
  status: e.status,
  ...(e.localizacao ? { localizacao: e.localizacao } : {}),
  ...(e.baixa ? { baixa: e.baixa } : {}),
})

// O banco é a fonte do acervo para o administrador que entrou pela API:
// obras, autores, exemplares e desbastes locais são substituídos pelos do banco
const acervoParaEstado = (atual: Estado, a: AcervoApi): Estado => ({
  ...atual,
  autores: a.autores,
  livros: a.livros,
  exemplares: a.exemplares.map(exemplarDaApi),
  desbastes: a.desbastes,
})

// Com a API no ar, o banco também é a fonte da circulação (empréstimos, multas,
// danos, reservas), dos sócios-leitores e do repositório digital
const circulacaoParaEstado = (atual: Estado, c: CirculacaoApi): Estado => ({
  ...atual,
  socios: c.socios,
  emprestimos: c.emprestimos,
  multas: c.multas,
  ocorrencias: c.ocorrencias,
  reservas: c.reservas,
})

const mesasParaEstado = (atual: Estado, m: EstadoMesasApi & { mesas: MesaEstudo[] }): Estado => ({
  ...atual,
  mesas: m.mesas,
  agendamentos: m.agendamentos,
  fila: m.fila,
})

const parceriasParaEstado = (atual: Estado, p: ParceriasApi): Estado => ({
  ...atual,
  instituicoes: p.instituicoes,
  movimentacoes: p.movimentacoes,
})

const repositorioParaEstado = (atual: Estado, r: RepositorioApi): Estado => ({
  ...atual,
  pastas: r.pastas,
  arquivos: r.documentos,
})

// Sócio conectado pela API: o próprio cadastro (com o id do banco) e a própria circulação.
// O registro local com o mesmo CPF é trocado pelo do banco; a senha local é mantida
// para o modo de demonstração (o banco nunca devolve a senha).
const minhaCirculacaoParaEstado = (
  atual: Estado,
  m: { socio?: SocioLeitor; emprestimos: Emprestimo[]; multas: Multa[]; reservas: Reserva[] },
  senhaLocal?: string,
): Estado => {
  const s = m.socio
  const anterior = s ? atual.socios.find((x) => x.id === s.id || (!!s.cpf && x.cpf === s.cpf)) : undefined
  const socio = s ? { ...anterior, ...s, senha: senhaLocal ?? anterior?.senha ?? "" } : undefined
  return {
    ...atual,
    socios: socio ? [...atual.socios.filter((x) => x !== anterior && x.id !== socio.id), socio] : atual.socios,
    emprestimos: m.emprestimos,
    multas: m.multas,
    reservas: m.reservas,
    ocorrencias: [],
  }
}

type PerfilApi = "admin" | "socio" | "publico"

// Carrega do banco tudo o que o perfil usa (e o mural, que é de todos); só aplica se
// todas as leituras derem certo, para a tela nunca misturar dados do banco com dados
// antigos do navegador
async function carregarDoBanco(
  perfil: PerfilApi,
  token?: string,
): Promise<{ ok: true; aplicar: (e: Estado, senhaLocal?: string) => Estado } | { ok: false; mensagem: string }> {
  const [base, mural] = await Promise.all([carregarDadosDoPerfil(perfil, token), muralDaApi()])
  if (!base.ok) return base
  if (mural.tipo !== "ok") {
    return {
      ok: false,
      mensagem: mural.tipo === "erro" ? mural.mensagem : "Não foi possível carregar os dados do servidor. Tente novamente.",
    }
  }
  return { ok: true, aplicar: (e, senhaLocal) => ({ ...base.aplicar(e, senhaLocal), publicacoes: mural.dados.publicacoes }) }
}

async function carregarDadosDoPerfil(
  perfil: PerfilApi,
  token?: string,
): Promise<{ ok: true; aplicar: (e: Estado, senhaLocal?: string) => Estado } | { ok: false; mensagem: string }> {
  const falhou = (r: RespostaApi<unknown>) => ({
    ok: false as const,
    mensagem: r.tipo === "erro" ? r.mensagem : "Não foi possível carregar os dados do servidor. Tente novamente.",
  })
  if (perfil === "admin" && token) {
    const [a, c, r, me, pa] = await Promise.all([
      acervoDaApi(token),
      circulacaoDaApi(token),
      repositorioDaApi(),
      mesasDaApi(token),
      parceriasDaApi(token),
    ])
    if (a.tipo !== "ok") return falhou(a)
    if (c.tipo !== "ok") return falhou(c)
    if (r.tipo !== "ok") return falhou(r)
    if (me.tipo !== "ok") return falhou(me)
    if (pa.tipo !== "ok") return falhou(pa)
    return {
      ok: true,
      aplicar: (e) =>
        parceriasParaEstado(
          mesasParaEstado(repositorioParaEstado(circulacaoParaEstado(acervoParaEstado(e, a.dados), c.dados), r.dados), me.dados),
          pa.dados,
        ),
    }
  }
  if (perfil === "socio" && token) {
    const [a, m, r, me] = await Promise.all([
      acervoPublicoDaApi(),
      minhaCirculacaoDaApi(token),
      repositorioDaApi(),
      mesasDaApi(token),
    ])
    if (a.tipo !== "ok") return falhou(a)
    if (m.tipo !== "ok") return falhou(m)
    if (r.tipo !== "ok") return falhou(r)
    if (me.tipo !== "ok") return falhou(me)
    return {
      ok: true,
      aplicar: (e, senhaLocal) =>
        mesasParaEstado(
          repositorioParaEstado(minhaCirculacaoParaEstado(acervoParaEstado(e, a.dados), m.dados, senhaLocal), r.dados),
          me.dados,
        ),
    }
  }
  const [a, r] = await Promise.all([acervoPublicoDaApi(), repositorioDaApi()])
  if (a.tipo !== "ok") return falhou(a)
  if (r.tipo !== "ok") return falhou(r)
  return { ok: true, aplicar: (e) => repositorioParaEstado(acervoParaEstado(e, a.dados), r.dados) }
}

// troca o registro de mesmo id (ou acrescenta no início)
const trocar = <T extends { id: string }>(lista: T[], item: T): T[] =>
  lista.some((x) => x.id === item.id) ? lista.map((x) => (x.id === item.id ? item : x)) : [item, ...lista]

const NEGADO = "Acesso negado: esta operação não é permitida para o seu perfil (RNF02)."

export function StoreProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>(() => carregarEstado() ?? criarEstadoInicial())
  const [sessao, setSessao] = useState<Sessao>(() => carregarSessao())
  const [alertaLogin, setAlertaLogin] = useState(false)
  const [relatorio, setRelatorio] = useState<RelatorioRotina | null>(null)
  const [persistenciaOk, setPersistenciaOk] = useState(true)
  const [relogio, setRelogio] = useState(() => Date.now())
  // Inicia a geração dos arquivos de demonstração durante a renderização, antes dos
  // efeitos dos componentes filhos, para que as leituras de imagem aguardem por ela
  const [demo] = useState(() => {
    const p = garantirArquivosDemo()
    aguardarAntesDeLer(p)
    return p
  })

  // referência sempre atualizada: permite encadear ações no mesmo evento
  const ref = useRef(estado)
  const commit = useCallback((novo: Estado) => {
    ref.current = novo
    setEstado(novo)
  }, [])

  // Persistência local a cada alteração
  useEffect(() => {
    setPersistenciaOk(salvarEstado(estado))
  }, [estado])

  useEffect(() => {
    salvarSessao(sessao)
  }, [sessao])

  const sessaoRef = useRef(sessao)
  useEffect(() => {
    sessaoRef.current = sessao
  }, [sessao])

  // Ao abrir o app, confere se o token salvo ainda vale (expirou, cadastro
  // desativado no banco...) e recarrega do banco o que o perfil usa (acervo,
  // circulação, repositório). Sem resposta da API, mantém os dados do navegador.
  useEffect(() => {
    const token = sessao.token
    ;(async () => {
      let perfil: PerfilApi = "publico"
      if (token) {
        const r = await usuarioDoToken(token)
        if (r.tipo === "indisponivel") return
        if (r.tipo === "erro") {
          if (r.status !== 401) return
          setSessao({ perfil: "publico", usuarioId: null })
          setAlertaLogin(false)
        } else {
          perfil = r.dados.usuario.perfil
        }
      }
      const c = await carregarDoBanco(perfil, perfil === "publico" ? undefined : token)
      if (!c.ok) return
      commit(c.aplicar(ref.current))
      // sessão aberta no modo de demonstração (sem a API) e a API agora responde:
      // encerra, para o próximo login usar o banco em vez dos dados do navegador
      if (!token && sessao.perfil !== "publico") {
        setSessao({ perfil: "publico", usuarioId: null })
        setAlertaLogin(false)
      }
    })()
  }, []) // só na abertura

  // Rotina diária (vencimentos, reservas, fila, notificações) + backup automático (RNF05)
  const rodarRotina = useCallback(
    (forcar: boolean): RelatorioRotina | null => {
      const atual = ref.current
      const hoje = hojeISO()
      const agora = new Date()
      const { estado: novo, relatorio: rel } = aplicarRotinas(atual, hoje, agora.toISOString(), agora.getHours(), {
        expirarReservas: !sessaoRef.current.token,
        cuidarDaFila: !sessaoRef.current.token,
      })
      const mudou =
        rel.notificacoes + rel.reservasExpiradas + rel.filaExpirada + rel.contemplados + rel.vagasLiberadas > 0 ||
        atual.ultimaRotina !== hoje
      if (mudou || forcar) {
        commit(novo)
        setRelatorio(rel)
      }
      return rel
    },
    [commit],
  )

  useEffect(() => {
    rodarRotina(false)
    backupAutomaticoDoDia(ref.current)
    demo
      .then((tamanhos) => {
        if (Object.keys(tamanhos).length === 0) return
        const atual = ref.current
        commit({
          ...atual,
          arquivos: atual.arquivos.map((a) => (tamanhos[a.id] ? { ...a, ...tamanhos[a.id] } : a)),
        })
      })
      .catch(() => undefined)

    const timer = setInterval(() => {
      setRelogio(Date.now())
      rodarRotina(false)
      backupAutomaticoDoDia(ref.current)
    }, 60_000)
    return () => clearInterval(timer)
  }, [rodarRotina, commit, demo])

  const api = useMemo<StoreContextType>(() => {
    const e = estado
    const hoje = hojeISO()
    const perfil = sessao.perfil
    const socioLogado = perfil === "socio" ? e.socios.find((s) => s.id === sessao.usuarioId) ?? null : null
    const adminLogado =
      perfil === "admin" ? e.administradores.find((a) => a.id === sessao.usuarioId) ?? null : null

    const ehAdmin = () => sessao.perfil === "admin"
    const ehSocio = () => sessao.perfil === "socio"
    const agora = () => agoraISO()

    // Sessão aberta pela API: acervo, circulação, sócios, repositório, mural, mesas e
    // parcerias vivem no banco e as ações dessas áreas passam por ela (notificações e
    // backups ainda são locais)
    const viaApi = () => sessao.perfil === "admin" && !!sessao.token
    const socioViaApi = () => sessao.perfil === "socio" && !!sessao.token
    const falhaDaApi = (r: Exclude<RespostaApi<unknown>, { tipo: "ok" }>): Resultado => {
      if (r.tipo === "indisponivel") {
        return falha("Servidor indisponível: não foi possível gravar no banco de dados. Tente novamente.")
      }
      if (r.status === 401) {
        setSessao({ perfil: "publico", usuarioId: null })
        setAlertaLogin(false)
        return falha("Sessão expirada. Entre novamente.")
      }
      return falha(r.mensagem)
    }
    // copia uma obra gravada no banco para o estado local (autores incluídos)
    const espelharLivro = (atual: Estado, l: LivroApi): Estado => {
      const autores = [...atual.autores]
      for (const a of l.autores) if (!autores.some((x) => x.id === a.id)) autores.push(a)
      const livro: Livro = {
        id: l.id,
        titulo: l.titulo,
        autorIds: l.autores.map((a) => a.id),
        editora: l.editora,
        edicao: l.edicao,
        ano: l.ano,
        categoria: l.categoria,
        secao: l.secao,
        isbn: l.isbn,
        sinopse: l.sinopse,
      }
      const existe = atual.livros.some((x) => x.id === livro.id)
      return {
        ...atual,
        autores,
        livros: existe ? atual.livros.map((x) => (x.id === livro.id ? livro : x)) : [...atual.livros, livro],
      }
    }

    // -------------------- seletores --------------------
    const getLivro = (id: string) => e.livros.find((l) => l.id === id)
    const getSocio = (id: string) => e.socios.find((s) => s.id === id)
    const livroDoExemplar = (exId: string) => {
      const ex = e.exemplares.find((x) => x.id === exId)
      return ex ? getLivro(ex.livroId) : undefined
    }
    const tituloDoExemplar = (exId: string) => livroDoExemplar(exId)?.titulo ?? "Obra removida"

    const podeVerSocio = (socioId: string) =>
      sessao.perfil === "admin" || (sessao.perfil === "socio" && sessao.usuarioId === socioId)

    // -------------------- sessão --------------------
    // Login pelas contas guardadas no navegador (usado quando a API não responde)
    const entrarLocal = (usuario: string, senha: string): Resultado & { perfil?: PerfilUsuario } => {
      const u = usuario.trim()
      if (!u || !senha) return falha("Informe usuário e senha.")
      const atual = ref.current
      const admin = atual.administradores.find((a) => normalizar(a.usuario) === normalizar(u))
      if (admin && conferirSenha(senha, admin.senha)) {
        setSessao({ perfil: "admin", usuarioId: admin.id, loginEm: agora() })
        return { ...ok(`Bem-vindo(a), ${admin.nome}.`), perfil: "admin" }
      }
      const cpf = somenteDigitos(u)
      const socio = atual.socios.find(
        (s) =>
          !s.anonimizado &&
          ((cpf.length === 11 && s.cpf === cpf) || (s.email && normalizar(s.email) === normalizar(u))),
      )
      if (socio && conferirSenha(senha, socio.senha)) {
        if (!socio.ativo) return falha("Cadastro inativo. Procure a biblioteca para reativá-lo.")
        setSessao({ perfil: "socio", usuarioId: socio.id, loginEm: agora() })
        // RN11: alerta de pendências logo após o login
        const d = calcDebitos(atual, socio.id, hojeISO())
        setAlertaLogin(d.atrasados.length > 0 || d.multasAbertas.length > 0)
        return { ...ok(`Bem-vindo(a), ${socio.nome.split(" ")[0]}.`), perfil: "socio" }
      }
      return falha("Usuário ou senha incorretos.")
    }

    // Abre a sessão com a resposta da API (login ou cadastro). O restante do app
    // ainda usa os dados do navegador, então o cadastro vindo do banco é copiado
    // para o registro local equivalente (mesmo CPF ou usuário), ou cria um novo.
    const abrirSessaoDaApi = async (
      dados: LoginApi,
      senha: string,
      loginDigitado: string,
    ): Promise<Resultado & { perfil?: PerfilUsuario }> => {
      const { token, usuario: conta, cadastro, mensagem } = dados
      const u = loginDigitado

      // os dados do perfil vêm do banco (carregados antes de abrir a sessão,
      // para a tela nunca mostrar um acervo e gravar em outro)
      const carga = await carregarDoBanco(conta.perfil, token)
      if (!carga.ok) return falha(carga.mensagem)
      const atual = ref.current
      // a senha local acompanha a do banco, para o modo de demonstração continuar valendo
      const senhaLocal = hashSenha(senha)

      if (conta.perfil === "admin") {
        const login = "usuario" in cadastro ? cadastro.usuario : u
        const existente = atual.administradores.find((a) => normalizar(a.usuario) === normalizar(login))
        const admin: Administrador = { id: existente?.id ?? conta.id, nome: conta.nome, usuario: login, senha: senhaLocal }
        const comAdmin: Estado = {
          ...atual,
          administradores: existente
            ? atual.administradores.map((a) => (a.id === existente.id ? admin : a))
            : [...atual.administradores, admin],
        }
        commit(carga.aplicar(comAdmin))
        setSessao({ perfil: "admin", usuarioId: admin.id, loginEm: agora(), token })
        return { ...ok(mensagem), perfil: "admin" }
      }

      if (!("cpf" in cadastro)) return falha("Resposta inesperada do servidor. Tente novamente.")
      // o sócio passa a ter no navegador o mesmo id do banco (empréstimos e multas apontam para ele)
      const existente = atual.socios.find((s) => !s.anonimizado && s.cpf === cadastro.cpf)
      const socio: SocioLeitor = {
        ...existente, // mantém o que só existe no navegador (ex.: foto)
        id: conta.id,
        nome: conta.nome,
        cpf: cadastro.cpf,
        rg: cadastro.rg,
        telefone: cadastro.telefone,
        email: cadastro.email,
        dataNascimento: cadastro.dataNascimento || existente?.dataNascimento,
        endereco: cadastro.endereco,
        senha: senhaLocal,
        ativo: true,
        dataCadastro: cadastro.dataCadastro || existente?.dataCadastro || hoje,
        consentimentoLgpd: cadastro.consentimentoLgpd,
      }
      const comSocio = {
        ...atual,
        socios: [...atual.socios.filter((s) => s !== existente && s.id !== socio.id), socio],
      }
      const novo = carga.aplicar(comSocio, senhaLocal)
      commit(novo)
      setSessao({ perfil: "socio", usuarioId: socio.id, loginEm: agora(), token })
      // RN11: alerta se o banco ou os dados locais apontarem pendências
      const d = calcDebitos(novo, socio.id, hojeISO())
      setAlertaLogin(Boolean(conta.pendencias) || d.atrasados.length > 0 || d.multasAbertas.length > 0)
      return { ...ok(mensagem), perfil: "socio" }
    }

    const AVISO_SEM_SERVIDOR = "Servidor indisponível: usando os dados de demonstração."

    // Login validado no banco de dados pela API.
    // Sem resposta da API, cai nas contas locais de demonstração.
    const entrar = async (usuario: string, senha: string): Promise<Resultado & { perfil?: PerfilUsuario }> => {
      const u = usuario.trim()
      if (!u || !senha) return falha("Informe usuário e senha.")

      const r = await loginNaApi(u, senha)
      if (r.tipo === "indisponivel") {
        const local = entrarLocal(u, senha)
        return local.ok ? { ...local, mensagem: `${local.mensagem} ${AVISO_SEM_SERVIDOR}` } : local
      }
      if (r.tipo === "erro") return falha(r.mensagem)
      return await abrirSessaoDaApi(r.dados, senha, u)
    }

    // Cadastro feito pelo próprio visitante: grava o sócio-leitor no banco pela
    // API e já entra no sistema. Sem resposta da API, cadastra só no navegador.
    const cadastrarConta = async (d: DadosSocio): Promise<Resultado> => {
      if (sessao.perfil !== "publico") return falha("Você já está conectado. Saia para criar outra conta.")
      const r = await cadastroNaApi(d)
      if (r.tipo === "indisponivel") {
        const local = cadastrarContaLocal(d)
        return local.ok ? { ...local, mensagem: `${local.mensagem} ${AVISO_SEM_SERVIDOR}` } : local
      }
      if (r.tipo === "erro") return falha(r.mensagem)
      return await abrirSessaoDaApi(r.dados, d.senha ?? "", d.cpf)
    }

    // Cadastro só no navegador (usado quando a API não responde)
    const cadastrarContaLocal = (d: DadosSocio): Resultado => {
      const atual = ref.current
      const erro = validarSocio(atual, d)
      if (erro) return falha(erro)
      if (d.senha !== d.senha?.trim()) return falha("A senha não pode começar nem terminar com espaço.")
      const novo: SocioLeitor = {
        id: uuid(),
        nome: d.nome.trim(),
        cpf: somenteDigitos(d.cpf),
        rg: d.rg.trim(),
        telefone: somenteDigitos(d.telefone),
        email: d.email.trim().toLowerCase(),
        dataNascimento: d.dataNascimento,
        endereco: {
          rua: d.endereco.rua.trim(),
          numero: d.endereco.numero.trim(),
          bairro: d.endereco.bairro.trim(),
          cep: somenteDigitos(d.endereco.cep),
        },
        senha: hashSenha(d.senha!),
        ativo: true,
        dataCadastro: hoje,
        consentimentoLgpd: hoje,
      }
      commit({ ...atual, socios: [...atual.socios, novo] })
      setSessao({ perfil: "socio", usuarioId: novo.id, loginEm: agora() })
      return ok(`Conta criada. Bem-vindo(a), ${novo.nome.split(" ")[0]}!`)
    }

    const sair = () => {
      setSessao({ perfil: "publico", usuarioId: null })
      setAlertaLogin(false)
    }

    // -------------------- acervo --------------------
    const resolverAutores = (atual: Estado, nomes: string[]) => {
      // reaproveita autores já cadastrados (evita duplicidade no catálogo)
      const autores = [...atual.autores]
      const ids = nomes.map((nome) => {
        const existente = autores.find((a) => normalizar(a.nome) === normalizar(nome))
        if (existente) return existente.id
        const novo = { id: uuid(), nome: nome.trim() }
        autores.push(novo)
        return novo.id
      })
      return { autores, ids }
    }

    const salvarLivro = async (dados: DadosLivro, id?: string): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO) // RN15
      const atual = ref.current
      const titulo = dados.titulo.trim()
      if (!titulo) return falha("Informe o título da obra.")
      const erroAutor = validarAutores(dados.autores)
      if (erroAutor) return falha(erroAutor)
      if (!dados.editora.trim()) return falha("Informe a editora.")
      if (!dados.edicao.trim()) return falha("Informe a edição.")
      const anoAtual = new Date().getFullYear()
      if (!Number.isInteger(dados.ano) || dados.ano < 1400 || dados.ano > anoAtual) {
        return falha(`Ano inválido. Informe um ano entre 1400 e ${anoAtual}.`)
      }
      const secao = dados.secao.trim().toUpperCase()
      if (!LETRAS_SECAO.includes(secao)) return falha("A seção deve ser uma letra de A a Z (RN22).")
      if (!isbnValido(dados.isbn)) return falha("ISBN inválido. Confira os dígitos (ISBN-10 ou ISBN-13).")
      const chaveIsbn = dados.isbn.replace(/[-\s]/g, "")
      const duplicado = atual.livros.find((l) => l.id !== id && l.isbn.replace(/[-\s]/g, "") === chaveIsbn)
      if (duplicado) return falha(`Já existe uma obra com este ISBN: "${duplicado.titulo}".`)

      if (viaApi()) {
        const r = await salvarLivroNaApi(sessao.token!, { ...dados, titulo, secao }, id)
        if (r.tipo !== "ok") return falhaDaApi(r)
        commit(espelharLivro(ref.current, r.dados.livro))
        return ok(r.dados.mensagem)
      }

      const nomes = dados.autores.map((n) => n.trim()).filter(Boolean)
      const { autores, ids } = resolverAutores(atual, nomes)
      const livro: Livro = {
        id: id ?? uuid(),
        titulo,
        autorIds: ids,
        editora: dados.editora.trim(),
        edicao: dados.edicao.trim(),
        ano: dados.ano,
        categoria: dados.categoria,
        secao,
        isbn: dados.isbn.trim(),
        sinopse: dados.sinopse?.trim() || undefined,
      }
      commit({
        ...atual,
        autores,
        livros: id ? atual.livros.map((l) => (l.id === id ? livro : l)) : [...atual.livros, livro],
      })
      return ok(id ? "Obra atualizada." : "Obra cadastrada. Agora cadastre os exemplares (RN16).")
    }

    const excluirLivro = async (id: string): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO)
      const atual = ref.current
      const exs = atual.exemplares.filter((x) => x.livroId === id)
      if (exs.some((x) => !x.baixa)) {
        return falha("A obra possui exemplares no acervo. Desbaste ou exclua os exemplares antes.")
      }
      const exIds = new Set(exs.map((x) => x.id))
      if (atual.emprestimos.some((emp) => exIds.has(emp.exemplarId)) || atual.movimentacoes.some((m) => m.livroId === id)) {
        return falha("A obra tem histórico de empréstimos ou doações e não pode ser excluída.")
      }
      if (atual.arquivos.some((a) => a.vinculo.tipo === "livro" && a.vinculo.livroId === id)) {
        return falha("Há digitalizações vinculadas a esta obra no repositório. Remova-as antes.")
      }
      if (viaApi()) {
        const r = await excluirLivroNaApi(sessao.token!, id)
        if (r.tipo !== "ok") return falhaDaApi(r)
      }
      commit({
        ...ref.current,
        livros: ref.current.livros.filter((l) => l.id !== id),
        exemplares: ref.current.exemplares.filter((x) => x.livroId !== id),
      })
      return ok("Obra excluída.")
    }

    const tombamentoEmUso = (atual: Estado, tomb: string, ignorarId?: string) =>
      atual.exemplares.some((x) => x.id !== ignorarId && normalizar(x.tombamento) === normalizar(tomb))

    const adicionarExemplares = async (livroId: string, tombamentos: string[], localizacao?: string): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO) // RN15
      const atual = ref.current
      if (!atual.livros.some((l) => l.id === livroId)) {
        return falha("Não é possível cadastrar o exemplar: a obra não está cadastrada (RN16).")
      }
      const lista = tombamentos.map((t) => t.trim().toUpperCase()).filter(Boolean)
      if (lista.length === 0) return falha("Informe ao menos um código de tombamento.")
      if (new Set(lista).size !== lista.length) return falha("Há códigos de tombamento repetidos na lista.")
      const emUso = lista.find((t) => tombamentoEmUso(atual, t))
      if (emUso) return falha(`O tombamento ${emUso} já pertence a outro exemplar.`)
      const local = localizacao?.trim() ?? ""
      if (local.length > 80) return falha("Localização muito longa (máximo de 80 caracteres).")
      if (viaApi()) {
        const r = await adicionarExemplaresNaApi(sessao.token!, livroId, lista, local || undefined)
        if (r.tipo !== "ok") return falhaDaApi(r)
        commit({ ...ref.current, exemplares: [...ref.current.exemplares, ...r.dados.exemplares.map(exemplarDaApi)] })
        return ok(r.dados.mensagem)
      }
      const novos: Exemplar[] = lista.map((tombamento) => ({
        id: uuid(), // RN20
        livroId,
        tombamento,
        status: "disponivel",
        ...(local ? { localizacao: local } : {}),
      }))
      commit({ ...atual, exemplares: [...atual.exemplares, ...novos] })
      return ok(`${novos.length} exemplar(es) cadastrado(s) com identificador único (UUID).`)
    }

    const editarExemplar = async (
      id: string,
      dados: { tombamento: string; status: StatusExemplar; localizacao?: string },
    ): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO) // RN12
      const atual = ref.current
      const ex = atual.exemplares.find((x) => x.id === id)
      if (!ex) return falha("Exemplar não encontrado.")
      const tomb = dados.tombamento.trim().toUpperCase()
      if (!tomb) return falha("Informe o código de tombamento.")
      // sem localização informada, mantém a atual
      const local = dados.localizacao === undefined ? ex.localizacao ?? "" : dados.localizacao.trim()
      if (local.length > 80) return falha("Localização muito longa (máximo de 80 caracteres).")
      if (tombamentoEmUso(atual, tomb, id)) return falha(`O tombamento ${tomb} já pertence a outro exemplar.`)
      if (dados.status !== ex.status) {
        if (emprestimoAtivoDoExemplar(atual, id)) {
          return falha("O exemplar está emprestado. O status muda automaticamente na devolução.")
        }
        if (reservaAtivaDoExemplar(atual, id)) {
          return falha("O exemplar está reservado. Cancele a reserva antes de alterar o status.")
        }
        if (dados.status === "reservado") {
          return falha('O status "Reservado" é definido pela reserva de um sócio-leitor.')
        }
      }
      if (viaApi()) {
        // só envia o status se mudou: o status "reservado" de reservas locais não existe no banco
        const mudouStatus = dados.status !== ex.status
        const r = await editarExemplarNaApi(sessao.token!, id, {
          tombamento: tomb,
          localizacao: local,
          ...(mudouStatus ? { status: dados.status } : {}),
        })
        if (r.tipo !== "ok") return falhaDaApi(r)
        const novo = r.dados.exemplar
        commit({
          ...ref.current,
          exemplares: ref.current.exemplares.map((x) =>
            x.id === id
              ? {
                  ...x,
                  tombamento: novo.tombamento,
                  localizacao: novo.localizacao,
                  ...(mudouStatus ? { status: novo.status } : {}),
                }
              : x,
          ),
        })
        return ok(r.dados.mensagem)
      }
      commit({
        ...atual,
        exemplares: atual.exemplares.map((x) =>
          x.id === id ? { ...x, tombamento: tomb, status: dados.status, localizacao: local || undefined } : x,
        ),
      })
      return ok("Exemplar atualizado.")
    }

    const excluirExemplar = async (id: string): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO)
      const atual = ref.current
      const temHistorico =
        atual.emprestimos.some((emp) => emp.exemplarId === id) || atual.reservas.some((r) => r.exemplarId === id)
      if (temHistorico) {
        return falha("O exemplar tem histórico de circulação. Para retirá-lo do acervo, use o desbastamento.")
      }
      if (viaApi()) {
        const r = await excluirExemplarNaApi(sessao.token!, id)
        if (r.tipo !== "ok") return falhaDaApi(r)
      }
      commit({ ...ref.current, exemplares: ref.current.exemplares.filter((x) => x.id !== id) })
      return ok("Exemplar excluído (cadastro feito por engano).")
    }

    const desbastarExemplar = async (id: string, relatorioTexto: string): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO)
      const atual = ref.current
      const ex = atual.exemplares.find((x) => x.id === id)
      if (!ex || ex.baixa) return falha("Exemplar não encontrado no acervo.")
      // RN31: somente ociosos ou danificados
      if (!STATUS_DESBASTAVEIS.includes(ex.status)) {
        return falha(
          `Somente exemplares ociosos ou danificados podem ser desbastados (RN31). Status atual: ${labelStatus[ex.status]}.`,
        )
      }
      // RN24: relatório justificando a decisão
      if (relatorioTexto.trim().length < MIN_JUSTIFICATIVA) {
        return falha(`Anexe o relatório justificando o desbastamento (mínimo ${MIN_JUSTIFICATIVA} caracteres) (RN24).`)
      }
      if (viaApi()) {
        const r = await desbastarNaApi(sessao.token!, id, relatorioTexto.trim())
        if (r.tipo !== "ok") return falhaDaApi(r)
        const reg = r.dados.desbaste
        commit({
          ...ref.current,
          exemplares: ref.current.exemplares.map((x) =>
            x.id === id ? { ...x, baixa: { data: reg.data, motivo: "desbaste" } } : x,
          ),
          desbastes: [reg, ...ref.current.desbastes],
        })
        return ok(r.dados.mensagem)
      }
      const registro: Desbaste = {
        id: uuid(),
        exemplarId: id,
        livroId: ex.livroId,
        tombamento: ex.tombamento,
        statusAnterior: ex.status,
        relatorio: relatorioTexto.trim(),
        data: hoje,
        admin: adminLogado?.nome,
      }
      commit({
        ...atual,
        exemplares: atual.exemplares.map((x) => (x.id === id ? { ...x, baixa: { data: hoje, motivo: "desbaste" } } : x)),
        desbastes: [registro, ...atual.desbastes],
      })
      return ok(`Exemplar ${ex.tombamento} desbastado. O relatório foi registrado.`)
    }

    // -------------------- sócios-leitores --------------------
    // US29: conta própria só a partir dos 12 anos; até os 11, a criança usa o
    // Espaço Kids pelo agendamento de um sócio-leitor responsável
    function validarNascimentoSocio(dataNascimento: string): string | null {
      if (!dataValida(dataNascimento)) return "Informe a data de nascimento."
      if (dataNascimento > hoje) return "A data de nascimento não pode estar no futuro."
      const anos = idade(dataNascimento, hoje)
      if (anos > 120) return "Data de nascimento inválida. Confira o ano."
      if (anos < IDADE_MINIMA_SOCIO) {
        return `O cadastro de sócio-leitor é permitido a partir dos ${IDADE_MINIMA_SOCIO} anos. Crianças de até ${IDADE_MAXIMA_KIDS} anos usam o Espaço Kids pelo agendamento de um sócio-leitor responsável.`
      }
      return null
    }

    function validarSocio(atual: Estado, d: DadosSocio, id?: string): string | null {
      if (d.nome.trim().split(/\s+/).length < 2) return "Informe o nome completo."
      if (!cpfValido(d.cpf)) return "CPF inválido."
      const cpf = somenteDigitos(d.cpf)
      if (atual.socios.some((s) => s.id !== id && s.cpf === cpf)) return "Já existe um sócio-leitor com este CPF."
      const erroNascimento = validarNascimentoSocio(d.dataNascimento)
      if (erroNascimento) return erroNascimento
      if (!telefoneValido(d.telefone)) return "Telefone inválido. Use DDD + número."
      if (!emailValido(d.email)) return "E-mail inválido."
      if (atual.socios.some((s) => s.id !== id && s.email && normalizar(s.email) === normalizar(d.email))) {
        return "Este e-mail já está em uso por outro sócio-leitor."
      }
      const end = d.endereco
      if (!end.rua.trim() || !end.numero.trim() || !end.bairro.trim()) return "Preencha rua, número e bairro."
      if (!cepValido(end.cep)) return "CEP inválido."
      if (!id && (!d.senha || d.senha.length < 6)) return "A senha inicial deve ter ao menos 6 caracteres."
      if (!d.consentimentoLgpd) return "É necessário registrar o consentimento do titular para o tratamento dos dados (LGPD)."
      return null
    }

    const salvarSocio = async (d: DadosSocio, id?: string): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO) // RN29
      const atual = ref.current
      const erro = validarSocio(atual, d, id)
      if (erro) return falha(erro)
      if (viaApi()) {
        // a foto antiga é apagada pelo servidor
        const r = await salvarSocioNaApi(sessao.token!, d, id)
        if (r.tipo !== "ok") return falhaDaApi(r)
        commit({ ...ref.current, socios: trocar(ref.current.socios, r.dados.socio) })
        return ok(r.dados.mensagem)
      }
      const base = {
        nome: d.nome.trim(),
        cpf: somenteDigitos(d.cpf),
        rg: d.rg.trim(),
        telefone: somenteDigitos(d.telefone),
        email: d.email.trim().toLowerCase(),
        dataNascimento: d.dataNascimento,
        endereco: {
          rua: d.endereco.rua.trim(),
          numero: d.endereco.numero.trim(),
          bairro: d.endereco.bairro.trim(),
          cep: somenteDigitos(d.endereco.cep),
        },
        fotoId: d.fotoId,
      }
      if (id) {
        const anterior = atual.socios.find((s) => s.id === id)
        if (!anterior) return falha("Sócio-leitor não encontrado.")
        if (anterior.fotoId && anterior.fotoId !== d.fotoId) removerArquivos([anterior.fotoId])
        commit({
          ...atual,
          socios: atual.socios.map((s) =>
            s.id === id ? { ...s, ...base, consentimentoLgpd: s.consentimentoLgpd || hoje } : s,
          ),
        })
        return ok("Cadastro atualizado.")
      }
      const novo: SocioLeitor = {
        id: uuid(),
        ...base,
        senha: hashSenha(d.senha!),
        ativo: true,
        dataCadastro: hoje,
        consentimentoLgpd: hoje,
      }
      commit({ ...atual, socios: [...atual.socios, novo] })
      return ok("Sócio-leitor cadastrado.")
    }

    const alternarAtivoSocio = async (id: string): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO)
      if (viaApi()) {
        const r = await alternarAtivoSocioNaApi(sessao.token!, id)
        if (r.tipo !== "ok") return falhaDaApi(r)
        commit({
          ...ref.current,
          socios: trocar(ref.current.socios, r.dados.socio),
          agendamentos: r.dados.agendamentos,
          fila: r.dados.fila,
        })
        return ok(r.dados.mensagem)
      }
      const atual = ref.current
      const s = atual.socios.find((x) => x.id === id)
      if (!s) return falha("Sócio-leitor não encontrado.")
      if (s.anonimizado) return falha("Cadastro anonimizado não pode ser reativado.")
      if (s.ativo && emprestimosAtivos(atual, id).length > 0) {
        return falha("O sócio-leitor tem empréstimos em andamento. Registre as devoluções antes de inativar.")
      }
      const novo = { ...atual, socios: atual.socios.map((x) => (x.id === id ? { ...x, ativo: !x.ativo } : x)) }
      commit(s.ativo ? liberarMesasDoSocio(novo, id, hoje, new Date().getHours(), agora()) : novo)
      return ok(s.ativo ? "Sócio-leitor inativado." : "Sócio-leitor reativado.")
    }

    const redefinirSenhaSocio = async (id: string, novaSenha: string): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO)
      if (novaSenha.length < 6) return falha("A senha deve ter ao menos 6 caracteres.")
      if (viaApi()) {
        const r = await redefinirSenhaSocioNaApi(sessao.token!, id, novaSenha)
        if (r.tipo !== "ok") return falhaDaApi(r)
        const depois = ref.current
        commit({ ...depois, socios: depois.socios.map((s) => (s.id === id ? { ...s, senha: hashSenha(novaSenha) } : s)) })
        return ok(r.dados.mensagem)
      }
      const atual = ref.current
      commit({ ...atual, socios: atual.socios.map((s) => (s.id === id ? { ...s, senha: hashSenha(novaSenha) } : s)) })
      return ok("Senha redefinida. Informe a nova senha ao sócio-leitor.")
    }

    // LGPD: as crianças do Espaço Kids ficam ligadas ao responsável; sem ele
    // identificado, os dados delas também são apagados
    const CRIANCA_ANONIMA: CriancaKids = { nome: "Criança (dados eliminados)", cpf: "", dataNascimento: "" }
    const semDadosDasCriancas = (e: Estado, socioId: string): Estado => ({
      ...e,
      agendamentos: e.agendamentos.map((a) => (a.socioId === socioId && a.crianca ? { ...a, crianca: CRIANCA_ANONIMA } : a)),
      fila: e.fila.map((f) => (f.socioId === socioId && f.crianca ? { ...f, crianca: CRIANCA_ANONIMA } : f)),
    })

    // RNF06 / LGPD: eliminação dos dados pessoais a pedido do titular
    const anonimizarSocio = async (id: string): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO)
      if (viaApi()) {
        const r = await anonimizarSocioNaApi(sessao.token!, id)
        if (r.tipo !== "ok") return falhaDaApi(r)
        const depois = semDadosDasCriancas(ref.current, id)
        const liberados = new Set(depois.reservas.filter((x) => x.socioId === id && x.status === "ativa").map((x) => x.exemplarId))
        commit({
          ...depois,
          socios: trocar(depois.socios, r.dados.socio),
          reservas: depois.reservas.map((x) => (x.socioId === id && x.status === "ativa" ? { ...x, status: "cancelada" } : x)),
          exemplares: depois.exemplares.map((x) => (liberados.has(x.id) && x.status === "reservado" ? { ...x, status: "disponivel" } : x)),
          agendamentos: r.dados.agendamentos,
          fila: r.dados.fila,
        })
        return ok(r.dados.mensagem)
      }
      const atual = ref.current
      const s = atual.socios.find((x) => x.id === id)
      if (!s) return falha("Sócio-leitor não encontrado.")
      if (emprestimosAtivos(atual, id).length > 0 || calcDebitos(atual, id, hoje).multasAbertas.length > 0) {
        return falha("Não é possível anonimizar: há empréstimos ou multas em aberto.")
      }
      if (s.fotoId) removerArquivos([s.fotoId])
      const limpo = semDadosDasCriancas(atual, id)
      const anonimizado: Estado = {
        ...limpo,
        socios: atual.socios.map((x) =>
          x.id === id
            ? {
                ...x,
                nome: `Titular anonimizado ${x.id.slice(0, 4).toUpperCase()}`,
                cpf: "",
                rg: "",
                telefone: "",
                email: "",
                dataNascimento: undefined,
                endereco: { rua: "", numero: "", bairro: "", cep: "" },
                fotoId: undefined,
                senha: "",
                ativo: false,
                anonimizado: true,
              }
            : x,
        ),
        reservas: atual.reservas.map((r) => (r.socioId === id && r.status === "ativa" ? { ...r, status: "cancelada" } : r)),
      }
      // as mesas futuras voltam para a fila, e o sócio sai das filas em que estava
      commit(liberarMesasDoSocio(anonimizado, id, hoje, new Date().getHours(), agora()))
      return ok("Dados pessoais eliminados. O histórico de circulação foi mantido sem identificação.")
    }

    // -------------------- circulação --------------------
    // Com a sessão pela API, o servidor aplica as regras (as mesmas destas ações)
    // e a resposta é copiada para o estado local
    const espelharEmprestimo = (emp: Emprestimo, statusExemplar?: StatusExemplar) => {
      const atual = ref.current
      commit({
        ...atual,
        emprestimos: trocar(atual.emprestimos, emp),
        exemplares: statusExemplar
          ? atual.exemplares.map((x) => (x.id === emp.exemplarId ? { ...x, status: statusExemplar } : x))
          : atual.exemplares,
        // a retirada da reserva é registrada pelo banco junto com o empréstimo
        reservas:
          statusExemplar === "indisponivel"
            ? atual.reservas.map((r) =>
                r.exemplarId === emp.exemplarId && r.socioId === emp.socioId && r.status === "ativa"
                  ? { ...r, status: "retirada" }
                  : r,
              )
            : atual.reservas,
      })
    }
    const espelharMulta = (m: Multa) => commit({ ...ref.current, multas: trocar(ref.current.multas, m) })

    const realizarEmprestimo = async (socioId: string, exemplarId: string): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO) // RN27
      if (viaApi()) {
        const r = await emprestarNaApi(sessao.token!, socioId, exemplarId)
        if (r.tipo !== "ok") return falhaDaApi(r)
        espelharEmprestimo(r.dados.emprestimo, "indisponivel")
        return ok(r.dados.mensagem)
      }
      const atual = ref.current
      const socio = atual.socios.find((s) => s.id === socioId)
      // RN06: somente sócios-leitores ativos
      if (!socio || !socio.ativo) return falha("Somente sócios-leitores ativos podem fazer empréstimos (RN06).")
      // RN08: dívidas pendentes bloqueiam
      const motivo = motivoBloqueio(atual, socioId, hoje)
      if (motivo) return falha(`Empréstimo bloqueado: o sócio-leitor possui ${motivo} (RN08).`)

      const ex = atual.exemplares.find((x) => x.id === exemplarId && !x.baixa)
      if (!ex) return falha("Exemplar não encontrado no acervo.")
      const livro = atual.livros.find((l) => l.id === ex.livroId)
      if (!livro) return falha("Obra não encontrada.")
      // RN04 / RNF09: obras restritas
      if (!categoriaEmprestavel(livro.categoria)) {
        return falha(`${labelCategoria[livro.categoria]}: obra de consulta local, não pode ser emprestada (RN04).`)
      }
      // RN14: exemplar sem empréstimo ativo
      if (emprestimoAtivoDoExemplar(atual, exemplarId)) {
        return falha("Este exemplar já possui um empréstimo ativo (RN14).")
      }
      const reserva = reservaAtivaDoExemplar(atual, exemplarId)
      if (reserva && reserva.socioId !== socioId) {
        return falha("Este exemplar está reservado para outro sócio-leitor.")
      }
      if (!reserva && ex.status !== "disponivel") {
        return falha(`Exemplar indisponível para empréstimo (status: ${labelStatus[ex.status]}).`)
      }
      // RN01: no máximo 3 exemplares simultâneos
      if (emprestimosAtivos(atual, socioId).length >= MAX_EXEMPLARES_SIMULTANEOS) {
        return falha(`Limite de ${MAX_EXEMPLARES_SIMULTANEOS} exemplares simultâneos atingido (RN01).`)
      }

      const emp: Emprestimo = {
        id: uuid(),
        socioId,
        exemplarId,
        dataEmprestimo: hoje, // RF07
        dataPrevista: addDays(hoje, PRAZO_EMPRESTIMO_DIAS), // RN02
        renovacoes: 0,
        status: "ativo",
        historico: [{ data: agora(), texto: "Empréstimo registrado." }],
      }
      commit({
        ...atual,
        emprestimos: [...atual.emprestimos, emp],
        exemplares: atual.exemplares.map((x) => (x.id === exemplarId ? { ...x, status: "indisponivel" } : x)),
        reservas: reserva
          ? atual.reservas.map((r) => (r.id === reserva.id ? { ...r, status: "retirada" } : r))
          : atual.reservas,
      })
      return ok(`Empréstimo registrado. Devolução prevista para ${emp.dataPrevista.split("-").reverse().join("/")}.`)
    }

    const renovarEmprestimo = async (id: string): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO) // RN27
      if (viaApi()) {
        const r = await renovarNaApi(sessao.token!, id)
        if (r.tipo !== "ok") return falhaDaApi(r)
        espelharEmprestimo(r.dados.emprestimo)
        return ok(r.dados.mensagem)
      }
      const atual = ref.current
      const emp = atual.emprestimos.find((x) => x.id === id)
      if (!emp || emp.status !== "ativo") return falha("Somente empréstimos em andamento podem ser renovados.")
      if (emp.renovacoes >= MAX_RENOVACOES) return falha(`Limite de ${MAX_RENOVACOES} renovações atingido (RN17).`)
      if (diasAtraso(emp.dataPrevista, hoje) > 0) {
        return falha("Empréstimo em atraso não pode ser renovado. Registre a devolução para calcular a multa.")
      }
      const novaData = addDays(emp.dataPrevista, PRAZO_EMPRESTIMO_DIAS) // RN02
      commit({
        ...atual,
        emprestimos: atual.emprestimos.map((x) =>
          x.id === id
            ? {
                ...x,
                renovacoes: x.renovacoes + 1,
                dataPrevista: novaData,
                historico: [...x.historico, { data: agora(), texto: `Renovação ${x.renovacoes + 1}: novo prazo ${novaData}.` }],
              }
            : x,
        ),
      })
      return ok(`Empréstimo renovado por mais ${PRAZO_EMPRESTIMO_DIAS} dias (${emp.renovacoes + 1}/${MAX_RENOVACOES}).`)
    }

    const alterarEmprestimo = async (id: string, novaDataPrevista: string, motivo: string): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO)
      if (viaApi()) {
        const r = await alterarEmprestimoNaApi(sessao.token!, id, novaDataPrevista, motivo)
        if (r.tipo !== "ok") return falhaDaApi(r)
        espelharEmprestimo(r.dados.emprestimo)
        return ok(r.dados.mensagem)
      }
      const atual = ref.current
      const emp = atual.emprestimos.find((x) => x.id === id)
      if (!emp || emp.status !== "ativo") return falha("Somente empréstimos em andamento podem ser alterados.")
      if (!novaDataPrevista || novaDataPrevista < emp.dataEmprestimo) {
        return falha("A data prevista não pode ser anterior à data de saída.")
      }
      if (motivo.trim().length < 10) return falha("Descreva o motivo da alteração (mínimo 10 caracteres).")
      commit({
        ...atual,
        emprestimos: atual.emprestimos.map((x) =>
          x.id === id
            ? {
                ...x,
                dataPrevista: novaDataPrevista,
                historico: [
                  ...x.historico,
                  { data: agora(), texto: `Prazo alterado de ${x.dataPrevista} para ${novaDataPrevista}: ${motivo.trim()}` },
                ],
              }
            : x,
        ),
      })
      return ok("Empréstimo alterado. A alteração ficou registrada no histórico.")
    }

    const cancelarEmprestimo = async (id: string, motivo: string): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO)
      if (viaApi()) {
        const r = await cancelarEmprestimoNaApi(sessao.token!, id, motivo)
        if (r.tipo !== "ok") return falhaDaApi(r)
        espelharEmprestimo(r.dados.emprestimo, "disponivel")
        return ok(r.dados.mensagem)
      }
      const atual = ref.current
      const emp = atual.emprestimos.find((x) => x.id === id)
      if (!emp || emp.status !== "ativo") return falha("Somente empréstimos em andamento podem ser cancelados.")
      if (motivo.trim().length < 10) return falha("Descreva o motivo do cancelamento (mínimo 10 caracteres).")
      commit({
        ...atual,
        emprestimos: atual.emprestimos.map((x) =>
          x.id === id
            ? {
                ...x,
                status: "cancelado",
                motivoCancelamento: motivo.trim(),
                historico: [...x.historico, { data: agora(), texto: `Cancelado: ${motivo.trim()}` }],
              }
            : x,
        ),
        exemplares: atual.exemplares.map((x) => (x.id === emp.exemplarId ? { ...x, status: "disponivel" } : x)),
      })
      return ok("Empréstimo cancelado. O exemplar voltou a ficar disponível.")
    }

    const devolverEmprestimo = async (id: string, dano?: DadosDano): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO)
      const atual = ref.current
      const emp = atual.emprestimos.find((x) => x.id === id)
      if (!emp || emp.status !== "ativo") return falha("Empréstimo não está em andamento.")
      if (dano) {
        if (dano.relatorio.trim().length < MIN_JUSTIFICATIVA) {
          return falha(`Descreva o dano no relatório (mínimo ${MIN_JUSTIFICATIVA} caracteres) (RF15).`)
        }
        if (!(dano.valor > 0)) return falha("Informe o valor da multa pelo dano (RN13).")
      }
      if (viaApi()) {
        // RN03 (multa por atraso) e RF15 (dano) calculados no servidor
        const r = await devolverNaApi(sessao.token!, id, dano ? { ...dano, relatorio: dano.relatorio.trim() } : undefined)
        if (r.tipo !== "ok") return falhaDaApi(r)
        espelharEmprestimo(r.dados.emprestimo, dano ? "danificado" : "disponivel")
        const depois = ref.current
        const oc = r.dados.ocorrencia
        commit({
          ...depois,
          multas: [...depois.multas.filter((m) => !r.dados.multas.some((n) => n.id === m.id)), ...r.dados.multas],
          ocorrencias: oc ? [oc, ...depois.ocorrencias] : depois.ocorrencias,
        })
        return ok(r.dados.mensagem)
      }

      const novasMultas: Multa[] = []
      const dias = diasAtraso(emp.dataPrevista, hoje)
      // RN03: R$ 1,00 por dia de atraso, por exemplar
      if (dias > 0) {
        novasMultas.push({
          id: uuid(),
          socioId: emp.socioId,
          emprestimoId: emp.id,
          valor: dias * MULTA_POR_DIA,
          motivo: "atraso",
          status: "pendente",
          dias,
          data: hoje,
          pareceres: [],
        })
      }
      let ocorrencia: OcorrenciaDano | null = null
      if (dano) {
        const multaDano: Multa = {
          id: uuid(),
          socioId: emp.socioId,
          emprestimoId: emp.id,
          valor: Math.round(dano.valor * 100) / 100,
          motivo: "dano",
          status: "pendente",
          data: hoje,
          pareceres: [],
        }
        novasMultas.push(multaDano)
        ocorrencia = {
          id: uuid(),
          emprestimoId: emp.id,
          exemplarId: emp.exemplarId,
          socioId: emp.socioId,
          multaId: multaDano.id,
          relatorio: dano.relatorio.trim(),
          imagemIds: dano.imagemIds,
          valorMulta: multaDano.valor,
          data: hoje,
        }
      }

      commit({
        ...atual,
        emprestimos: atual.emprestimos.map((x) =>
          x.id === id
            ? {
                ...x,
                status: "devolvido",
                dataDevolucao: hoje, // RF07
                devolvidoDanificado: !!dano,
                historico: [...x.historico, { data: agora(), texto: dano ? "Devolvido com dano." : "Devolvido." }],
              }
            : x,
        ),
        // RN12 / RN13: exemplar danificado sai de circulação; senão volta a ficar disponível
        exemplares: atual.exemplares.map((x) =>
          x.id === emp.exemplarId ? { ...x, status: dano ? "danificado" : "disponivel" } : x,
        ),
        multas: [...atual.multas, ...novasMultas],
        ocorrencias: ocorrencia ? [ocorrencia, ...atual.ocorrencias] : atual.ocorrencias,
      })

      const partes = ["Devolução registrada."]
      if (dias > 0) partes.push(`Multa por atraso: ${formatCurrency(dias * MULTA_POR_DIA)} (${dias} dia(s)).`)
      if (dano) partes.push(`Multa por dano: ${formatCurrency(dano.valor)}.`)
      return ok(partes.join(" "))
    }

    const quitarMulta = async (id: string): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO)
      if (viaApi()) {
        const r = await quitarMultaNaApi(sessao.token!, id)
        if (r.tipo !== "ok") return falhaDaApi(r)
        espelharMulta(r.dados.multa)
        return ok(r.dados.mensagem)
      }
      const atual = ref.current
      const m = atual.multas.find((x) => x.id === id)
      if (!m || (m.status !== "pendente" && m.status !== "em_analise")) return falha("Multa não está em aberto.")
      commit({
        ...atual,
        multas: atual.multas.map((x) => (x.id === id ? { ...x, status: "paga", dataQuitacao: hoje } : x)),
      })
      return ok(`Pagamento de ${formatCurrency(m.valor)} registrado.`)
    }

    // RN07: justificativa registrada pelo sócio-leitor (ou pelo balcão, em nome dele)
    const registrarJustificativa = async (multaId: string, texto: string): Promise<Resultado> => {
      const atual = ref.current
      const m = atual.multas.find((x) => x.id === multaId)
      if (!m) return falha("Multa não encontrada.")
      const permitido = ehAdmin() || (ehSocio() && sessao.usuarioId === m.socioId)
      if (!permitido) return falha(NEGADO)
      if (m.status !== "pendente") return falha("Só é possível justificar uma multa pendente.")
      if (texto.trim().length < MIN_JUSTIFICATIVA) {
        return falha(`Escreva uma justificativa fundamentada (mínimo ${MIN_JUSTIFICATIVA} caracteres).`)
      }
      if (viaApi() || socioViaApi()) {
        const r = await justificarMultaNaApi(sessao.token!, multaId, texto.trim())
        if (r.tipo !== "ok") return falhaDaApi(r)
        espelharMulta(r.dados.multa)
        return ok(r.dados.mensagem)
      }
      commit({
        ...atual,
        multas: atual.multas.map((x) =>
          x.id === multaId ? { ...x, status: "em_analise", justificativa: { texto: texto.trim(), data: hoje } } : x,
        ),
      })
      return ok("Justificativa enviada. Ela será avaliada pela administração da biblioteca.")
    }

    const julgarJustificativa = async (
      multaId: string,
      decisao: "deferido" | "indeferido",
      parecer: string,
    ): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO)
      const atual = ref.current
      const m = atual.multas.find((x) => x.id === multaId)
      if (!m || m.status !== "em_analise" || !m.justificativa) return falha("Não há justificativa aguardando julgamento.")
      if (parecer.trim().length < 10) return falha("Registre o parecer da decisão (mínimo 10 caracteres).")
      if (viaApi()) {
        const r = await julgarMultaNaApi(sessao.token!, multaId, decisao, parecer.trim())
        if (r.tipo !== "ok") return falhaDaApi(r)
        espelharMulta(r.dados.multa)
        return ok(r.dados.mensagem)
      }
      commit({
        ...atual,
        multas: atual.multas.map((x) =>
          x.id === multaId
            ? {
                ...x,
                status: decisao === "deferido" ? "abonada" : "pendente",
                pareceres: [
                  ...x.pareceres,
                  {
                    decisao,
                    texto: parecer.trim(),
                    data: hoje,
                    adminId: sessao.usuarioId ?? "",
                    justificativa: m.justificativa!.texto,
                  },
                ],
                justificativa: decisao === "deferido" ? x.justificativa : undefined,
              }
            : x,
        ),
      })
      return decisao === "deferido"
        ? ok("Justificativa deferida: multa abonada e pendência liberada.")
        : ok("Justificativa indeferida: a dívida foi mantida.")
    }

    // -------------------- reservas --------------------
    const reservarLivro = async (livroId: string, socioIdParam?: string): Promise<Resultado> => {
      const socioId = ehSocio() ? sessao.usuarioId : socioIdParam
      if (!ehAdmin() && !ehSocio()) return falha("Entre como sócio-leitor para reservar (RN06).")
      if (!socioId) return falha("Selecione o sócio-leitor.")
      if (viaApi() || socioViaApi()) {
        const r = await reservarNaApi(sessao.token!, livroId, ehAdmin() ? socioId : undefined)
        if (r.tipo !== "ok") return falhaDaApi(r)
        const reserva = r.dados.reserva
        const depois = ref.current
        commit({
          ...depois,
          reservas: trocar(depois.reservas, reserva),
          exemplares: depois.exemplares.map((x) => (x.id === reserva.exemplarId ? { ...x, status: "reservado" } : x)),
        })
        return ok(r.dados.mensagem)
      }
      const atual = ref.current
      const socio = atual.socios.find((s) => s.id === socioId)
      if (!socio || !socio.ativo) return falha("Somente sócios-leitores ativos podem reservar (RN06).")
      const livro = atual.livros.find((l) => l.id === livroId)
      if (!livro) return falha("Obra não encontrada.")
      if (!categoriaEmprestavel(livro.categoria)) return falha("Obra de consulta local: não pode ser reservada (RN04).")
      const motivo = motivoBloqueio(atual, socioId, hoje)
      if (motivo) return falha(`Reserva bloqueada: há ${motivo} (RN08).`)
      if (reservasAtivas(atual, socioId).some((r) => atual.exemplares.find((x) => x.id === r.exemplarId)?.livroId === livroId)) {
        return falha("Você já possui uma reserva ativa desta obra.")
      }
      const ocupados = emprestimosAtivos(atual, socioId).length + reservasAtivas(atual, socioId).length
      if (ocupados >= MAX_EXEMPLARES_SIMULTANEOS) {
        return falha(`Empréstimos e reservas somados não podem passar de ${MAX_EXEMPLARES_SIMULTANEOS} (RN01).`)
      }
      const ex = exemplaresDoLivro(atual, livroId).find(
        (x) => x.status === "disponivel" && !emprestimoAtivoDoExemplar(atual, x.id),
      )
      if (!ex) return falha("Não há exemplar disponível para reserva no momento.")
      const reserva: Reserva = {
        id: uuid(),
        socioId,
        exemplarId: ex.id,
        dataReserva: hoje,
        expiraEm: addDays(hoje, PRAZO_RESERVA_DIAS),
        status: "ativa",
      }
      commit({
        ...atual,
        reservas: [reserva, ...atual.reservas],
        exemplares: atual.exemplares.map((x) => (x.id === ex.id ? { ...x, status: "reservado" } : x)),
      })
      return ok(`Reserva confirmada. Retire o livro no balcão até ${reserva.expiraEm.split("-").reverse().join("/")}.`)
    }

    const cancelarReserva = async (id: string): Promise<Resultado> => {
      const atual = ref.current
      const r = atual.reservas.find((x) => x.id === id)
      if (!r || r.status !== "ativa") return falha("Reserva não está ativa.")
      if (!ehAdmin() && !(ehSocio() && sessao.usuarioId === r.socioId)) return falha(NEGADO) // RN28
      if (viaApi() || socioViaApi()) {
        const resp = await cancelarReservaNaApi(sessao.token!, id)
        if (resp.tipo !== "ok") return falhaDaApi(resp)
        const depois = ref.current
        commit({
          ...depois,
          reservas: trocar(depois.reservas, resp.dados.reserva),
          exemplares: depois.exemplares.map((x) =>
            x.id === r.exemplarId && x.status === "reservado" ? { ...x, status: "disponivel" } : x,
          ),
        })
        return ok(resp.dados.mensagem)
      }
      commit({
        ...atual,
        reservas: atual.reservas.map((x) => (x.id === id ? { ...x, status: "cancelada" } : x)),
        exemplares: atual.exemplares.map((x) =>
          x.id === r.exemplarId && x.status === "reservado" ? { ...x, status: "disponivel" } : x,
        ),
      })
      return ok("Reserva cancelada.")
    }

    // -------------------- notificações --------------------
    const executarRotinaAgora = () => {
      if (!ehAdmin()) return null
      return rodarRotina(true)
    }

    const reenviarNotificacao = (id: string): Resultado => {
      if (!ehAdmin()) return falha(NEGADO)
      const atual = ref.current
      const n = atual.notificacoes.find((x) => x.id === id)
      if (!n) return falha("Notificação não encontrada.")
      const socio = atual.socios.find((s) => s.id === n.socioId)
      if (!socio || !emailValido(socio.email)) {
        return falha("O cadastro continua sem e-mail válido. Atualize o cadastro do sócio-leitor antes de reenviar.")
      }
      const nova: Notificacao = {
        ...n,
        id: uuid(),
        destinatario: socio.email,
        data: agora(),
        status: "enviado",
        motivoFalha: undefined,
      }
      commit({
        ...atual,
        notificacoes: [nova, ...atual.notificacoes.map((x) => (x.id === id ? { ...x, tratadaEm: agora() } : x))],
      })
      return ok(`Notificação reenviada para ${socio.email}.`)
    }

    // -------------------- mesas de estudo --------------------
    const socioDaOperacao = (socioIdParam: string) => (ehSocio() ? (sessao.usuarioId ?? "") : socioIdParam)
    const mesasViaApi = () => viaApi() || socioViaApi()

    // Resposta das rotas de mesas: atualiza agendamentos e fila e repassa a oferta de fila
    // e o campo da criança com erro, como as regras locais fazem
    const respostaMesas = (
      r: RespostaApi<EstadoMesasApi & { mensagem: string }>,
    ): ResultadoAgendamento => {
      if (r.tipo === "ok") {
        commit({ ...ref.current, agendamentos: r.dados.agendamentos, fila: r.dados.fila })
        return ok(r.dados.mensagem)
      }
      if (r.tipo === "erro" && (r.ofereceFila || r.campo)) {
        return {
          ok: false,
          mensagem: r.mensagem,
          ...(r.ofereceFila ? { ofereceFila: true } : {}),
          ...(r.campo ? { campo: r.campo } : {}),
        }
      }
      return falhaDaApi(r)
    }
    const pedidoMesa = (socioIdParam: string, data: string, turno: Turno, extra: Partial<PedidoMesa> = {}): PedidoMesa => ({
      socioId: socioDaOperacao(socioIdParam),
      data,
      turno,
      ...extra,
    })

    const validarTurno = (data: string, turno: Turno): string | null => {
      if (!data) return "Escolha a data."
      if (data < hoje) return "Não é possível agendar em uma data passada."
      if (turnoEncerrado(data, turno, hoje, new Date().getHours())) return "Este turno já foi encerrado."
      if (data > addDays(hoje, 30)) return "Os agendamentos podem ser feitos com até 30 dias de antecedência."
      return null
    }

    // US30: sem a confirmação de uso dentro da tolerância, a vaga vai para a fila
    const AVISO_TOLERANCIA = `Apresente-se no balcão em até ${TOLERANCIA_USO_MINUTOS} minutos do início do turno; sem a confirmação de uso, a vaga é liberada.`

    const agendarMesa = async (socioIdParam: string, data: string, turno: Turno, mesaId?: string): Promise<ResultadoAgendamento> => {
      if (!ehAdmin() && !ehSocio()) return falha("Somente sócios-leitores podem agendar mesas de estudo (RN06).")
      if (mesasViaApi()) return respostaMesas(await agendarNaApi(sessao.token!, pedidoMesa(socioIdParam, data, turno, { mesaId })))
      const socioId = socioDaOperacao(socioIdParam)
      const atual = ref.current
      const socio = atual.socios.find((s) => s.id === socioId)
      if (!socio || !socio.ativo) return falha("Somente sócios-leitores ativos podem agendar mesas (RN06).")
      const erroTurno = validarTurno(data, turno)
      if (erroTurno) return falha(erroTurno)
      // RN05: um turno por dia
      const existente = agendamentoNoDia(atual, socio.id, data)
      if (existente) {
        return falha(`Já existe um agendamento neste dia (${labelTurno[existente.turno]}). O limite é 1 turno por dia (RN05).`)
      }
      if (mesaId && atual.mesas.find((m) => m.id === mesaId)?.espaco === "kids") {
        return falha("Para agendar o Espaço Kids, informe os dados da criança.")
      }
      // RN09: espaço disponível no horário escolhido
      const livres = mesasLivres(atual, data, turno)
      if (livres.length === 0) {
        return { ok: false, mensagem: "Todas as mesas estão ocupadas neste turno (RN09).", ofereceFila: true }
      }
      const mesa = mesaId ? livres.find((m) => m.id === mesaId) : livres[0]
      if (!mesa) return falha("A mesa escolhida já está ocupada neste turno (RN09). Escolha outra.")
      const ag: Agendamento = {
        id: uuid(),
        mesaId: mesa.id,
        socioId: socio.id,
        data,
        turno, // RN10
        status: "confirmado",
        origem: "direto",
        criadoEm: agora(),
      }
      commit({ ...atual, agendamentos: [...atual.agendamentos, ag] })
      return ok(
        `${mesa.nome} agendada para ${formatDate(data)}, turno da ${labelTurno[turno].toLowerCase()}. ${AVISO_TOLERANCIA}`,
      )
    }

    // Espaço Kids (US29): a criança (até 11 anos) não tem cadastro e fica ligada
    // ao sócio-leitor que agendou. Mesmas regras de turno e disponibilidade das mesas.
    const prepararKids = (
      socioIdParam: string,
      data: string,
      turno: Turno,
      c: CriancaKids,
    ): { erro: ResultadoAgendamento } | { socio: SocioLeitor; crianca: CriancaKids } => {
      if (!ehAdmin() && !ehSocio()) return { erro: falha("Somente sócios-leitores podem agendar o Espaço Kids (RN06).") }
      const socio = ref.current.socios.find((s) => s.id === socioDaOperacao(socioIdParam))
      if (!socio || !socio.ativo) return { erro: falha("Somente sócios-leitores ativos podem agendar o Espaço Kids (RN06).") }
      const erroTurno = validarTurno(data, turno)
      if (erroTurno) return { erro: falha(erroTurno) }
      const erro = validarCrianca(ref.current, c, hoje, data)
      if (erro) return { erro: { ok: false, mensagem: erro.mensagem, campo: erro.campo } }
      const crianca = { nome: c.nome.trim().replace(/\s+/g, " "), cpf: somenteDigitos(c.cpf), dataNascimento: c.dataNascimento }
      return { socio, crianca }
    }

    const agendarKids = async (
      socioIdParam: string,
      data: string,
      turno: Turno,
      c: CriancaKids,
      mesaId?: string,
    ): Promise<ResultadoAgendamento> => {
      if (!ehAdmin() && !ehSocio()) return falha("Somente sócios-leitores podem agendar o Espaço Kids (RN06).")
      if (mesasViaApi()) {
        return respostaMesas(await agendarNaApi(sessao.token!, pedidoMesa(socioIdParam, data, turno, { mesaId, crianca: c })))
      }
      const p = prepararKids(socioIdParam, data, turno, c)
      if ("erro" in p) return p.erro
      const atual = ref.current
      // RN05 aplicada à criança: um turno por dia
      const existente = agendamentoKidsNoDia(atual, p.crianca.cpf, data)
      if (existente) {
        return falha(
          `${primeiroNome(p.crianca.nome)} já tem agendamento no Espaço Kids neste dia (${labelTurno[existente.turno]}). O limite é 1 turno por dia (RN05).`,
        )
      }
      const livres = mesasLivres(atual, data, turno, "kids")
      if (livres.length === 0) {
        return { ok: false, mensagem: "Todas as mesas do Espaço Kids estão ocupadas neste turno (RN09).", ofereceFila: true }
      }
      const mesa = mesaId ? livres.find((m) => m.id === mesaId) : livres[0]
      if (!mesa) return falha("A mesa escolhida já está ocupada neste turno (RN09). Escolha outra.")
      const ag: Agendamento = {
        id: uuid(),
        mesaId: mesa.id,
        socioId: p.socio.id,
        data,
        turno,
        status: "confirmado",
        origem: "direto",
        criadoEm: agora(),
        crianca: p.crianca,
      }
      commit({ ...atual, agendamentos: [...atual.agendamentos, ag] })
      return ok(
        `${mesa.nome} agendada para ${primeiroNome(p.crianca.nome)} em ${formatDate(data)}, turno da ${labelTurno[turno].toLowerCase()}. ${AVISO_TOLERANCIA}`,
      )
    }

    const entrarNaFilaKids = async (
      socioIdParam: string,
      data: string,
      turno: Turno,
      c: CriancaKids,
    ): Promise<ResultadoAgendamento> => {
      if (!ehAdmin() && !ehSocio()) return falha("Somente sócios-leitores podem agendar o Espaço Kids (RN06).")
      if (mesasViaApi()) return respostaMesas(await entrarNaFilaNaApi(sessao.token!, pedidoMesa(socioIdParam, data, turno, { crianca: c })))
      const p = prepararKids(socioIdParam, data, turno, c)
      if ("erro" in p) return p.erro
      const atual = ref.current
      if (agendamentoKidsNoDia(atual, p.crianca.cpf, data)) {
        return falha(`${primeiroNome(p.crianca.nome)} já tem agendamento no Espaço Kids neste dia (RN05).`)
      }
      if (mesasLivres(atual, data, turno, "kids").length > 0) {
        return falha("Há mesas livres no Espaço Kids neste turno: faça o agendamento direto.")
      }
      if (atual.fila.some((f) => f.status === "aguardando" && f.data === data && f.crianca?.cpf === p.crianca.cpf)) {
        return falha(`${primeiroNome(p.crianca.nome)} já está na fila do Espaço Kids neste dia.`)
      }
      const fila = filaDoTurno(atual, data, turno, "kids")
      const entrada: EntradaFila = {
        id: uuid(),
        socioId: p.socio.id,
        data,
        turno,
        criadoEm: agora(),
        status: "aguardando",
        crianca: p.crianca,
      }
      commit({ ...atual, fila: [...atual.fila, entrada] })
      return ok(`${primeiroNome(p.crianca.nome)} entrou na fila de espera do Espaço Kids na posição ${fila.length + 1}.`)
    }

    // US30: o funcionário confirma que o espaço agendado está em uso. No Espaço Kids,
    // a confirmação encerra a fila de espera daquele turno (US29).
    const confirmarUso = async (id: string): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO)
      if (viaApi()) return respostaMesas(await confirmarUsoNaApi(sessao.token!, id))
      const atual = ref.current
      const ag = atual.agendamentos.find((a) => a.id === id)
      if (!ag || ag.status !== "confirmado") return falha("Agendamento não encontrado.")
      if (ag.usoConfirmadoEm) return falha("O uso deste agendamento já foi confirmado.")
      if (ag.data !== hoje) return falha("O uso só pode ser confirmado no dia do agendamento.")
      if (turnoEncerrado(ag.data, ag.turno, hoje, new Date().getHours())) return falha("O turno já foi encerrado.")
      const { estado, retirados } = confirmarUsoNoEstado(atual, id, agora())
      commit(estado)
      const quem = ag.crianca ? primeiroNome(ag.crianca.nome) : primeiroNome(atual.socios.find((s) => s.id === ag.socioId)?.nome ?? "")
      return ok(
        `Uso confirmado: ${quem} está no espaço.` +
          (retirados > 0 ? ` ${retirados} sócio(s)-leitor(es) foram retirados da fila de espera do Espaço Kids deste turno.` : ""),
      )
    }

    const entrarNaFila = async (socioIdParam: string, data: string, turno: Turno): Promise<ResultadoAgendamento> => {
      if (!ehAdmin() && !ehSocio()) return falha("Somente sócios-leitores podem entrar na fila (RN06).")
      if (mesasViaApi()) return respostaMesas(await entrarNaFilaNaApi(sessao.token!, pedidoMesa(socioIdParam, data, turno)))
      const socioId = socioDaOperacao(socioIdParam)
      const atual = ref.current
      const socio = atual.socios.find((s) => s.id === socioId)
      if (!socio || !socio.ativo) return falha("Somente sócios-leitores ativos (RN06).")
      const erroTurno = validarTurno(data, turno)
      if (erroTurno) return falha(erroTurno)
      if (agendamentoNoDia(atual, socio.id, data)) return falha("Você já tem um agendamento neste dia (RN05).")
      if (mesasLivres(atual, data, turno).length > 0) return falha("Há mesas livres neste turno: faça o agendamento direto.")
      const fila = filaDoTurno(atual, data, turno)
      if (fila.some((f) => f.socioId === socio.id)) return falha("Você já está na fila deste turno.")
      if (atual.fila.some((f) => f.socioId === socio.id && f.data === data && f.status === "aguardando")) {
        return falha("Você já está na fila de outro turno neste dia (RN05).")
      }
      const entrada: EntradaFila = {
        id: uuid(),
        socioId: socio.id,
        data,
        turno,
        criadoEm: agora(),
        status: "aguardando",
      }
      commit({ ...atual, fila: [...atual.fila, entrada] })
      return ok(`Você entrou na fila de espera na posição ${fila.length + 1}.`)
    }

    const cancelarAgendamento = async (id: string): Promise<Resultado> => {
      if (mesasViaApi()) return respostaMesas(await cancelarAgendamentoNaApi(sessao.token!, id))
      const atual = ref.current
      const ag = atual.agendamentos.find((a) => a.id === id)
      if (!ag || ag.status !== "confirmado") return falha("Agendamento não encontrado.")
      if (!ehAdmin() && !(ehSocio() && sessao.usuarioId === ag.socioId)) return falha(NEGADO)
      if (turnoEncerrado(ag.data, ag.turno, hoje, new Date().getHours())) return falha("O turno já foi encerrado.")
      let novo: Estado = {
        ...atual,
        agendamentos: atual.agendamentos.map((a) => (a.id === id ? { ...a, status: "cancelado" } : a)),
      }
      // RF11: a mesa liberada contempla o primeiro da fila do mesmo espaço
      const antes = novo.fila.filter((f) => f.status === "contemplado").length
      novo = processarFila(novo, ag.data, ag.turno, agora(), espacoDoAgendamento(atual, ag))
      const contemplados = novo.fila.filter((f) => f.status === "contemplado").length - antes
      commit(novo)
      return ok(
        contemplados > 0
          ? "Agendamento cancelado. A mesa foi repassada ao primeiro da fila de espera."
          : "Agendamento cancelado. A mesa está livre.",
      )
    }

    const desistirDaFila = async (id: string): Promise<Resultado> => {
      if (mesasViaApi()) return respostaMesas(await desistirDaFilaNaApi(sessao.token!, id))
      const atual = ref.current
      const f = atual.fila.find((x) => x.id === id)
      if (!f || f.status !== "aguardando") return falha("Entrada não está na fila.")
      if (!ehAdmin() && !(ehSocio() && sessao.usuarioId === f.socioId)) return falha(NEGADO)
      commit({ ...atual, fila: atual.fila.map((x) => (x.id === id ? { ...x, status: "desistiu" } : x)) })
      return ok("Você saiu da fila. As posições foram reordenadas.")
    }

    // -------------------- parcerias --------------------
    const salvarReceptor = async (d: DadosReceptor, id?: string): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO)
      const atual = ref.current
      if (d.nome.trim().length < 3) return falha("Informe o nome.")
      const doc = somenteDigitos(d.documento)
      if (d.tipo === "instituicao" && !cnpjValido(doc)) return falha("CNPJ inválido.")
      if (d.tipo === "pessoa_fisica" && !cpfValido(doc)) return falha("CPF inválido.")
      if (atual.instituicoes.some((i) => i.id !== id && i.documento === doc)) {
        return falha("Já existe um receptor cadastrado com este documento.")
      }
      if (d.endereco.trim().length < 5) return falha("Informe o endereço.")
      if (d.contato.trim().length < 5) return falha("Informe um contato (telefone ou e-mail).")
      if (viaApi()) {
        const r = await salvarInstituicaoNaApi(sessao.token!, { ...d, documento: doc }, id)
        if (r.tipo !== "ok") return falhaDaApi(r)
        commit({ ...ref.current, instituicoes: trocar(ref.current.instituicoes, r.dados.instituicao) })
        return ok(r.dados.mensagem)
      }
      const registro: Instituicao = {
        id: id ?? uuid(),
        tipo: d.tipo,
        nome: d.nome.trim(),
        documento: doc,
        endereco: d.endereco.trim(),
        contato: d.contato.trim(),
      }
      commit({
        ...atual,
        instituicoes: id
          ? atual.instituicoes.map((i) => (i.id === id ? registro : i))
          : [...atual.instituicoes, registro],
      })
      return ok(id ? "Cadastro atualizado." : "Receptor cadastrado.")
    }

    const excluirReceptor = async (id: string): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO)
      if (viaApi()) {
        const r = await excluirInstituicaoNaApi(sessao.token!, id)
        if (r.tipo !== "ok") return falhaDaApi(r)
        commit({ ...ref.current, instituicoes: ref.current.instituicoes.filter((i) => i.id !== id) })
        return ok(r.dados.mensagem)
      }
      const atual = ref.current
      if (atual.movimentacoes.some((m) => m.receptorId === id)) {
        return falha("O receptor possui doações ou aquisições registradas e não pode ser excluído (rastreabilidade).")
      }
      commit({ ...atual, instituicoes: atual.instituicoes.filter((i) => i.id !== id) })
      return ok("Receptor excluído.")
    }

    const livrosDoadosPara = (atual: Estado, receptorId: string) =>
      atual.movimentacoes
        .filter((m) => m.tipo === "doacao" && m.receptorId === receptorId)
        .reduce((acc, m) => acc + m.tombamentos.length, 0)

    const registrarDoacao = async (receptorId: string, exemplarIds: string[], observacao?: string): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO)
      if (viaApi()) {
        const r = await registrarDoacaoNaApi(sessao.token!, receptorId, exemplarIds, observacao)
        if (r.tipo !== "ok") return falhaDaApi(r)
        const depois = ref.current
        const ids = new Set(exemplarIds)
        commit({
          ...depois,
          movimentacoes: [r.dados.movimentacao, ...depois.movimentacoes],
          exemplares: depois.exemplares.map((x) =>
            ids.has(x.id) ? { ...x, baixa: { data: r.dados.movimentacao.data, motivo: "doacao" } } : x,
          ),
        })
        return ok(r.dados.mensagem)
      }
      const atual = ref.current
      // RN25: receptor precisa estar cadastrado
      const receptor = atual.instituicoes.find((i) => i.id === receptorId)
      if (!receptor) return falha("O receptor precisa estar cadastrado antes da doação (RN25).")
      if (exemplarIds.length === 0) return falha("Selecione o(s) exemplar(es) doado(s).")
      const exs = exemplarIds.map((id) => atual.exemplares.find((x) => x.id === id && !x.baixa))
      if (exs.some((x) => !x)) return falha("Exemplar não encontrado no acervo.")
      const livroIds = new Set(exs.map((x) => x!.livroId))
      if (livroIds.size !== 1) return falha("Registre uma doação por obra.")
      const indisponivel = exs.find((x) => x!.status !== "disponivel" && x!.status !== "ocioso")
      if (indisponivel) {
        return falha(`O exemplar ${indisponivel.tombamento} está ${labelStatus[indisponivel.status].toLowerCase()} e não pode ser doado.`)
      }
      // RN26: pessoa física recebe no máximo 1 livro
      if (receptor.tipo === "pessoa_fisica") {
        const jaRecebidos = livrosDoadosPara(atual, receptorId)
        if (jaRecebidos + exs.length > MAX_DOACOES_PESSOA_FISICA) {
          return falha(
            `Pessoa física pode receber no máximo ${MAX_DOACOES_PESSOA_FISICA} livro. ${receptor.nome} já recebeu ${jaRecebidos} (RN26).`,
          )
        }
      }
      const ids = new Set(exemplarIds)
      const mov: Movimentacao = {
        id: uuid(),
        tipo: "doacao",
        livroId: [...livroIds][0],
        receptorId,
        tombamentos: exs.map((x) => x!.tombamento),
        data: hoje,
        observacao: observacao?.trim() || undefined,
      }
      commit({
        ...atual,
        movimentacoes: [mov, ...atual.movimentacoes],
        exemplares: atual.exemplares.map((x) => (ids.has(x.id) ? { ...x, baixa: { data: hoje, motivo: "doacao" } } : x)),
      })
      return ok(`Doação registrada para ${receptor.nome}.`)
    }

    const registrarAquisicao = async (
      receptorId: string,
      livroId: string,
      tombamentos: string[],
      observacao?: string,
    ): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO)
      if (viaApi()) {
        // exemplares e movimentação na mesma transação: ou entram os dois, ou nenhum
        const r = await registrarAquisicaoNaApi(sessao.token!, receptorId, livroId, tombamentos, observacao)
        if (r.tipo !== "ok") return falhaDaApi(r)
        const depois = ref.current
        commit({
          ...depois,
          movimentacoes: [r.dados.movimentacao, ...depois.movimentacoes],
          exemplares: [...depois.exemplares, ...r.dados.exemplares.map(exemplarDaApi)],
        })
        return ok(r.dados.mensagem)
      }
      const atual = ref.current
      const receptor = atual.instituicoes.find((i) => i.id === receptorId)
      if (!receptor) return falha("A instituição ou pessoa de origem precisa estar cadastrada (RN25).")
      const r = await adicionarExemplares(livroId, tombamentos) // RN16 / RN20
      if (!r.ok) return r
      const depois = ref.current
      const mov: Movimentacao = {
        id: uuid(),
        tipo: "aquisicao",
        livroId,
        receptorId,
        tombamentos: tombamentos.map((t) => t.trim().toUpperCase()).filter(Boolean),
        data: hoje,
        observacao: observacao?.trim() || undefined,
      }
      commit({ ...depois, movimentacoes: [mov, ...depois.movimentacoes] })
      return ok(`Aquisição registrada: ${mov.tombamentos.length} exemplar(es) incorporado(s) ao acervo.`)
    }

    // -------------------- repositório --------------------
    // Com a sessão pela API, o arquivo já foi enviado ao servidor (S3) e
    // idArmazenado é o id gerado pelo banco
    const adicionarArquivo = async (
      arq: Omit<ArquivoDigital, "id" | "dataUpload">,
      idArmazenado: string,
    ): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO)
      const atual = ref.current
      if (arq.titulo.trim().length < 3) return falha("Informe o título do arquivo.")
      if (arq.vinculo.tipo === "livro" && !atual.livros.some((l) => l.id === (arq.vinculo as { livroId: string }).livroId)) {
        return falha("A obra vinculada não está cadastrada (RF08).")
      }
      if (arq.vinculo.tipo === "pasta" && !atual.pastas.some((p) => p.id === (arq.vinculo as { pastaId: string }).pastaId)) {
        return falha("A pasta vinculada não está cadastrada (RF08).")
      }
      if (viaApi()) {
        const r = await anexarDocumentoNaApi(sessao.token!, idArmazenado, { ...arq, titulo: arq.titulo.trim() })
        if (r.tipo !== "ok") return falhaDaApi(r)
        commit({ ...ref.current, arquivos: trocar(ref.current.arquivos, r.dados.documento) })
        return ok(r.dados.mensagem)
      }
      const novo: ArquivoDigital = { ...arq, titulo: arq.titulo.trim(), id: idArmazenado, dataUpload: hoje }
      commit({ ...atual, arquivos: [novo, ...atual.arquivos] })
      return ok("Arquivo anexado e comprimido para armazenamento (RNF13).")
    }

    const excluirArquivo = async (id: string): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO)
      if (viaApi()) {
        const r = await excluirDocumentoNaApi(sessao.token!, id)
        if (r.tipo !== "ok") return falhaDaApi(r)
        commit({ ...ref.current, arquivos: ref.current.arquivos.filter((a) => a.id !== id) })
        return ok(r.dados.mensagem)
      }
      const atual = ref.current
      removerArquivos([id])
      commit({ ...atual, arquivos: atual.arquivos.filter((a) => a.id !== id) })
      return ok("Arquivo removido do repositório.")
    }

    const salvarPasta = async (d: Omit<PastaHistorica, "id">, id?: string): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO)
      const atual = ref.current
      if (d.nome.trim().length < 3) return falha("Informe o nome da pasta.")
      if (viaApi()) {
        const r = await salvarPastaNaApi(sessao.token!, { nome: d.nome.trim(), descricao: d.descricao.trim() }, id)
        if (r.tipo !== "ok") return falhaDaApi(r)
        const depois = ref.current
        const pasta = r.dados.pasta
        commit({
          ...depois,
          pastas: depois.pastas.some((p) => p.id === pasta.id)
            ? depois.pastas.map((p) => (p.id === pasta.id ? pasta : p))
            : [...depois.pastas, pasta],
        })
        return ok(r.dados.mensagem)
      }
      const pasta = { id: id ?? uuid(), nome: d.nome.trim(), descricao: d.descricao.trim() }
      commit({
        ...atual,
        pastas: id ? atual.pastas.map((p) => (p.id === id ? pasta : p)) : [...atual.pastas, pasta],
      })
      return ok(id ? "Pasta atualizada." : "Pasta de recortes cadastrada.")
    }

    const excluirPasta = async (id: string): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO)
      const atual = ref.current
      if (atual.arquivos.some((a) => a.vinculo.tipo === "pasta" && a.vinculo.pastaId === id)) {
        return falha("A pasta possui arquivos. Remova-os antes de excluir a pasta.")
      }
      if (viaApi()) {
        const r = await excluirPastaNaApi(sessao.token!, id)
        if (r.tipo !== "ok") return falhaDaApi(r)
        commit({ ...ref.current, pastas: ref.current.pastas.filter((p) => p.id !== id) })
        return ok(r.dados.mensagem)
      }
      commit({ ...atual, pastas: atual.pastas.filter((p) => p.id !== id) })
      return ok("Pasta excluída.")
    }

    // -------------------- mural --------------------
    const salvarPublicacao = async (d: Omit<Publicacao, "id">, id?: string): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO)
      const atual = ref.current
      if (d.titulo.trim().length < 3) return falha("Informe o título da publicação.")
      // RF12: descrição e/ou imagem
      if (!d.descricao.trim() && d.imagemIds.length === 0) return falha("Informe uma descrição e/ou anexe imagem(ns).")
      if (!d.data) return falha("Informe a data da publicação ou do evento.")
      if (viaApi()) {
        // as imagens retiradas da publicação são apagadas pelo servidor
        const r = await salvarPublicacaoNaApi(
          sessao.token!,
          { ...d, titulo: d.titulo.trim(), descricao: d.descricao.trim() },
          id,
        )
        if (r.tipo !== "ok") return falhaDaApi(r)
        commit({ ...ref.current, publicacoes: trocar(ref.current.publicacoes, r.dados.publicacao) })
        return ok(r.dados.mensagem)
      }
      const pub: Publicacao = { ...d, id: id ?? uuid(), titulo: d.titulo.trim(), descricao: d.descricao.trim() }
      if (id) {
        const anterior = atual.publicacoes.find((p) => p.id === id)
        const removidas = anterior?.imagemIds.filter((img) => !d.imagemIds.includes(img)) ?? []
        removerArquivos(removidas)
      }
      commit({
        ...atual,
        publicacoes: id ? atual.publicacoes.map((p) => (p.id === id ? pub : p)) : [pub, ...atual.publicacoes],
      })
      return ok(id ? "Publicação atualizada." : "Publicação adicionada ao mural.")
    }

    const excluirPublicacao = async (id: string): Promise<Resultado> => {
      if (!ehAdmin()) return falha(NEGADO)
      if (viaApi()) {
        const r = await excluirPublicacaoNaApi(sessao.token!, id)
        if (r.tipo !== "ok") return falhaDaApi(r)
        commit({ ...ref.current, publicacoes: ref.current.publicacoes.filter((p) => p.id !== id) })
        return ok(r.dados.mensagem)
      }
      const atual = ref.current
      const pub = atual.publicacoes.find((p) => p.id === id)
      if (pub) removerArquivos(pub.imagemIds)
      commit({ ...atual, publicacoes: atual.publicacoes.filter((p) => p.id !== id) })
      return ok("Publicação removida do mural.")
    }

    // -------------------- importação CSV --------------------
    const importarObras = async (linhas: LinhaObra[]): Promise<ResultadoImportacao> => {
      if (!ehAdmin()) return falha(NEGADO)
      const atual = ref.current
      const erros: ErroLinha[] = []
      for (const l of linhas) {
        const chave = l.isbn.replace(/[-\s]/g, "")
        const existente = atual.livros.find((x) => x.isbn.replace(/[-\s]/g, "") === chave)
        if (existente) erros.push({ linha: l.linha, mensagem: `ISBN já cadastrado ("${existente.titulo}")` })
        const tomb = l.tombamentos.find((t) => tombamentoEmUso(atual, t))
        if (tomb) erros.push({ linha: l.linha, mensagem: `tombamento ${tomb} já existe no acervo` })
      }
      if (erros.length > 0) {
        return { ok: false, mensagem: "Importação cancelada: há conflitos com o acervo atual.", erros }
      }
      if (viaApi()) {
        const r = await importarObrasNaApi(
          sessao.token!,
          linhas.map((l) => ({
            titulo: l.titulo,
            autores: l.autores,
            editora: l.editora,
            edicao: l.edicao,
            ano: l.ano,
            categoria: l.categoria,
            secao: l.secao,
            isbn: l.isbn,
            tombamentos: l.tombamentos,
            linha: l.linha,
          })),
        )
        if (r.tipo !== "ok") {
          const f = falhaDaApi(r)
          // a API cita a linha do erro ("Linha 4: ..."): mostra na lista de erros da tela
          const m = /^Linha (\d+): (.*)$/s.exec(f.mensagem)
          return m
            ? { ok: false, mensagem: "Importação cancelada: nada foi gravado.", erros: [{ linha: Number(m[1]), mensagem: m[2] }] }
            : f
        }
        let novo = ref.current
        for (const l of r.dados.livros) novo = espelharLivro(novo, l)
        commit({ ...novo, exemplares: [...novo.exemplares, ...r.dados.exemplares.map(exemplarDaApi)] })
        return ok(r.dados.mensagem)
      }
      let autores = atual.autores
      const livros: Livro[] = []
      const exemplares: Exemplar[] = []
      for (const l of linhas) {
        const r = resolverAutores({ ...atual, autores }, l.autores)
        autores = r.autores
        const livro: Livro = {
          id: uuid(),
          titulo: l.titulo,
          autorIds: r.ids,
          editora: l.editora,
          edicao: l.edicao,
          ano: l.ano,
          categoria: l.categoria,
          secao: l.secao,
          isbn: l.isbn,
        }
        livros.push(livro)
        for (const t of l.tombamentos) {
          exemplares.push({ id: uuid(), livroId: livro.id, tombamento: t.toUpperCase(), status: "disponivel" })
        }
      }
      commit({
        ...atual,
        autores,
        livros: [...atual.livros, ...livros],
        exemplares: [...atual.exemplares, ...exemplares],
      })
      return ok(`${livros.length} obra(s) e ${exemplares.length} exemplar(es) importados.`)
    }

    const importarSocios = (linhas: LinhaSocio[]): ResultadoImportacao => {
      if (!ehAdmin()) return falha(NEGADO)
      // sem consentimento LGPD na planilha, o banco não aceita o cadastro
      if (viaApi()) {
        return falha(
          "Com o banco de dados conectado, cadastre os sócios-leitores pela tela Sócios-leitores: a importação por planilha grava só no modo de demonstração.",
        )
      }
      const atual = ref.current
      const erros: ErroLinha[] = []
      for (const l of linhas) {
        if (atual.socios.some((s) => s.cpf === l.cpf)) erros.push({ linha: l.linha, mensagem: "CPF já cadastrado" })
      }
      if (erros.length > 0) {
        return { ok: false, mensagem: "Importação cancelada: há conflitos com os cadastros atuais.", erros }
      }
      const novos: SocioLeitor[] = linhas.map((l) => ({
        id: uuid(),
        nome: l.nome,
        cpf: l.cpf,
        rg: l.rg,
        telefone: l.telefone,
        email: l.email.toLowerCase(),
        endereco: { rua: l.rua, numero: l.numero, bairro: l.bairro, cep: l.cep },
        senha: hashSenha(l.cpf.slice(0, 6)), // senha provisória: 6 primeiros dígitos do CPF
        ativo: true,
        dataCadastro: hoje,
        consentimentoLgpd: "", // coletar no primeiro atendimento
      }))
      commit({ ...atual, socios: [...atual.socios, ...novos] })
      return ok(`${novos.length} sócio(s)-leitor(es) importados. Senha provisória: 6 primeiros dígitos do CPF.`)
    }

    // -------------------- backups --------------------
    const gerarBackup = (): Resultado => {
      if (!ehAdmin()) return falha(NEGADO)
      const b = criarBackup(ref.current, false)
      return b ? ok("Backup gerado.") : falha("Não foi possível gerar o backup: espaço de armazenamento esgotado.")
    }

    const restaurarBackup = (id: string): Resultado => {
      if (!ehAdmin()) return falha(NEGADO)
      const dados = lerBackup(id)
      if (!dados || !validarEstadoImportado(dados)) return falha("Backup corrompido ou incompatível.")
      criarBackup(ref.current, false) // ponto de retorno antes de restaurar
      commit(dados)
      return ok("Backup restaurado. Um backup do estado anterior foi gerado por segurança.")
    }

    const importarBackup = (dados: unknown): Resultado => {
      if (!ehAdmin()) return falha(NEGADO)
      if (!validarEstadoImportado(dados)) return falha("Arquivo de backup inválido ou de versão incompatível.")
      criarBackup(ref.current, false)
      commit(completarEstado(dados))
      return ok("Backup importado com sucesso.")
    }

    const restaurarDemonstracao = (): Resultado => {
      if (!ehAdmin()) return falha(NEGADO)
      criarBackup(ref.current, false)
      commit(criarEstadoInicial())
      return ok("Dados de demonstração restaurados. Um backup do estado anterior foi gerado.")
    }

    return {
      ...e,
      hoje,
      sessao,
      perfil,
      socioLogado,
      adminLogado,
      alertaLogin,
      fecharAlertaLogin: () => setAlertaLogin(false),
      ultimaRotinaRelatorio: relatorio,
      persistenciaOk,
      entrar,
      cadastrarConta,
      sair,
      getLivro,
      autoresDoLivro: (livro) => nomesAutores(e, livro.autorIds),
      exemplaresDoLivro: (livroId) => exemplaresDoLivro(e, livroId),
      livroDoExemplar,
      tituloDoExemplar,
      getSocio,
      debitos: (socioId) => calcDebitos(e, socioId, hoje),
      socioBloqueado: (socioId) => calcBloqueio(e, socioId, hoje),
      motivoBloqueio: (socioId) => motivoBloqueio(e, socioId, hoje),
      historicoDoSocio: (socioId) =>
        podeVerSocio(socioId)
          ? e.emprestimos
              .filter((emp) => emp.socioId === socioId)
              .sort((a, b) => b.dataEmprestimo.localeCompare(a.dataEmprestimo))
          : null,
      reservasDoSocio: (socioId) =>
        podeVerSocio(socioId)
          ? e.reservas.filter((r) => r.socioId === socioId).sort((a, b) => b.dataReserva.localeCompare(a.dataReserva))
          : null,
      salvarLivro,
      excluirLivro,
      adicionarExemplares,
      editarExemplar,
      excluirExemplar,
      desbastarExemplar,
      salvarSocio,
      alternarAtivoSocio,
      redefinirSenhaSocio,
      anonimizarSocio,
      realizarEmprestimo,
      renovarEmprestimo,
      alterarEmprestimo,
      cancelarEmprestimo,
      devolverEmprestimo,
      quitarMulta,
      registrarJustificativa,
      julgarJustificativa,
      reservarLivro,
      cancelarReserva,
      executarRotinaAgora,
      reenviarNotificacao,
      agendarMesa,
      entrarNaFila,
      cancelarAgendamento,
      desistirDaFila,
      agendarKids,
      entrarNaFilaKids,
      confirmarUso,
      salvarReceptor,
      excluirReceptor,
      registrarDoacao,
      registrarAquisicao,
      adicionarArquivo,
      excluirArquivo,
      salvarPasta,
      excluirPasta,
      salvarPublicacao,
      excluirPublicacao,
      importarObras,
      importarSocios,
      gerarBackup,
      restaurarBackup,
      importarBackup,
      restaurarDemonstracao,
      exportarEstado: () => ref.current,
    }
    // relogio força o recálculo de "hoje" e dos atrasos a cada minuto
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado, sessao, alertaLogin, relatorio, persistenciaOk, relogio, commit, rodarRotina])

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error("useStore deve ser usado dentro de StoreProvider")
  return ctx
}

export { mesaLivre }
