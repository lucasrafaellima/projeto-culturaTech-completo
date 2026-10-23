import { createReadStream } from "node:fs"
import { mkdir, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Readable } from "node:stream"
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { config } from "./config.ts"

// Guarda o conteúdo dos arquivos fora do banco; a tabela arquivo guarda só a
// chave (chave_storage). S3 em produção, pasta local em desenvolvimento.
interface Armazenamento {
  // gzip: o conteúdo é um PDF comprimido (fica marcado como Content-Encoding: gzip no S3)
  gravar(chave: string, bytes: Buffer, mime: string, gzip?: boolean): Promise<void>
  ler(chave: string): Promise<Readable>
  apagar(chave: string): Promise<void>
}

function armazenamentoS3(bucket: string, regiao: string, endpoint?: string): Armazenamento {
  // credenciais pela cadeia padrão da AWS (variáveis AWS_*, perfil ou papel da instância)
  const s3 = new S3Client({ region: regiao, ...(endpoint ? { endpoint, forcePathStyle: true } : {}) })
  return {
    async gravar(chave, bytes, mime, gzip) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: chave,
          Body: bytes,
          ContentType: mime,
          ...(gzip ? { ContentEncoding: "gzip" } : {}),
        }),
      )
    },
    async ler(chave) {
      const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: chave }))
      return r.Body as Readable
    },
    async apagar(chave) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: chave }))
    },
  }
}

function armazenamentoDisco(pasta: string): Armazenamento {
  // a chave é sempre "<pasta>/<uuid>.<extensão>" (gerada pela API), nunca vem do usuário
  const caminho = (chave: string) => join(pasta, ...chave.split("/"))
  return {
    async gravar(chave, bytes) {
      await mkdir(join(caminho(chave), ".."), { recursive: true })
      await writeFile(caminho(chave), bytes)
    },
    async ler(chave) {
      // confere antes de abrir: arquivo ausente falha aqui, como no S3, e não no meio da resposta
      await stat(caminho(chave))
      return createReadStream(caminho(chave))
    },
    async apagar(chave) {
      await rm(caminho(chave), { force: true })
    },
  }
}

const a = config.armazenamento
export const armazenamento: Armazenamento =
  a.modo === "s3" ? armazenamentoS3(a.bucket, a.regiao, a.endpoint) : armazenamentoDisco(a.pasta)

// Pastas do bucket, conforme o uso do arquivo
export const DESTINOS = ["mural", "acervo", "documentos", "socios", "danos"] as const
export type Destino = (typeof DESTINOS)[number]

const EXTENSOES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
}

// ex.: acervo/3f9c2a1e-....pdf
export const chaveDoArquivo = (destino: Destino, id: string, mime: string) => `${destino}/${id}.${EXTENSOES[mime]}`
