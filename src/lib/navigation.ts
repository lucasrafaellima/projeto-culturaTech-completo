import { useEffect, useState } from "react"
import type { PerfilUsuario } from "@/lib/types"
import {
  LayoutDashboard,
  Search,
  BookMarked,
  Library,
  Users,
  ArrowLeftRight,
  CalendarClock,
  FolderArchive,
  Handshake,
  MailCheck,
  FileSpreadsheet,
  DatabaseBackup,
  LogIn,
  UserPlus,
  type LucideIcon,
} from "lucide-react"

export type RotaId =
  | "mural"
  | "consulta"
  | "repositorio"
  | "entrar"
  | "cadastro"
  | "minha-area"
  | "mesas"
  | "acervo"
  | "socios"
  | "circulacao"
  | "notificacoes"
  | "parcerias"
  | "importacao"
  | "backups"

export interface ItemNav {
  id: RotaId
  rotulo: string
  icone: LucideIcon
  perfis: PerfilUsuario[]
  grupo: "publico" | "socio" | "admin"
  oculto?: boolean // acessível, mas fora do menu
}

// Matriz rota x perfil (RNF02)
export const itensNavegacao: ItemNav[] = [
  // Portal público (RF06, RF12, RF17)
  { id: "mural", rotulo: "Mural Cultural", icone: LayoutDashboard, perfis: ["publico", "socio", "admin"], grupo: "publico" },
  { id: "consulta", rotulo: "Consulta Pública (OPAC)", icone: Search, perfis: ["publico", "socio", "admin"], grupo: "publico" },
  { id: "repositorio", rotulo: "Repositório Digital", icone: FolderArchive, perfis: ["publico", "socio", "admin"], grupo: "publico" },
  { id: "entrar", rotulo: "Entrar", icone: LogIn, perfis: ["publico"], grupo: "publico", oculto: true },
  { id: "cadastro", rotulo: "Criar conta", icone: UserPlus, perfis: ["publico"], grupo: "publico", oculto: true },

  // Sócio-leitor (RF04, RF14, RF10, RF11)
  { id: "minha-area", rotulo: "Minha Área", icone: BookMarked, perfis: ["socio"], grupo: "socio" },
  { id: "mesas", rotulo: "Mesas de Estudo", icone: CalendarClock, perfis: ["socio", "admin"], grupo: "socio" },

  // Administração
  { id: "acervo", rotulo: "Acervo", icone: Library, perfis: ["admin"], grupo: "admin" },
  { id: "socios", rotulo: "Sócios-leitores", icone: Users, perfis: ["admin"], grupo: "admin" },
  { id: "circulacao", rotulo: "Circulação", icone: ArrowLeftRight, perfis: ["admin"], grupo: "admin" },
  { id: "notificacoes", rotulo: "Notificações", icone: MailCheck, perfis: ["admin"], grupo: "admin" },
  { id: "parcerias", rotulo: "Parcerias e Doações", icone: Handshake, perfis: ["admin"], grupo: "admin" },
  { id: "importacao", rotulo: "Importação CSV", icone: FileSpreadsheet, perfis: ["admin"], grupo: "admin" },
  { id: "backups", rotulo: "Backups", icone: DatabaseBackup, perfis: ["admin"], grupo: "admin" },
]

export function rotasDoPerfil(perfil: PerfilUsuario): ItemNav[] {
  return itensNavegacao.filter((i) => i.perfis.includes(perfil))
}

export function rotaPermitida(rota: RotaId, perfil: PerfilUsuario): boolean {
  return itensNavegacao.some((i) => i.id === rota && i.perfis.includes(perfil))
}

export const rotaInicialPorPerfil: Record<PerfilUsuario, RotaId> = {
  publico: "mural",
  socio: "minha-area",
  admin: "circulacao",
}

// Mesas aparecem no grupo "Administração" para o administrador
export function grupoDoItem(item: ItemNav, perfil: PerfilUsuario): ItemNav["grupo"] {
  if (item.id === "mesas" && perfil === "admin") return "admin"
  return item.grupo
}

// ------------------------------------------------------------
// Roteamento por hash (#/acervo): permite recarregar a página,
// usar voltar/avançar e compartilhar o link de uma tela.
// ------------------------------------------------------------
function lerHash(): { rota: RotaId | null; parametro: string | null } {
  const [rota, parametro] = window.location.hash.replace(/^#\/?/, "").split("/")
  const valida = itensNavegacao.some((i) => i.id === rota)
  return { rota: valida ? (rota as RotaId) : null, parametro: parametro ? decodeURIComponent(parametro) : null }
}

export function navegar(rota: RotaId, parametro?: string) {
  const alvo = `#/${rota}${parametro ? `/${encodeURIComponent(parametro)}` : ""}`
  if (window.location.hash !== alvo) window.location.hash = alvo
}

export function useRota(): { rota: RotaId | null; parametro: string | null } {
  const [atual, setAtual] = useState(lerHash)
  useEffect(() => {
    const onHash = () => {
      setAtual(lerHash())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])
  return atual
}
