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

/** Visualizador de PDF no navegador (RF17). */
export function VisualizadorPdf({ id, titulo }: { id: string; titulo: string }) {
  const { url, carregando } = useArquivoUrl(id)
  if (carregando || !url) {
    return (
      <div className="flex h-[60vh] items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 text-sm text-muted-foreground">
        {carregando ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Descomprimindo e carregando o documento...
          </>
        ) : (
          <>
            <FileText className="mr-2 h-4 w-4" /> Arquivo não encontrado neste navegador.
          </>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <iframe title={titulo} src={url} className="h-[65vh] w-full rounded-lg border border-border bg-muted" />
      <p className="text-xs text-muted-foreground">
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
  const token = destino && sessao.perfil === "admin" ? sessao.token : undefined
  const servidor = token && destino ? { token, destino } : undefined

  async function aoEscolher(arquivos: FileList | null) {
    if (!arquivos || arquivos.length === 0) return
    const lista = Array.from(arquivos).slice(0, maximo - ids.length)
    setEnviando(true)
    const novos: string[] = []
    for (const arq of lista) {
      try {
        const r = await armazenarImagem(arq, undefined, servidor)
        novos.push(r.id)
      } catch (err) {
        notificar(`${arq.name}: ${(err as Error).message}`, false)
      }
    }
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
    </div>
  )
}
