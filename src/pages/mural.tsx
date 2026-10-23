import { useEffect, useRef, useState } from "react"
import {
  Newspaper,
  CalendarDays,
  Sparkles,
  BookOpen,
  Plus,
  Pencil,
  Trash2,
  Search,
  CalendarClock,
  FolderArchive,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
} from "lucide-react"
import { useStore } from "@/lib/store"
import {
  Badge,
  Button,
  Campo,
  Card,
  Confirmar,
  Input,
  Modal,
  Rodape,
  Select,
  Textarea,
  useAcao,
} from "@/components/ui"
import { ImagemArmazenada, SeletorImagens } from "@/components/arquivos"
import { removerArquivos } from "@/lib/arquivos"
import { labelPublicacao } from "@/lib/constants"
import { navegar } from "@/lib/navigation"
import { exemplarNoAcervo } from "@/lib/regras"
import { cn, formatDate, normalizar } from "@/lib/utils"
import type { Publicacao, TipoPublicacao } from "@/lib/types"

const iconePublicacao: Record<TipoPublicacao, typeof Newspaper> = {
  noticia: Newspaper,
  evento: CalendarDays,
  novidade: Sparkles,
}

const corPublicacao: Record<TipoPublicacao, string> = {
  noticia: "bg-primary/10 text-primary",
  evento: "bg-accent/15 text-accent",
  novidade: "bg-success/15 text-success",
}

// Fundo dos slides sem imagem
const fundoPublicacao: Record<TipoPublicacao, string> = {
  noticia: "from-primary to-primary/70",
  evento: "from-accent to-primary",
  novidade: "from-success to-primary",
}

const INTERVALO_SLIDE = 6000 // ms

type Form = Omit<Publicacao, "id">

const formVazio = (hoje: string): Form => ({ tipo: "noticia", titulo: "", descricao: "", data: hoje, imagemIds: [] })

