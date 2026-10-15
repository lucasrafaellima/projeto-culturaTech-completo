import { useState } from "react"
import { Handshake, Building2, UserRound, Plus, Gift, PackagePlus, Pencil, Trash2, History } from "lucide-react"
import { useStore, type DadosReceptor } from "@/lib/store"
import {
  Aviso,
  Badge,
  Button,
  Campo,
  Card,
  CardHeader,
  Confirmar,
  Input,
  Modal,
  Rodape,
  Select,
  Textarea,
  Vazio,
  useAcao,
} from "@/components/ui"
import { MAX_DOACOES_PESSOA_FISICA, labelMovimentacao, labelReceptor, labelStatus } from "@/lib/constants"
import { formatCnpj, formatCpf, formatDate } from "@/lib/utils"
import type { Instituicao, TipoMovimentacao } from "@/lib/types"

const receptorVazio = (): DadosReceptor => ({ tipo: "instituicao", nome: "", documento: "", endereco: "", contato: "" })

export function ParceriasPage() {
  const store = useStore()
  const { instituicoes, movimentacoes, livros, exemplares, getLivro } = store
  const executar = useAcao()

  const [editando, setEditando] = useState<{ id?: string; form: DadosReceptor } | null>(null)
  const [excluindo, setExcluindo] = useState<Instituicao | null>(null)
  const [mov, setMov] = useState<{
    tipo: TipoMovimentacao
    receptorId: string
    livroId: string
    exemplarIds: string[]
    tombamentos: string
    observacao: string
  } | null>(null)
  const [historicoDe, setHistoricoDe] = useState<Instituicao | null>(null)

  const doadosPara = (id: string) =>
    movimentacoes.filter((m) => m.tipo === "doacao" && m.receptorId === id).reduce((a, m) => a + m.tombamentos.length, 0)
  const recebidosDe = (id: string) =>
    movimentacoes.filter((m) => m.tipo === "aquisicao" && m.receptorId === id).reduce((a, m) => a + m.tombamentos.length, 0)

  const doaveis = mov
    ? exemplares.filter((x) => !x.baixa && x.livroId === mov.livroId && (x.status === "disponivel" || x.status === "ocioso"))
    : []

  function iniciarMov(tipo: TipoMovimentacao, receptorId = "") {
    setMov({ tipo, receptorId, livroId: "", exemplarIds: [], tombamentos: "", observacao: "" })
  }

  function salvarMov() {
    if (!mov) return
    const r =
      mov.tipo === "doacao"
        ? store.registrarDoacao(mov.receptorId, mov.exemplarIds, mov.observacao)
        : store.registrarAquisicao(mov.receptorId, mov.livroId, mov.tombamentos.split(/[\n,;]/), mov.observacao)
    executar(r, () => setMov(null))
  }

  const receptorMov = mov ? instituicoes.find((i) => i.id === mov.receptorId) : undefined

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="max-w-2xl text-sm text-muted-foreground text-pretty">
          Cadastro de instituições e pessoas físicas (RF13). Toda doação ou aquisição precisa estar vinculada a um cadastro
          (RN25), garantindo a rastreabilidade da origem e do destino das obras.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variante="outline" onClick={() => setEditando({ form: receptorVazio() })}>
            <Plus className="h-4 w-4" /> Novo cadastro
          </Button>
          <Button variante="outline" onClick={() => iniciarMov("aquisicao")}>
            <PackagePlus className="h-4 w-4" /> Registrar aquisição
          </Button>
          <Button onClick={() => iniciarMov("doacao")}>
            <Gift className="h-4 w-4" /> Registrar doação
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader titulo="Instituições e pessoas cadastradas" icone={<Handshake className="h-5 w-5" />} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="p-4 font-medium">Nome</th>
                <th className="p-4 font-medium">Documento</th>
                <th className="p-4 font-medium">Endereço / contato</th>
                <th className="p-4 font-medium">Movimentações</th>
                <th className="p-4 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {instituicoes.map((i) => (
                <tr key={i.id}>
                  <td className="p-4">
                    <p className="font-medium">{i.nome}</p>
                    <Badge
                      className={
                        i.tipo === "instituicao"
                          ? "mt-1 border border-primary/30 bg-primary/15 text-primary"
                          : "mt-1 border border-accent/30 bg-accent/15 text-accent"
                      }
                    >
                      {i.tipo === "instituicao" ? <Building2 className="h-3 w-3" /> : <UserRound className="h-3 w-3" />}
                      {labelReceptor[i.tipo]}
                    </Badge>
                  </td>
                  <td className="p-4 font-mono text-xs">
                    {i.tipo === "instituicao" ? formatCnpj(i.documento) : formatCpf(i.documento)}
                  </td>
                  <td className="p-4 text-muted-foreground">
                    <p>{i.endereco}</p>
                    <p>{i.contato}</p>
                  </td>
                  <td className="p-4">
                    <p>Recebeu {doadosPara(i.id)} livro(s)</p>
                    {i.tipo === "pessoa_fisica" && (
                      <p className="text-xs text-muted-foreground">limite: {MAX_DOACOES_PESSOA_FISICA} (RN26)</p>
                    )}
                    {recebidosDe(i.id) > 0 && <p className="text-xs text-muted-foreground">Doou {recebidosDe(i.id)} ao acervo</p>}
                  </td>
                  <td className="p-4">
                    <div className="flex justify-end gap-1">
                      <Button variante="ghost" tamanho="sm" onClick={() => setHistoricoDe(i)}>
                        <History className="h-4 w-4" /> Histórico
                      </Button>
                      <Button
                        variante="ghost"
                        tamanho="icon"
                        aria-label={`Editar ${i.nome}`}
                        onClick={() =>
                          setEditando({
                            id: i.id,
                            form: {
                              ...i,
                              documento: i.tipo === "instituicao" ? formatCnpj(i.documento) : formatCpf(i.documento),
                            },
                          })
                        }
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variante="ghost" tamanho="icon" aria-label={`Excluir ${i.nome}`} onClick={() => setExcluindo(i)}>
                        <Trash2 className="h-4 w-4 text-danger" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {instituicoes.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted-foreground">
                    Nenhum cadastro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader
          titulo="Histórico de doações e aquisições"
          descricao="Receptor, data e exemplares de cada movimentação."
          icone={<Gift className="h-5 w-5" />}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="p-4 font-medium">Data</th>
                <th className="p-4 font-medium">Tipo</th>
                <th className="p-4 font-medium">Obra</th>
                <th className="p-4 font-medium">Exemplares</th>
                <th className="p-4 font-medium">Instituição / pessoa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {movimentacoes.map((m) => (
                <tr key={m.id}>
                  <td className="p-4 text-muted-foreground">{formatDate(m.data)}</td>
                  <td className="p-4">
                    <Badge className={m.tipo === "doacao" ? "bg-accent/15 text-accent" : "bg-success/15 text-success"}>
                      {labelMovimentacao[m.tipo]}
                    </Badge>
                  </td>
                  <td className="p-4 font-medium">
                    {getLivro(m.livroId)?.titulo ?? "Obra removida"}
                    {m.observacao && <p className="text-xs font-normal text-muted-foreground">{m.observacao}</p>}
                  </td>
                  <td className="p-4 font-mono text-xs">{m.tombamentos.join(", ")}</td>
                  <td className="p-4">{instituicoes.find((i) => i.id === m.receptorId)?.nome ?? "-"}</td>
                </tr>
              ))}
              {movimentacoes.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted-foreground">
                    Nenhuma movimentação registrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Cadastro (RF13) */}
      <Modal aberto={!!editando} onFechar={() => setEditando(null)} titulo={editando?.id ? "Editar cadastro" : "Cadastrar instituição ou pessoa"}>
        {editando && (
          <div className="space-y-3">
            <Campo rotulo="Tipo">
              {(id) => (
                <Select
                  id={id}
                  value={editando.form.tipo}
                  onChange={(e) =>
                    setEditando({ ...editando, form: { ...editando.form, tipo: e.target.value as Instituicao["tipo"], documento: "" } })
                  }
                >
                  <option value="instituicao">Instituição (CNPJ)</option>
                  <option value="pessoa_fisica">Pessoa física (CPF)</option>
                </Select>
              )}
            </Campo>
            {editando.form.tipo === "pessoa_fisica" && (
              <Aviso tipo="info">Pessoa física pode receber no máximo {MAX_DOACOES_PESSOA_FISICA} livro em doação (RN26).</Aviso>
            )}
            <Campo rotulo="Nome">
              {(id) => <Input id={id} value={editando.form.nome} onChange={(e) => setEditando({ ...editando, form: { ...editando.form, nome: e.target.value } })} />}
            </Campo>
            <Campo rotulo={editando.form.tipo === "instituicao" ? "CNPJ" : "CPF"}>
              {(id) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  value={editando.form.documento}
                  onChange={(e) =>
                    setEditando({
                      ...editando,
                      form: {
                        ...editando.form,
                        documento: editando.form.tipo === "instituicao" ? formatCnpj(e.target.value) : formatCpf(e.target.value),
                      },
                    })
                  }
                  placeholder={editando.form.tipo === "instituicao" ? "00.000.000/0000-00" : "000.000.000-00"}
                />
              )}
            </Campo>
            <Campo rotulo="Endereço">
              {(id) => (
                <Input id={id} value={editando.form.endereco} onChange={(e) => setEditando({ ...editando, form: { ...editando.form, endereco: e.target.value } })} />
              )}
            </Campo>
            <Campo rotulo="Contato" dica="Telefone ou e-mail.">
              {(id) => (
                <Input id={id} value={editando.form.contato} onChange={(e) => setEditando({ ...editando, form: { ...editando.form, contato: e.target.value } })} />
              )}
            </Campo>
            <Rodape>
              <Button variante="outline" onClick={() => setEditando(null)}>
                Cancelar
              </Button>
              <Button onClick={() => executar(store.salvarReceptor(editando.form, editando.id), () => setEditando(null))}>Salvar</Button>
            </Rodape>
          </div>
        )}
      </Modal>

      {/* Doação / aquisição (RN25 / RN26) */}
      <Modal
        aberto={!!mov}
        onFechar={() => setMov(null)}
        titulo={mov?.tipo === "doacao" ? "Registrar doação de livro" : "Registrar aquisição (entrada no acervo)"}
      >
        {mov && (
          <div className="space-y-3">
            <Campo
              rotulo={mov.tipo === "doacao" ? "Receptor" : "Origem (doador ou fornecedor)"}
              dica="Somente instituições ou pessoas já cadastradas (RN25)."
            >
              {(id) => (
                <Select id={id} value={mov.receptorId} onChange={(e) => setMov({ ...mov, receptorId: e.target.value })}>
                  <option value="">Selecione...</option>
                  {instituicoes.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.nome} ({labelReceptor[i.tipo]})
                    </option>
                  ))}
                </Select>
              )}
            </Campo>
            {mov.tipo === "doacao" && receptorMov?.tipo === "pessoa_fisica" && (
              <Aviso tipo={doadosPara(receptorMov.id) >= MAX_DOACOES_PESSOA_FISICA ? "erro" : "info"}>
                {receptorMov.nome} já recebeu {doadosPara(receptorMov.id)} de {MAX_DOACOES_PESSOA_FISICA} livro permitido (RN26).
              </Aviso>
            )}
            <Campo rotulo="Obra">
              {(id) => (
                <Select id={id} value={mov.livroId} onChange={(e) => setMov({ ...mov, livroId: e.target.value, exemplarIds: [] })}>
                  <option value="">Selecione...</option>
                  {livros.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.titulo}
                    </option>
                  ))}
                </Select>
              )}
            </Campo>
            {mov.tipo === "doacao" && mov.livroId && (
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium">Exemplar(es) doado(s)</legend>
                {doaveis.length === 0 && <p className="text-sm text-muted-foreground">Nenhum exemplar disponível ou ocioso desta obra.</p>}
                <div className="space-y-1.5">
                  {doaveis.map((x) => (
                    <label key={x.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={mov.exemplarIds.includes(x.id)}
                        onChange={(e) =>
                          setMov({
                            ...mov,
                            exemplarIds: e.target.checked ? [...mov.exemplarIds, x.id] : mov.exemplarIds.filter((y) => y !== x.id),
                          })
                        }
                        className="h-4 w-4 accent-[var(--color-primary)]"
                      />
                      <span className="font-mono">{x.tombamento}</span>
                      <span className="text-muted-foreground">· {labelStatus[x.status]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {mov.tipo === "aquisicao" && (
              <Campo rotulo="Códigos de tombamento dos novos exemplares" dica="Um por linha. Cada exemplar recebe um UUID (RN20).">
                {(id) => <Textarea id={id} rows={3} value={mov.tombamentos} onChange={(e) => setMov({ ...mov, tombamentos: e.target.value })} />}
              </Campo>
            )}
            <Campo rotulo="Observação (opcional)">
              {(id) => <Input id={id} value={mov.observacao} onChange={(e) => setMov({ ...mov, observacao: e.target.value })} />}
            </Campo>
            <Rodape>
              <Button variante="outline" onClick={() => setMov(null)}>
                Cancelar
              </Button>
              <Button onClick={salvarMov}>Registrar</Button>
            </Rodape>
          </div>
        )}
      </Modal>

      <Modal aberto={!!historicoDe} onFechar={() => setHistoricoDe(null)} titulo={historicoDe?.nome ?? ""}>
        {historicoDe && (
          <div className="divide-y divide-border">
            {movimentacoes.filter((m) => m.receptorId === historicoDe.id).length === 0 && <Vazio>Nenhuma movimentação.</Vazio>}
            {movimentacoes
              .filter((m) => m.receptorId === historicoDe.id)
              .map((m) => (
                <div key={m.id} className="py-3 text-sm">
                  <p className="font-medium">
                    {labelMovimentacao[m.tipo]} · {getLivro(m.livroId)?.titulo}
                  </p>
                  <p className="text-muted-foreground">
                    {formatDate(m.data)} · {m.tombamentos.join(", ")}
                  </p>
                </div>
              ))}
            <div className="pt-3">
              <Button
                tamanho="sm"
                onClick={() => {
                  const id = historicoDe.id
                  setHistoricoDe(null)
                  iniciarMov("doacao", id)
                }}
              >
                <Gift className="h-4 w-4" /> Nova doação para este cadastro
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Confirmar
        aberto={!!excluindo}
        titulo="Excluir cadastro"
        mensagem={`O cadastro de "${excluindo?.nome}" será excluído. Cadastros com movimentações não podem ser excluídos.`}
        rotuloConfirmar="Excluir"
        perigo
        onCancelar={() => setExcluindo(null)}
        onConfirmar={() => excluindo && executar(store.excluirReceptor(excluindo.id), () => setExcluindo(null))}
      />
    </div>
  )
}
