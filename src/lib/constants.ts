import type {
  StatusExemplar,
  Categoria,
  PerfilUsuario,
  Turno,
  StatusMulta,
  TipoPublicacao,
  TipoReceptor,
  StatusReserva,
  TipoNotificacao,
  TipoMovimentacao,
} from "./types"

// ============================================================
// Constantes de regras de negócio
// ============================================================
export const MAX_EXEMPLARES_SIMULTANEOS = 3 // RN01
export const PRAZO_EMPRESTIMO_DIAS = 14 // RN02
export const MAX_RENOVACOES = 3 // RN17
export const MULTA_POR_DIA = 1.0 // RN03 (R$ 1,00 por dia, por exemplar)
export const MULTA_DANO_SUGERIDA = 25.0 // RF15: valor sugerido, o administrador define o valor final
export const PRAZO_RESERVA_DIAS = 3 // reserva aguarda retirada por 3 dias
export const DIAS_LEMBRETE = 3 // RF05: lembrete enviado a partir de 3 dias antes do vencimento
export const MAX_DOACOES_PESSOA_FISICA = 1 // RN26
export const MIN_JUSTIFICATIVA = 20 // RN07 / RN24: texto mínimo de uma justificativa "fundamentada"

// Categorias restritas (RN04 / RNF09): apenas consulta local
export const CATEGORIAS_RESTRITAS: Categoria[] = ["exemplar_unico", "raro", "cordel"]

// Status mascarados como "indisponível" para quem não é administrador (RN30)
export const STATUS_MASCARADOS: StatusExemplar[] = ["em_restauro", "extraviado", "ocioso"]

// Status aceitos no desbastamento (RN31)
export const STATUS_DESBASTAVEIS: StatusExemplar[] = ["ocioso", "danificado"]

// Formatos de arquivo (RNF12 / RN21)
export const EXTENSOES_IMAGEM = [".webp", ".jpg", ".jpeg", ".png"]
export const MIMES_IMAGEM = ["image/webp", "image/jpeg", "image/png"]
export const ACCEPT_IMAGEM = ".webp,.jpg,.jpeg,.png,image/webp,image/jpeg,image/png"

export const LETRAS_SECAO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("") // RN22

export const TODOS_STATUS: StatusExemplar[] = [
  "disponivel",
  "reservado",
  "em_restauro",
  "indisponivel",
  "extraviado",
  "ocioso",
  "danificado",
]

export const TODAS_CATEGORIAS: Categoria[] = [
  "literatura",
  "infantil",
  "didatico",
  "historia",
  "ciencias",
  "cordel",
  "raro",
  "exemplar_unico",
]

// --- Rótulos em PT-BR (RNF04) ---
export const labelPerfil: Record<PerfilUsuario, string> = {
  publico: "Visitante",
  socio: "Sócio-leitor",
  admin: "Administrador",
}

export const labelStatus: Record<StatusExemplar, string> = {
  disponivel: "Disponível",
  reservado: "Reservado",
  em_restauro: "Em restauro",
  indisponivel: "Indisponível",
  extraviado: "Extraviado",
  ocioso: "Ocioso",
  danificado: "Danificado",
}

export const labelCategoria: Record<Categoria, string> = {
  literatura: "Literatura",
  infantil: "Infantil",
  didatico: "Didático",
  historia: "História",
  ciencias: "Ciências",
  cordel: "Cordel",
  raro: "Obra rara",
  exemplar_unico: "Exemplar único",
}

export const labelTurno: Record<Turno, string> = {
  manha: "Manhã",
  tarde: "Tarde",
  noite: "Noite",
}

export const horarioTurno: Record<Turno, string> = {
  manha: "08h às 12h",
  tarde: "13h às 17h",
  noite: "18h às 21h",
}

export const labelMulta: Record<StatusMulta, string> = {
  pendente: "Pendente",
  em_analise: "Justificativa em análise",
  paga: "Paga",
  abonada: "Abonada",
}

export const corMulta: Record<StatusMulta, string> = {
  pendente: "bg-danger/15 text-danger",
  em_analise: "bg-warning/20 text-warning-foreground",
  paga: "bg-success/15 text-success",
  abonada: "bg-muted text-muted-foreground",
}

export const labelPublicacao: Record<TipoPublicacao, string> = {
  noticia: "Notícia",
  evento: "Evento",
  novidade: "Novidade literária",
}

export const labelReceptor: Record<TipoReceptor, string> = {
  instituicao: "Instituição",
  pessoa_fisica: "Pessoa física",
}

export const labelMovimentacao: Record<TipoMovimentacao, string> = {
  doacao: "Doação (saída)",
  aquisicao: "Aquisição (entrada)",
}

export const labelReserva: Record<StatusReserva, string> = {
  ativa: "Aguardando retirada",
  retirada: "Retirada",
  cancelada: "Cancelada",
  expirada: "Expirada",
}

export const labelNotificacao: Record<TipoNotificacao, string> = {
  lembrete: "Lembrete de prazo",
  vencimento: "Vence hoje",
  atraso: "Aviso de atraso",
}

// Cores (classes Tailwind) para badges de status
export const corStatus: Record<StatusExemplar, string> = {
  disponivel: "bg-success/15 text-success border border-success/30",
  reservado: "bg-accent/15 text-accent border border-accent/30",
  em_restauro: "bg-warning/20 text-warning-foreground border border-warning/40",
  indisponivel: "bg-danger/15 text-danger border border-danger/30",
  extraviado: "bg-danger/15 text-danger border border-danger/30",
  ocioso: "bg-muted text-muted-foreground border border-border",
  danificado: "bg-danger/15 text-danger border border-danger/30",
}

/**
 * Máscara de status (RN30): em restauro, extraviado e ocioso aparecem
 * como "Indisponível" para visitantes e sócios-leitores.
 */
export function statusVisivel(status: StatusExemplar, perfil: PerfilUsuario): StatusExemplar {
  if (perfil === "admin") return status
  if (STATUS_MASCARADOS.includes(status)) return "indisponivel"
  return status
}

export function categoriaEmprestavel(categoria: Categoria): boolean {
  return !CATEGORIAS_RESTRITAS.includes(categoria) // RN04
}

/** RNF12: aceita apenas WEBP, JPG e PNG (confere extensão e tipo MIME). */
export function imagemValida(arquivo: { name: string; type: string }): boolean {
  const nome = arquivo.name.toLowerCase()
  const extOk = EXTENSOES_IMAGEM.some((ext) => nome.endsWith(ext))
  const mimeOk = !arquivo.type || MIMES_IMAGEM.includes(arquivo.type)
  return extOk && mimeOk
}

export function pdfValido(arquivo: { name: string; type: string }): boolean {
  return (
    arquivo.name.toLowerCase().endsWith(".pdf") &&
    (!arquivo.type || arquivo.type === "application/pdf")
  )
}

/** RN21: importação apenas em CSV. */
export function csvValido(arquivo: { name: string }): boolean {
  return arquivo.name.toLowerCase().endsWith(".csv")
}
