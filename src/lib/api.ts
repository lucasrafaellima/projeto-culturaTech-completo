// ============================================================
// Cliente da API (server/). Em desenvolvimento e no preview, o Vite
// repassa /api para a porta 3333 (vite.config.ts).
// ============================================================

import type {
  ArquivoDigital,
  Autor,
  Desbaste,
  Emprestimo,
  Endereco,
  Exemplar,
  Livro,
  Multa,
  OcorrenciaDano,
  PastaHistorica,
  Publicacao,
  Reserva,
  SocioLeitor,
} from "./types"
import type { DadosDano, DadosLivro, DadosSocio } from "./store"

export type RespostaApi<T> =
  | { tipo: "ok"; dados: T }
  | { tipo: "erro"; status: number; mensagem: string }
  // a API não respondeu (servidor desligado, sem rede, proxy sem destino)
  | { tipo: "indisponivel" }

const TEMPO_LIMITE_MS = 10_000

async function chamar<T>(rota: string, init: RequestInit, tempoLimiteMs = TEMPO_LIMITE_MS): Promise<RespostaApi<T>> {
  let resposta: Response
  try {
    resposta = await fetch(`/api${rota}`, { ...init, signal: AbortSignal.timeout(tempoLimiteMs) })
  } catch {
    return { tipo: "indisponivel" }
  }

  // Toda resposta da API é JSON com "ok"; qualquer outra coisa (ex.: erro
  // do proxy do Vite com a API desligada) conta como indisponível
  let corpo: unknown
  try {
    corpo = await resposta.json()
  } catch {
    return { tipo: "indisponivel" }
  }
  if (typeof corpo !== "object" || corpo === null || typeof (corpo as { ok?: unknown }).ok !== "boolean") {
    return { tipo: "indisponivel" }
  }

  const dados = corpo as { ok: boolean; mensagem?: string }
  if (!resposta.ok || !dados.ok) {
    return { tipo: "erro", status: resposta.status, mensagem: dados.mensagem ?? "Erro inesperado no servidor." }
  }
  return { tipo: "ok", dados: corpo as T }
}

// ---------- autenticação ----------

export interface UsuarioApi {
  id: string
  nome: string
  perfil: "admin" | "socio"
  pendencias?: boolean // RN11
}

export type CadastroApi =
  | { usuario: string }
  | {
      cpf: string
      rg: string
      telefone: string
      email: string
      endereco: Endereco
      dataCadastro: string
      consentimentoLgpd: string
    }

export interface LoginApi {
  token: string
  usuario: UsuarioApi
  cadastro: CadastroApi
  mensagem: string
}

export function loginNaApi(usuario: string, senha: string) {
  return chamar<LoginApi>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario, senha }),
  })
}

// Cadastro feito pelo próprio visitante; a resposta tem o mesmo formato do login
export function cadastroNaApi(d: DadosSocio) {
  return chamar<LoginApi>("/auth/cadastro", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nome: d.nome,
      cpf: d.cpf,
      rg: d.rg,
      telefone: d.telefone,
      email: d.email,
      endereco: d.endereco,
      senha: d.senha ?? "",
      consentimentoLgpd: d.consentimentoLgpd,
    }),
  })
}

