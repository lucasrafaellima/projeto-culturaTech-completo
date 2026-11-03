import { useMemo, useState } from "react"
import { CalendarClock, Clock, Users, ListOrdered, X, UserRound, Baby, CheckCircle2 } from "lucide-react"
import { useStore, type ResultadoAgendamento } from "@/lib/store"
import { Abas, Aviso, Badge, Button, Campo, Card, CardHeader, Confirmar, Input, Select, Vazio, useAcao } from "@/components/ui"
import { IDADE_MAXIMA_KIDS, IDADE_MINIMA_SOCIO, TOLERANCIA_USO_MINUTOS, horarioTurno, labelEspaco, labelTurno } from "@/lib/constants"
import {
  agendamentosDoTurno,
  espacoDaFila,
  espacoDoAgendamento,
  filaDoTurno,
  mesasDoEspaco,
  prazoConfirmacaoUso,
  turnoEncerrado,
} from "@/lib/regras"
import { addDays, cn, formatCpf, formatDate, idade, mascararCpf, primeiroNome } from "@/lib/utils"
import type { Agendamento, CriancaKids, EspacoMesa, Turno } from "@/lib/types"

const TURNOS: Turno[] = ["manha", "tarde", "noite"]

const criancaVazia = (): CriancaKids => ({ nome: "", cpf: "", dataNascimento: "" })

const horaMinuto = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })

