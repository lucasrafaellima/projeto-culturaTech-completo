import { useMemo, useState } from "react"
import {
  Library,
  PackagePlus,
  Scissors,
  BookPlus,
  Pencil,
  Trash2,
  ChevronDown,
  Search,
  Plus,
  X,
  ArrowUp,
  ArrowDown,
  FileText,
} from "lucide-react"
import { useStore, type DadosLivro } from "@/lib/store"
import {
  Abas,
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
import { StatusBadge } from "@/components/status-badge"
import {
  LETRAS_SECAO,
  MIN_JUSTIFICATIVA,
  STATUS_DESBASTAVEIS,
  TODAS_CATEGORIAS,
  TODOS_STATUS,
  labelCategoria,
  labelStatus,
} from "@/lib/constants"
import { catalogar } from "@/lib/catalogacao"
import { emprestimoAtivoDoExemplar } from "@/lib/regras"
import { cn, formatDate, normalizar } from "@/lib/utils"
import type { Exemplar, Livro, StatusExemplar } from "@/lib/types"

type Aba = "obras" | "desbaste" | "historico"

const formVazio = (): DadosLivro => ({
  titulo: "",
  autores: [""],
  editora: "",
  edicao: "1ª",
  ano: new Date().getFullYear(),
  categoria: "literatura",
  secao: "A",
  isbn: "",
  sinopse: "",
})

export function AcervoPage() {
  const store = useStore()
  const { livros, exemplares, desbastes, perfil, autoresDoLivro, exemplaresDoLivro, getLivro, arquivos } = store
  const executar = useAcao()

  const [aba, setAba] = useState<Aba>("obras")
  const [busca, setBusca] = useState("")
  const [filtroStatus, setFiltroStatus] = useState<StatusExemplar | "todos">("todos")
  const [expandido, setExpandido] = useState<string | null>(null)
  const [editandoLivro, setEditandoLivro] = useState<{ id?: string; form: DadosLivro } | null>(null)
  const [excluindoLivro, setExcluindoLivro] = useState<Livro | null>(null)
  const [novosExemplares, setNovosExemplares] = useState<{ livro: Livro; texto: string } | null>(null)
  const [editandoEx, setEditandoEx] = useState<{ ex: Exemplar; tombamento: string; status: StatusExemplar } | null>(null)
  const [excluindoEx, setExcluindoEx] = useState<Exemplar | null>(null)
  const [desbastando, setDesbastando] = useState<{ ex: Exemplar; relatorio: string } | null>(null)

  const noAcervo = exemplares.filter((e) => !e.baixa)
  const aptos = noAcervo.filter((e) => STATUS_DESBASTAVEIS.includes(e.status))

  const lista = useMemo(() => {
    const t = normalizar(busca)
    return livros
      .filter((l) => {
        const casa =
          !t ||
          normalizar(`${l.titulo} ${autoresDoLivro(l).join(" ")} ${l.isbn}`).includes(t) ||
          exemplaresDoLivro(l.id).some((x) => normalizar(x.tombamento).includes(t))
        const casaStatus = filtroStatus === "todos" || exemplaresDoLivro(l.id).some((x) => x.status === filtroStatus)
        return casa && casaStatus
      })
      .sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR"))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livros, exemplares, busca, filtroStatus])

  const contagem = TODOS_STATUS.map((s) => ({ s, n: noAcervo.filter((x) => x.status === s).length })).filter((c) => c.n > 0)

  function salvarLivro() {
    if (!editandoLivro) return
    executar(store.salvarLivro(editandoLivro.form, editandoLivro.id), () => setEditandoLivro(null))
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Abas<Aba>
          abas={[
            { id: "obras", rotulo: "Obras e exemplares" },
            { id: "desbaste", rotulo: "Aptos a desbaste", contador: aptos.length },
            { id: "historico", rotulo: "Relatórios de desbaste" },
          ]}
          ativa={aba}
          onChange={setAba}
        />
        <Button onClick={() => setEditandoLivro({ form: formVazio() })}>
          <BookPlus className="h-4 w-4" /> Nova obra
        </Button>
      </div>

      {aba === "obras" && (
        <>
          <div className="flex flex-wrap gap-2">
            {contagem.map(({ s, n }) => (
              <button key={s} onClick={() => setFiltroStatus(filtroStatus === s ? "todos" : s)}>
                <Badge className={cn("cursor-pointer", filtroStatus === s ? "ring-2 ring-primary/40" : "", "bg-muted text-foreground")}>
                  {labelStatus[s]}: {n}
                </Badge>
              </button>
            ))}
          </div>
          <Card className="grid gap-3 p-4 md:grid-cols-[1fr_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                aria-label="Buscar no acervo"
                placeholder="Título, autor, ISBN ou código de tombamento..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <Select
              aria-label="Filtrar por status do exemplar"
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value as StatusExemplar | "todos")}
              className="md:w-56"
            >
              <option value="todos">Todos os status</option>
              {TODOS_STATUS.map((s) => (
                <option key={s} value={s}>
                  {labelStatus[s]}
                </option>
              ))}
            </Select>
          </Card>
          <p className="text-sm text-muted-foreground">
            {lista.length} obra(s) · {noAcervo.length} exemplar(es) no acervo
          </p>

          <div className="space-y-3">
            {lista.map((livro) => {
              const exs = exemplaresDoLivro(livro.id)
              const aberto = expandido === livro.id
              const digitais = arquivos.filter((a) => a.vinculo.tipo === "livro" && a.vinculo.livroId === livro.id).length
              return (
                <Card key={livro.id}>
                  <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      onClick={() => setExpandido(aberto ? null : livro.id)}
                      aria-expanded={aberto}
                      className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Library className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-serif font-semibold">{livro.titulo}</p>
                        <p className="text-sm text-muted-foreground">
                          {autoresDoLivro(livro).join("; ")} · {livro.editora}, {livro.ano} · ISBN {livro.isbn}
                        </p>
                      </div>
                      <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-180")} />
                    </button>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-accent/10 text-accent">{labelCategoria[livro.categoria]}</Badge>
                      <Badge className="bg-muted text-muted-foreground">Seção {livro.secao}</Badge>
                      <Badge className="bg-muted text-muted-foreground">{exs.length} exemplar(es)</Badge>
                      {digitais > 0 && (
                        <Badge className="bg-primary/10 text-primary">
                          <FileText className="h-3 w-3" /> {digitais} digital
                        </Badge>
                      )}
                    </div>
                  </div>

                  {aberto && (
                    <div className="border-t border-border p-5">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">Exemplares</p>
                        <div className="flex flex-wrap gap-2">
                          <Button variante="outline" tamanho="sm" onClick={() => setNovosExemplares({ livro, texto: "" })}>
                            <PackagePlus className="h-4 w-4" /> Adicionar exemplares
                          </Button>
                          <Button
                            variante="ghost"
                            tamanho="sm"
                            onClick={() =>
                              setEditandoLivro({
                                id: livro.id,
                                form: { ...livro, autores: autoresDoLivro(livro), sinopse: livro.sinopse ?? "" },
                              })
                            }
                          >
                            <Pencil className="h-4 w-4" /> Editar obra
                          </Button>
                          <Button variante="ghost" tamanho="sm" className="text-danger" onClick={() => setExcluindoLivro(livro)}>
                            <Trash2 className="h-4 w-4" /> Excluir
                          </Button>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[620px] text-sm">
                          <thead>
                            <tr className="border-b border-border text-left text-muted-foreground">
                              <th className="pb-2 font-medium">Tombamento</th>
                              <th className="pb-2 font-medium">Código de identificação (UUID)</th>
                              <th className="pb-2 font-medium">Status</th>
                              <th className="pb-2 text-right font-medium">Ações</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {exs.map((ex) => (
                              <tr key={ex.id}>
                                <td className="py-2.5 font-mono text-xs">{ex.tombamento}</td>
                                <td className="py-2.5 font-mono text-xs text-muted-foreground">{ex.id}</td>
                                <td className="py-2.5">
                                  <StatusBadge status={ex.status} perfil={perfil} />
                                  {emprestimoAtivoDoExemplar(store, ex.id) && (
                                    <span className="ml-2 text-xs text-muted-foreground">emprestado</span>
                                  )}
                                </td>
                                <td className="py-2.5">
                                  <div className="flex justify-end gap-1">
                                    <Button
                                      variante="ghost"
                                      tamanho="sm"
                                      onClick={() => setEditandoEx({ ex, tombamento: ex.tombamento, status: ex.status })}
                                    >
                                      <Pencil className="h-4 w-4" /> Status
                                    </Button>
                                    {STATUS_DESBASTAVEIS.includes(ex.status) && (
                                      <Button variante="ghost" tamanho="sm" onClick={() => setDesbastando({ ex, relatorio: "" })}>
                                        <Scissors className="h-4 w-4" /> Desbastar
                                      </Button>
                                    )}
                                    <Button
                                      variante="ghost"
                                      tamanho="icon"
                                      aria-label={`Excluir exemplar ${ex.tombamento}`}
                                      onClick={() => setExcluindoEx(ex)}
                                    >
                                      <Trash2 className="h-4 w-4 text-danger" />
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                            {exs.length === 0 && (
                              <tr>
                                <td colSpan={4} className="py-3 text-muted-foreground">
                                  Nenhum exemplar no acervo.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </Card>
              )
            })}
            {lista.length === 0 && <Card className="p-8 text-center text-muted-foreground">Nenhuma obra encontrada.</Card>}
          </div>
        </>
      )}

      {aba === "desbaste" && (
        <Card>
          <CardHeader
            titulo="Exemplares aptos a desbaste"
            descricao="Somente exemplares ociosos ou danificados podem ser desbastados (RN31), mediante relatório (RN24)."
            icone={<Scissors className="h-5 w-5" />}
          />
          <div className="divide-y divide-border">
            {aptos.length === 0 && <Vazio>Nenhum exemplar ocioso ou danificado.</Vazio>}
            {aptos.map((ex) => (
              <div key={ex.id} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{getLivro(ex.livroId)?.titulo}</p>
                  <p className="font-mono text-xs text-muted-foreground">Tombo {ex.tombamento}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={ex.status} perfil={perfil} />
                  <Button variante="danger" tamanho="sm" onClick={() => setDesbastando({ ex, relatorio: "" })}>
                    <Scissors className="h-4 w-4" /> Desbastar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {aba === "historico" && (
        <Card>
          <CardHeader titulo="Relatórios de desbastamento" icone={<FileText className="h-5 w-5" />} />
          <div className="divide-y divide-border">
            {desbastes.length === 0 && <Vazio>Nenhum desbastamento registrado.</Vazio>}
            {desbastes.map((d) => (
              <div key={d.id} className="space-y-1 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    {getLivro(d.livroId)?.titulo ?? "Obra removida"} · <span className="font-mono text-sm">{d.tombamento}</span>
                  </p>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(d.data)} · era {labelStatus[d.statusAnterior].toLowerCase()}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground text-pretty">{d.relatorio}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Cadastro / edição de obra (RF01) */}
      <Modal
        aberto={!!editandoLivro}
        onFechar={() => setEditandoLivro(null)}
        titulo={editandoLivro?.id ? "Editar obra" : "Cadastrar obra"}
        largura="max-w-2xl"
      >
        {editandoLivro && (
          <FormLivro
            form={editandoLivro.form}
            onChange={(form) => setEditandoLivro({ ...editandoLivro, form })}
            onCancelar={() => setEditandoLivro(null)}
            onSalvar={salvarLivro}
            editando={!!editandoLivro.id}
          />
        )}
      </Modal>

      {/* Novos exemplares (RF16) */}
      <Modal aberto={!!novosExemplares} onFechar={() => setNovosExemplares(null)} titulo="Adicionar exemplares">
        {novosExemplares && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Obra: <strong className="text-foreground">{novosExemplares.livro.titulo}</strong>. Cada exemplar recebe um
              código de identificação único (UUID) gerado pelo sistema (RN20).
            </p>
            <Campo rotulo="Códigos de tombamento" dica="Um por linha. Ex.: BMA-2050">
              {(id) => (
                <Textarea
                  id={id}
                  rows={4}
                  value={novosExemplares.texto}
                  onChange={(e) => setNovosExemplares({ ...novosExemplares, texto: e.target.value })}
                  placeholder={"BMA-2050\nBMA-2051"}
                />
              )}
            </Campo>
            <Rodape>
              <Button variante="outline" onClick={() => setNovosExemplares(null)}>
                Cancelar
              </Button>
              <Button
                onClick={() =>
                  executar(store.adicionarExemplares(novosExemplares.livro.id, novosExemplares.texto.split(/[\n,;]/)), () =>
                    setNovosExemplares(null),
                  )
                }
              >
                <PackagePlus className="h-4 w-4" /> Cadastrar
              </Button>
            </Rodape>
          </div>
        )}
      </Modal>

      {/* Status do exemplar (RN12) */}
      <Modal aberto={!!editandoEx} onFechar={() => setEditandoEx(null)} titulo="Editar exemplar">
        {editandoEx && (
          <div className="space-y-3">
            <p className="font-mono text-xs text-muted-foreground">{editandoEx.ex.id}</p>
            <Campo rotulo="Código de tombamento">
              {(id) => (
                <Input id={id} value={editandoEx.tombamento} onChange={(e) => setEditandoEx({ ...editandoEx, tombamento: e.target.value })} />
              )}
            </Campo>
            <Campo
              rotulo="Status"
              dica="Em restauro, extraviado e ocioso aparecem como “Indisponível” para visitantes e sócios-leitores (RN30)."
            >
              {(id) => (
                <Select
                  id={id}
                  value={editandoEx.status}
                  onChange={(e) => setEditandoEx({ ...editandoEx, status: e.target.value as StatusExemplar })}
                >
                  {TODOS_STATUS.map((s) => (
                    <option key={s} value={s} disabled={s === "reservado" && editandoEx.ex.status !== "reservado"}>
                      {labelStatus[s]}
                    </option>
                  ))}
                </Select>
              )}
            </Campo>
            <Rodape>
              <Button variante="outline" onClick={() => setEditandoEx(null)}>
                Cancelar
              </Button>
              <Button
                onClick={() =>
                  executar(
                    store.editarExemplar(editandoEx.ex.id, { tombamento: editandoEx.tombamento, status: editandoEx.status }),
                    () => setEditandoEx(null),
                  )
                }
              >
                Salvar
              </Button>
            </Rodape>
          </div>
        )}
      </Modal>

      {/* Desbastamento (RN24 / RN31) */}
      <Modal aberto={!!desbastando} onFechar={() => setDesbastando(null)} titulo="Desbastamento de exemplar">
        {desbastando && (
          <div className="space-y-3">
            <p className="text-sm">
              <strong>{getLivro(desbastando.ex.livroId)?.titulo}</strong> ·{" "}
              <span className="font-mono">{desbastando.ex.tombamento}</span> ·{" "}
              {labelStatus[desbastando.ex.status].toLowerCase()}
            </p>
            <Aviso tipo="alerta">
              O exemplar sai do acervo. O registro é mantido para preservar o histórico de empréstimos.
            </Aviso>
            <Campo
              rotulo="Relatório justificando a decisão (obrigatório)"
              dica={`${desbastando.relatorio.trim().length}/${MIN_JUSTIFICATIVA} caracteres mínimos (RN24)`}
            >
              {(id) => (
                <Textarea
                  id={id}
                  rows={5}
                  value={desbastando.relatorio}
                  onChange={(e) => setDesbastando({ ...desbastando, relatorio: e.target.value })}
                  placeholder="Descreva o estado do exemplar, o tempo sem circulação, se há outros exemplares da obra..."
                />
              )}
            </Campo>
            <Rodape>
              <Button variante="outline" onClick={() => setDesbastando(null)}>
                Cancelar
              </Button>
              <Button
                variante="danger"
                onClick={() => executar(store.desbastarExemplar(desbastando.ex.id, desbastando.relatorio), () => setDesbastando(null))}
              >
                <Scissors className="h-4 w-4" /> Confirmar desbaste
              </Button>
            </Rodape>
          </div>
        )}
      </Modal>

      <Confirmar
        aberto={!!excluindoLivro}
        titulo="Excluir obra"
        mensagem={`A obra "${excluindoLivro?.titulo}" será excluída do catálogo. Só é possível excluir obras sem exemplares no acervo e sem histórico.`}
        rotuloConfirmar="Excluir"
        perigo
        onCancelar={() => setExcluindoLivro(null)}
        onConfirmar={() => excluindoLivro && executar(store.excluirLivro(excluindoLivro.id), () => setExcluindoLivro(null))}
      />
      <Confirmar
        aberto={!!excluindoEx}
        titulo="Excluir exemplar"
        mensagem="Use a exclusão apenas para corrigir cadastros feitos por engano. Para retirar um exemplar do acervo, use o desbastamento."
        rotuloConfirmar="Excluir"
        perigo
        onCancelar={() => setExcluindoEx(null)}
        onConfirmar={() => excluindoEx && executar(store.excluirExemplar(excluindoEx.id), () => setExcluindoEx(null))}
      />
    </div>
  )
}

function FormLivro({
  form,
  onChange,
  onCancelar,
  onSalvar,
  editando,
}: {
  form: DadosLivro
  onChange: (f: DadosLivro) => void
  onCancelar: () => void
  onSalvar: () => void
  editando: boolean
}) {
  const { autores } = useStore()
  const cat = catalogar(form.autores)
  const set = <K extends keyof DadosLivro>(k: K, v: DadosLivro[K]) => onChange({ ...form, [k]: v })

  function moverAutor(i: number, dir: -1 | 1) {
    const lista = [...form.autores]
    const j = i + dir
    if (j < 0 || j >= lista.length) return
    ;[lista[i], lista[j]] = [lista[j], lista[i]]
    set("autores", lista)
  }

  return (
    <div className="space-y-3">
      <Campo rotulo="Título">{(id) => <Input id={id} value={form.titulo} onChange={(e) => set("titulo", e.target.value)} />}</Campo>

      {/* Múltiplos autores (RN18) com catalogação (RN19) */}
      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-sm font-medium">Autor(es) — na ordem da página de rosto</legend>
        <datalist id="autores-cadastrados">
          {autores.map((a) => (
            <option key={a.id} value={a.nome} />
          ))}
        </datalist>
        {form.autores.map((nome, i) => (
          <div key={i} className="flex gap-1.5">
            <Input
              aria-label={`Autor ${i + 1}`}
              list="autores-cadastrados"
              value={nome}
              onChange={(e) => set("autores", form.autores.map((n, j) => (j === i ? e.target.value : n)))}
              placeholder="Nome completo, ex.: Graciliano Ramos"
            />
            <Button variante="ghost" tamanho="icon" aria-label="Subir" disabled={i === 0} onClick={() => moverAutor(i, -1)}>
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              variante="ghost"
              tamanho="icon"
              aria-label="Descer"
              disabled={i === form.autores.length - 1}
              onClick={() => moverAutor(i, 1)}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button
              variante="ghost"
              tamanho="icon"
              aria-label="Remover autor"
              disabled={form.autores.length === 1}
              onClick={() => set("autores", form.autores.filter((_, j) => j !== i))}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button variante="outline" tamanho="sm" onClick={() => set("autores", [...form.autores, ""])}>
          <Plus className="h-4 w-4" /> Adicionar autor
        </Button>
        {form.autores.some((n) => n.trim()) && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
            <p className="font-medium">Catalogação (RN19)</p>
            <p className="mt-1">
              Entrada principal: <strong>{cat.principal ?? form.titulo.toUpperCase() ?? "título"}</strong>
            </p>
            {cat.secundarias.length > 0 && <p>Entradas secundárias: {cat.secundarias.join(" · ")}</p>}
            <p className="mt-1 text-muted-foreground">{cat.regra}</p>
          </div>
        )}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Editora">{(id) => <Input id={id} value={form.editora} onChange={(e) => set("editora", e.target.value)} />}</Campo>
        <Campo rotulo="Edição">{(id) => <Input id={id} value={form.edicao} onChange={(e) => set("edicao", e.target.value)} placeholder="1ª" />}</Campo>
        <Campo rotulo="Ano">
          {(id) => <Input id={id} type="number" inputMode="numeric" value={form.ano || ""} onChange={(e) => set("ano", Number(e.target.value))} />}
        </Campo>
        <Campo rotulo="ISBN" dica="ISBN-10 ou ISBN-13, com ou sem hífens.">
          {(id) => <Input id={id} value={form.isbn} onChange={(e) => set("isbn", e.target.value)} placeholder="978-85-..." />}
        </Campo>
        <Campo rotulo="Categoria" dica={["cordel", "raro", "exemplar_unico"].includes(form.categoria) ? "Obra de consulta local: não pode ser emprestada (RN04)." : undefined}>
          {(id) => (
            <Select id={id} value={form.categoria} onChange={(e) => set("categoria", e.target.value as DadosLivro["categoria"])}>
              {TODAS_CATEGORIAS.map((c) => (
                <option key={c} value={c}>
                  {labelCategoria[c]}
                </option>
              ))}
            </Select>
          )}
        </Campo>
        <Campo rotulo="Seção (A–Z)">
          {(id) => (
            <Select id={id} value={form.secao} onChange={(e) => set("secao", e.target.value)}>
              {LETRAS_SECAO.map((l) => (
                <option key={l} value={l}>
                  Seção {l}
                </option>
              ))}
            </Select>
          )}
        </Campo>
      </div>
      <Campo rotulo="Sinopse (opcional)">
        {(id) => <Textarea id={id} rows={3} value={form.sinopse ?? ""} onChange={(e) => set("sinopse", e.target.value)} />}
      </Campo>
      <Rodape>
        <Button variante="outline" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button onClick={onSalvar}>{editando ? "Salvar alterações" : "Cadastrar obra"}</Button>
      </Rodape>
    </div>
  )
}
