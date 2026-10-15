import { useEffect, useMemo, useState } from "react"
import { Search, BookOpen, MapPin, Lock, Info, FileText, BookmarkPlus, LogIn } from "lucide-react"
import { useStore } from "@/lib/store"
import { Aviso, Badge, Button, Card, Input, Modal, Rodape, Select, useAcao } from "@/components/ui"
import { StatusBadge } from "@/components/status-badge"
import { LETRAS_SECAO, TODAS_CATEGORIAS, labelCategoria, categoriaEmprestavel, statusVisivel } from "@/lib/constants"
import { catalogar } from "@/lib/catalogacao"
import { navegar } from "@/lib/navigation"
import { normalizar } from "@/lib/utils"
import type { Categoria, Livro } from "@/lib/types"

type Campo = "todos" | "titulo" | "autor" | "isbn"

const POR_PAGINA = 12

export function ConsultaPage({ livroInicial }: { livroInicial: string | null }) {
  const { livros, perfil, arquivos, autores, exemplaresDoLivro, autoresDoLivro, reservarLivro, socioLogado } = useStore()
  const executar = useAcao()
  const [termo, setTermo] = useState("")
  const [campo, setCampo] = useState<Campo>("todos")
  const [categoria, setCategoria] = useState<Categoria | "todas">("todas")
  const [secao, setSecao] = useState("todas")
  const [somenteDisponiveis, setSomenteDisponiveis] = useState(false)
  const [pagina, setPagina] = useState(1)
  const [detalheId, setDetalheId] = useState<string | null>(livroInicial)

  useEffect(() => setDetalheId(livroInicial), [livroInicial])

  // índice de busca: acentos e maiúsculas são ignorados (RNF07: busca em memória, instantânea)
  const indice = useMemo(() => {
    const nomeAutor = new Map(autores.map((a) => [a.id, a.nome]))
    return livros.map((l) => ({
      livro: l,
      titulo: normalizar(l.titulo),
      autores: normalizar(l.autorIds.map((id) => nomeAutor.get(id) ?? "").join(" ")),
      isbn: l.isbn.replace(/[-\s]/g, ""),
    }))
  }, [livros, autores])

  const disponiveis = (livroId: string) =>
    exemplaresDoLivro(livroId).filter((e) => statusVisivel(e.status, perfil) === "disponivel").length

  const resultados = useMemo(() => {
    const t = normalizar(termo)
    const tIsbn = termo.replace(/[-\s]/g, "")
    return indice
      .filter((i) => {
        const casaTermo =
          !t ||
          ((campo === "todos" || campo === "titulo") && i.titulo.includes(t)) ||
          ((campo === "todos" || campo === "autor") && i.autores.includes(t)) ||
          ((campo === "todos" || campo === "isbn") && tIsbn.length > 0 && i.isbn.includes(tIsbn))
        const casaCat = categoria === "todas" || i.livro.categoria === categoria
        const casaSecao = secao === "todas" || i.livro.secao === secao // RN22
        const casaDisp = !somenteDisponiveis || disponiveis(i.livro.id) > 0
        return casaTermo && casaCat && casaSecao && casaDisp
      })
      .map((i) => i.livro)
      .sort((a, b) => a.secao.localeCompare(b.secao) || a.titulo.localeCompare(b.titulo, "pt-BR"))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indice, termo, campo, categoria, secao, somenteDisponiveis, perfil])

  useEffect(() => setPagina(1), [termo, campo, categoria, secao, somenteDisponiveis])

  const totalPaginas = Math.max(1, Math.ceil(resultados.length / POR_PAGINA))
  const visiveis = resultados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)
  const detalhe = livros.find((l) => l.id === detalheId) ?? null

  function fecharDetalhe() {
    setDetalheId(null)
    if (livroInicial) navegar("consulta")
  }

  return (
    <div className="space-y-5">
      {/* Filtros (RF06) */}
      <Card className="p-5">
        <form role="search" onSubmit={(e) => e.preventDefault()} className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                aria-label="Termo de busca"
                placeholder="Buscar por título, autor ou ISBN..."
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
              />
            </div>
            <Select aria-label="Buscar em" value={campo} onChange={(e) => setCampo(e.target.value as Campo)} className="md:w-44">
              <option value="todos">Todos os campos</option>
              <option value="titulo">Somente título</option>
              <option value="autor">Somente autor</option>
              <option value="isbn">Somente ISBN</option>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-[1fr_1fr_auto]">
            <Select
              aria-label="Filtrar por categoria"
              value={categoria}
              onChange={(e) => setCategoria(e.target.value as Categoria | "todas")}
            >
              <option value="todas">Todas as categorias</option>
              {TODAS_CATEGORIAS.map((c) => (
                <option key={c} value={c}>
                  {labelCategoria[c]}
                </option>
              ))}
            </Select>
            <Select aria-label="Filtrar por seção" value={secao} onChange={(e) => setSecao(e.target.value)}>
              <option value="todas">Todas as seções (A–Z)</option>
              {LETRAS_SECAO.map((s) => (
                <option key={s} value={s}>
                  Seção {s}
                </option>
              ))}
            </Select>
            <label className="flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm">
              <input
                type="checkbox"
                checked={somenteDisponiveis}
                onChange={(e) => setSomenteDisponiveis(e.target.checked)}
                className="h-4 w-4 accent-[var(--color-primary)]"
              />
              Só com exemplar disponível
            </label>
          </div>
        </form>
        <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
          {resultados.length} obra(s) encontrada(s)
        </p>
      </Card>

      {/* Resultados */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {visiveis.map((livro) => {
          const disp = disponiveis(livro.id)
          const total = exemplaresDoLivro(livro.id).length
          const restrito = !categoriaEmprestavel(livro.categoria)
          const temDigital = arquivos.some((a) => a.vinculo.tipo === "livro" && a.vinculo.livroId === livro.id)
          return (
            <Card key={livro.id} className="flex flex-col p-5">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <BookOpen className="h-5 w-5" />
                </div>
                <Badge className="bg-muted text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  Seção {livro.secao}
                </Badge>
              </div>

              <h3 className="font-serif text-base font-semibold text-balance">{livro.titulo}</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">{autoresDoLivro(livro).join("; ")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {livro.editora} · {livro.edicao} ed. · {livro.ano}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge className="bg-accent/10 text-accent">{labelCategoria[livro.categoria]}</Badge>
                {restrito ? (
                  <Badge className="bg-danger/10 text-danger">
                    <Lock className="h-3 w-3" />
                    Consulta local
                  </Badge>
                ) : (
                  <Badge className={disp > 0 ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}>
                    {disp > 0 ? `${disp} de ${total} disponível(is)` : "Indisponível"}
                  </Badge>
                )}
                {temDigital && (
                  <Badge className="bg-primary/10 text-primary">
                    <FileText className="h-3 w-3" />
                    Versão digital
                  </Badge>
                )}
              </div>

              <Button variante="outline" tamanho="sm" className="mt-4 self-start" onClick={() => setDetalheId(livro.id)}>
                <Info className="h-4 w-4" />
                Ver detalhes
              </Button>
            </Card>
          )
        })}
        {resultados.length === 0 && (
          <Card className="col-span-full p-8 text-center text-muted-foreground">
            Nenhuma obra encontrada com os filtros aplicados.
          </Card>
        )}
      </div>

      {totalPaginas > 1 && (
        <nav className="flex items-center justify-center gap-2" aria-label="Paginação">
          <Button variante="outline" tamanho="sm" disabled={pagina === 1} onClick={() => setPagina(pagina - 1)}>
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {pagina} de {totalPaginas}
          </span>
          <Button variante="outline" tamanho="sm" disabled={pagina === totalPaginas} onClick={() => setPagina(pagina + 1)}>
            Próxima
          </Button>
        </nav>
      )}

      <DetalheObra
        livro={detalhe}
        onFechar={fecharDetalhe}
        onReservar={(id) => executar(reservarLivro(id))}
        podeReservar={!!socioLogado}
      />
    </div>
  )
}

