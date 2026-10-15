import { Badge } from "./ui"
import { useStore } from "@/lib/store"
import { corMulta, labelMulta } from "@/lib/constants"
import { formatDate } from "@/lib/utils"
import type { Multa } from "@/lib/types"

export function BadgeMulta({ m }: { m: Multa }) {
  return <Badge className={corMulta[m.status]}>{labelMulta[m.status]}</Badge>
}

export function descricaoMulta(m: Multa): string {
  return m.motivo === "atraso" ? `Atraso de ${m.dias ?? 0} dia(s)` : "Dano ao exemplar"
}

/** Linha do tempo da multa: justificativas e pareceres (RN07). */
export function HistoricoMulta({ m }: { m: Multa }) {
  const { administradores } = useStore()
  if (!m.justificativa && m.pareceres.length === 0 && !m.dataQuitacao) return null
  return (
    <ol className="space-y-2 border-l-2 border-border pl-4 text-sm">
      {m.pareceres.map((p, i) => (
        <li key={i} className="space-y-1">
          <p className="text-xs text-muted-foreground">Justificativa do sócio-leitor</p>
          <p className="text-pretty">"{p.justificativa}"</p>
          <p className="text-xs text-muted-foreground">
            {p.decisao === "deferido" ? "Deferida" : "Indeferida"} em {formatDate(p.data)} por{" "}
            {administradores.find((a) => a.id === p.adminId)?.nome ?? "administração"}:
          </p>
          <p className={p.decisao === "deferido" ? "text-success" : "text-danger"}>{p.texto}</p>
        </li>
      ))}
      {m.status === "em_analise" && m.justificativa && (
        <li className="space-y-1">
          <p className="text-xs text-muted-foreground">Justificativa enviada em {formatDate(m.justificativa.data)} · aguardando julgamento</p>
          <p className="text-pretty">"{m.justificativa.texto}"</p>
        </li>
      )}
      {m.dataQuitacao && <li className="text-xs text-muted-foreground">Quitada em {formatDate(m.dataQuitacao)}</li>}
    </ol>
  )
}
