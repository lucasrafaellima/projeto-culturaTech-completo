import { useMemo, useState } from "react"
import { CalendarClock, Clock, Users, ListOrdered, X, UserRound } from "lucide-react"
import { useStore } from "@/lib/store"
import { Aviso, Badge, Button, Campo, Card, CardHeader, Confirmar, Input, Select, Vazio, useAcao } from "@/components/ui"
import { horarioTurno, labelTurno } from "@/lib/constants"
import { agendamentosDoTurno, filaDoTurno, turnoEncerrado } from "@/lib/regras"
import { addDays, cn, formatDate, primeiroNome } from "@/lib/utils"
import type { Agendamento, Turno } from "@/lib/types"

const TURNOS: Turno[] = ["manha", "tarde", "noite"]

export function MesasPage() {
  const store = useStore()
  const { mesas, socios, perfil, socioLogado, hoje, agendamentos, fila, agendarMesa, entrarNaFila, cancelarAgendamento, desistirDaFila, getSocio } =
    store
  const executar = useAcao()
  const ehAdmin = perfil === "admin"

  const [data, setData] = useState(hoje)
  const [socioSel, setSocioSel] = useState("")
  const [cancelando, setCancelando] = useState<Agendamento | null>(null)
  const [ofertaFila, setOfertaFila] = useState<Turno | null>(null)

  const horaAtual = new Date().getHours()
  const socioId = ehAdmin ? socioSel : socioLogado?.id ?? ""

  // A grade reflete a data escolhida
  const grade = useMemo(
    () =>
      TURNOS.map((turno) => ({
        turno,
        encerrado: turnoEncerrado(data, turno, hoje, horaAtual),
        ocupacao: agendamentosDoTurno(store, data, turno),
        fila: filaDoTurno(store, data, turno),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, agendamentos, fila, hoje, horaAtual],
  )

  function agendar(turno: Turno, mesaId?: string) {
    if (!socioId) return executar({ ok: false, mensagem: "Selecione o sócio-leitor." })
    const r = agendarMesa(socioId, data, turno, mesaId)
    executar(r)
    if (!r.ok && r.ofereceFila) setOfertaFila(turno)
  }

  const nomeSocio = (id: string) => {
    const s = getSocio(id)
    if (!s) return "-"
    return ehAdmin || id === socioLogado?.id ? s.nome : "Reservado"
  }

  // Lista do sócio: seus agendamentos e posições na fila
  const meusAgendamentos = agendamentos
    .filter((a) => a.status === "confirmado" && a.data >= hoje && (ehAdmin ? a.data === data : a.socioId === socioLogado?.id))
    .sort((a, b) => a.data.localeCompare(b.data) || TURNOS.indexOf(a.turno) - TURNOS.indexOf(b.turno))
  const minhasFilas = fila
    .filter((f) => f.status === "aguardando" && (ehAdmin ? f.data === data : f.socioId === socioLogado?.id))
    .sort((a, b) => a.data.localeCompare(b.data) || a.criadoEm.localeCompare(b.criadoEm))

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="grid gap-3 md:grid-cols-[auto_1fr] md:items-end">
          <Campo rotulo="Data">
            {(id) => (
              <Input
                id={id}
                type="date"
                min={hoje}
                max={addDays(hoje, 30)}
                value={data}
                onChange={(e) => setData(e.target.value || hoje)}
                className="md:w-48"
              />
            )}
          </Campo>
          {ehAdmin ? (
            <Campo rotulo="Agendar para o sócio-leitor">
              {(id) => (
                <Select id={id} value={socioSel} onChange={(e) => setSocioSel(e.target.value)}>
                  <option value="">Selecione...</option>
                  {socios
                    .filter((s) => s.ativo)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nome}
                      </option>
                    ))}
                </Select>
              )}
            </Campo>
          ) : (
            <p className="text-sm text-muted-foreground text-pretty">
              Escolha a data e o turno. Cada sócio-leitor pode agendar <strong>1 turno por dia</strong> (RN05). Se todas as
              mesas estiverem ocupadas, você pode entrar na fila de espera (RF11).
            </p>
          )}
        </div>
      </Card>

      {/* Grade da data escolhida */}
      <div className="grid gap-4 md:grid-cols-3">
        {grade.map(({ turno, encerrado, ocupacao, fila: filaTurno }) => {
          const livres = mesas.length - ocupacao.length
          const minhaPosicao = filaTurno.findIndex((f) => f.socioId === socioId)
          return (
            <Card key={turno} className={cn("flex flex-col", encerrado && "opacity-60")}>
              <div className="flex items-center justify-between gap-2 border-b border-border p-4">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Clock className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-serif font-semibold">{labelTurno[turno]}</p>
                    <p className="text-xs text-muted-foreground">{horarioTurno[turno]}</p>
                  </div>
                </div>
                <Badge className={encerrado ? "bg-muted text-muted-foreground" : livres > 0 ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}>
                  {encerrado ? "Encerrado" : livres > 0 ? `${livres} livre(s)` : "Lotado"}
                </Badge>
              </div>
              <ul className="flex-1 space-y-1.5 p-4">
                {mesas.map((mesa) => {
                  const ag = ocupacao.find((a) => a.mesaId === mesa.id)
                  return (
                    <li key={mesa.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5 text-sm">
                      <span>
                        {mesa.nome}
                        <span className="ml-1 text-xs text-muted-foreground">· {mesa.local}</span>
                      </span>
                      {ag ? (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <UserRound className="h-3 w-3" />
                          {ehAdmin || ag.socioId === socioLogado?.id ? primeiroNome(nomeSocio(ag.socioId)) : "Ocupada"}
                        </span>
                      ) : encerrado ? (
                        <span className="text-xs text-muted-foreground">-</span>
                      ) : (
                        <Button tamanho="sm" variante="ghost" className="h-7 text-primary" onClick={() => agendar(turno, mesa.id)}>
                          Agendar
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
              {!encerrado && (
                <div className="space-y-2 border-t border-border p-4">
                  {filaTurno.length > 0 && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <ListOrdered className="h-3.5 w-3.5" /> {filaTurno.length} pessoa(s) na fila de espera
                      {minhaPosicao >= 0 && ` · posição ${minhaPosicao + 1}`}
                    </p>
                  )}
                  {livres === 0 && minhaPosicao < 0 && (
                    <Button variante="outline" tamanho="sm" className="w-full" onClick={() => executar(entrarNaFila(socioId, data, turno))}>
                      <Users className="h-4 w-4" /> Entrar na fila de espera
                    </Button>
                  )}
                </div>
              )}
            </Card>
          )
        })}
      </div>

      {ofertaFila && (
        <Aviso tipo="alerta">
          Todas as mesas estão ocupadas no turno da {labelTurno[ofertaFila].toLowerCase()}.{" "}
          <button
            className="font-medium text-primary underline"
            onClick={() => {
              executar(entrarNaFila(socioId, data, ofertaFila))
              setOfertaFila(null)
            }}
          >
            Entrar na fila de espera
          </button>
        </Aviso>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            titulo={ehAdmin ? `Agendamentos de ${formatDate(data)}` : "Meus agendamentos"}
            icone={<CalendarClock className="h-5 w-5" />}
          />
          <div className="divide-y divide-border">
            {meusAgendamentos.length === 0 && <Vazio>Nenhum agendamento.</Vazio>}
            {meusAgendamentos.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 p-4">
                <div>
                  <p className="font-medium">
                    {mesas.find((m) => m.id === a.mesaId)?.nome} · {labelTurno[a.turno]}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {ehAdmin ? `${nomeSocio(a.socioId)} · ` : ""}
                    {formatDate(a.data)}
                    {a.origem === "fila" && " · contemplado pela fila"}
                  </p>
                </div>
                {!turnoEncerrado(a.data, a.turno, hoje, horaAtual) && (
                  <Button variante="ghost" tamanho="sm" onClick={() => setCancelando(a)}>
                    <X className="h-4 w-4" /> Cancelar
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            titulo={ehAdmin ? `Fila de espera de ${formatDate(data)}` : "Minhas posições na fila"}
            descricao="Quando uma mesa é liberada, o primeiro da fila é contemplado automaticamente."
            icone={<ListOrdered className="h-5 w-5" />}
          />
          <div className="divide-y divide-border">
            {minhasFilas.length === 0 && <Vazio>Nenhuma entrada na fila.</Vazio>}
            {minhasFilas.map((f) => {
              const posicao = filaDoTurno(store, f.data, f.turno).findIndex((x) => x.id === f.id) + 1
              return (
                <div key={f.id} className="flex items-center justify-between gap-2 p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-warning/25 text-sm font-semibold text-warning-foreground">
                      {posicao}º
                    </span>
                    <div>
                      <p className="font-medium">{ehAdmin ? nomeSocio(f.socioId) : `${labelTurno[f.turno]} · ${formatDate(f.data)}`}</p>
                      <p className="text-sm text-muted-foreground">
                        {ehAdmin ? `${labelTurno[f.turno]} · ` : ""}aguardando mesa
                      </p>
                    </div>
                  </div>
                  <Button variante="ghost" tamanho="sm" onClick={() => executar(desistirDaFila(f.id))}>
                    Desistir
                  </Button>
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      <Confirmar
        aberto={!!cancelando}
        titulo="Cancelar agendamento"
        mensagem="A mesa será liberada e, se houver fila de espera, repassada ao primeiro da fila."
        rotuloConfirmar="Cancelar agendamento"
        perigo
        onCancelar={() => setCancelando(null)}
        onConfirmar={() => cancelando && executar(cancelarAgendamento(cancelando.id), () => setCancelando(null))}
      />
    </div>
  )
}
