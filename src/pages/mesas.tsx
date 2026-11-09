import { useMemo, useState } from "react"
import { Baby, CalendarClock, Clock, Users, ListOrdered, X, UserRound } from "lucide-react"
import { useStore } from "@/lib/store"
import { Aviso, Badge, Button, Campo, Card, CardHeader, Confirmar, Input, Select, Vazio, useAcao } from "@/components/ui"
import { IDADE_MAXIMA_CRIANCA, horarioTurno, labelEspaco, labelTurno } from "@/lib/constants"
import { agendamentosDoTurno, erroDoResponsavel, filaDoTurno, turnoEncerrado } from "@/lib/regras"
import { addDays, cn, formatDate, primeiroNome } from "@/lib/utils"
import type { Agendamento, CriancaAgendada, Espaco, Turno } from "@/lib/types"

const TURNOS: Turno[] = ["manha", "tarde", "noite"]

const descreverCrianca = (c: CriancaAgendada) => `Para ${c.nome}${c.idade === undefined ? "" : `, ${c.idade} ano(s)`}`

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
  const [paraCrianca, setParaCrianca] = useState(false)
  const [nomeCrianca, setNomeCrianca] = useState("")
  const [idadeCrianca, setIdadeCrianca] = useState("")

  const horaAtual = new Date().getHours()
  const socioId = ehAdmin ? socioSel : socioLogado?.id ?? ""
  const socioEscolhido = ehAdmin ? getSocio(socioSel) : socioLogado ?? undefined

  // US28: quem não pode agendar para criança vê o motivo e continua com as mesas de estudo
  const motivoSemCrianca = socioEscolhido ? erroDoResponsavel(socioEscolhido, data) : null
  const comCrianca = paraCrianca && !motivoSemCrianca
  const espaco: Espaco = comCrianca ? "infantil" : "estudo"
  const mesasDoEspaco = mesas.filter((m) => m.espaco === espaco)
  const nomeDigitado = nomeCrianca.trim().toLowerCase()
  const criancaPedida = (): CriancaAgendada | undefined =>
    comCrianca ? { nome: nomeCrianca, idade: idadeCrianca === "" ? Number.NaN : Number(idadeCrianca) } : undefined

  // A grade reflete a data e o espaço escolhidos
  const grade = useMemo(
    () =>
      TURNOS.map((turno) => ({
        turno,
        encerrado: turnoEncerrado(data, turno, hoje, horaAtual),
        ocupacao: agendamentosDoTurno(store, data, turno),
        fila: filaDoTurno(store, data, turno, espaco),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, agendamentos, fila, hoje, horaAtual, espaco],
  )

  function agendar(turno: Turno, mesaId?: string) {
    if (!socioId) return executar({ ok: false, mensagem: "Selecione o sócio-leitor." })
    setOfertaFila(null)
    return executar(async () => {
      const r = await agendarMesa(socioId, data, turno, mesaId, criancaPedida())
      if (!r.ok && r.ofereceFila) setOfertaFila(turno)
      return r
    })
  }

  function entrarFila(turno: Turno) {
    if (!socioId) return executar({ ok: false, mensagem: "Selecione o sócio-leitor." })
    return executar(() => entrarNaFila(socioId, data, turno, criancaPedida()))
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
      <Card className="space-y-3 p-5">
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
              Escolha a data e o turno. Cada sócio-leitor pode agendar <strong>1 turno por dia</strong> para si (RN05). Se todas as
              mesas estiverem ocupadas, você pode entrar na fila de espera (RF11).
            </p>
          )}
        </div>
        <div className="grid gap-3 md:grid-cols-3 md:items-end">
          <Campo rotulo="Para quem é o agendamento">
            {(id) => (
              <Select
                id={id}
                value={comCrianca ? "crianca" : "socio"}
                onChange={(e) => {
                  setParaCrianca(e.target.value === "crianca")
                  setOfertaFila(null)
                }}
              >
                <option value="socio">{ehAdmin ? "Para o sócio-leitor" : "Para mim"}</option>
                <option value="crianca" disabled={!!motivoSemCrianca}>
                  Para uma criança sob {ehAdmin ? "responsabilidade do sócio" : "minha responsabilidade"}
                </option>
              </Select>
            )}
          </Campo>
          {comCrianca && (
            <>
              <Campo rotulo="Nome da criança">
                {(id) => <Input id={id} maxLength={150} value={nomeCrianca} onChange={(e) => setNomeCrianca(e.target.value)} autoComplete="off" />}
              </Campo>
              <Campo rotulo="Idade da criança">
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={IDADE_MAXIMA_CRIANCA}
                    value={idadeCrianca}
                    onChange={(e) => setIdadeCrianca(e.target.value)}
                  />
                )}
              </Campo>
            </>
          )}
        </div>
        {motivoSemCrianca && <p className="text-sm text-muted-foreground text-pretty">{motivoSemCrianca}</p>}
        {comCrianca && (
          <Aviso tipo="info">
            O espaço infantil funciona com a supervisão do responsável, que precisa permanecer com a criança durante o turno.
          </Aviso>
        )}
      </Card>

      <h2 className="flex items-center gap-2 font-serif text-lg font-semibold">
        {espaco === "infantil" && <Baby className="h-5 w-5 text-primary" />}
        {labelEspaco[espaco]}
      </h2>

      {mesasDoEspaco.length === 0 && <Vazio>Nenhuma mesa cadastrada neste espaço.</Vazio>}

      {/* Grade da data e do espaço escolhidos */}
      {mesasDoEspaco.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          {grade.map(({ turno, encerrado, ocupacao, fila: filaTurno }) => {
            const ocupadas = mesasDoEspaco.filter((m) => ocupacao.some((a) => a.mesaId === m.id)).length
            const livres = mesasDoEspaco.length - ocupadas
            const minhaPosicao = filaTurno.findIndex(
              (f) => f.socioId === socioId && (f.crianca?.nome.toLowerCase() ?? "") === (comCrianca ? nomeDigitado : ""),
            )
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
                  {mesasDoEspaco.map((mesa) => {
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
                            {ehAdmin || ag.socioId === socioLogado?.id ? primeiroNome(ag.crianca?.nome ?? nomeSocio(ag.socioId)) : "Ocupada"}
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
                      <Button variante="outline" tamanho="sm" className="w-full" onClick={() => entrarFila(turno)}>
                        <Users className="h-4 w-4" /> Entrar na fila de espera
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {ofertaFila && (
        <Aviso tipo="alerta">
          Todas as mesas estão ocupadas no turno da {labelTurno[ofertaFila].toLowerCase()}.{" "}
          <button
            className="font-medium text-primary underline"
            onClick={() => {
              entrarFila(ofertaFila)
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
                  {a.crianca && <p className="text-sm text-muted-foreground">{descreverCrianca(a.crianca)}</p>}
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
              const posicao = filaDoTurno(store, f.data, f.turno, f.espaco).findIndex((x) => x.id === f.id) + 1
              return (
                <div key={f.id} className="flex items-center justify-between gap-2 p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-warning/25 text-sm font-semibold text-warning-foreground">
                      {posicao}º
                    </span>
                    <div>
                      <p className="font-medium">{ehAdmin ? nomeSocio(f.socioId) : `${labelTurno[f.turno]} · ${formatDate(f.data)}`}</p>
                      <p className="text-sm text-muted-foreground">
                        {ehAdmin ? `${labelTurno[f.turno]} · ` : ""}
                        {f.crianca ? `${labelEspaco.infantil} · ${descreverCrianca(f.crianca)}` : "aguardando mesa"}
                      </p>
                    </div>
                  </div>
                  <Button variante="ghost" tamanho="sm" onClick={() => executar(() => desistirDaFila(f.id))}>
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
        onConfirmar={() => cancelando && executar(() => cancelarAgendamento(cancelando.id), () => setCancelando(null))}
      />
    </div>
  )
}
