import type { StatusExemplar, PerfilUsuario } from "@/lib/types"
import { corStatus, labelStatus, statusVisivel } from "@/lib/constants"
import { Badge } from "./ui"

/**
 * Badge de status do exemplar que respeita a máscara da RN30:
 * para quem não é administrador, em restauro / extraviado / ocioso
 * aparecem como "Indisponível".
 */
export function StatusBadge({ status, perfil }: { status: StatusExemplar; perfil: PerfilUsuario }) {
  const visivel = statusVisivel(status, perfil)
  return <Badge className={corStatus[visivel]}>{labelStatus[visivel]}</Badge>
}