function DetalheObra({
  livro,
  onFechar,
  onReservar,
  podeReservar,
}: {
  livro: Livro | null
  onFechar: () => void
  onReservar: (livroId: string) => void
  podeReservar: boolean
}) {
  const { perfil, arquivos, exemplaresDoLivro, autoresDoLivro } = useStore()
  if (!livro) return <Modal aberto={false} onFechar={onFechar} titulo="">{null}</Modal>

  const exemplares = exemplaresDoLivro(livro.id)
  const restrito = !categoriaEmprestavel(livro.categoria)
  const digitais = arquivos.filter((a) => a.vinculo.tipo === "livro" && a.vinculo.livroId === livro.id)
  const disp = exemplares.filter((e) => statusVisivel(e.status, perfil) === "disponivel").length
  const cat = catalogar(autoresDoLivro(livro))

  return (
    <Modal aberto onFechar={onFechar} titulo={livro.titulo} largura="max-w-2xl">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Info2 rotulo="Autor(es)" valor={autoresDoLivro(livro).join("; ")} />
          <Info2 rotulo="Editora" valor={livro.editora} />
          <Info2 rotulo="Edição" valor={livro.edicao} />
          <Info2 rotulo="Ano" valor={String(livro.ano)} />
          <Info2 rotulo="Categoria" valor={labelCategoria[livro.categoria]} />
          <Info2 rotulo="Seção" valor={livro.secao} />
          <Info2 rotulo="ISBN" valor={livro.isbn} />
          <Info2 rotulo="Entrada principal" valor={cat.principal ?? "Pelo título"} />
        </div>

        {livro.sinopse && (
          <div>
            <p className="text-sm font-medium">Sinopse</p>
            <p className="mt-1 text-sm text-muted-foreground text-pretty">{livro.sinopse}</p>
          </div>
        )}

        {restrito && (
          <Aviso tipo="erro">
            <Lock className="mr-1 inline h-3.5 w-3.5" />
            {labelCategoria[livro.categoria]}: obra de consulta local, não pode ser emprestada (RN04).
            {digitais.length > 0 && " A versão digital pode ser lida online abaixo."}
          </Aviso>
        )}

        <div>
          <p className="mb-2 text-sm font-medium">Exemplares ({exemplares.length})</p>
          <div className="space-y-2">
            {exemplares.map((ex) => (
              <div key={ex.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                <span className="text-xs text-muted-foreground">
                  Tombo <span className="font-mono">{ex.tombamento}</span>
                </span>
                <StatusBadge status={ex.status} perfil={perfil} />
              </div>
            ))}
            {exemplares.length === 0 && <p className="text-sm text-muted-foreground">Nenhum exemplar no acervo.</p>}
          </div>
        </div>

        {digitais.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium">Versão digital (RF17)</p>
            <div className="flex flex-wrap gap-2">
              {digitais.map((a) => (
                <Button key={a.id} variante="outline" tamanho="sm" onClick={() => navegar("repositorio", a.id)}>
                  <FileText className="h-4 w-4" /> {a.titulo}
                </Button>
              ))}
            </div>
          </div>
        )}

        {!restrito && (
          <Rodape>
            {podeReservar ? (
              <Button disabled={disp === 0} onClick={() => onReservar(livro.id)}>
                <BookmarkPlus className="h-4 w-4" />
                {disp === 0 ? "Sem exemplar para reservar" : "Reservar para retirada"}
              </Button>
            ) : perfil === "publico" ? (
              <Button variante="outline" onClick={() => navegar("entrar")}>
                <LogIn className="h-4 w-4" /> Entre como sócio-leitor para reservar
              </Button>
            ) : null}
          </Rodape>
        )}
      </div>
    </Modal>
  )
}

function Info2({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="break-words font-medium">{valor}</p>
    </div>
  )
}