export function MuralPage() {
  const { publicacoes, livros, exemplares, perfil, hoje, sessao, autoresDoLivro, salvarPublicacao, excluirPublicacao } =
    useStore()
  const executar = useAcao()
  const ehAdmin = perfil === "admin"

  const [filtro, setFiltro] = useState<TipoPublicacao | "todas">("todas")
  const [busca, setBusca] = useState("")
  const [editando, setEditando] = useState<{ id?: string; form: Form } | null>(null)
  const [excluindo, setExcluindo] = useState<Publicacao | null>(null)
  const [aberta, setAberta] = useState<Publicacao | null>(null)

  const noAcervo = exemplares.filter(exemplarNoAcervo)
  const totalDisponiveis = noAcervo.filter((e) => e.status === "disponivel").length

  // eventos futuros primeiro (mais próximos), depois o restante do mais recente ao mais antigo
  const futuros = publicacoes
    .filter((p) => p.tipo === "evento" && p.data >= hoje)
    .sort((a, b) => a.data.localeCompare(b.data))
  const demais = publicacoes
    .filter((p) => !(p.tipo === "evento" && p.data >= hoje))
    .sort((a, b) => b.data.localeCompare(a.data))
  // filtros da consulta pública (US22): tipo e busca por título ou descrição, sem login
  const termo = normalizar(busca)
  const ordenadas = [...futuros, ...demais].filter(
    (p) => (filtro === "todas" || p.tipo === filtro) && (!termo || normalizar(`${p.titulo} ${p.descricao}`).includes(termo)),
  )

  function salvar() {
    if (!editando) return
    executar(() => salvarPublicacao(editando.form, editando.id), () => setEditando(null))
  }

  // cancelamento: descarta as imagens enviadas nesta edição que ainda não foram salvas
  function cancelarEdicao() {
    if (editando) {
      const salvas = publicacoes.find((p) => p.id === editando.id)?.imagemIds ?? []
      const novas = editando.form.imagemIds.filter((img) => !salvas.includes(img))
      if (novas.length) removerArquivos(novas, perfil === "admin" ? sessao.token : undefined)
    }
    setEditando(null)
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-5 bg-primary p-6 text-primary-foreground md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-serif text-2xl font-semibold text-balance">Bem-vindo ao Portal Cultural de Arapiraca</h2>
            <p className="mt-1 max-w-xl text-sm text-primary-foreground/80 text-pretty">
              Acompanhe notícias, eventos e novidades literárias da Biblioteca Municipal Prof. Pedro de França Reis.
              Cultura, memória e conhecimento para toda a cidade.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variante="accent" tamanho="sm" onClick={() => navegar("consulta")}>
                <Search className="h-4 w-4" /> Consultar o acervo
              </Button>
              <Button
                variante="outline"
                tamanho="sm"
                className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10"
                onClick={() => navegar("repositorio")}
              >
                <FolderArchive className="h-4 w-4" /> Acervo digital
              </Button>
              {perfil === "socio" && (
                <Button
                  variante="outline"
                  tamanho="sm"
                  className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10"
                  onClick={() => navegar("mesas")}
                >
                  <CalendarClock className="h-4 w-4" /> Agendar mesa
                </Button>
              )}
            </div>
          </div>
          <div className="flex gap-6">
            <div>
              <p className="font-serif text-3xl font-bold">{livros.length}</p>
              <p className="text-xs text-primary-foreground/80">obras no catálogo</p>
            </div>
            <div>
              <p className="font-serif text-3xl font-bold">{totalDisponiveis}</p>
              <p className="text-xs text-primary-foreground/80">exemplares disponíveis</p>
            </div>
          </div>
        </div>
      </Card>

      {/* Mural digital (RF12) */}
      <div>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="flex items-center gap-2 font-serif text-lg font-semibold">
            <Newspaper className="h-5 w-5 text-primary" />
            Mural Cultural
          </h3>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative sm:w-56">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                className="pl-9"
                aria-label="Buscar no mural"
                placeholder="Buscar no mural..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <Select
              aria-label="Filtrar publicações"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value as TipoPublicacao | "todas")}
              className="sm:w-48"
            >
              <option value="todas">Todas as publicações</option>
              <option value="evento">Eventos</option>
              <option value="noticia">Notícias</option>
              <option value="novidade">Novidades literárias</option>
            </Select>
            {ehAdmin && (
              <Button onClick={() => setEditando({ form: formVazio(hoje) })}>
                <Plus className="h-4 w-4" /> Publicar
              </Button>
            )}
          </div>
        </div>

        {ordenadas.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            {publicacoes.length === 0 ? "Nenhuma publicação no mural." : "Nenhuma publicação encontrada com esses filtros."}
          </Card>
        ) : (
          <CarrosselMural
            key={`${filtro}|${termo}`}
            publicacoes={ordenadas}
            hoje={hoje}
            ehAdmin={ehAdmin}
            pausado={!!aberta || !!editando || !!excluindo}
            onAbrir={setAberta}
            onEditar={(pub) => setEditando({ id: pub.id, form: { ...pub } })}
            onExcluir={setExcluindo}
          />
        )}
      </div>

      {/* Destaques do acervo */}
      <Card className="p-5">
        <h3 className="mb-3 flex items-center gap-2 font-serif text-lg font-semibold">
          <BookOpen className="h-5 w-5 text-accent" />
          Destaques do Acervo
        </h3>
        <div className="flex flex-wrap gap-2">
          {livros.slice(0, 8).map((l) => (
            <button
              key={l.id}
              onClick={() => navegar("consulta", l.id)}
              className="rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-left text-sm hover:bg-muted"
            >
              {l.titulo}
              <span className="ml-1 text-muted-foreground">· {autoresDoLivro(l).join(", ")}</span>
            </button>
          ))}
        </div>
      </Card>

      {/* Leitura da publicação */}
      <Modal aberto={!!aberta} onFechar={() => setAberta(null)} titulo={aberta?.titulo ?? ""} largura="max-w-2xl">
        {aberta && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge className={corPublicacao[aberta.tipo]}>{labelPublicacao[aberta.tipo]}</Badge>
              <span className="text-sm text-muted-foreground">{formatDate(aberta.data)}</span>
            </div>
            {aberta.imagemIds.map((id) => (
              <ImagemArmazenada key={id} id={id} alt={aberta.titulo} className="w-full rounded-lg" />
            ))}
            <p className="whitespace-pre-line text-sm text-pretty">{aberta.descricao}</p>
          </div>
        )}
      </Modal>

      {/* Cadastro / edição (RF12) */}
      <Modal
        aberto={!!editando}
        onFechar={cancelarEdicao}
        titulo={editando?.id ? "Editar publicação" : "Nova publicação no mural"}
      >
        {editando && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Tipo">
                {(id) => (
                  <Select
                    id={id}
                    value={editando.form.tipo}
                    onChange={(e) =>
                      setEditando({ ...editando, form: { ...editando.form, tipo: e.target.value as TipoPublicacao } })
                    }
                  >
                    <option value="noticia">Notícia</option>
                    <option value="evento">Evento / oficina / sarau</option>
                    <option value="novidade">Novidade literária</option>
                  </Select>
                )}
              </Campo>
              <Campo rotulo={editando.form.tipo === "evento" ? "Data do evento" : "Data da publicação"}>
                {(id) => (
                  <Input
                    id={id}
                    type="date"
                    value={editando.form.data}
                    onChange={(e) => setEditando({ ...editando, form: { ...editando.form, data: e.target.value } })}
                  />
                )}
              </Campo>
            </div>
            <Campo rotulo="Título">
              {(id) => (
                <Input
                  id={id}
                  value={editando.form.titulo}
                  onChange={(e) => setEditando({ ...editando, form: { ...editando.form, titulo: e.target.value } })}
                />
              )}
            </Campo>
            <Campo rotulo="Descrição" dica="Informe a descrição e/ou anexe imagens.">
              {(id) => (
                <Textarea
                  id={id}
                  rows={5}
                  value={editando.form.descricao}
                  onChange={(e) => setEditando({ ...editando, form: { ...editando.form, descricao: e.target.value } })}
                />
              )}
            </Campo>
            <div>
              <p className="mb-1.5 text-sm font-medium">Imagens</p>
              <SeletorImagens
                ids={editando.form.imagemIds}
                onChange={(imagemIds) => setEditando({ ...editando, form: { ...editando.form, imagemIds } })}
                destino="mural"
                maximo={10}
              />
            </div>
            <Rodape>
              <Button variante="outline" onClick={cancelarEdicao}>
                Cancelar
              </Button>
              <Button onClick={salvar}>{editando.id ? "Salvar alterações" : "Publicar"}</Button>
            </Rodape>
          </div>
        )}
      </Modal>

      <Confirmar
        aberto={!!excluindo}
        titulo="Excluir publicação"
        mensagem={`A publicação "${excluindo?.titulo}" será removida do mural.`}
        rotuloConfirmar="Excluir"
        perigo
        onCancelar={() => setExcluindo(null)}
        onConfirmar={() => excluindo && executar(() => excluirPublicacao(excluindo.id), () => setExcluindo(null))}
      />
    </div>
  )
}

