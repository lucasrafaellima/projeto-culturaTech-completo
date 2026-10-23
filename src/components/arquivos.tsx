import { useRef, useState, type ReactNode } from "react"
import { FileText, ImageIcon, Loader2, Upload, X } from "lucide-react"
import { useArquivoUrl, armazenarImagem, removerArquivos } from "@/lib/arquivos"
import { ACCEPT_IMAGEM } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { useStore } from "@/lib/store"
import type { DestinoArquivo } from "@/lib/api"
import { Button, useToast } from "./ui"

/** Exibe uma imagem armazenada no IndexedDB. */
export function ImagemArmazenada({
  id,
  alt,
  className,
  fallback,
}: {
  id: string | undefined
  alt: string
  className?: string
  fallback?: ReactNode
}) {
  const { url, carregando } = useArquivoUrl(id)
  if (!id || (!url && !carregando)) {
    return (
      <>
        {fallback ?? (
          <div className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}>
            <ImageIcon className="h-6 w-6" />
          </div>
        )}
      </>
    )
  }
  if (!url) {
    return (
      <div className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}>
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }
  return <img src={url} alt={alt} className={cn("object-cover", className)} />
}

/** Visualizador de PDF no navegador (RF17 / US18): estados de carregamento e de arquivo indisponível. */
export function VisualizadorPdf({ id, titulo }: { id: string; titulo: string }) {
  const { url, carregando, recarregar } = useArquivoUrl(id)
  if (carregando || !url) {
    return (
      <div
        role="status"
        className="flex h-[50vh] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/40 p-6 text-center text-sm text-muted-foreground sm:h-[60vh]"
      >
        {carregando ? (
          <>
            <Loader2 className="h-6 w-6 animate-spin" />
            <p>Carregando o documento...</p>
          </>
        ) : (
          <>
            <FileText className="h-8 w-8" />
            <div>
              <p className="font-medium text-foreground">Arquivo indisponível no momento</p>
              <p className="mt-1">
                O documento não pôde ser carregado. Verifique a conexão e tente de novo; se continuar, avise a biblioteca.
              </p>
            </div>
            <Button variante="outline" tamanho="sm" onClick={recarregar}>
              Tentar de novo
            </Button>
          </>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {/* no celular o leitor embutido costuma não abrir PDF: o link para abrir fica em destaque */}
      <iframe title={titulo} src={url} className="hidden h-[65vh] w-full rounded-lg border border-border bg-muted sm:block" />
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-center gap-2 rounded-lg border border-border bg-muted/40 p-4 text-sm font-medium text-primary sm:hidden"
      >
        <FileText className="h-5 w-5" /> Abrir o documento
      </a>
      <p className="hidden text-xs text-muted-foreground sm:block">
        Se o documento não aparecer,{" "}
        <a href={url} target="_blank" rel="noreferrer" className="font-medium text-primary underline">
          abra em uma nova aba
        </a>
        .
      </p>
    </div>
  )
}

/**
 * Seletor de imagens: valida o formato (RNF12), comprime (RNF13)
 * e devolve os ids armazenados.
 */
export function SeletorImagens({
  ids,
  onChange,
  maximo = 4,
  rotulo = "Adicionar imagem",
  destino,
}: {
  ids: string[]
  onChange: (ids: string[]) => void
  maximo?: number
  rotulo?: string
  /** pasta do bucket: com o administrador conectado pela API, as imagens vão para o servidor (S3) */
  destino?: DestinoArquivo
}) {
  const input = useRef<HTMLInputElement>(null)
  const { notificar } = useToast()
  const { sessao } = useStore()
  const [enviando, setEnviando] = useState(false)
  const [erros, setErros] = useState<string[]>([])
  const token = destino && sessao.perfil === "admin" ? sessao.token : undefined
  const servidor = token && destino ? { token, destino } : undefined

  async function aoEscolher(arquivos: FileList | null) {
    if (!arquivos || arquivos.length === 0) return
    const todos = Array.from(arquivos)
    const lista = todos.slice(0, maximo - ids.length)
    setEnviando(true)
    const novos: string[] = []
    const falhas: string[] = []
    if (todos.length > lista.length) falhas.push(`Limite de ${maximo} imagens: ${todos.length - lista.length} não foram anexadas.`)
    for (const arq of lista) {
      try {
        const r = await armazenarImagem(arq, undefined, servidor)
        novos.push(r.id)
      } catch (err) {
        falhas.push(`${arq.name}: ${(err as Error).message}`)
        notificar(`${arq.name}: ${(err as Error).message}`, false)
      }
    }
    setErros(falhas)
    setEnviando(false)
    if (novos.length) onChange([...ids, ...novos])
    if (input.current) input.current.value = ""
  }

  function remover(id: string) {
    removerArquivos([id], token)
    onChange(ids.filter((x) => x !== id))
  }

  return (
    <div className="space-y-2">
      {ids.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {ids.map((id) => (
            <div key={id} className="relative">
              <ImagemArmazenada id={id} alt="Imagem anexada" className="h-20 w-20 rounded-lg border border-border" />
              <button
                type="button"
                aria-label="Remover imagem"
                onClick={() => remover(id)}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-danger text-danger-foreground shadow"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {ids.length < maximo && (
        <>
          <input
            ref={input}
            type="file"
            accept={ACCEPT_IMAGEM}
            multiple={maximo > 1}
            className="hidden"
            onChange={(e) => aoEscolher(e.target.files)}
          />
          <Button variante="outline" tamanho="sm" disabled={enviando} onClick={() => input.current?.click()}>
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {enviando ? "Comprimindo..." : rotulo}
          </Button>
          <p className="text-xs text-muted-foreground">Formatos aceitos: WEBP, JPG e PNG (RNF12).</p>
        </>
      )}
      {erros.length > 0 && (
        <ul role="alert" className="space-y-0.5 rounded-lg border border-danger/30 bg-danger/5 p-2 text-xs text-danger">
          {erros.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
