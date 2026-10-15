import { Badge } from "./ui"
import { useStore } from "@/lib/store"
import { formatCurrency, formatDate, diasAtraso } from "@/lib/utils"
import { labelReserva } from "@/lib/constants"
import type { Emprestimo, Reserva } from "@/lib/types"

/** Situação de um empréstimo, calculada a partir das datas (RF07). */
export function SituacaoEmprestimo({ emp }: { emp: Emprestimo }) {
  const { hoje } = useStore()
  if (emp.status === "cancelado") return <Badge className="bg-muted text-muted-foreground">Cancelado</Badge>
  if (emp.status === "devolvido") {
    const atraso = emp.dataDevolucao ? diasAtraso(emp.dataPrevista, emp.dataDevolucao) : 0
    return (
      <Badge className={emp.devolvidoDanificado || atraso > 0 ? "bg-warning/20 text-warning-foreground" : "bg-muted text-muted-foreground"}>
        {emp.devolvidoDanificado ? "Devolvido com dano" : atraso > 0 ? `Devolvido com ${atraso}d de atraso` : "Devolvido"}
      </Badge>
    )
  }
  const atraso = diasAtraso(emp.dataPrevista, hoje)
  if (atraso > 0) return <Badge className="bg-danger/15 text-danger">Atrasado há {atraso} dia(s)</Badge>
  if (emp.dataPrevista === hoje) return <Badge className="bg-warning/20 text-warning-foreground">Vence hoje</Badge>
  return <Badge className="bg-success/15 text-success">Em dia</Badge>
}

/** Tabela de histórico de leitura (RF04). */
export function TabelaHistorico({ emprestimos }: { emprestimos: Emprestimo[] }) {
  const { tituloDoExemplar, exemplares, multas } = useStore()
  if (emprestimos.length === 0) {
    return <p className="p-5 text-sm text-muted-foreground">Nenhum empréstimo registrado.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="p-4 font-medium">Obra</th>
            <th className="p-4 font-medium">Saída</th>
            <th className="p-4 font-medium">Prevista</th>
            <th className="p-4 font-medium">Devolução</th>
            <th className="p-4 font-medium">Renov.</th>
            <th className="p-4 font-medium">Situação</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {emprestimos.map((emp) => {
            const tomb = exemplares.find((x) => x.id === emp.exemplarId)?.tombamento
            const multasEmp = multas.filter((m) => m.emprestimoId === emp.id)
            return (
              <tr key={emp.id}>
                <td className="p-4">
                  <p className="font-medium">{tituloDoExemplar(emp.exemplarId)}</p>
                  <p className="text-xs text-muted-foreground">
                    Tombo {tomb}
                    {multasEmp.length > 0 &&
                      ` · multa ${formatCurrency(multasEmp.reduce((a, m) => a + m.valor, 0))}`}
                  </p>
                </td>
                <td className="p-4">{formatDate(emp.dataEmprestimo)}</td>
                <td className="p-4">{formatDate(emp.dataPrevista)}</td>
                <td className="p-4">{emp.dataDevolucao ? formatDate(emp.dataDevolucao) : "-"}</td>
                <td className="p-4">{emp.renovacoes}/3</td>
                <td className="p-4">
                  <SituacaoEmprestimo emp={emp} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function corReserva(r: Reserva): string {
  if (r.status === "ativa") return "bg-accent/15 text-accent"
  if (r.status === "retirada") return "bg-success/15 text-success"
  return "bg-muted text-muted-foreground"
}

export function BadgeReserva({ r }: { r: Reserva }) {
  return <Badge className={corReserva(r)}>{labelReserva[r.status]}</Badge>
}