/**
 * Slides do mural: passam sozinhos e param quando o cursor (ou o foco) está sobre eles.
 * Ao passar o cursor, o slide mostra o resumo e o botão "Ler mais"; no celular, que não
 * tem cursor, o botão fica sempre visível e os slides também passam com o dedo.
 */
function CarrosselMural({
  publicacoes,
  hoje,
  ehAdmin,
  pausado,
  onAbrir,
  onEditar,
  onExcluir,
}: {
  publicacoes: Publicacao[]
  hoje: string
  ehAdmin: boolean
  pausado: boolean // uma publicação está aberta: não troca o slide por trás da janela
  onAbrir: (pub: Publicacao) => void
  onEditar: (pub: Publicacao) => void
  onExcluir: (pub: Publicacao) => void
}) {
  const total = publicacoes.length
  const [indice, setIndice] = useState(0)
  const [pausadoPeloUsuario, setPausadoPeloUsuario] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  )
  const [sobCursor, setSobCursor] = useState(false)
  const [comFoco, setComFoco] = useState(false)
  const toqueInicio = useRef<number | null>(null)

  const atual = Math.min(indice, total - 1)
  const rodando = total > 1 && !pausado && !pausadoPeloUsuario && !sobCursor && !comFoco

  const ir = (n: number) => setIndice(((n % total) + total) % total)

  useEffect(() => {
    if (!rodando) return
    const timer = setInterval(() => setIndice((i) => (Math.min(i, total - 1) + 1) % total), INTERVALO_SLIDE)
    return () => clearInterval(timer)
  }, [rodando, total])

  return (
    <section
      aria-roledescription="carrossel"
      aria-label="Notícias e eventos do mural"
      className="space-y-3"
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") ir(atual - 1)
        if (e.key === "ArrowRight") ir(atual + 1)
      }}
    >
      <div
        className="relative overflow-hidden rounded-xl border border-border bg-card shadow-sm"
        onMouseEnter={() => setSobCursor(true)}
        onMouseLeave={() => setSobCursor(false)}
        onFocus={() => setComFoco(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setComFoco(false)
        }}
        onTouchStart={(e) => (toqueInicio.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (toqueInicio.current === null) return
          const delta = e.changedTouches[0].clientX - toqueInicio.current
          toqueInicio.current = null
          if (Math.abs(delta) > 40) ir(delta < 0 ? atual + 1 : atual - 1)
        }}
      >
        <div
          className="flex transition-transform duration-700 ease-out motion-reduce:transition-none"
          style={{ transform: `translateX(-${atual * 100}%)` }}
          aria-live={rodando ? "off" : "polite"}
        >
          {publicacoes.map((pub, i) => (
            <Slide
              key={pub.id}
              pub={pub}
              hoje={hoje}
              rotulo={`${i + 1} de ${total}`}
              ativo={i === atual}
              ehAdmin={ehAdmin}
              onAbrir={() => onAbrir(pub)}
              onEditar={() => onEditar(pub)}
              onExcluir={() => onExcluir(pub)}
            />
          ))}
        </div>

        {total > 1 && (
          <>
            <button
              type="button"
              onClick={() => ir(atual - 1)}
              aria-label="Slide anterior"
              className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-card/85 text-foreground shadow transition hover:bg-card"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => ir(atual + 1)}
              aria-label="Próximo slide"
              className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-card/85 text-foreground shadow transition hover:bg-card"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}
      </div>

      {total > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setPausadoPeloUsuario(!pausadoPeloUsuario)}
            aria-label={pausadoPeloUsuario ? "Reproduzir slides" : "Pausar slides"}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {pausadoPeloUsuario ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>
          <div className="flex items-center gap-1.5">
            {publicacoes.map((pub, i) => (
              <button
                key={pub.id}
                type="button"
                onClick={() => ir(i)}
                aria-label={`Ir para o slide ${i + 1}: ${pub.titulo}`}
                aria-current={i === atual ? "true" : undefined}
                className={cn(
                  "h-2.5 rounded-full transition-all",
                  i === atual ? "w-6 bg-primary" : "w-2.5 bg-border hover:bg-muted-foreground/50",
                )}
              />
            ))}
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {atual + 1} / {total}
          </span>
        </div>
      )}
    </section>
  )
}

