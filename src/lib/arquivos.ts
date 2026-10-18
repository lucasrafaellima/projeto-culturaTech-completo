// ============================================================
// Armazenamento de arquivos (imagens e PDFs) no IndexedDB.
// RNF12: somente WEBP, JPG e PNG para imagens.
// RNF13: todo arquivo é comprimido antes de ser armazenado —
//        imagens são reencodadas em WEBP (redimensionadas se muito
//        grandes) e PDFs são compactados com gzip.
// ============================================================
import { useEffect, useState } from "react"
import type { Compressao } from "./types"
import { imagemValida, pdfValido } from "./constants"
import { uuid } from "./utils"
import { carregarSessao } from "./persistencia"
import { apagarArquivoNaApi, enviarArquivoNaApi, type DestinoArquivo } from "./api"

const DB_NOME = "culturatech-arquivos"
const STORE = "arquivos"

interface Registro {
  id: string
  blob: Blob
  mime: string // tipo original (usado ao descomprimir)
  compressao: Compressao
}

let dbPromise: Promise<IDBDatabase> | null = null

function abrirDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NOME, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: "id" })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

async function transacao<T>(
  modo: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await abrirDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, modo)
    const req = fn(tx.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function salvarRegistro(reg: Registro): Promise<void> {
  await transacao("readwrite", (s) => s.put(reg))
}

export async function removerArquivo(id: string): Promise<void> {
  await transacao("readwrite", (s) => s.delete(id))
}

/** Remove do navegador; com token, também apaga no servidor o upload que ficou sem uso. */
export async function removerArquivos(ids: string[], token?: string): Promise<void> {
  await Promise.all(
    ids.map(async (id) => {
      await removerArquivo(id).catch(() => undefined)
      // o servidor só apaga arquivo que nada referencia
      if (token && UUID.test(id)) await apagarArquivoNaApi(token, id)
    }),
  )
}

async function gzip(blob: Blob): Promise<Blob> {
  const stream = blob.stream().pipeThrough(new CompressionStream("gzip"))
  return new Response(stream).blob()
}

async function gunzip(blob: Blob, mime: string): Promise<Blob> {
  const stream = blob.stream().pipeThrough(new DecompressionStream("gzip"))
  const buf = await new Response(stream).arrayBuffer()
  return new Blob([buf], { type: mime })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Arquivo guardado no servidor (S3): a API devolve o conteúdo já descomprimido
// (PDF em gzip vem com Content-Encoding). Digitalizações do repositório são
// públicas; fotos e imagens de dano exigem o token da sessão.
async function lerDaApi(id: string): Promise<Blob | null> {
  if (!UUID.test(id)) return null
  const token = carregarSessao().token
  try {
    const r = await fetch(`/api/arquivos/${id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    const tipo = r.headers.get("content-type") ?? ""
    if (!r.ok || tipo.includes("json") || tipo.includes("html")) return null
    return await r.blob()
  } catch {
    return null
  }
}

/** Lê o arquivo já descomprimido, pronto para exibição (navegador ou servidor). */
export async function lerArquivo(id: string): Promise<Blob | null> {
  const reg = await transacao<Registro | undefined>("readonly", (s) => s.get(id))
  if (!reg) return lerDaApi(id)
  if (reg.compressao === "gzip") return gunzip(reg.blob, reg.mime)
  return reg.blob
}

/** Envio ao servidor (S3): token da sessão e pasta do bucket onde o arquivo fica. */
export interface EnvioServidor {
  token: string
  destino: DestinoArquivo
}

// Envia ao servidor o conteúdo já comprimido; devolve o id gerado pelo banco
async function enviarAoServidor(
  servidor: EnvioServidor,
  c: { blob: Blob; mime: string; compressao: Compressao; tamanhoOriginal: number },
  nome: string,
): Promise<ArquivoArmazenado> {
  const r = await enviarArquivoNaApi(servidor.token, c.blob, {
    mime: c.mime,
    nome,
    compressao: c.compressao,
    tamanhoOriginal: c.tamanhoOriginal,
    destino: servidor.destino,
  })
  if (r.tipo === "indisponivel") throw new Error("Servidor indisponível: não foi possível enviar o arquivo. Tente novamente.")
  if (r.tipo === "erro") throw new Error(r.mensagem)
  const a = r.dados.arquivo
  return { id: a.id, tamanhoOriginal: a.tamanhoOriginal, tamanhoArmazenado: a.tamanhoArmazenado, compressao: a.compressao }
}

export interface ArquivoArmazenado {
  id: string
  tamanhoOriginal: number
  tamanhoArmazenado: number
  compressao: Compressao
}

const LADO_MAXIMO = 1600

function carregarImagem(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("Não foi possível ler a imagem."))
    }
    img.src = url
  })
}

async function reencodarWebp(blob: Blob): Promise<Blob | null> {
  const img = await carregarImagem(blob)
  const escala = Math.min(1, LADO_MAXIMO / Math.max(img.width, img.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(img.width * escala)
  canvas.height = Math.round(img.height * escala)
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/webp", 0.8))
}

/**
 * Valida (RNF12), comprime (RNF13) e armazena uma imagem: no navegador ou,
 * com o token da sessão, no servidor (S3).
 */
export async function armazenarImagem(
  arquivo: File | Blob,
  nome?: string,
  servidor?: EnvioServidor,
): Promise<ArquivoArmazenado> {
  const info = { name: nome ?? (arquivo as File).name ?? "imagem", type: arquivo.type }
  if (!imagemValida(info)) {
    throw new Error("Formato de imagem não permitido. Envie apenas WEBP, JPG ou PNG (RNF12).")
  }
  let blob: Blob = arquivo
  let compressao: Compressao = "nenhuma"
  try {
    const webp = await reencodarWebp(arquivo)
    // navegadores sem suporte a WEBP no canvas devolvem PNG — nesse caso mantém o original
    if (webp && webp.type === "image/webp" && webp.size < arquivo.size) {
      blob = webp
      compressao = "webp"
    }
  } catch {
    throw new Error("O arquivo enviado não é uma imagem válida.")
  }
  if (servidor) {
    return enviarAoServidor(servidor, { blob, mime: blob.type, compressao, tamanhoOriginal: arquivo.size }, info.name)
  }
  const id = uuid()
  await salvarRegistro({ id, blob, mime: blob.type, compressao })
  return { id, tamanhoOriginal: arquivo.size, tamanhoArmazenado: blob.size, compressao }
}

/** Valida, comprime com gzip (RNF13) e armazena um PDF (no navegador ou, com token, no servidor). */
export async function armazenarPdf(
  arquivo: File | Blob,
  nome?: string,
  servidor?: EnvioServidor,
): Promise<ArquivoArmazenado> {
  const info = { name: nome ?? (arquivo as File).name ?? "documento.pdf", type: arquivo.type }
  if (!pdfValido(info)) {
    throw new Error("O arquivo precisa ser um PDF.")
  }
  const comprimido = await gzip(arquivo)
  const usarGzip = comprimido.size < arquivo.size
  const blob = usarGzip ? comprimido : arquivo
  const compressao: Compressao = usarGzip ? "gzip" : "nenhuma"
  if (servidor) {
    return enviarAoServidor(servidor, { blob, mime: "application/pdf", compressao, tamanhoOriginal: arquivo.size }, info.name)
  }
  const id = uuid()
  await salvarRegistro({ id, blob, mime: "application/pdf", compressao })
  return { id, tamanhoOriginal: arquivo.size, tamanhoArmazenado: blob.size, compressao }
}

/** Grava um arquivo com id fixo (usado nos dados de demonstração). */
export async function armazenarComId(
  id: string,
  blob: Blob,
  tipo: "imagem" | "pdf",
): Promise<{ tamanhoOriginal: number; tamanhoArmazenado: number }> {
  if (tipo === "pdf") {
    const comprimido = await gzip(blob)
    await salvarRegistro({ id, blob: comprimido, mime: "application/pdf", compressao: "gzip" })
    return { tamanhoOriginal: blob.size, tamanhoArmazenado: comprimido.size }
  }
  await salvarRegistro({ id, blob, mime: blob.type, compressao: "nenhuma" })
  return { tamanhoOriginal: blob.size, tamanhoArmazenado: blob.size }
}

// Leituras feitas pela interface aguardam a geração dos arquivos de demonstração
let barreira: Promise<unknown> = Promise.resolve()
export function aguardarAntesDeLer(p: Promise<unknown>) {
  barreira = p.catch(() => undefined)
}

/** Hook: devolve uma URL temporária para exibir o arquivo armazenado. */
export function useArquivoUrl(id: string | undefined | null): {
  url: string | null
  carregando: boolean
} {
  const [url, setUrl] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  useEffect(() => {
    if (!id) {
      setUrl(null)
      return
    }
    let ativo = true
    let criada: string | null = null
    setCarregando(true)
    barreira
      .then(() => lerArquivo(id))
      .then((blob) => {
        if (!ativo) return
        if (blob) {
          criada = URL.createObjectURL(blob)
          setUrl(criada)
        } else {
          setUrl(null)
        }
      })
      .catch(() => ativo && setUrl(null))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
      if (criada) URL.revokeObjectURL(criada)
    }
  }, [id])

  return { url, carregando }
}
