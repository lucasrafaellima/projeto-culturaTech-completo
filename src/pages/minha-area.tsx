import { useState } from "react"
import {
  AlertTriangle,
  BookMarked,
  History,
  Clock,
  CircleDollarSign,
  Ban,
  CheckCircle2,
  BookmarkX,
  MessageSquareText,
  CalendarClock,
  Search,
  Mail,
} from "lucide-react"
import { useStore } from "@/lib/store"
import {
  Aviso,
  Badge,
  Button,
  Campo,
  Card,
  CardHeader,
  Indicador,
  Modal,
  Rodape,
  Textarea,
  Vazio,
  useAcao,
} from "@/components/ui"
import { SituacaoEmprestimo, TabelaHistorico, BadgeReserva } from "@/components/historico"
import { BadgeMulta, HistoricoMulta, descricaoMulta } from "@/components/multas"
import { MAX_EXEMPLARES_SIMULTANEOS, MAX_RENOVACOES, MIN_JUSTIFICATIVA, labelTurno, horarioTurno } from "@/lib/constants"
import { navegar } from "@/lib/navigation"
import { formatCurrency, formatDate, formatDateTime, primeiroNome } from "@/lib/utils"
import { multaCorrente } from "@/lib/regras"
import type { Multa } from "@/lib/types"