function Slide({
  pub,
  hoje,
  rotulo,
  ativo,
  ehAdmin,
  onAbrir,
  onEditar,
  onExcluir,
}: {
  pub: Publicacao
  hoje: string
  rotulo: string
  ativo: boolean
  ehAdmin: boolean
  onAbrir: () => void
  onEditar: () => void
  onExcluir: () => void
}) {
  const Icone = iconePublicacao[pub.tipo]
  const proximo = pub.tipo === "evento" && pub.data >= hoje

  return (
    <div
      role="group"
      aria-roledescription="slide"
      aria-label={`${rotulo}: ${pub.titulo}`}
      aria-hidden={!ativo}
      inert={!ativo}
      className="group relative h-80 w-full shrink-0 sm:h-96"
    >
      {pub.imagemIds[0] ? (
        <ImagemArmazenada id={pub.imagemIds[0]} alt="" className="absolute inset-0 h-full w-full" />
      ) : (
        <div className={cn("absolute inset-0 flex items-center justify-center bg-gradient-to-br", fundoPublicacao[pub.tipo])}>
          <Icone className="h-28 w-28 text-primary-foreground/15" aria-hidden="true" />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/5" aria-hidden="true" />

      <div className="absolute inset-x-0 bottom-0 p-5 text-white sm:p-7">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge className="bg-white/90 text-foreground">
            <Icone className="h-3 w-3" />
            {labelPublicacao[pub.tipo]}
          </Badge>
          <span className="text-xs text-white/85">
            {proximo ? `Acontece em ${formatDate(pub.data)}` : formatDate(pub.data)}
          </span>
        </div>
        <h4 className="max-w-3xl font-serif text-xl font-semibold text-balance sm:text-2xl">{pub.titulo}</h4>

        {/* Resumo e "Ler mais": aparecem ao passar o cursor (sempre visíveis em telas de toque) */}
        <div
          className={cn(
            "grid transition-all duration-300 motion-reduce:transition-none",
            "[@media(hover:hover)]:grid-rows-[0fr] [@media(hover:hover)]:opacity-0",
            "group-hover:grid-rows-[1fr] group-hover:opacity-100",
            "[@media(hover:hover)]:group-focus-within:grid-rows-[1fr] [@media(hover:hover)]:group-focus-within:opacity-100",
          )}
        >
          <div className="overflow-hidden">
            {pub.descricao && (
              <p className="mt-2 line-clamp-2 max-w-3xl text-sm text-white/90 text-pretty sm:line-clamp-3">{pub.descricao}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variante="accent" tamanho="sm" onClick={onAbrir} aria-label={`Ler mais: ${pub.titulo}`}>
                Ler mais
              </Button>
              {ehAdmin && (
                <>
                  <Button
                    variante="ghost"
                    tamanho="sm"
                    className="text-white hover:bg-white/15"
                    onClick={onEditar}
                    aria-label={`Editar ${pub.titulo}`}
                  >
                    <Pencil className="h-4 w-4" /> Editar
                  </Button>
                  <Button
                    variante="ghost"
                    tamanho="sm"
                    className="text-white hover:bg-white/15"
                    onClick={onExcluir}
                    aria-label={`Excluir ${pub.titulo}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
