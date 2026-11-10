import { useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowRightLeft, CheckCircle2, Clock, History, ListOrdered, RefreshCw, UserRound, UserX, Users } from "lucide-react"
import { useStore } from "@/lib/store"
import { Aviso, Badge, Button, Campo, Card, CardHeader, Confirmar, Indicador, Input, Select, Vazio, useAcao } from "@/components/ui"
import {
  TOLERANCIA_USO_MINUTOS,
  corSituacaoAgendamento,
  horarioTurno,
  labelEspaco,
  labelSituacaoAgendamento,
  labelTurno,
} from "@/lib/constants"
import {
  FIM_TURNO,
  destinoDaVaga,
  espacoDaFila,
  espacoDoAgendamento,
  filaDoTurno,
  movimentacoesDoTurno,
  prazoConfirmacaoUso,
  situacaoAgendamento,
  turnoDoMomento,
  type DestinoVaga,
  type MovimentoMesa,
} from "@/lib/regras"
import { addDays, cn, formatDate, formatHora } from "@/lib/utils"
import type { Agendamento, EspacoMesa, Turno } from "@/lib/types"

const TURNOS: Turno[] = ["manha", "tarde", "noite"]
const ATUALIZACAO_MS = 30_000

type FiltroEspaco = "todos" | EspacoMesa