export function MesasPage() {
  const store = useStore()
  const {
    socios,
    perfil,
    socioLogado,
    hoje,
    agendamentos,
    fila,
    agendarMesa,
    entrarNaFila,
    agendarKids,
    entrarNaFilaKids,
    confirmarUso,
    cancelarAgendamento,
    desistirDaFila,
    getSocio,
  } = store
  const executar = useAcao()
  const ehAdmin = perfil === "admin"

  const [espaco, setEspaco] = useState<EspacoMesa>("estudo")
  const [data, setData] = useState(hoje)
  const [socioSel, setSocioSel] = useState("")
  const [crianca, setCrianca] = useState<CriancaKids>(criancaVazia)
  const [erroCrianca, setErroCrianca] = useState<{ campo: keyof CriancaKids; mensagem: string } | null>(null)
  const [cancelando, setCancelando] = useState<Agendamento | null>(null)
  const [ofertaFila, setOfertaFila] = useState<{ turno: Turno; espaco: EspacoMesa } | null>(null)

  const horaAtual = new Date().getHours()
  const socioId = ehAdmin ? socioSel : socioLogado?.id ?? ""
  const kids = espaco === "kids"
  const mesasEspaco = mesasDoEspaco(store, espaco)

  // A grade reflete a data e o espaço escolhidos
  const grade = useMemo(
    () =>
      TURNOS.map((turno) => ({
        turno,
        encerrado: turnoEncerrado(data, turno, hoje, horaAtual),
        ocupacao: agendamentosDoTurno(store, data, turno, espaco),
        fila: filaDoTurno(store, data, turno, espaco),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, espaco, agendamentos, fila, hoje, horaAtual],
  )

  const setCampoCrianca = (k: keyof CriancaKids, v: string) => {
    setCrianca({ ...crianca, [k]: v })
    if (erroCrianca?.campo === k) setErroCrianca(null)
  }

  function agendar(turno: Turno, mesaId?: string) {
    if (!socioId) return executar({ ok: false, mensagem: "Selecione o sócio-leitor." })
    const r = kids ? agendarKids(socioId, data, turno, crianca, mesaId) : agendarMesa(socioId, data, turno, mesaId)
    setErroCrianca(r.campo ? { campo: r.campo, mensagem: r.mensagem } : null)
    executar(r)
    setOfertaFila(!r.ok && r.ofereceFila ? { turno, espaco } : null)
  }

  function entrar(turno: Turno, esp: EspacoMesa) {
    if (!socioId) return executar({ ok: false, mensagem: "Selecione o sócio-leitor." })
    const r: ResultadoAgendamento =
      esp === "kids" ? entrarNaFilaKids(socioId, data, turno, crianca) : entrarNaFila(socioId, data, turno)
    if (r.campo) setErroCrianca({ campo: r.campo, mensagem: r.mensagem })
    executar(r)
    if (r.ok) setOfertaFila(null)
  }

  const nomeSocio = (id: string) => {
    const s = getSocio(id)
    if (!s) return "-"
    return ehAdmin || id === socioLogado?.id ? s.nome : "Reservado"
  }

  const nomeMesa = (id: string) => store.mesas.find((m) => m.id === id)?.nome ?? "Mesa"

  // RNF06: os dados da criança só aparecem para o responsável e para a administração
  const podeVer = (a: { socioId: string }) => ehAdmin || a.socioId === socioLogado?.id

  // Lista do sócio: seus agendamentos e posições na fila; o administrador vê os da data escolhida
  const meusAgendamentos = agendamentos
    .filter((a) =>
      ehAdmin
        ? a.data === data && (a.status === "confirmado" || a.status === "nao_compareceu")
        : a.status === "confirmado" && a.data >= hoje && a.socioId === socioLogado?.id,
    )
    .sort((a, b) => a.data.localeCompare(b.data) || TURNOS.indexOf(a.turno) - TURNOS.indexOf(b.turno))
  const minhasFilas = fila
    .filter((f) => f.status === "aguardando" && (ehAdmin ? f.data === data : f.socioId === socioLogado?.id))
    .sort((a, b) => a.data.localeCompare(b.data) || a.criadoEm.localeCompare(b.criadoEm))

  return (
    <div className="space-y-5">
      <Abas
        abas={[
          { id: "estudo", rotulo: labelEspaco.estudo },
          { id: "kids", rotulo: labelEspaco.kids },
        ]}
        ativa={espaco}
        onChange={(id) => {
          setEspaco(id)
          setOfertaFila(null)
          setErroCrianca(null)
        }}
      />

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
            <Campo rotulo={kids ? "Sócio-leitor responsável" : "Agendar para o sócio-leitor"}>
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
          ) : kids ? (
            <p className="text-sm text-muted-foreground text-pretty">
              Agende uma mesa do Espaço Kids para uma criança de até {IDADE_MAXIMA_KIDS} anos sob a sua responsabilidade.
              Cada criança pode usar <strong>1 turno por dia</strong>.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground text-pretty">
              Escolha a data e o turno. Cada sócio-leitor pode agendar <strong>1 turno por dia</strong> (RN05). Se todas as
              mesas estiverem ocupadas, você pode entrar na fila de espera (RF11).
            </p>
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground text-pretty">
          O uso é confirmado no balcão. Sem confirmação em até {TOLERANCIA_USO_MINUTOS} minutos do início do turno, a vaga é
          liberada para a fila de espera.
        </p>
      </Card>

      {kids && (
        <Card>
          <CardHeader
            titulo="Dados da criança"
            descricao={`A criança não tem cadastro: ela fica vinculada ${ehAdmin ? "ao sócio-leitor responsável" : "a você como responsável"}.`}
            icone={<Baby className="h-5 w-5" />}
          />
          <div className="space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
              <Campo rotulo="Nome completo da criança" erro={erroCrianca?.campo === "nome" ? erroCrianca.mensagem : null}>
                {(id) => (
                  <Input
                    id={id}
                    autoComplete="off"
                    value={crianca.nome}
                    aria-invalid={erroCrianca?.campo === "nome" || undefined}
                    onChange={(e) => setCampoCrianca("nome", e.target.value)}
                  />
                )}
              </Campo>
              <Campo rotulo="CPF da criança" erro={erroCrianca?.campo === "cpf" ? erroCrianca.mensagem : null}>
                {(id) => (
                  <Input
                    id={id}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="000.000.000-00"
                    value={crianca.cpf}
                    aria-invalid={erroCrianca?.campo === "cpf" || undefined}
                    onChange={(e) => setCampoCrianca("cpf", formatCpf(e.target.value))}
                  />
                )}
              </Campo>
              <Campo
                rotulo="Data de nascimento"
                erro={erroCrianca?.campo === "dataNascimento" ? erroCrianca.mensagem : null}
              >
                {(id) => (
                  <Input
                    id={id}
                    type="date"
                    max={hoje}
                    value={crianca.dataNascimento}
                    aria-invalid={erroCrianca?.campo === "dataNascimento" || undefined}
                    onChange={(e) => setCampoCrianca("dataNascimento", e.target.value)}
                  />
                )}
              </Campo>
            </div>
            <Aviso>
              O Espaço Kids é só para crianças de até {IDADE_MAXIMA_KIDS} anos. A partir dos {IDADE_MINIMA_SOCIO} anos, ela pode
              criar a própria conta de sócio-leitor e pegar livros emprestados.
            </Aviso>
          </div>
        </Card>
      )}

      {/* Grade da data escolhida */}
      <div className="grid gap-4 md:grid-cols-3">
        {grade.map(({ turno, encerrado, ocupacao, fila: filaTurno }) => {
          const livres = mesasEspaco.length - ocupacao.length
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
                {mesasEspaco.map((mesa) => {
                  const ag = ocupacao.find((a) => a.mesaId === mesa.id)
                  return (
                    <li key={mesa.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5 text-sm">
                      <span>
                        {mesa.nome}
                        <span className="ml-1 text-xs text-muted-foreground">· {mesa.local}</span>
                      </span>
                      {ag ? (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          {ag.usoConfirmadoEm && <CheckCircle2 className="h-3 w-3 text-success" aria-label="Em uso" />}
                          <UserRound className="h-3 w-3" />
                          {!podeVer(ag)
                            ? "Ocupada"
                            : ag.crianca
                              ? primeiroNome(ag.crianca.nome)
                              : primeiroNome(nomeSocio(ag.socioId))}
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
                  {livres === 0 && (kids || minhaPosicao < 0) && (
                    <Button variante="outline" tamanho="sm" className="w-full" onClick={() => entrar(turno, espaco)}>
                      <Users className="h-4 w-4" /> Entrar na fila de espera
                    </Button>
                  )}
                </div>
              )}
            </Card>
          )
        })}
      </div>

      {ofertaFila && ofertaFila.espaco === espaco && (
        <Aviso tipo="alerta">
          Todas as mesas {ofertaFila.espaco === "kids" ? "do Espaço Kids " : ""}estão ocupadas no turno da{" "}
          {labelTurno[ofertaFila.turno].toLowerCase()}.{" "}
          <button className="font-medium text-primary underline" onClick={() => entrar(ofertaFila.turno, ofertaFila.espaco)}>
            Entrar na fila de espera
          </button>
        </Aviso>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            titulo={ehAdmin ? `Agendamentos de ${formatDate(data)}` : "Meus agendamentos"}
            descricao={ehAdmin ? "Confirme o uso quando o sócio-leitor (ou a criança) chegar ao espaço." : undefined}
            icone={<CalendarClock className="h-5 w-5" />}
          />
          <div className="divide-y divide-border">
            {meusAgendamentos.length === 0 && <Vazio>Nenhum agendamento.</Vazio>}
            {meusAgendamentos.map((a) => {
              const encerradoAg = turnoEncerrado(a.data, a.turno, hoje, horaAtual)
              const ativo = a.status === "confirmado"
              const aguardandoUso = ativo && !a.usoConfirmadoEm && a.data === hoje && !encerradoAg
              const ehKids = espacoDoAgendamento(store, a) === "kids"
              return (
                <div key={a.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {nomeMesa(a.mesaId)} · {labelTurno[a.turno]}
                      {ehKids && <Badge className="bg-accent/15 text-accent">Espaço Kids</Badge>}
                      {a.usoConfirmadoEm && <Badge className="bg-success/15 text-success">Em uso</Badge>}
                      {a.status === "nao_compareceu" && <Badge className="bg-muted text-muted-foreground">Não compareceu</Badge>}
                    </p>
                    {a.crianca && podeVer(a) && (
                      <p className="text-sm">
                        Criança: {a.crianca.nome}
                        {a.crianca.cpf && (
                          <span className="text-muted-foreground">
                            {" "}
                            · CPF {mascararCpf(a.crianca.cpf)} · {idade(a.crianca.dataNascimento, a.data)} anos
                          </span>
                        )}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {ehAdmin ? `${a.crianca ? "Responsável: " : ""}${nomeSocio(a.socioId)} · ` : a.crianca ? "Responsável: você · " : ""}
                      {formatDate(a.data)}
                      {a.origem === "fila" && " · contemplado pela fila"}
                    </p>
                    {aguardandoUso && (
                      <p className="text-xs text-warning-foreground">
                        Confirmar o uso até {horaMinuto(prazoConfirmacaoUso(a))}, senão a vaga é liberada.
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {ehAdmin && aguardandoUso && (
                      <Button variante="success" tamanho="sm" onClick={() => executar(confirmarUso(a.id))}>
                        <CheckCircle2 className="h-4 w-4" /> Confirmar uso
                      </Button>
                    )}
                    {ativo && !encerradoAg && (
                      <Button variante="ghost" tamanho="sm" onClick={() => setCancelando(a)}>
                        <X className="h-4 w-4" /> Cancelar
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
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
              const esp = espacoDaFila(f)
              const posicao = filaDoTurno(store, f.data, f.turno, esp).findIndex((x) => x.id === f.id) + 1
              const onde = esp === "kids" ? `${labelEspaco.kids} · ` : ""
              return (
                <div key={f.id} className="flex items-center justify-between gap-2 p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-warning/25 text-sm font-semibold text-warning-foreground">
                      {posicao}º
                    </span>
                    <div>
                      <p className="font-medium">
                        {ehAdmin ? nomeSocio(f.socioId) : `${onde}${labelTurno[f.turno]} · ${formatDate(f.data)}`}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {ehAdmin ? `${onde}${labelTurno[f.turno]} · ` : ""}
                        {f.crianca ? `para ${f.crianca.nome}` : "aguardando mesa"}
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
