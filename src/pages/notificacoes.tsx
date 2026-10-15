import { useState } from "react"
import { MailCheck, MailX, Play, RotateCw, Mail, UserRoundPen } from "lucide-react"
import { useStore } from "@/lib/store"
import { Abas, Aviso, Badge, Button, Card, CardHeader, Indicador, Modal, Vazio, useAcao, useToast } from "@/components/ui"
import { DIAS_LEMBRETE, labelNotificacao } from "@/lib/constants"
import { navegar } from "@/lib/navigation"
import { formatDateTime } from "@/lib/utils"
import type { Notificacao } from "@/lib/types"

type Aba = "todas" | "falhas"

export function NotificacoesPage() {
  const { notificacoes, getSocio, executarRotinaAgora, reenviarNotificacao, ultimaRotina } = useStore()
  const executar = useAcao()
  const { notificar } = useToast()
  const [aba, setAba] = useState<Aba>("todas")
  const [aberta, setAberta] = useState<Notificacao | null>(null)

  const falhasPendentes = notificacoes.filter((n) => n.status === "falha" && !n.tratadaEm)
  const lista = (aba === "falhas" ? falhasPendentes : notificacoes).slice(0, 200)
  const enviadas = notificacoes.filter((n) => n.status === "enviado").length

  function rodar() {
    const r = executarRotinaAgora()
    if (!r) return
    notificar(
      r.notificacoes > 0
        ? `${r.notificacoes} notificação(ões) gerada(s)${r.falhas ? `, ${r.falhas} com falha` : ""}.`
        : "Nenhuma notificação pendente para hoje: todos os avisos devidos já foram enviados.",
      true,
    )
  }

  return (
    <div className="space-y-5">
      <Aviso tipo="info">
        A rotina de avisos roda automaticamente ao abrir o sistema e a cada minuto. Envia um lembrete {DIAS_LEMBRETE} dias
        antes do vencimento, um aviso no dia do vencimento e um aviso de atraso (RF05). Cada aviso é enviado uma única vez
        por prazo. Nesta versão sem servidor, os e-mails ficam registrados nesta caixa de saída.
      </Aviso>

      <div className="grid gap-4 sm:grid-cols-3">
        <Indicador icone={<MailCheck className="h-5 w-5" />} rotulo="E-mails enviados" valor={enviadas} />
        <Indicador icone={<MailX className="h-5 w-5" />} rotulo="Falhas a tratar" valor={falhasPendentes.length} alerta={falhasPendentes.length > 0} />
        <Indicador icone={<Play className="h-5 w-5" />} rotulo="Última execução" valor={ultimaRotina ? ultimaRotina.split("-").reverse().join("/") : "-"} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Abas<Aba>
          abas={[
            { id: "todas", rotulo: "Caixa de saída" },
            { id: "falhas", rotulo: "Falhas", contador: falhasPendentes.length },
          ]}
          ativa={aba}
          onChange={setAba}
        />
        <Button variante="outline" onClick={rodar}>
          <Play className="h-4 w-4" /> Executar rotina agora
        </Button>
      </div>

      <Card>
        <CardHeader
          titulo={aba === "falhas" ? "Falhas de envio" : "Notificações enviadas"}
          descricao={aba === "falhas" ? "Atualize o e-mail do sócio-leitor e reenvie o aviso." : undefined}
          icone={<Mail className="h-5 w-5" />}
        />
        <div className="divide-y divide-border">
          {lista.length === 0 && <Vazio>{aba === "falhas" ? "Nenhuma falha pendente." : "Nenhuma notificação registrada."}</Vazio>}
          {lista.map((n) => {
            const socio = getSocio(n.socioId)
            return (
              <div key={n.id} className="flex flex-col gap-2 p-5 md:flex-row md:items-center md:justify-between">
                <button className="min-w-0 text-left" onClick={() => setAberta(n)}>
                  <p className="font-medium hover:underline">{n.assunto}</p>
                  <p className="text-sm text-muted-foreground">
                    {socio?.nome} · {n.destinatario} · {formatDateTime(n.data)}
                  </p>
                  {n.motivoFalha && !n.tratadaEm && <p className="text-sm text-danger">{n.motivoFalha}</p>}
                </button>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="bg-muted text-muted-foreground">{labelNotificacao[n.tipo]}</Badge>
                  {n.status === "enviado" ? (
                    <Badge className="bg-success/15 text-success">Enviado</Badge>
                  ) : n.tratadaEm ? (
                    <Badge className="bg-muted text-muted-foreground">Falha tratada</Badge>
                  ) : (
                    <>
                      <Badge className="bg-danger/15 text-danger">Falha</Badge>
                      <Button variante="ghost" tamanho="sm" onClick={() => navegar("socios", n.socioId)}>
                        <UserRoundPen className="h-4 w-4" /> Cadastro
                      </Button>
                      <Button variante="outline" tamanho="sm" onClick={() => executar(reenviarNotificacao(n.id))}>
                        <RotateCw className="h-4 w-4" /> Reenviar
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      <Modal aberto={!!aberta} onFechar={() => setAberta(null)} titulo="E-mail">
        {aberta && (
          <div className="space-y-3 text-sm">
            <p>
              <span className="text-muted-foreground">Para:</span> {aberta.destinatario}
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
