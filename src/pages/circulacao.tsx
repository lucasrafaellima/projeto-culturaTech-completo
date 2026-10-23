import { useMemo, useState } from "react"
import {
  ArrowLeftRight,
  BookUp,
  BookDown,
  CircleDollarSign,
  RefreshCw,
  AlertTriangle,
  CalendarCog,
  XCircle,
  Gavel,
  Search,
  Bookmark,
  FileWarning,
  Clock,
  BookCheck,
} from "lucide-react"
import { useStore, type DadosDano } from "@/lib/store"
import {
  Abas,
  Aviso,
  Badge,
  Button,
  Campo,
  Card,
  CardHeader,
  Indicador,
  Input,
  Modal,
  Rodape,
  Textarea,
  Vazio,
  useAcao,
} from "@/components/ui"
import { SituacaoEmprestimo, BadgeReserva } from "@/components/historico"
import { BadgeMulta, HistoricoMulta, descricaoMulta } from "@/components/multas"
import { ImagemArmazenada, SeletorImagens } from "@/components/arquivos"
import { removerArquivos } from "@/lib/arquivos"
import {
  MAX_EXEMPLARES_SIMULTANEOS,
  MAX_RENOVACOES,
  MIN_JUSTIFICATIVA,
  MULTA_DANO_SUGERIDA,
  MULTA_POR_DIA,
  PRAZO_EMPRESTIMO_DIAS,
  categoriaEmprestavel,
  labelMulta,
} from "@/lib/constants"
import { emprestimoAtivoDoExemplar, multaCorrente, reservaAtivaDoExemplar } from "@/lib/regras"
import {
  addDays,
  diasAtraso,
  formatCurrency,
  formatDate,
  formatDateTime,
  mascararCpf,
  normalizar,
  somenteDigitos,
} from "@/lib/utils"
import type { Emprestimo, Multa } from "@/lib/types"

type Aba = "emprestimos" | "multas" | "reservas" | "danos"