// US30: acompanhamento dos agendamentos de um turno pelo administrador. Mostra quem está
// em cada mesa, confirma o uso, registra o não comparecimento e mostra para onde foi a vaga.
export function AcompanhamentoPage() {
  const store = useStore()
  const { hoje, perfil, agendamentos, mesas, getSocio, confirmarUso, registrarNaoComparecimento, atualizarMesas } = store
  const executar = useAcao()
  const ehAdmin = perfil === "admin"

  const [data, setData] = useState(hoje)
  const [turno, setTurno] = useState<Turno>(() => turnoDoMomento(new Date().getHours()))
  const [espaco, setEspaco] = useState<FiltroEspaco>("todos")
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null)
  const [ausente, setAusente] = useState<Agendamento | null>(null)
  // a situação depende do relógio; a atualização periódica garante uma nova renderização
  const agora = new Date()

  // Atualização automática: com a API, o servidor aplica a tolerância de uso a cada leitura;
  // sem ela, a rotina local faz o mesmo
  const atualizar = useRef(atualizarMesas)
  useEffect(() => {
    atualizar.current = atualizarMesas
  }, [atualizarMesas])
  useEffect(() => {
    let ativo = true
    const ciclo = async () => {
      const r = await atualizar.current()
      if (ativo && r.ok) setAtualizadoEm(new Date())
    }
    ciclo()
    const timer = setInterval(ciclo, ATUALIZACAO_MS)
    return () => {
      ativo = false
      clearInterval(timer)
    }
  }, [])

  const espacos: EspacoMesa[] = espaco === "todos" ? ["estudo", "kids"] : [espaco]
  const doFiltro = (a: Agendamento) => espacos.includes(espacoDoAgendamento(store, a))

  const lista = agendamentos
    .filter((a) => a.data === data && a.turno === turno && a.status !== "cancelado" && doFiltro(a))
    .sort((a, b) => nomeMesa(a.mesaId).localeCompare(nomeMesa(b.mesaId), "pt-BR", { numeric: true }) || a.criadoEm.localeCompare(b.criadoEm))
  const situacoes = new Map(lista.map((a) => [a.id, situacaoAgendamento(a, agora)]))
  const mesasDoFiltro = mesas.filter((m) => espacos.includes(m.espaco ?? "estudo"))
  const ocupadas = new Set(lista.filter((a) => a.status === "confirmado").map((a) => a.mesaId))
  const livres = mesasDoFiltro.filter((m) => !ocupadas.has(m.id))
  const filaTurno = espacos.flatMap((esp) => filaDoTurno(store, data, turno, esp).map((f, i) => ({ f, posicao: i + 1 })))
  const movimentos = movimentacoesDoTurno(store, data, turno, espaco === "todos" ? undefined : espaco)

  const contar = (...s: string[]) => lista.filter((a) => s.includes(situacoes.get(a.id)!)).length
  const emUso = contar("em_uso", "utilizado")
  const aguardando = contar("agendado", "aguardando_uso", "prazo_esgotado")
  const naoCompareceram = contar("nao_compareceu")

  function nomeMesa(id: string) {
    return mesas.find((m) => m.id === id)?.nome ?? "Mesa"
  }
  const nomeSocio = (id: string) => getSocio(id)?.nome ?? "Sócio-leitor"
  const pessoa = (a: Agendamento) => (a.crianca ? a.crianca.nome : nomeSocio(a.socioId))

  const textoDestino = (d: DestinoVaga) =>
    d.tipo === "fila"
      ? `Vaga transferida para ${pessoa(d.agendamento)}, da fila de espera`
      : d.tipo === "direto"
        ? `Vaga liberada e agendada por ${pessoa(d.agendamento)}`
        : "Vaga liberada para novo agendamento"

  function detalheSituacao(a: Agendamento): string {
    switch (situacoes.get(a.id)) {
      case "agendado":
      case "aguardando_uso":
        return `Confirmar o uso até ${formatHora(prazoConfirmacaoUso(a))}`
      case "prazo_esgotado":
        return `Tolerância terminou às ${formatHora(prazoConfirmacaoUso(a))}: a vaga será liberada`
      case "em_uso":
        return `Uso confirmado às ${formatHora(a.usoConfirmadoEm!)} · vaga garantida até as ${FIM_TURNO[a.turno]}h`
      case "utilizado":
        return `Uso confirmado às ${formatHora(a.usoConfirmadoEm!)}`
      case "nao_compareceu":
        return textoDestino(destinoDaVaga(store, a))
      case "encerrado":
        return "Turno encerrado sem confirmação de uso"
      default:
        return ""
    }
  }

  function textoMovimento(m: MovimentoMesa): string {
    const quem = pessoa(m.agendamento)
    const mesa = nomeMesa(m.agendamento.mesaId)
    switch (m.tipo) {
      case "agendado":
        return `${quem} agendou a ${mesa}.`
      case "contemplado":
        return `${quem} foi contemplado(a) pela fila de espera com a ${mesa} e saiu da fila.`
      case "uso_confirmado":
        return `Uso confirmado: ${quem} está na ${mesa}.`
      case "nao_compareceu":
        return `${quem} não compareceu à ${mesa} (sem confirmação em ${TOLERANCIA_USO_MINUTOS} minutos). ${textoDestino(m.destino!)}.`
    }
  }

  const iconeMovimento: Record<MovimentoMesa["tipo"], ReactNode> = {
    agendado: <Clock className="h-4 w-4 text-primary" />,
    contemplado: <ArrowRightLeft className="h-4 w-4 text-accent" />,
    uso_confirmado: <CheckCircle2 className="h-4 w-4 text-success" />,
    nao_compareceu: <UserX className="h-4 w-4 text-danger" />,
  }

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="grid gap-3 sm:grid-cols-[auto_auto_1fr_auto] sm:items-end">
          <Campo rotulo="Data">
            {(id) => (
              <Input
                id={id}
                type="date"
                min={hoje}
                max={addDays(hoje, 30)}
                value={data}
                onChange={(e) => setData(e.target.value || hoje)}
                className="sm:w-44"
              />
            )}
          </Campo>
          <Campo rotulo="Turno">
            {(id) => (
              <Select id={id} value={turno} onChange={(e) => setTurno(e.target.value as Turno)} className="sm:w-48">
                {TURNOS.map((t) => (
                  <option key={t} value={t}>
                    {labelTurno[t]} ({horarioTurno[t]})
                  </option>
                ))}
              </Select>
            )}
          </Campo>
          <Campo rotulo="Espaço">
            {(id) => (
              <Select id={id} value={espaco} onChange={(e) => setEspaco(e.target.value as FiltroEspaco)} className="sm:w-56">
                <option value="todos">Todos os espaços</option>
                <option value="estudo">{labelEspaco.estudo}</option>
                <option value="kids">{labelEspaco.kids}</option>
              </Select>
            )}
          </Campo>
          <Button
            variante="outline"
            onClick={() =>
              executar(async () => {
                const r = await atualizarMesas()
                if (r.ok) setAtualizadoEm(new Date())
                return r
              })
            }
          >
            <RefreshCw className="h-4 w-4" /> Atualizar
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground text-pretty">
          Sem confirmação de uso em até {TOLERANCIA_USO_MINUTOS} minutos do início do turno (ou do agendamento, se ele foi
          feito depois), o agendamento passa para “não compareceu” e a vaga vai para o primeiro da fila de espera do turno.
          A situação é atualizada sozinha a cada {ATUALIZACAO_MS / 1000} segundos
          {atualizadoEm ? ` (última atualização às ${formatHora(atualizadoEm)})` : ""}.
        </p>
      </Card>

      {!ehAdmin && <Aviso tipo="erro">Somente o administrador acompanha os agendamentos.</Aviso>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador icone={<CheckCircle2 className="h-5 w-5" />} rotulo="Em uso" valor={`${emUso} de ${mesasDoFiltro.length} mesas`} />
        <Indicador icone={<Clock className="h-5 w-5" />} rotulo="Aguardando confirmação" valor={aguardando} />
        <Indicador icone={<UserX className="h-5 w-5" />} rotulo="Não compareceram" valor={naoCompareceram} alerta={naoCompareceram > 0} />
        <Indicador icone={<ListOrdered className="h-5 w-5" />} rotulo="Na fila de espera" valor={filaTurno.length} />
      </div>

      <Card>
        <CardHeader
          titulo={`Agendamentos de ${formatDate(data)} · ${labelTurno[turno]}`}
          descricao="Confirme o uso quando o sócio-leitor (ou, no Espaço Kids, a criança) chegar ao espaço."
          icone={<Users className="h-5 w-5" />}
        />
        <ul className="divide-y divide-border" aria-label="Agendamentos do turno">
          {lista.length === 0 && (
            <li>
              <Vazio>Nenhum agendamento neste turno.</Vazio>
            </li>
          )}
          {lista.map((a) => {
            const situacao = situacoes.get(a.id)!
            const kids = espacoDoAgendamento(store, a) === "kids"
            const podeConfirmar = a.data === hoje && (situacao === "agendado" || situacao === "aguardando_uso")
            return (
              <li key={a.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-0.5">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {nomeMesa(a.mesaId)}
                    {kids && <Badge className="bg-accent/15 text-accent">Espaço Kids</Badge>}
                    <Badge className={corSituacaoAgendamento[situacao]}>{labelSituacaoAgendamento[situacao]}</Badge>
                  </p>
                  {a.crianca ? (
                    <>
                      <p className="text-sm">Criança: {a.crianca.nome}</p>
                      <p className="text-sm text-muted-foreground">Responsável: {nomeSocio(a.socioId)}</p>
                    </>
                  ) : (
                    <p className="flex items-center gap-1 text-sm">
                      <UserRound className="h-3.5 w-3.5 text-muted-foreground" /> {nomeSocio(a.socioId)}
                    </p>
                  )}
                  <p
                    className={cn(
                      "text-xs",
                      situacao === "prazo_esgotado" ? "text-danger" : "text-muted-foreground",
                    )}
                  >
                    {detalheSituacao(a)}
                    {a.origem === "fila" && " · contemplado pela fila"}
                  </p>
                </div>
                {ehAdmin && (podeConfirmar || situacao === "prazo_esgotado") && (
                  <div className="flex shrink-0 flex-wrap gap-1">
                    {podeConfirmar && (
                      <Button variante="success" tamanho="sm" onClick={() => executar(() => confirmarUso(a.id))}>
                        <CheckCircle2 className="h-4 w-4" /> Confirmar uso
                      </Button>
                    )}
                    {situacao === "prazo_esgotado" && (
                      <Button variante="danger" tamanho="sm" onClick={() => setAusente(a)}>
                        <UserX className="h-4 w-4" /> Registrar não comparecimento
                      </Button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        {mesasDoFiltro.length > 0 && (
          <p className="border-t border-border p-4 text-sm text-muted-foreground">
            {livres.length === 0
              ? "Todas as mesas estão ocupadas neste turno."
              : `Livres para agendamento: ${livres.map((m) => m.nome).join(", ")}.`}
          </p>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            titulo="Fila de espera do turno"
            descricao="Quem já tem agendamento no mesmo dia é ignorado e a vaga passa para o próximo."
            icone={<ListOrdered className="h-5 w-5" />}
          />
          <ul className="divide-y divide-border" aria-label="Fila de espera do turno">
            {filaTurno.length === 0 && (
              <li>
                <Vazio>Ninguém na fila de espera: uma vaga liberada fica disponível para novo agendamento.</Vazio>
              </li>
            )}
            {filaTurno.map(({ f, posicao }) => (
              <li key={f.id} className="flex items-center gap-3 p-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning/25 text-sm font-semibold text-warning-foreground">
                  {posicao}º
                </span>
                <div className="min-w-0">
                  <p className="font-medium">{f.crianca ? f.crianca.nome : nomeSocio(f.socioId)}</p>
                  <p className="text-sm text-muted-foreground">
                    {espacoDaFila(f) === "kids" ? `${labelEspaco.kids} · responsável: ${nomeSocio(f.socioId)}` : labelEspaco.estudo}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader
            titulo="Movimentações do turno"
            descricao="Mudanças de situação e transferências de vaga, das mais recentes para as mais antigas."
            icone={<History className="h-5 w-5" />}
          />
          <ul className="divide-y divide-border" aria-label="Movimentações do turno">
            {movimentos.length === 0 && (
              <li>
                <Vazio>Nenhuma movimentação neste turno.</Vazio>
              </li>
            )}
            {movimentos.map((m) => (
              <li key={m.id} className="flex items-start gap-3 p-4 text-sm">
                <span className="mt-0.5 shrink-0">{iconeMovimento[m.tipo]}</span>
                <span className="w-12 shrink-0 tabular-nums text-muted-foreground">{formatHora(m.quando)}</span>
                <span className="min-w-0 text-pretty">{textoMovimento(m)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Confirmar
        aberto={!!ausente}
        titulo="Registrar não comparecimento"
        mensagem={
          ausente &&
          `${pessoa(ausente)} não confirmou o uso da ${nomeMesa(ausente.mesaId)}. A vaga será transferida ao primeiro da fila de espera do turno que não tenha agendamento no dia; sem fila, a mesa fica livre para novo agendamento.`
        }
        rotuloConfirmar="Registrar não comparecimento"
        perigo
        onCancelar={() => setAusente(null)}
        onConfirmar={() => ausente && executar(() => registrarNaoComparecimento(ausente.id), () => setAusente(null))}
      />
    </div>
  )
}
