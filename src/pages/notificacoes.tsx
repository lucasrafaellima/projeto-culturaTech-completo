import { useState } from "react"
import { BellRing, Play, CalendarClock, Mail } from "lucide-react"
import { useStore } from "@/lib/store"
import { Aviso, Badge, Button, Card, CardHeader, Indicador, Modal, Vazio, useAcao } from "@/components/ui"
import { DIAS_LEMBRETE, labelNotificacao } from "@/lib/constants"
import { formatDate, formatDateTime } from "@/lib/utils"
import type { Notificacao } from "@/lib/types"

// Avisos de prazo de devolução (RF05 / US15), entregues dentro do sistema, na Minha Área do sócio
export function NotificacoesPage() {
  const { notificacoes, getSocio, executarRotinaAgora, ultimaRotina, hoje } = useStore()
  const executar = useAcao()
  const [aberta, setAberta] = useState<Notificacao | null>(null)

  const lista = [...notificacoes].sort((a, b) => b.data.localeCompare(a.data)).slice(0, 200)
  const deHoje = notificacoes.filter((n) => n.data.slice(0, 10) === hoje).length

  return (
    <div className="space-y-5">
      <Aviso tipo="info">
        A rotina de avisos roda automaticamente sempre que o sistema é aberto. Ela gera um lembrete {DIAS_LEMBRETE} dias antes
        do vencimento, um aviso no dia do vencimento e um aviso de atraso. Cada aviso é gerado uma única vez por prazo
        e aparece para o sócio-leitor na Minha Área.
      </Aviso>

      <div className="grid gap-4 sm:grid-cols-3">
        <Indicador icone={<BellRing className="h-5 w-5" />} rotulo="Avisos registrados" valor={notificacoes.length} />
        <Indicador icone={<CalendarClock className="h-5 w-5" />} rotulo="Gerados hoje" valor={deHoje} />
        <Indicador icone={<Play className="h-5 w-5" />} rotulo="Última execução" valor={ultimaRotina ? formatDate(ultimaRotina) : "-"} />
      </div>

      <div className="flex justify-end">
        <Button variante="outline" onClick={() => executar(() => executarRotinaAgora())}>
          <Play className="h-4 w-4" /> Executar rotina agora
        </Button>
      </div>

      <Card>
        <CardHeader titulo="Avisos de prazo" icone={<Mail className="h-5 w-5" />} />
        <div className="divide-y divide-border">
          {lista.length === 0 && <Vazio>Nenhum aviso registrado.</Vazio>}
          {lista.map((n) => (
            <div key={n.id} className="flex flex-col gap-2 p-5 md:flex-row md:items-center md:justify-between">
              <button className="min-w-0 text-left" onClick={() => setAberta(n)}>
                <p className="font-medium hover:underline">{n.assunto}</p>
                <p className="text-sm text-muted-foreground">
                  {getSocio(n.socioId)?.nome ?? "Sócio-leitor"} · {formatDateTime(n.data)}
                </p>
              </button>
              <Badge className="w-fit bg-muted text-muted-foreground">{labelNotificacao[n.tipo]}</Badge>
            </div>
          ))}
        </div>
      </Card>

      <Modal aberto={!!aberta} onFechar={() => setAberta(null)} titulo="Aviso de prazo">
        {aberta && (
          <div className="space-y-3 text-sm">
            <p>
              <span className="text-muted-foreground">Para:</span> {getSocio(aberta.socioId)?.nome ?? "Sócio-leitor"} ·{" "}
              {aberta.destinatario}
            </p>
            <p>
              <span className="text-muted-foreground">Assunto:</span> <strong>{aberta.assunto}</strong>
            </p>
            <div className="rounded-lg border border-border bg-muted/40 p-4 whitespace-pre-line text-pretty">
              {aberta.corpo}
              {"\n\n"}Biblioteca Municipal Prof. Pedro de França Reis · Arapiraca - AL
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
