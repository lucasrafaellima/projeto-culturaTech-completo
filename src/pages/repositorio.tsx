import { useEffect, useMemo, useRef, useState } from "react"
import {
  FileText,
  Upload,
  Eye,
  Trash2,
  FolderPlus,
  Folder,
  BookOpen,
  Loader2,
  Search,
  Pencil,
} from "lucide-react"
import { useStore } from "@/lib/store"
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
  useAcao,
  useToast,
} from "@/components/ui"
import { ImagemArmazenada, VisualizadorPdf } from "@/components/arquivos"
import { armazenarImagem, armazenarPdf, removerArquivos } from "@/lib/arquivos"
import { ACCEPT_IMAGEM, labelCategoria } from "@/lib/constants"
import { navegar } from "@/lib/navigation"
import { formatBytes, formatDate, normalizar } from "@/lib/utils"
import type { ArquivoDigital, FormatoArquivo, PastaHistorica, VinculoArquivo } from "@/lib/types"

export function RepositorioPage({ arquivoInicial }: { arquivoInicial: string | null }) {
  const { arquivos, pastas, livros, perfil, getLivro, adicionarArquivo, excluirArquivo, salvarPasta, excluirPasta } =
    useStore()
  const executar = useAcao()
  const ehAdmin = perfil === "admin"

  const [busca, setBusca] = useState("")
  const [filtroVinculo, setFiltroVinculo] = useState("todos")
  const [visualizando, setVisualizando] = useState<string | null>(arquivoInicial)
  const [modalUpload, setModalUpload] = useState(false)
  const [pastaEdit, setPastaEdit] = useState<{ id?: string; nome: string; descricao: string } | null>(null)
  const [excluindo, setExcluindo] = useState<ArquivoDigital | null>(null)
  const [excluindoPasta, setExcluindoPasta] = useState<PastaHistorica | null>(null)

  useEffect(() => setVisualizando(arquivoInicial), [arquivoInicial])

  const nomeVinculo = (v: VinculoArquivo) =>
    v.tipo === "livro" ? getLivro(v.livroId)?.titulo ?? "Obra removida" : pastas.find((p) => p.id === v.pastaId)?.nome ?? "Pasta removida"

  const filtrados = useMemo(() => {
    const t = normalizar(busca)
    return arquivos
      .filter((a) => {
        const casaBusca = !t || normalizar(`${a.titulo} ${a.descricao ?? ""} ${nomeVinculo(a.vinculo)}`).includes(t)
        const chave = a.vinculo.tipo === "livro" ? `livro:${a.vinculo.livroId}` : `pasta:${a.vinculo.pastaId}`
        const casaVinculo =
          filtroVinculo === "todos" ||
          (filtroVinculo === "livros" && a.vinculo.tipo === "livro") ||
          filtroVinculo === chave
        return casaBusca && casaVinculo
      })
      .sort((a, b) => b.dataUpload.localeCompare(a.dataUpload))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arquivos, busca, filtroVinculo, pastas, livros])

  const atual = arquivos.find((a) => a.id === visualizando) ?? null
  const economia = arquivos.reduce((acc, a) => acc + Math.max(0, a.tamanhoOriginal - a.tamanhoArmazenado), 0)

  function fecharVisualizador() {
    setVisualizando(null)
    if (arquivoInicial) navegar("repositorio")
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="max-w-2xl text-sm text-muted-foreground text-pretty">
          Digitalizações de obras raras e de pastas com recortes históricos, para consulta sem manuseio do original
          (RF08, RF17).
          {ehAdmin && economia > 0 && ` A compressão já economizou ${formatBytes(economia)} de armazenamento (RNF13).`}
        </p>
        {ehAdmin && (
          <div className="flex gap-2">
            <Button variante="outline" onClick={() => setPastaEdit({ nome: "", descricao: "" })}>
              <FolderPlus className="h-4 w-4" /> Nova pasta
            </Button>
            <Button onClick={() => setModalUpload(true)}>
              <Upload className="h-4 w-4" /> Anexar arquivo
            </Button>
          </div>
        )}
      </div>

      <Card className="grid gap-3 p-4 md:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            aria-label="Buscar no repositório"
            placeholder="Buscar por título, descrição, obra ou pasta..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <Select aria-label="Filtrar por vínculo" value={filtroVinculo} onChange={(e) => setFiltroVinculo(e.target.value)} className="md:w-72">
          <option value="todos">Todos os arquivos</option>
          <option value="livros">Digitalizações de obras</option>
          {pastas.map((p) => (
            <option key={p.id} value={`pasta:${p.id}`}>
              Pasta: {p.nome}
            </option>
          ))}
        </Select>
      </Card>

      {/* Pastas de recortes */}
      {pastas.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pastas.map((p) => {
            const qtd = arquivos.filter((a) => a.vinculo.tipo === "pasta" && a.vinculo.pastaId === p.id).length
            return (
              <Card key={p.id} className="flex items-start gap-3 p-4">
                <button
                  onClick={() => setFiltroVinculo(`pasta:${p.id}`)}
                  className="flex min-w-0 flex-1 items-start gap-3 text-left"
                >
                  <Folder className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                  <div className="min-w-0">
                    <p className="font-medium leading-tight">{p.nome}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.descricao}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{qtd} arquivo(s)</p>
                  </div>
                </button>
                {ehAdmin && (
                  <div className="flex">
                    <Button
                      variante="ghost"
                      tamanho="icon"
                      aria-label={`Editar pasta ${p.nome}`}
                      onClick={() => setPastaEdit({ id: p.id, nome: p.nome, descricao: p.descricao })}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variante="ghost" tamanho="icon" aria-label={`Excluir pasta ${p.nome}`} onClick={() => setExcluindoPasta(p)}>
                      <Trash2 className="h-4 w-4 text-danger" />
                    </Button>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* Grade de arquivos */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtrados.map((a) => (
          <Card key={a.id} className="flex flex-col overflow-hidden">
            <button
              onClick={() => setVisualizando(a.id)}
              className="flex h-40 items-center justify-center border-b border-border bg-muted/40 text-primary"
              aria-label={`Visualizar ${a.titulo}`}
            >
              {a.formato === "pdf" ? (
                <FileText className="h-14 w-14 text-danger" />
              ) : (
                <ImagemArmazenada id={a.id} alt="" className="h-full w-full" />
              )}
            </button>
            <div className="flex flex-1 flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium leading-tight text-pretty">{a.titulo}</h3>
                <Badge
                  className={
                    a.formato === "pdf"
                      ? "border border-danger/30 bg-danger/15 text-danger"
                      : "border border-accent/30 bg-accent/15 text-accent"
                  }
                >
                  {a.formato === "pdf" ? "PDF" : "IMAGEM"}
                </Badge>
              </div>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {a.vinculo.tipo === "livro" ? <BookOpen className="h-3.5 w-3.5" /> : <Folder className="h-3.5 w-3.5" />}
                {nomeVinculo(a.vinculo)}
              </p>
              {a.descricao && <p className="line-clamp-2 text-sm text-muted-foreground text-pretty">{a.descricao}</p>}
              {ehAdmin && a.tamanhoOriginal > 0 && (
                <p className="text-xs text-muted-foreground">
                  {formatBytes(a.tamanhoOriginal)} → {formatBytes(a.tamanhoArmazenado)} armazenados
                  {a.compressao !== "nenhuma" && ` (${a.compressao})`}
                </p>
              )}
              <div className="mt-auto flex gap-2 pt-2">
                <Button variante="outline" tamanho="sm" onClick={() => setVisualizando(a.id)}>
                  <Eye className="h-4 w-4" /> Visualizar
                </Button>
                {ehAdmin && (
                  <Button variante="ghost" tamanho="sm" className="text-danger" onClick={() => setExcluindo(a)}>
                    <Trash2 className="h-4 w-4" /> Remover
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
        {filtrados.length === 0 && (
          <Card className="col-span-full p-8 text-center text-muted-foreground">Nenhum arquivo encontrado.</Card>
        )}
      </div>

      {/* Visualizador (RF17) */}
      <Modal aberto={!!atual} onFechar={fecharVisualizador} titulo={atual?.titulo ?? "Visualizador"} largura="max-w-4xl">
        {atual && (
          <div className="space-y-3">
            {atual.formato === "pdf" ? (
              <VisualizadorPdf id={atual.id} titulo={atual.titulo} />
            ) : (
              <ImagemArmazenada id={atual.id} alt={atual.titulo} className="mx-auto max-h-[70vh] rounded-lg object-contain" />
            )}
            {atual.vinculo.tipo === "livro" && (() => {
              const livro = getLivro((atual.vinculo as { livroId: string }).livroId)
              return livro ? (
                <Aviso tipo="info">
                  Vinculado à obra <strong>{livro.titulo}</strong> ({labelCategoria[livro.categoria]}).{" "}
                  <button className="font-medium text-primary underline" onClick={() => navegar("consulta", livro.id)}>
                    Ver no catálogo
                  </button>
                </Aviso>
              ) : null
            })()}
            {atual.descricao && <p className="text-sm text-muted-foreground text-pretty">{atual.descricao}</p>}
            <p className="text-xs text-muted-foreground">Adicionado em {formatDate(atual.dataUpload)}</p>
          </div>
        )}
      </Modal>

      {ehAdmin && (
        <UploadModal
          aberto={modalUpload}
          onFechar={() => setModalUpload(false)}
          onSalvar={(arq, id) => executar(adicionarArquivo(arq, id), () => setModalUpload(false))}
        />
      )}

      <Modal
        aberto={!!pastaEdit}
        onFechar={() => setPastaEdit(null)}
        titulo={pastaEdit?.id ? "Editar pasta de recortes" : "Nova pasta de recortes históricos"}
      >
        {pastaEdit && (
          <div className="space-y-3">
            <Campo rotulo="Nome da pasta">
              {(id) => <Input id={id} value={pastaEdit.nome} onChange={(e) => setPastaEdit({ ...pastaEdit, nome: e.target.value })} />}
            </Campo>
            <Campo rotulo="Descrição">
              {(id) => (
                <Textarea
                  id={id}
                  rows={3}
                  value={pastaEdit.descricao}
                  onChange={(e) => setPastaEdit({ ...pastaEdit, descricao: e.target.value })}
                />
              )}
            </Campo>
            <Rodape>
              <Button variante="outline" onClick={() => setPastaEdit(null)}>
                Cancelar
              </Button>
              <Button
                onClick={() =>
                  executar(salvarPasta({ nome: pastaEdit.nome, descricao: pastaEdit.descricao }, pastaEdit.id), () =>
                    setPastaEdit(null),
                  )
                }
              >
                Salvar
              </Button>
            </Rodape>
          </div>
        )}
      </Modal>

      <Confirmar
        aberto={!!excluindo}
        titulo="Remover arquivo"
        mensagem={`O arquivo "${excluindo?.titulo}" será removido do repositório digital.`}
        rotuloConfirmar="Remover"
        perigo
        onCancelar={() => setExcluindo(null)}
        onConfirmar={() => excluindo && executar(excluirArquivo(excluindo.id), () => setExcluindo(null))}
      />
      <Confirmar
        aberto={!!excluindoPasta}
        titulo="Excluir pasta"
        mensagem={`A pasta "${excluindoPasta?.nome}" será excluída.`}
        rotuloConfirmar="Excluir"
        perigo
        onCancelar={() => setExcluindoPasta(null)}
        onConfirmar={() => excluindoPasta && executar(excluirPasta(excluindoPasta.id), () => setExcluindoPasta(null))}
      />
    </div>
  )
}

function UploadModal({
  aberto,
  onFechar,
  onSalvar,
}: {
  aberto: boolean
  onFechar: () => void
  onSalvar: (arq: Omit<ArquivoDigital, "id" | "dataUpload">, idArmazenado: string) => boolean
}) {
  const { livros, pastas } = useStore()
  const { notificar } = useToast()
  const input = useRef<HTMLInputElement>(null)

  const [formato, setFormato] = useState<FormatoArquivo>("pdf")
  const [titulo, setTitulo] = useState("")
  const [descricao, setDescricao] = useState("")
  const [vinculo, setVinculo] = useState("")
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [enviando, setEnviando] = useState(false)

  function limpar() {
    setTitulo("")
    setDescricao("")
    setVinculo("")
    setArquivo(null)
    if (input.current) input.current.value = ""
  }

  async function enviar() {
    if (!arquivo) return notificar("Selecione o arquivo.", false)
    if (!vinculo) return notificar("Vincule o arquivo a uma obra ou pasta já cadastrada (RF08).", false)
    const [tipo, id] = vinculo.split(":")
    const v: VinculoArquivo = tipo === "livro" ? { tipo: "livro", livroId: id } : { tipo: "pasta", pastaId: id }
    setEnviando(true)
    try {
      const armazenado = formato === "pdf" ? await armazenarPdf(arquivo) : await armazenarImagem(arquivo)
      const salvou = onSalvar(
        {
          titulo: titulo || arquivo.name.replace(/\.[^.]+$/, ""),
          formato,
          nomeArquivo: arquivo.name,
          descricao: descricao.trim() || undefined,
          vinculo: v,
          tamanhoOriginal: armazenado.tamanhoOriginal,
          tamanhoArmazenado: armazenado.tamanhoArmazenado,
          compressao: armazenado.compressao,
        },
        armazenado.id,
      )
      if (salvou) limpar()
      else removerArquivos([armazenado.id])
    } catch (err) {
      notificar((err as Error).message, false)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal aberto={aberto} onFechar={onFechar} titulo="Anexar arquivo ao repositório">
      <div className="space-y-3">
        <Campo rotulo="Tipo de arquivo">
          {(id) => (
            <Select
              id={id}
              value={formato}
              onChange={(e) => {
                setFormato(e.target.value as FormatoArquivo)
                setArquivo(null)
                if (input.current) input.current.value = ""
              }}
            >
              <option value="pdf">PDF (digitalização de obra ou documento)</option>
              <option value="imagem">Imagem (WEBP, JPG ou PNG)</option>
            </Select>
          )}
        </Campo>
        <Campo rotulo="Arquivo" dica={formato === "pdf" ? "Somente .pdf" : "Somente WEBP, JPG e PNG (RNF12)."}>
          {(id) => (
            <Input
              id={id}
              ref={input}
              type="file"
              accept={formato === "pdf" ? ".pdf,application/pdf" : ACCEPT_IMAGEM}
              className="py-1.5 file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            />
          )}
        </Campo>
        <Campo rotulo="Vincular a" dica="O arquivo precisa estar ligado a uma obra ou pasta já cadastrada.">
          {(id) => (
            <Select id={id} value={vinculo} onChange={(e) => setVinculo(e.target.value)}>
              <option value="">Selecione...</option>
              <optgroup label="Obras do acervo">
                {livros.map((l) => (
                  <option key={l.id} value={`livro:${l.id}`}>
                    {l.titulo}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Pastas de recortes">
                {pastas.map((p) => (
                  <option key={p.id} value={`pasta:${p.id}`}>
                    {p.nome}
                  </option>
                ))}
              </optgroup>
            </Select>
          )}
        </Campo>
        <Campo rotulo="Título">
          {(id) => <Input id={id} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Recorte de jornal - 1950" />}
        </Campo>
        <Campo rotulo="Descrição (opcional)">
          {(id) => <Textarea id={id} rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} />}
        </Campo>
        <Aviso tipo="info">O arquivo é comprimido antes de ser armazenado (RNF13).</Aviso>
        <Rodape>
          <Button variante="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={enviando}>
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {enviando ? "Comprimindo..." : "Anexar"}
          </Button>
        </Rodape>
      </div>
    </Modal>
  )
}
