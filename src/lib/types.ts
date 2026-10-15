// ============================================================
// CulturaTech - Tipos do domínio
// Numeração de RF/RN/RNF conforme o Documento de Requisitos v3.2
// ============================================================

export type PerfilUsuario = "publico" | "socio" | "admin"

export interface Sessao {
  perfil: PerfilUsuario
  usuarioId: string | null // id do sócio-leitor ou do administrador
  loginEm?: string
}

export interface Administrador {
  id: string
  nome: string
  usuario: string
  senha: string
}

// --- Status do exemplar (RN12) ---
export type StatusExemplar =
  | "disponivel"
  | "reservado"
  | "em_restauro"
  | "indisponivel"
  | "extraviado"
  | "ocioso"
  | "danificado"

export type Categoria =
  | "literatura"
  | "infantil"
  | "didatico"
  | "historia"
  | "ciencias"
  | "cordel"
  | "raro"
  | "exemplar_unico"

export interface Autor {
  id: string
  nome: string // nome na ordem direta; a forma catalográfica é derivada (RN19)
}

// Obra / título (RF01)
export interface Livro {
  id: string
  titulo: string
  autorIds: string[] // RN18: múltiplos autores; o primeiro é a entrada principal (RN19)
  editora: string
  edicao: string
  ano: number
  categoria: Categoria
  secao: string // RN22: letra de A a Z
  isbn: string
  sinopse?: string
}

// Exemplar físico (RF16)
export interface Exemplar {
  id: string // código de identificação — UUID gerado pelo sistema (RN20)
  livroId: string
  tombamento: string // código de tombamento (patrimônio)
  status: StatusExemplar
  // exemplar retirado do acervo (desbastamento ou doação); o registro é mantido
  // para não perder o histórico de empréstimos
  baixa?: { data: string; motivo: "desbaste" | "doacao" }
}

// Registro de desbastamento (RN24 / RN31)
export interface Desbaste {
  id: string
  exemplarId: string
  livroId: string
  tombamento: string
  statusAnterior: StatusExemplar
  relatorio: string
  data: string
}

export interface Endereco {
  rua: string
  numero: string
  bairro: string
  cep: string
}

// Sócio-leitor (RF02)
export interface SocioLeitor {
  id: string
  nome: string
  cpf: string
  rg: string
  telefone: string
  email: string
  fotoId?: string // imagem armazenada e comprimida (RNF12 / RNF13)
  endereco: Endereco
  senha: string
  ativo: boolean
  dataCadastro: string
  consentimentoLgpd: string // data do consentimento (RNF06); "" = pendente (cadastro migrado)
  anonimizado?: boolean // dados pessoais eliminados a pedido do titular (LGPD)
}

export type StatusEmprestimo = "ativo" | "devolvido" | "cancelado"

export interface Emprestimo {
  id: string
  socioId: string
  exemplarId: string
  dataEmprestimo: string // RF07: data de saída
  dataPrevista: string // RN02: saída + 14 dias (+14 a cada renovação)
  dataDevolucao?: string // RF07: data efetiva de devolução
  renovacoes: number // RN17: máx. 3
  status: StatusEmprestimo
  motivoCancelamento?: string
  devolvidoDanificado?: boolean
  historico: { data: string; texto: string }[] // renovações e alterações (RF03)
}

export type StatusMulta = "pendente" | "em_analise" | "paga" | "abonada"

export interface Justificativa {
  texto: string
  data: string
}

export interface Parecer {
  decisao: "deferido" | "indeferido"
  texto: string
  data: string
  adminId: string
  justificativa: string // cópia da justificativa julgada
}

export interface Multa {
  id: string
  socioId: string
  emprestimoId: string
  valor: number
  motivo: "atraso" | "dano"
  status: StatusMulta
  dias?: number
  data: string
  justificativa?: Justificativa // RN07: registrada pelo sócio-leitor
  pareceres: Parecer[] // RN07: julgamentos do administrador (histórico)
  dataQuitacao?: string
}

// Ocorrência de dano (RF15)
export interface OcorrenciaDano {
  id: string
  emprestimoId: string
  exemplarId: string
  socioId: string
  multaId: string
  relatorio: string
  imagemIds: string[]
  valorMulta: number
  data: string
}