export function CirculacaoPage() {
  const store = useStore()
  const { emprestimos, multas, reservas, ocorrencias, socios, hoje, getSocio, tituloDoExemplar, exemplares } = store
  const executar = useAcao()

  const [aba, setAba] = useState<Aba>("emprestimos")
  const [busca, setBusca] = useState("")
  const [mostrarEncerrados, setMostrarEncerrados] = useState(false)
  const [novo, setNovo] = useState(false)
  const [devolvendo, setDevolvendo] = useState<Emprestimo | null>(null)
  const [alterando, setAlterando] = useState<{ emp: Emprestimo; data: string; motivo: string } | null>(null)
  const [cancelando, setCancelando] = useState<{ emp: Emprestimo; motivo: string } | null>(null)
  const [julgando, setJulgando] = useState<{ m: Multa; parecer: string } | null>(null)
  const [justificandoBalcao, setJustificandoBalcao] = useState<{ m: Multa; texto: string } | null>(null)
  const [detalhe, setDetalhe] = useState<Emprestimo | null>(null)

  const ativos = emprestimos.filter((e) => e.status === "ativo")
  const atrasados = ativos.filter((e) => diasAtraso(e.dataPrevista, hoje) > 0)
  const emAnalise = multas.filter((m) => m.status === "em_analise")
  const abertas = multas.filter((m) => m.status === "pendente" || m.status === "em_analise")
  const reservasAtivas = reservas.filter((r) => r.status === "ativa")

  const t = normalizar(busca)
  const casaBusca = (socioId: string, exemplarId: string) => {
    if (!t) return true
    const s = getSocio(socioId)
    const tomb = exemplares.find((x) => x.id === exemplarId)?.tombamento ?? ""
    return normalizar(`${s?.nome ?? ""} ${tituloDoExemplar(exemplarId)} ${tomb}`).includes(t)
  }

  const listaEmprestimos = useMemo(
    () =>
      emprestimos
        .filter((e) => (mostrarEncerrados ? true : e.status === "ativo") && casaBusca(e.socioId, e.exemplarId))
        .sort((a, b) =>
          a.status === b.status ? a.dataPrevista.localeCompare(b.dataPrevista) : a.status === "ativo" ? -1 : 1,
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [emprestimos, mostrarEncerrados, busca],
  )

  const listaMultas = [...multas]
    .filter((m) => {
      const emp = emprestimos.find((e) => e.id === m.emprestimoId)
      return casaBusca(m.socioId, emp?.exemplarId ?? "")
    })
    .sort((a, b) => {
      const ordem = { em_analise: 0, pendente: 1, paga: 2, abonada: 3 }
      return ordem[a.status] - ordem[b.status] || b.data.localeCompare(a.data)
    })

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador icone={<ArrowLeftRight className="h-5 w-5" />} rotulo="Empréstimos em andamento" valor={ativos.length} />
        <Indicador icone={<Clock className="h-5 w-5" />} rotulo="Devoluções atrasadas" valor={atrasados.length} alerta={atrasados.length > 0} />
        <Indicador
          icone={<CircleDollarSign className="h-5 w-5" />}
          rotulo="Multas em aberto"
          valor={formatCurrency(abertas.reduce((a, m) => a + m.valor, 0))}
        />
        <Indicador icone={<Gavel className="h-5 w-5" />} rotulo="Justificativas a julgar" valor={emAnalise.length} alerta={emAnalise.length > 0} />
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Abas<Aba>
          abas={[
            { id: "emprestimos", rotulo: "Empréstimos", contador: ativos.length },
            { id: "multas", rotulo: "Multas", contador: emAnalise.length },
            { id: "reservas", rotulo: "Reservas", contador: reservasAtivas.length },
            { id: "danos", rotulo: "Danos" },
          ]}
          ativa={aba}
          onChange={setAba}
        />
        <div className="flex gap-2">
          <div className="relative flex-1 lg:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              aria-label="Buscar na circulação"
              placeholder="Sócio, obra ou tombamento..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Button onClick={() => setNovo(true)}>
            <BookUp className="h-4 w-4" /> Novo empréstimo
          </Button>
        </div>
      </div>

      {aba === "emprestimos" && (
        <Card>
          <CardHeader
            titulo="Empréstimos"
            descricao={`Prazo de ${PRAZO_EMPRESTIMO_DIAS} dias corridos, até ${MAX_RENOVACOES} renovações. Multa de ${formatCurrency(MULTA_POR_DIA)} por dia de atraso.`}
            icone={<ArrowLeftRight className="h-5 w-5" />}
            acao={
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={mostrarEncerrados}
                  onChange={(e) => setMostrarEncerrados(e.target.checked)}
                  className="h-4 w-4 accent-[var(--color-primary)]"
                />
                Mostrar devolvidos e cancelados
              </label>
            }
          />
          {listaEmprestimos.length === 0 && <Vazio>Nenhum empréstimo.</Vazio>}

          {/* Celular e tablet (US30): um cartão por empréstimo */}
          <ul className="divide-y divide-border lg:hidden">
            {listaEmprestimos.map((emp) => {
              const corrente = multaCorrente(emp, hoje)
              return (
                <li key={emp.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <button className="text-left font-medium hover:underline" onClick={() => setDetalhe(emp)}>
                        {tituloDoExemplar(emp.exemplarId)}
                      </button>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-mono">{exemplares.find((x) => x.id === emp.exemplarId)?.tombamento}</span> ·{" "}
                        {getSocio(emp.socioId)?.nome}
                      </p>
                    </div>
                    <SituacaoEmprestimo emp={emp} />
                  </div>
                  <dl className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Saída</dt>
                      <dd className="font-medium">{formatDate(emp.dataEmprestimo)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{emp.dataDevolucao ? "Devolvido" : "Prevista"}</dt>
                      <dd className="font-medium">{formatDate(emp.dataDevolucao ?? emp.dataPrevista)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Renovações</dt>
                      <dd className="font-medium">
                        {emp.renovacoes}/{MAX_RENOVACOES}
                      </dd>
                    </div>
                  </dl>
                  {corrente > 0 && <p className="text-xs text-danger">Multa corrente: {formatCurrency(corrente)}</p>}
                  <AcoesEmprestimo
                    emp={emp}
                    onDevolver={() => setDevolvendo(emp)}
                    onRenovar={() => executar(() => store.renovarEmprestimo(emp.id))}
                    onAlterar={() => setAlterando({ emp, data: emp.dataPrevista, motivo: "" })}
                    onCancelar={() => setCancelando({ emp, motivo: "" })}
                  />
                </li>
              )
            })}
          </ul>

          {/* Computador: tabela */}
          {listaEmprestimos.length > 0 && (
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="p-4 font-medium">Obra</th>
                    <th className="p-4 font-medium">Sócio-leitor</th>
                    <th className="p-4 font-medium">Saída</th>
                    <th className="p-4 font-medium">Prevista</th>
                    <th className="p-4 font-medium">Renov.</th>
                    <th className="p-4 font-medium">Situação</th>
                    <th className="p-4 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {listaEmprestimos.map((emp) => {
                    const corrente = multaCorrente(emp, hoje)
                    return (
                      <tr key={emp.id}>
                        <td className="p-4">
                          <button className="text-left font-medium hover:underline" onClick={() => setDetalhe(emp)}>
                            {tituloDoExemplar(emp.exemplarId)}
                          </button>
                          <p className="font-mono text-xs text-muted-foreground">
                            {exemplares.find((x) => x.id === emp.exemplarId)?.tombamento}
                          </p>
                        </td>
                        <td className="p-4">{getSocio(emp.socioId)?.nome}</td>
                        <td className="p-4">{formatDate(emp.dataEmprestimo)}</td>
                        <td className="p-4">
                          {formatDate(emp.dataDevolucao ? emp.dataDevolucao : emp.dataPrevista)}
                          {emp.dataDevolucao && <p className="text-xs text-muted-foreground">prevista {formatDate(emp.dataPrevista)}</p>}
                        </td>
                        <td className="p-4">
                          {emp.renovacoes}/{MAX_RENOVACOES}
                        </td>
                        <td className="p-4">
                          <SituacaoEmprestimo emp={emp} />
                          {corrente > 0 && <p className="mt-1 text-xs text-danger">multa corrente {formatCurrency(corrente)}</p>}
                        </td>
                        <td className="p-4">
                          <AcoesEmprestimo
                            emp={emp}
                            onDevolver={() => setDevolvendo(emp)}
                            onRenovar={() => executar(() => store.renovarEmprestimo(emp.id))}
                            onAlterar={() => setAlterando({ emp, data: emp.dataPrevista, motivo: "" })}
                            onCancelar={() => setCancelando({ emp, motivo: "" })}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {aba === "multas" && (
        <Card>
          <CardHeader
            titulo="Multas"
            descricao="Justificativas enviadas pelos sócios-leitores podem ser deferidas (multa abonada) ou indeferidas (dívida mantida) (RN07)."
            icone={<CircleDollarSign className="h-5 w-5" />}
          />
          <div className="divide-y divide-border">
            {listaMultas.length === 0 && <Vazio>Nenhuma multa registrada.</Vazio>}
            {listaMultas.map((m) => {
              const emp = emprestimos.find((e) => e.id === m.emprestimoId)
              return (
                <div key={m.id} className="space-y-3 p-5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-medium">
                        {getSocio(m.socioId)?.nome} · {formatCurrency(m.valor)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {descricaoMulta(m)} · {emp ? tituloDoExemplar(emp.exemplarId) : "-"} · {formatDate(m.data)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <BadgeMulta m={m} />
                      {m.status === "em_analise" && (
                        <Button tamanho="sm" onClick={() => setJulgando({ m, parecer: "" })}>
                          <Gavel className="h-4 w-4" /> Julgar justificativa
                        </Button>
                      )}
                      {m.status === "pendente" && (
                        <Button variante="outline" tamanho="sm" onClick={() => setJustificandoBalcao({ m, texto: "" })}>
                          Registrar justificativa
                        </Button>
                      )}
                      {(m.status === "pendente" || m.status === "em_analise") && (
                        <Button variante="success" tamanho="sm" onClick={() => executar(() => store.quitarMulta(m.id))}>
                          Registrar pagamento
                        </Button>
                      )}
                    </div>
                  </div>
                  <HistoricoMulta m={m} />
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {aba === "reservas" && (
        <Card>
          <CardHeader
            titulo="Reservas"
            descricao="Ao registrar o empréstimo do exemplar reservado para o mesmo sócio-leitor, a reserva é marcada como retirada."
            icone={<Bookmark className="h-5 w-5" />}
          />
          <div className="divide-y divide-border">
            {reservas.length === 0 && <Vazio>Nenhuma reserva.</Vazio>}
            {reservas
              .filter((r) => casaBusca(r.socioId, r.exemplarId))
              .sort((a, b) => (a.status === "ativa" ? -1 : 1) - (b.status === "ativa" ? -1 : 1) || b.dataReserva.localeCompare(a.dataReserva))
              .map((r) => (
                <div key={r.id} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">{tituloDoExemplar(r.exemplarId)}</p>
                    <p className="text-sm text-muted-foreground">
                      {getSocio(r.socioId)?.nome} · reservado em {formatDate(r.dataReserva)}
                      {r.status === "ativa" && ` · expira em ${formatDate(r.expiraEm)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <BadgeReserva r={r} />
                    {r.status === "ativa" && (
                      <>
                        <Button tamanho="sm" onClick={() => executar(() => store.realizarEmprestimo(r.socioId, r.exemplarId))}>
                          <BookCheck className="h-4 w-4" /> Registrar retirada
                        </Button>
                        <Button variante="ghost" tamanho="sm" onClick={() => executar(() => store.cancelarReserva(r.id))}>
                          Cancelar
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </Card>
      )}

      {aba === "danos" && (
        <Card>
          <CardHeader
            titulo="Ocorrências de dano"
            descricao="Relatórios e imagens comprobatórias registrados na devolução (RF15)."
            icone={<FileWarning className="h-5 w-5" />}
          />
          <div className="divide-y divide-border">
            {ocorrencias.length === 0 && <Vazio>Nenhuma ocorrência de dano.</Vazio>}
            {ocorrencias.map((o) => (
              <div key={o.id} className="space-y-2 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    {tituloDoExemplar(o.exemplarId)} · {getSocio(o.socioId)?.nome}
                  </p>
                  <span className="text-sm text-muted-foreground">
                    {formatDate(o.data)} · multa {formatCurrency(o.valorMulta)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground text-pretty">{o.relatorio}</p>
                {o.imagemIds.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {o.imagemIds.map((id) => (
                      <ImagemArmazenada key={id} id={id} alt="Imagem do dano" className="h-24 w-24 rounded-lg border border-border" />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <NovoEmprestimo aberto={novo} onFechar={() => setNovo(false)} />

      <Devolucao
        key={devolvendo?.id ?? "nenhum"}
        emp={devolvendo}
        onFechar={() => setDevolvendo(null)}
        onConfirmar={(dano) => devolvendo && executar(() => store.devolverEmprestimo(devolvendo.id, dano), () => setDevolvendo(null))}
      />

      <Modal aberto={!!alterando} onFechar={() => setAlterando(null)} titulo="Alterar empréstimo">
        {alterando && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {tituloDoExemplar(alterando.emp.exemplarId)} · {getSocio(alterando.emp.socioId)?.nome}. Use para corrigir
              registros; para estender o prazo normalmente, use a renovação.
            </p>
            <Campo rotulo="Nova data prevista de devolução">
              {(id) => (
                <Input
                  id={id}
                  type="date"
                  min={alterando.emp.dataEmprestimo}
                  value={alterando.data}
                  onChange={(e) => setAlterando({ ...alterando, data: e.target.value })}
                />
              )}
            </Campo>
            <Campo rotulo="Motivo da alteração">
              {(id) => <Textarea id={id} rows={3} value={alterando.motivo} onChange={(e) => setAlterando({ ...alterando, motivo: e.target.value })} />}
            </Campo>
            <Rodape>
              <Button variante="outline" onClick={() => setAlterando(null)}>
                Cancelar
              </Button>
              <Button onClick={() => executar(() => store.alterarEmprestimo(alterando.emp.id, alterando.data, alterando.motivo), () => setAlterando(null))}>
                Salvar alteração
              </Button>
            </Rodape>
          </div>
        )}
      </Modal>

      <Modal aberto={!!cancelando} onFechar={() => setCancelando(null)} titulo="Cancelar empréstimo">
        {cancelando && (
          <div className="space-y-3">
            <Aviso tipo="alerta">
              O cancelamento desfaz um empréstimo registrado por engano: o exemplar volta a ficar disponível e nenhuma multa é
              gerada. Para devoluções normais, use “Devolver”.
            </Aviso>
            <Campo rotulo="Motivo do cancelamento">
              {(id) => <Textarea id={id} rows={3} value={cancelando.motivo} onChange={(e) => setCancelando({ ...cancelando, motivo: e.target.value })} />}
            </Campo>
            <Rodape>
              <Button variante="outline" onClick={() => setCancelando(null)}>
                Voltar
              </Button>
              <Button variante="danger" onClick={() => executar(() => store.cancelarEmprestimo(cancelando.emp.id, cancelando.motivo), () => setCancelando(null))}>
                Cancelar empréstimo
              </Button>
            </Rodape>
          </div>
        )}
      </Modal>

      <Modal aberto={!!julgando} onFechar={() => setJulgando(null)} titulo="Julgar justificativa de multa">
        {julgando && (
          <div className="space-y-3">
            <p className="text-sm">
              <strong>{getSocio(julgando.m.socioId)?.nome}</strong> · {formatCurrency(julgando.m.valor)} ·{" "}
              {descricaoMulta(julgando.m).toLowerCase()}
            </p>
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p className="text-xs text-muted-foreground">Justificativa enviada em {formatDate(julgando.m.justificativa?.data ?? "")}</p>
              <p className="mt-1 text-pretty">"{julgando.m.justificativa?.texto}"</p>
            </div>
            <Campo rotulo="Parecer da administração" dica="Fica registrado junto com a decisão.">
              {(id) => <Textarea id={id} rows={3} value={julgando.parecer} onChange={(e) => setJulgando({ ...julgando, parecer: e.target.value })} />}
            </Campo>
            <Rodape>
              <Button
                variante="danger"
                onClick={() => executar(() => store.julgarJustificativa(julgando.m.id, "indeferido", julgando.parecer), () => setJulgando(null))}
              >
                Indeferir (manter dívida)
              </Button>
              <Button
                variante="success"
                onClick={() => executar(() => store.julgarJustificativa(julgando.m.id, "deferido", julgando.parecer), () => setJulgando(null))}
              >
                Deferir (abonar multa)
              </Button>
            </Rodape>
          </div>
        )}
      </Modal>

      <Modal aberto={!!justificandoBalcao} onFechar={() => setJustificandoBalcao(null)} titulo="Registrar justificativa no balcão">
        {justificandoBalcao && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Registre a justificativa apresentada pessoalmente por {getSocio(justificandoBalcao.m.socioId)?.nome}. Depois ela
              poderá ser julgada.
            </p>
            <Campo rotulo="Justificativa do sócio-leitor" dica={`Mínimo de ${MIN_JUSTIFICATIVA} caracteres.`}>
              {(id) => (
                <Textarea
                  id={id}
                  rows={4}
                  value={justificandoBalcao.texto}
                  onChange={(e) => setJustificandoBalcao({ ...justificandoBalcao, texto: e.target.value })}
                />
              )}
            </Campo>
            <Rodape>
              <Button variante="outline" onClick={() => setJustificandoBalcao(null)}>
                Cancelar
              </Button>
              <Button
                onClick={() =>
                  executar(() => store.registrarJustificativa(justificandoBalcao.m.id, justificandoBalcao.texto), () => setJustificandoBalcao(null))
                }
              >
                Registrar
              </Button>
            </Rodape>
          </div>
        )}
      </Modal>

      <Modal aberto={!!detalhe} onFechar={() => setDetalhe(null)} titulo="Registro do empréstimo">
        {detalhe && (
          <div className="space-y-3 text-sm">
            <p>
              <strong>{tituloDoExemplar(detalhe.exemplarId)}</strong> · {getSocio(detalhe.socioId)?.nome}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Data de saída</p>
                <p className="font-medium">{formatDate(detalhe.dataEmprestimo)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Devolução prevista</p>
                <p className="font-medium">{formatDate(detalhe.dataPrevista)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Devolução efetiva</p>
                <p className="font-medium">{detalhe.dataDevolucao ? formatDate(detalhe.dataDevolucao) : "-"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Situação</p>
                <SituacaoEmprestimo emp={detalhe} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Renovações</p>
                <p className="font-medium">
                  {detalhe.renovacoes}/{MAX_RENOVACOES}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Multa</p>
                <p className="font-medium">
                  {(() => {
                    const doEmp = multas.filter((m) => m.emprestimoId === detalhe.id)
                    const corrente = multaCorrente(detalhe, hoje)
                    if (corrente > 0) return `${formatCurrency(corrente)} correndo`
                    if (doEmp.length === 0) return "-"
                    return doEmp.map((m) => `${formatCurrency(m.valor)} (${labelMulta[m.status].toLowerCase()})`).join(", ")
                  })()}
                </p>
              </div>
            </div>
            {detalhe.status === "ativo" && bloqueioRenovacao(detalhe, hoje) && (
              <Aviso tipo="info">Renovação indisponível: {bloqueioRenovacao(detalhe, hoje)}</Aviso>
            )}
            {detalhe.historico.length > 0 && (
              <ol className="space-y-1 border-l-2 border-border pl-4">
                {detalhe.historico.map((h, i) => (
                  <li key={i}>
                    <span className="text-xs text-muted-foreground">{formatDateTime(h.data)}</span> — {h.texto}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </Modal>

      {socios.length === 0 && <Aviso>Cadastre sócios-leitores para registrar empréstimos.</Aviso>}
    </div>
  )
}

/** Motivo pelo qual um empréstimo não pode ser renovado, ou null se pode (RN17 / atraso). */
function bloqueioRenovacao(emp: Emprestimo, hoje: string): string | null {
  if (emp.status !== "ativo") return "Somente empréstimos em andamento podem ser renovados."
  if (emp.renovacoes >= MAX_RENOVACOES) return `Limite de ${MAX_RENOVACOES} renovações atingido (RN17).`
  if (diasAtraso(emp.dataPrevista, hoje) > 0) return "Em atraso: registre a devolução para calcular a multa."
  return null
}

/** Ações de um empréstimo em andamento; a renovação só aparece quando é permitida (T19). */
function AcoesEmprestimo({
  emp,
  onDevolver,
  onRenovar,
  onAlterar,
  onCancelar,
}: {
  emp: Emprestimo
  onDevolver: () => void
  onRenovar: () => void
  onAlterar: () => void
  onCancelar: () => void
}) {
  const { hoje } = useStore()
  if (emp.status !== "ativo") return null
  const motivo = bloqueioRenovacao(emp, hoje)
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <Button variante="outline" tamanho="sm" onClick={onDevolver}>
        <BookDown className="h-4 w-4" /> Devolver
      </Button>
      {motivo ? (
        <span className="px-2 text-xs text-muted-foreground" title={motivo}>
          {emp.renovacoes >= MAX_RENOVACOES ? "Sem renovações" : "Não renovável"}
        </span>
      ) : (
        <Button variante="ghost" tamanho="sm" title={`Renovar por mais ${PRAZO_EMPRESTIMO_DIAS} dias`} onClick={onRenovar}>
          <RefreshCw className="h-4 w-4" /> Renovar
        </Button>
      )}
      <Button variante="ghost" tamanho="icon" aria-label="Alterar prazo" title="Alterar prazo" onClick={onAlterar}>
        <CalendarCog className="h-4 w-4" />
      </Button>
      <Button variante="ghost" tamanho="icon" aria-label="Cancelar empréstimo" title="Cancelar empréstimo" onClick={onCancelar}>
        <XCircle className="h-4 w-4 text-danger" />
      </Button>
    </div>
  )
}

function NovoEmprestimo({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const store = useStore()
  const { socios, exemplares, livros, hoje, getLivro, debitos, motivoBloqueio, emprestimos, reservas } = store
  const executar = useAcao()
  const [socioId, setSocioId] = useState("")
  const [buscaSocio, setBuscaSocio] = useState("")
  const [busca, setBusca] = useState("")
  const [exemplarId, setExemplarId] = useState("")

  const socio = socios.find((s) => s.id === socioId)
  const bloqueio = socioId ? motivoBloqueio(socioId) : null
  const d = socioId ? debitos(socioId) : null
  const ativosSocio = emprestimos.filter((e) => e.socioId === socioId && e.status === "ativo").length
  // RN01: reservas de outras obras também ocupam vaga
  const reservasSocio = reservas.filter((r) => r.socioId === socioId && r.status === "ativa")
  const ocupados = ativosSocio + reservasSocio.filter((r) => r.exemplarId !== exemplarId).length
  const noLimite = !!socio && ocupados >= MAX_EXEMPLARES_SIMULTANEOS
  const exemplar = exemplares.find((x) => x.id === exemplarId)

  // sócios localizados por nome ou CPF (só os ativos podem pegar emprestado, RN06)
  const sociosEncontrados = useMemo(() => {
    const t = normalizar(buscaSocio)
    const digitos = somenteDigitos(buscaSocio)
    if (t.length < 2 && digitos.length < 3) return []
    return socios
      .filter((s) => !s.anonimizado)
      .filter((s) => normalizar(s.nome).includes(t) || (digitos.length >= 3 && s.cpf.includes(digitos)))
      .slice(0, 8)
  }, [buscaSocio, socios])

  // exemplares localizados pela busca (título ou tombamento)
  const candidatos = useMemo(() => {
    const t = normalizar(busca)
    if (t.length < 2) return []
    return exemplares
      .filter((x) => !x.baixa)
      .filter((x) => {
        const l = getLivro(x.livroId)
        return normalizar(`${l?.titulo ?? ""} ${x.tombamento}`).includes(t)
      })
      .slice(0, 12)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, exemplares, livros])

  function motivoIndisponivel(exId: string): string | null {
    const ex = exemplares.find((x) => x.id === exId)!
    const l = getLivro(ex.livroId)
    if (l && !categoriaEmprestavel(l.categoria)) return "consulta local (RN04)"
    if (emprestimoAtivoDoExemplar(store, exId)) return "já emprestado (RN14)"
    const r = reservaAtivaDoExemplar(store, exId)
    if (r && r.socioId !== socioId) return "reservado para outro sócio"
    if (!r && ex.status !== "disponivel") return "indisponível"
    return null
  }

  function fechar() {
    setSocioId("")
    setBuscaSocio("")
    setBusca("")
    setExemplarId("")
    onFechar()
  }

  // o que impede confirmar, na ordem em que o balcão confere (US08)
  const impedimento = !socio
    ? null
    : !socio.ativo
      ? "Sócio-leitor inativo: somente sócios ativos podem fazer empréstimos (RN06)."
      : bloqueio
        ? `O sócio-leitor possui ${bloqueio}. Novos empréstimos estão bloqueados (RN08).`
        : noLimite
          ? `Limite de ${MAX_EXEMPLARES_SIMULTANEOS} exemplares simultâneos atingido, somando empréstimos e reservas (RN01).`
          : null
  const podeConfirmar = !!socio && !!exemplar && !impedimento

  return (
    <Modal aberto={aberto} onFechar={fechar} titulo="Registrar empréstimo" largura="max-w-xl">
      <div className="space-y-4">
        {socio ? (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
            <div className="min-w-0 text-sm">
              <p className="font-medium">{socio.nome}</p>
              <p className="text-xs text-muted-foreground">CPF {mascararCpf(socio.cpf)}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge className="bg-muted text-foreground">
                  {ocupados}/{MAX_EXEMPLARES_SIMULTANEOS} {reservasSocio.length ? "empréstimos e reservas" : "empréstimos ativos"}
                </Badge>
                {impedimento ? (
                  <Badge className="bg-danger/15 text-danger">
                    <AlertTriangle className="h-3 w-3" /> Bloqueado
                  </Badge>
                ) : (
                  <Badge className="bg-success/15 text-success">Regular</Badge>
                )}
                {d && d.totalCorrente > 0 && (
                  <Badge className="bg-danger/15 text-danger">multa correndo {formatCurrency(d.totalCorrente)}</Badge>
                )}
              </div>
            </div>
            <Button
              variante="ghost"
              tamanho="sm"
              onClick={() => {
                setSocioId("")
                setExemplarId("")
              }}
            >
              Trocar
            </Button>
          </div>
        ) : (
          <>
            <Campo rotulo="Sócio-leitor" dica="Busque pelo nome ou pelo CPF.">
              {(id) => (
                <Input
                  id={id}
                  value={buscaSocio}
                  onChange={(e) => setBuscaSocio(e.target.value)}
                  placeholder="Ex.: Maria ou 529.982"
                  autoComplete="off"
                />
              )}
            </Campo>
            {sociosEncontrados.length > 0 && (
              <ul className="max-h-52 divide-y divide-border overflow-y-auto rounded-lg border border-border" role="listbox" aria-label="Sócios-leitores">
                {sociosEncontrados.map((s) => {
                  const motivo = !s.ativo ? "inativo" : motivoBloqueio(s.id) ? "com pendências" : null
                  return (
                    <li key={s.id}>
                      <button
                        role="option"
                        aria-selected={false}
                        onClick={() => setSocioId(s.id)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                      >
                        <span>
                          {s.nome} <span className="font-mono text-xs text-muted-foreground">{mascararCpf(s.cpf)}</span>
                        </span>
                        <span className={motivo ? "text-xs text-danger" : "text-xs text-muted-foreground"}>{motivo ?? "regular"}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {buscaSocio.trim().length >= 2 && sociosEncontrados.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum sócio-leitor encontrado.</p>
            )}
          </>
        )}
        {impedimento && <Aviso tipo="erro">{impedimento}</Aviso>}
        {socio && d && d.atrasados.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-danger/30 bg-danger/5 p-3 text-xs">
            {d.atrasados.map((emp) => (
              <li key={emp.id} className="flex justify-between gap-2">
                <span>{store.tituloDoExemplar(emp.exemplarId)}</span>
                <span className="text-danger">
                  {diasAtraso(emp.dataPrevista, hoje)} dia(s) · {formatCurrency(multaCorrente(emp, hoje))}
                </span>
              </li>
            ))}
          </ul>
        )}

        <Campo rotulo="Exemplar" dica="Busque pelo título ou pelo código de tombamento.">
          {(id) => (
            <Input
              id={id}
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value)
                setExemplarId("")
              }}
              placeholder="Ex.: Vidas Secas ou BMA-1001"
              autoComplete="off"
            />
          )}
        </Campo>
        {candidatos.length > 0 && (
          <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-lg border border-border" role="listbox" aria-label="Exemplares">
            {candidatos.map((x) => {
              const motivo = motivoIndisponivel(x.id)
              const sel = x.id === exemplarId
              return (
                <li key={x.id}>
                  <button
                    role="option"
                    aria-selected={sel}
                    disabled={!!motivo}
                    onClick={() => setExemplarId(x.id)}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm disabled:opacity-50 ${sel ? "bg-primary/10" : "hover:bg-muted"}`}
                  >
                    <span>
                      {getLivro(x.livroId)?.titulo} <span className="font-mono text-xs text-muted-foreground">{x.tombamento}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{motivo ?? "disponível"}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {/* US10: datas do registro, antes de confirmar */}
        <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Data de saída</p>
            <p className="font-medium">{formatDate(hoje)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Devolução prevista</p>
            <p className="font-medium">{formatDate(addDays(hoje, PRAZO_EMPRESTIMO_DIAS))}</p>
          </div>
          <p className="col-span-2 text-xs text-muted-foreground">
            {PRAZO_EMPRESTIMO_DIAS} dias corridos (RN02), renovável até {MAX_RENOVACOES} vezes. Atraso: {formatCurrency(MULTA_POR_DIA)}{" "}
            por dia (RN03).
            {exemplar && ` Exemplar ${exemplar.tombamento}: ${getLivro(exemplar.livroId)?.titulo ?? ""}.`}
          </p>
        </div>
        <Rodape>
          <Button variante="outline" onClick={fechar}>
            Cancelar
          </Button>
          <Button
            disabled={!podeConfirmar}
            onClick={() => executar(() => store.realizarEmprestimo(socioId, exemplarId), fechar)}
          >
            <BookUp className="h-4 w-4" /> Confirmar empréstimo
          </Button>
        </Rodape>
      </div>
    </Modal>
  )
}

function Devolucao({
  emp,
  onFechar,
  onConfirmar,
}: {
  emp: Emprestimo | null
  onFechar: () => void
  onConfirmar: (dano?: DadosDano) => void
}) {
  const { hoje, tituloDoExemplar, getSocio, sessao } = useStore()
  // conectado pela API: as imagens do dano vão para o servidor (S3)
  const token = sessao.perfil === "admin" ? sessao.token : undefined
  const [comDano, setComDano] = useState(false)
  const [relatorio, setRelatorio] = useState("")
  const [imagens, setImagens] = useState<string[]>([])
  const [valor, setValor] = useState(String(MULTA_DANO_SUGERIDA))

  if (!emp) return null
  const dias = diasAtraso(emp.dataPrevista, hoje)
  const multaAtraso = dias * MULTA_POR_DIA
  const valorDano = comDano ? Number(valor.replace(",", ".")) || 0 : 0

  // cancelamento: descarta as imagens já comprimidas e armazenadas
  function fechar() {
    removerArquivos(imagens, token)
    onFechar()
  }

  return (
    <Modal aberto onFechar={fechar} titulo="Registrar devolução" largura="max-w-xl">
      <div className="space-y-4">
        <p className="text-sm">
          <strong>{tituloDoExemplar(emp.exemplarId)}</strong> · {getSocio(emp.socioId)?.nome}
        </p>
        {/* US10: as três datas do empréstimo */}
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Saída</p>
            <p className="font-medium">{formatDate(emp.dataEmprestimo)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Prevista</p>
            <p className="font-medium">{formatDate(emp.dataPrevista)}</p>
            {emp.renovacoes > 0 && (
              <p className="text-xs text-muted-foreground">
                {emp.renovacoes} renovação(ões)
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Devolução efetiva</p>
            <p className="font-medium">{formatDate(hoje)}</p>
          </div>
        </div>
        {dias > 0 ? (
          <Aviso tipo="erro">
            {dias} dia(s) de atraso × {formatCurrency(MULTA_POR_DIA)}: será gerada multa de{" "}
            <strong>{formatCurrency(multaAtraso)}</strong> para este exemplar (RN03).
          </Aviso>
        ) : (
          <Aviso tipo="sucesso">Devolução dentro do prazo: sem multa por atraso.</Aviso>
        )}

        <label className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm">
          <input
            type="checkbox"
            checked={comDano}
            onChange={(e) => setComDano(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-danger)]"
          />
          O exemplar foi devolvido <strong>danificado</strong>
        </label>

        {comDano && (
          <div className="space-y-3 rounded-lg border border-danger/30 bg-danger/5 p-3">
            <Campo rotulo="Relatório do dano (RF15)" dica={`Mínimo de ${MIN_JUSTIFICATIVA} caracteres.`}>
              {(id) => (
                <Textarea
                  id={id}
                  rows={3}
                  value={relatorio}
                  onChange={(e) => setRelatorio(e.target.value)}
                  placeholder="Descreva o dano: páginas rasgadas, manchas, capa..."
                />
              )}
            </Campo>
            <div>
              <p className="mb-1.5 text-sm font-medium">Imagens comprobatórias</p>
              <SeletorImagens ids={imagens} onChange={setImagens} destino="danos" />
            </div>
            <Campo rotulo="Valor da multa pelo dano (R$)" dica="O exemplar passa ao status “Danificado” (RN12 / RN13).">
              {(id) => <Input id={id} type="number" min="0" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} className="sm:w-40" />}
            </Campo>
          </div>
        )}

        {multaAtraso + valorDano > 0 && (
          <p className="text-right text-sm">
            Total a cobrar nesta devolução: <strong>{formatCurrency(multaAtraso + valorDano)}</strong>
          </p>
        )}

        <Rodape>
          <Button variante="outline" onClick={fechar}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              if (!comDano && imagens.length) {
                removerArquivos(imagens, token)
                setImagens([])
              }
              onConfirmar(comDano ? { relatorio, imagemIds: imagens, valor: Number(valor.replace(",", ".")) } : undefined)
            }}
          >
            <BookDown className="h-4 w-4" /> Confirmar devolução
          </Button>
        </Rodape>
      </div>
    </Modal>
  )
}
