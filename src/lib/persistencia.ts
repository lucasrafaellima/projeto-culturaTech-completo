// ============================================================
// Persistência local (localStorage) e backups automáticos (RNF05).
// Um backup completo é gerado automaticamente uma vez por dia e
// os 7 mais recentes são mantidos. O administrador também pode
// gerar, baixar, restaurar e importar backups manualmente.
// ============================================================
import type { Backup, Estado, Sessao } from "./types"
import { VERSAO_ESTADO } from "./mock-data"
import { agoraISO, hojeISO, uuid } from "./utils"

const CHAVE_ESTADO = "culturatech:estado"
const CHAVE_SESSAO = "culturatech:sessao"
const CHAVE_BACKUPS = "culturatech:backups"
const PREFIXO_BACKUP = "culturatech:backup:"
const MAX_BACKUPS = 7

export function carregarEstado(): Estado | null {
  try {
    const bruto = localStorage.getItem(CHAVE_ESTADO)
    if (!bruto) return null
    const estado = JSON.parse(bruto) as Estado
    if (estado.versao !== VERSAO_ESTADO) return null
    return estado
  } catch {
    return null
  }
}

export function salvarEstado(estado: Estado): boolean {
  try {
    localStorage.setItem(CHAVE_ESTADO, JSON.stringify(estado))
    return true
  } catch {
    return false
  }
}

export function carregarSessao(): Sessao {
  try {
    const bruto = localStorage.getItem(CHAVE_SESSAO)
    if (bruto) return JSON.parse(bruto) as Sessao
  } catch {
    // sessão corrompida: volta ao visitante
  }
  return { perfil: "publico", usuarioId: null }
}

export function salvarSessao(sessao: Sessao) {
  localStorage.setItem(CHAVE_SESSAO, JSON.stringify(sessao))
}

export function listarBackups(): Backup[] {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_BACKUPS) ?? "[]") as Backup[]
  } catch {
    return []
  }
}

function gravarLista(lista: Backup[]) {
  localStorage.setItem(CHAVE_BACKUPS, JSON.stringify(lista))
}

export function criarBackup(estado: Estado, automatico: boolean): Backup | null {
  const conteudo = JSON.stringify(estado)
  const backup: Backup = { id: uuid(), data: agoraISO(), automatico, tamanho: conteudo.length }
  let lista = [backup, ...listarBackups()]
  // descarta os mais antigos além do limite
  for (const velho of lista.slice(MAX_BACKUPS)) localStorage.removeItem(PREFIXO_BACKUP + velho.id)
  lista = lista.slice(0, MAX_BACKUPS)
  try {
    localStorage.setItem(PREFIXO_BACKUP + backup.id, conteudo)
    gravarLista(lista)
    return backup
  } catch {
    return null
  }
}

export function lerBackup(id: string): Estado | null {
  try {
    const bruto = localStorage.getItem(PREFIXO_BACKUP + id)
    return bruto ? (JSON.parse(bruto) as Estado) : null
  } catch {
    return null
  }
}

export function removerBackup(id: string) {
  localStorage.removeItem(PREFIXO_BACKUP + id)
  gravarLista(listarBackups().filter((b) => b.id !== id))
}

/** Gera o backup automático do dia, se ainda não houver um. */
export function backupAutomaticoDoDia(estado: Estado): Backup | null {
  const hoje = hojeISO()
  const jaFeito = listarBackups().some((b) => b.automatico && b.data.slice(0, 10) === hoje)
  if (jaFeito) return null
  return criarBackup(estado, true)
}

/** Confere se um JSON importado tem a estrutura esperada. */
export function validarEstadoImportado(dados: unknown): dados is Estado {
  if (!dados || typeof dados !== "object") return false
  const e = dados as Record<string, unknown>
  const colecoes = [
    "autores",
    "livros",
    "exemplares",
    "socios",
    "administradores",
    "emprestimos",
    "multas",
    "reservas",
    "mesas",
    "agendamentos",
    "fila",
    "instituicoes",
    "movimentacoes",
    "arquivos",
    "publicacoes",
  ]
  return e.versao === VERSAO_ESTADO && colecoes.every((c) => Array.isArray(e[c]))
}

export function baixarArquivo(nome: string, conteudo: string, tipo: string) {
  const blob = new Blob([conteudo], { type: tipo })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = nome
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