// Reserva de exemplar (RF14 / RN28)
export type StatusReserva = "ativa" | "retirada" | "cancelada" | "expirada"

export interface Reserva {
  id: string
  socioId: string
  exemplarId: string
  dataReserva: string
  expiraEm: string
  status: StatusReserva
}

// Notificação por e-mail (RF05) — caixa de saída
export type TipoNotificacao = "lembrete" | "vencimento" | "atraso"

export interface Notificacao {
  id: string
  socioId: string
  emprestimoId: string
  tipo: TipoNotificacao
  referencia: string // data de referência (evita reenvio no mesmo dia)
  destinatario: string
  assunto: string
  corpo: string
  data: string // ISO datetime
  status: "enviado" | "falha"
  motivoFalha?: string
  tratadaEm?: string // falha tratada pelo administrador (reenvio)
}

// Mesas de estudo (RF10 / RF11)
export type Turno = "manha" | "tarde" | "noite"

export interface MesaEstudo {
  id: string
  nome: string
  local: string
}

export interface Agendamento {
  id: string
  mesaId: string
  socioId: string
  data: string
  turno: Turno
  status: "confirmado" | "cancelado"
  origem: "direto" | "fila"
  criadoEm: string
}

export interface EntradaFila {
  id: string
  socioId: string
  data: string
  turno: Turno
  criadoEm: string // ISO datetime — define a ordem da fila
  status: "aguardando" | "contemplado" | "desistiu" | "expirada"
  agendamentoId?: string // agendamento gerado quando contemplado
}

// Parcerias e instituições (RF13 / RN25 / RN26)
export type TipoReceptor = "instituicao" | "pessoa_fisica"

export interface Instituicao {
  id: string
  tipo: TipoReceptor
  nome: string
  documento: string // CNPJ (instituição) ou CPF (pessoa física)
  endereco: string
  contato: string
}

export type TipoMovimentacao = "doacao" | "aquisicao"

export interface Movimentacao {
  id: string
  tipo: TipoMovimentacao // doação: exemplar sai do acervo; aquisição: exemplares entram
  livroId: string
  receptorId: string
  tombamentos: string[]
  data: string
  observacao?: string
}

// Repositório digital (RF08 / RF17)
export type FormatoArquivo = "pdf" | "imagem"

export interface PastaHistorica {
  id: string
  nome: string
  descricao: string
}

export type VinculoArquivo =
  | { tipo: "livro"; livroId: string }
  | { tipo: "pasta"; pastaId: string }

export interface ArquivoDigital {
  id: string
  titulo: string
  formato: FormatoArquivo
  nomeArquivo: string
  descricao?: string
  vinculo: VinculoArquivo
  tamanhoOriginal: number
  tamanhoArmazenado: number
  compressao: Compressao // RNF13
  dataUpload: string
}

export type Compressao = "gzip" | "webp" | "nenhuma"

// Mural digital (RF12)
export type TipoPublicacao = "noticia" | "evento" | "novidade"

export interface Publicacao {
  id: string
  tipo: TipoPublicacao
  titulo: string
  descricao: string
  data: string
  imagemIds: string[]
}

export interface Backup {
  id: string
  data: string // ISO datetime
  automatico: boolean
  tamanho: number
}

// Estado completo persistido da aplicação
export interface Estado {
  versao: number
  autores: Autor[]
  livros: Livro[]
  exemplares: Exemplar[]
  desbastes: Desbaste[]
  socios: SocioLeitor[]
  administradores: Administrador[]
  emprestimos: Emprestimo[]
  multas: Multa[]
  ocorrencias: OcorrenciaDano[]
  reservas: Reserva[]
  notificacoes: Notificacao[]
  mesas: MesaEstudo[]
  agendamentos: Agendamento[]
  fila: EntradaFila[]
  instituicoes: Instituicao[]
  movimentacoes: Movimentacao[]
  pastas: PastaHistorica[]
  arquivos: ArquivoDigital[]
  publicacoes: Publicacao[]
  ultimaRotina?: string // data (AAAA-MM-DD) da última rotina diária
}