export function usuarioDoToken(token: string) {
  return chamar<{ usuario: UsuarioApi }>("/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// ---------- acervo (somente administradores) ----------

// Chamada autenticada com o token da sessão
function comToken<T>(token: string, metodo: string, rota: string, corpo?: unknown, tempoLimiteMs?: number) {
  return chamar<T>(
    rota,
    {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(corpo === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    },
    tempoLimiteMs,
  )
}

/** Acervo inteiro, no formato do estado do front-end. */
export interface AcervoApi {
  autores: Autor[]
  livros: Livro[]
  exemplares: ExemplarApi[]
  desbastes: Desbaste[]
}

// o exemplar da API traz também a data de entrada no acervo
export type ExemplarApi = Exemplar & { dataEntrada?: string }

/** Obra devolvida pelas rotas de escrita: autores completos, em ordem. */
export interface LivroApi extends Omit<Livro, "autorIds"> {
  autores: Autor[]
  exemplaresNoAcervo: number
}

export const acervoDaApi = (token: string) => comToken<AcervoApi>(token, "GET", "/acervo")

export const salvarLivroNaApi = (token: string, dados: DadosLivro, id?: string) =>
  comToken<{ mensagem: string; livro: LivroApi }>(token, id ? "PUT" : "POST", id ? `/livros/${id}` : "/livros", dados)

export const excluirLivroNaApi = (token: string, id: string) =>
  comToken<{ mensagem: string }>(token, "DELETE", `/livros/${id}`)

export const adicionarExemplaresNaApi = (token: string, livroId: string, tombamentos: string[], localizacao?: string) =>
  comToken<{ mensagem: string; exemplares: ExemplarApi[] }>(token, "POST", `/livros/${livroId}/exemplares`, {
    tombamentos,
    localizacao,
  })

export const editarExemplarNaApi = (
  token: string,
  id: string,
  dados: { tombamento: string; status?: string; localizacao?: string },
) =>
  comToken<{ mensagem: string; exemplar: ExemplarApi }>(token, "PATCH", `/exemplares/${id}`, dados)

export const excluirExemplarNaApi = (token: string, id: string) =>
  comToken<{ mensagem: string }>(token, "DELETE", `/exemplares/${id}`)

export const desbastarNaApi = (token: string, id: string, relatorio: string) =>
  comToken<{ mensagem: string; desbaste: Desbaste }>(token, "POST", `/exemplares/${id}/desbaste`, { relatorio })

export interface ObraImportacao extends DadosLivro {
  tombamentos: string[]
  linha: number
}

// importação em lote: tudo ou nada, no banco (pode levar mais tempo que as demais chamadas)
export const importarObrasNaApi = (token: string, obras: ObraImportacao[]) =>
  comToken<{ mensagem: string; livros: LivroApi[]; exemplares: ExemplarApi[] }>(
    token,
    "POST",
    "/livros/importar",
    { obras },
    60_000,
  )

// consulta pública (sem login): status internos mascarados (RN30), sem baixados
export const acervoPublicoDaApi = () => chamar<AcervoApi>("/acervo/publico", {})

// ---------- circulação (US08–US11), multas e reservas ----------

export interface CirculacaoApi {
  socios: SocioLeitor[]
  emprestimos: Emprestimo[]
  multas: Multa[]
  ocorrencias: OcorrenciaDano[]
  reservas: Reserva[]
}

export const circulacaoDaApi = (token: string) => comToken<CirculacaoApi>(token, "GET", "/circulacao")

export const minhaCirculacaoDaApi = (token: string) =>
  comToken<{ socio?: SocioLeitor; emprestimos: Emprestimo[]; multas: Multa[]; reservas: Reserva[] }>(
    token,
    "GET",
    "/eu/circulacao",
  )

type RespEmprestimo = { mensagem: string; emprestimo: Emprestimo }

export const emprestarNaApi = (token: string, socioId: string, exemplarId: string) =>
  comToken<RespEmprestimo>(token, "POST", "/emprestimos", { socioId, exemplarId })

export const renovarNaApi = (token: string, id: string) =>
  comToken<RespEmprestimo>(token, "POST", `/emprestimos/${id}/renovar`, {})

export const alterarEmprestimoNaApi = (token: string, id: string, dataPrevista: string, motivo: string) =>
  comToken<RespEmprestimo>(token, "PATCH", `/emprestimos/${id}`, { dataPrevista, motivo })

export const cancelarEmprestimoNaApi = (token: string, id: string, motivo: string) =>
  comToken<RespEmprestimo>(token, "POST", `/emprestimos/${id}/cancelar`, { motivo })

export const devolverNaApi = (token: string, id: string, dano?: DadosDano) =>
  comToken<RespEmprestimo & { multas: Multa[]; ocorrencia: OcorrenciaDano | null }>(
    token,
    "POST",
    `/emprestimos/${id}/devolver`,
    dano ? { dano } : {},
  )

type RespMulta = { mensagem: string; multa: Multa }

export const quitarMultaNaApi = (token: string, id: string) =>
  comToken<RespMulta>(token, "POST", `/multas/${id}/quitar`, {})

export const justificarMultaNaApi = (token: string, id: string, texto: string) =>
  comToken<RespMulta>(token, "POST", `/multas/${id}/justificativa`, { texto })

export const julgarMultaNaApi = (token: string, id: string, decisao: "deferido" | "indeferido", texto: string) =>
  comToken<RespMulta>(token, "POST", `/multas/${id}/julgar`, { decisao, texto })

type RespReserva = { mensagem: string; reserva: Reserva }

export const reservarNaApi = (token: string, livroId: string, socioId?: string) =>
  comToken<RespReserva>(token, "POST", "/reservas", { livroId, socioId })

export const cancelarReservaNaApi = (token: string, id: string) =>
  comToken<RespReserva>(token, "POST", `/reservas/${id}/cancelar`, {})

// ---------- sócios-leitores (administrador) ----------

type RespSocio = { mensagem: string; socio: SocioLeitor }

export const salvarSocioNaApi = (token: string, d: DadosSocio, id?: string) =>
  comToken<RespSocio>(token, id ? "PUT" : "POST", id ? `/socios/${id}` : "/socios", {
    nome: d.nome,
    cpf: d.cpf,
    rg: d.rg,
    telefone: d.telefone,
    email: d.email,
    endereco: d.endereco,
    fotoId: d.fotoId ?? null,
    ...(id ? {} : { senha: d.senha ?? "" }),
    consentimentoLgpd: d.consentimentoLgpd,
  })

export const alternarAtivoSocioNaApi = (token: string, id: string) =>
  comToken<RespSocio>(token, "POST", `/socios/${id}/ativo`, {})

export const redefinirSenhaSocioNaApi = (token: string, id: string, senha: string) =>
  comToken<{ mensagem: string }>(token, "POST", `/socios/${id}/senha`, { senha })

export const anonimizarSocioNaApi = (token: string, id: string) =>
  comToken<RespSocio>(token, "POST", `/socios/${id}/anonimizar`, {})

// ---------- repositório digital (US17 / US18) ----------

export interface RepositorioApi {
  pastas: PastaHistorica[]
  documentos: ArquivoDigital[]
}

export const repositorioDaApi = () => chamar<RepositorioApi>("/repositorio", {})

export const anexarDocumentoNaApi = (
  token: string,
  arquivoId: string,
  d: Pick<ArquivoDigital, "titulo" | "formato" | "descricao" | "vinculo">,
) =>
  comToken<{ mensagem: string; documento: ArquivoDigital }>(token, "POST", "/documentos", {
    arquivoId,
    titulo: d.titulo,
    formato: d.formato,
    descricao: d.descricao,
    vinculo: d.vinculo,
  })

export const excluirDocumentoNaApi = (token: string, arquivoId: string) =>
  comToken<{ mensagem: string }>(token, "DELETE", `/documentos/${arquivoId}`)

export const salvarPastaNaApi = (token: string, d: Omit<PastaHistorica, "id">, id?: string) =>
  comToken<{ mensagem: string; pasta: PastaHistorica }>(token, id ? "PUT" : "POST", id ? `/pastas/${id}` : "/pastas", d)

export const excluirPastaNaApi = (token: string, id: string) =>
  comToken<{ mensagem: string }>(token, "DELETE", `/pastas/${id}`)

// ---------- mural (RF12) ----------

export const muralDaApi = () => chamar<{ publicacoes: Publicacao[] }>("/mural", {})

export const salvarPublicacaoNaApi = (token: string, d: Omit<Publicacao, "id">, id?: string) =>
  comToken<{ mensagem: string; publicacao: Publicacao }>(
    token,
    id ? "PUT" : "POST",
    id ? `/publicacoes/${id}` : "/publicacoes",
    d,
  )

export const excluirPublicacaoNaApi = (token: string, id: string) =>
  comToken<{ mensagem: string }>(token, "DELETE", `/publicacoes/${id}`)

// ---------- arquivos (S3 no servidor) ----------

export interface ArquivoEnviado {
  id: string
  tamanhoOriginal: number
  tamanhoArmazenado: number
  compressao: ArquivoDigital["compressao"]
}

// Pasta do bucket onde o arquivo fica (S3)
export type DestinoArquivo = "mural" | "acervo" | "documentos" | "socios" | "danos"

// Envia o conteúdo já comprimido; o upload pode demorar mais que as demais chamadas
export const enviarArquivoNaApi = (
  token: string,
  conteudo: Blob,
  meta: {
    mime: string
    nome: string
    compressao: ArquivoDigital["compressao"]
    tamanhoOriginal: number
    destino: DestinoArquivo
  },
) =>
  chamar<{ arquivo: ArquivoEnviado }>(
    "/arquivos",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": meta.mime,
        "X-Nome-Arquivo": encodeURIComponent(meta.nome),
        "X-Compressao": meta.compressao,
        "X-Tamanho-Original": String(meta.tamanhoOriginal),
        "X-Destino": meta.destino,
      },
      body: conteudo,
    },
    120_000,
  )

export const apagarArquivoNaApi = (token: string, id: string) =>
  comToken<{ mensagem: string }>(token, "DELETE", `/arquivos/${id}`)