export function MinhaAreaPage() {
  const {
    socioLogado,
    hoje,
    multas,
    agendamentos,
    mesas,
    notificacoes,
    tituloDoExemplar,
    debitos,
    historicoDoSocio,
    reservasDoSocio,
    cancelarReserva,
    registrarJustificativa,
  } = useStore()
  const executar = useAcao()
  const [justificando, setJustificando] = useState<Multa | null>(null)
  const [texto, setTexto] = useState("")

  if (!socioLogado) return null
  const socio = socioLogado

  // RN23 / RN28: só os dados do próprio sócio
  const historico = historicoDoSocio(socio.id) ?? []
  const ativos = historico.filter((e) => e.status === "ativo")
  const reservas = reservasDoSocio(socio.id) ?? []
  const reservasAtivas = reservas.filter((r) => r.status === "ativa")
  const minhasMultas = multas.filter((m) => m.socioId === socio.id).sort((a, b) => b.data.localeCompare(a.data))
  const d = debitos(socio.id)
  const bloqueado = d.atrasados.length > 0 || d.multasAbertas.length > 0
  const meusAgendamentos = agendamentos
    .filter((a) => a.socioId === socio.id && a.status === "confirmado" && a.data >= hoje)
    .sort((a, b) => a.data.localeCompare(b.data))
  const meusEmails = notificacoes.filter((n) => n.socioId === socio.id && n.status === "enviado").slice(0, 5)

  function enviarJustificativa() {
    if (!justificando) return
    executar(registrarJustificativa(justificando.id, texto), () => {
      setJustificando(null)
      setTexto("")
    })
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-serif text-2xl font-semibold">Olá, {primeiroNome(socio.nome)}!</h2>
        <p className="text-sm text-muted-foreground">Acompanhe seus empréstimos, reservas e pendências.</p>
      </div>

      {!socio.email && (
        <Aviso tipo="alerta">
          Seu cadastro está sem e-mail, por isso você não recebe os avisos de prazo de devolução. Informe um e-mail no
          balcão de atendimento.
        </Aviso>
      )}

      {/* Pendências (RN11) */}
      {bloqueado && (
        <div className="flex items-start gap-3 rounded-xl border border-danger/40 bg-danger/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
          <div className="text-sm">
            <p className="font-semibold text-danger">Você possui pendências</p>
            <p>
              {d.atrasados.length > 0 && (
                <>
                  {d.atrasados.length} devolução(ões) em atraso (multa acumulada de {formatCurrency(d.totalCorrente)} até
                  hoje).{" "}
                </>
              )}
              {d.multasAbertas.length > 0 && <>Multas em aberto: {formatCurrency(d.totalMultas)}. </>}
              <strong>Novos empréstimos e reservas estão bloqueados até a regularização (RN08).</strong>
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador icone={<BookMarked className="h-5 w-5" />} rotulo="Empréstimos ativos" valor={`${ativos.length} / ${MAX_EXEMPLARES_SIMULTANEOS}`} />
        <Indicador icone={<BookmarkX className="h-5 w-5" />} rotulo="Reservas aguardando" valor={reservasAtivas.length} />
        <Indicador
          icone={<CircleDollarSign className="h-5 w-5" />}
          rotulo="Multas em aberto"
          valor={formatCurrency(d.totalMultas)}
          alerta={d.totalMultas > 0}
        />
        <Indicador
          icone={bloqueado ? <Ban className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
          rotulo="Situação"
          valor={bloqueado ? "Bloqueado" : "Regular"}
          alerta={bloqueado}
        />
      </div>

      {/* Empréstimos em andamento */}
      <Card>
        <CardHeader
          titulo="Meus empréstimos em andamento"
          descricao={`Prazo de 14 dias, renovável até ${MAX_RENOVACOES} vezes no balcão de atendimento.`}
          icone={<Clock className="h-5 w-5" />}
        />
        <div className="divide-y divide-border">
          {ativos.length === 0 && <Vazio>Nenhum empréstimo em andamento.</Vazio>}
          {ativos.map((emp) => {
            const corrente = multaCorrente(emp, hoje)
            return (
              <div key={emp.id} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{tituloDoExemplar(emp.exemplarId)}</p>
                  <p className="text-sm text-muted-foreground">
                    Retirado em {formatDate(emp.dataEmprestimo)} · devolver até <strong>{formatDate(emp.dataPrevista)}</strong> ·
                    renovações {emp.renovacoes}/{MAX_RENOVACOES}
                  </p>
                  {corrente > 0 && (
                    <p className="text-sm text-danger">Multa acumulada até hoje: {formatCurrency(corrente)} (R$ 1,00/dia)</p>
                  )}
                </div>
                <SituacaoEmprestimo emp={emp} />
              </div>
            )
          })}
        </div>
      </Card>

      {/* Reservas (RF14) */}
      <Card>
        <CardHeader
          titulo="Meus livros reservados"
          descricao="A reserva fica guardada no balcão por 3 dias."
          icone={<BookMarked className="h-5 w-5" />}
          acao={
            <Button variante="outline" tamanho="sm" onClick={() => navegar("consulta")}>
              <Search className="h-4 w-4" /> Reservar no catálogo
            </Button>
          }
        />
        <div className="divide-y divide-border">
          {reservas.length === 0 && <Vazio>Você não possui reservas.</Vazio>}
          {reservas.slice(0, 8).map((r) => (
            <div key={r.id} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">{tituloDoExemplar(r.exemplarId)}</p>
                <p className="text-sm text-muted-foreground">
                  Reservado em {formatDate(r.dataReserva)}
                  {r.status === "ativa" && <> · retirar até {formatDate(r.expiraEm)}</>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <BadgeReserva r={r} />
                {r.status === "ativa" && (
                  <Button variante="ghost" tamanho="sm" onClick={() => executar(cancelarReserva(r.id))}>
                    Cancelar
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Multas (RN07) */}
        <Card>
          <CardHeader
            titulo="Minhas multas"
            descricao="Você pode enviar uma justificativa para pedir o abono de uma multa."
            icone={<CircleDollarSign className="h-5 w-5" />}
          />
          <div className="divide-y divide-border">
            {minhasMultas.length === 0 && <Vazio>Você não possui multas.</Vazio>}
            {minhasMultas.map((m) => (
              <div key={m.id} className="space-y-3 p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {formatCurrency(m.valor)} · {descricaoMulta(m)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {tituloDoExemplar(historico.find((e) => e.id === m.emprestimoId)?.exemplarId ?? "")} ·{" "}
                      {formatDate(m.data)}
                    </p>
                  </div>
                  <BadgeMulta m={m} />
                </div>
                <HistoricoMulta m={m} />
                {m.status === "pendente" && (
                  <Button
                    variante="outline"
                    tamanho="sm"
                    onClick={() => {
                      setJustificando(m)
                      setTexto("")
                    }}
                  >
                    <MessageSquareText className="h-4 w-4" />
                    {m.pareceres.length > 0 ? "Enviar nova justificativa" : "Justificar e pedir abono"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-5">
          {/* Agendamentos */}
          <Card>
            <CardHeader
              titulo="Próximos agendamentos de mesa"
              icone={<CalendarClock className="h-5 w-5" />}
              acao={
                <Button variante="outline" tamanho="sm" onClick={() => navegar("mesas")}>
                  Agendar
                </Button>
              }
            />
            <div className="divide-y divide-border">
              {meusAgendamentos.length === 0 && <Vazio>Nenhum agendamento futuro.</Vazio>}
              {meusAgendamentos.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 p-5">
                  <div>
                    <p className="font-medium">{mesas.find((m) => m.id === a.mesaId)?.nome}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(a.data)} · {labelTurno[a.turno]} ({horarioTurno[a.turno]})
                    </p>
                  </div>
                  {a.origem === "fila" && <Badge className="bg-success/15 text-success">Veio da fila</Badge>}
                </div>
              ))}
            </div>
          </Card>

          {/* E-mails recebidos (RF05) */}
          <Card>
            <CardHeader titulo="Avisos enviados por e-mail" icone={<Mail className="h-5 w-5" />} />
            <div className="divide-y divide-border">
              {meusEmails.length === 0 && <Vazio>Nenhum aviso enviado recentemente.</Vazio>}
              {meusEmails.map((n) => (
                <div key={n.id} className="p-5">
                  <p className="text-sm font-medium">{n.assunto}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(n.data)}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Histórico de leitura (RF04) */}
      <Card>
        <CardHeader
          titulo="Meu histórico de leitura"
          descricao="Empréstimos passados e em andamento."
          icone={<History className="h-5 w-5" />}
        />
        <TabelaHistorico emprestimos={historico} />
      </Card>

      <Modal aberto={!!justificando} onFechar={() => setJustificando(null)} titulo="Justificar multa">
        {justificando && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Multa de <strong className="text-foreground">{formatCurrency(justificando.valor)}</strong> ({descricaoMulta(justificando).toLowerCase()}).
              Explique o motivo com detalhes. A administração da biblioteca vai avaliar e pode abonar a multa ou mantê-la
              (RN07).
            </p>
            <Campo rotulo="Justificativa" dica={`${texto.trim().length}/${MIN_JUSTIFICATIVA} caracteres mínimos`}>
              {(id) => <Textarea id={id} rows={5} value={texto} onChange={(e) => setTexto(e.target.value)} />}
            </Campo>
            <Rodape>
              <Button variante="outline" onClick={() => setJustificando(null)}>
                Cancelar
              </Button>
              <Button onClick={enviarJustificativa}>Enviar justificativa</Button>
            </Rodape>
          </div>
        )}
      </Modal>
    </div>
  )
}
