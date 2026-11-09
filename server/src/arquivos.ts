import { randomUUID } from "node:crypto"
import { pipeline } from "node:stream/promises"
import express, { Router, type NextFunction, type Request, type Response } from "express"
import type pg from "pg"
import { pool } from "./db.ts"
import { exigirAdmin, usuarioOpcional, type UsuarioLogado } from "./auth.ts"
import { DESTINOS, armazenamento, chaveDoArquivo, type Destino } from "./armazenamento.ts"
import { ErroRegra, emTransacao, idDe, tratarErroDeRegra } from "./comum.ts"

// Arquivos binários (RNF12 / RNF13): digitalizações do repositório, fotos 3x4
// e imagens de dano. O front-end já envia o conteúdo comprimido (imagens em
// WEBP, PDFs em gzip); a API confere o tipo e guarda os bytes como recebeu.

// Limites do conteúdo armazenado (já comprimido): PDFs digitalizados até 15 MB;
// imagens até 5 MB (o front reduz para WEBP de até 1600 px, bem abaixo disso)
export const LIMITE_ARQUIVO = 15 * 1024 * 1024
export const LIMITE_IMAGEM = 5 * 1024 * 1024
const MIMES = ["image/webp", "image/jpeg", "image/png", "application/pdf"]

const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`

// Confere a assinatura do conteúdo, para um arquivo qualquer não passar como PDF ou imagem
function assinaturaConfere(b: Buffer, mime: string, compressao: string): boolean {
  if (compressao === "gzip") return b[0] === 0x1f && b[1] === 0x8b
  if (mime === "application/pdf") return b.subarray(0, 5).toString("latin1") === "%PDF-"
  if (mime === "image/png") return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (mime === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  if (mime === "image/webp") {
    return b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP"
  }
  return false
}

// Referências que impedem apagar o arquivo
const SQL_REFERENCIAS = `
  SELECT EXISTS (SELECT 1 FROM documento_digital WHERE arquivo_id = $1)
      OR EXISTS (SELECT 1 FROM socio_leitor WHERE foto_arquivo_id = $1)
      OR EXISTS (SELECT 1 FROM ocorrencia_dano_imagem WHERE arquivo_id = $1)
      OR EXISTS (SELECT 1 FROM publicacao_imagem WHERE arquivo_id = $1) AS referenciado`

// Apaga o objeto do armazenamento; uma falha aqui só deixa um objeto órfão
export async function apagarObjeto(chave: string) {
  try {
    await armazenamento.apagar(chave)
  } catch (erro) {
    console.error(`Não foi possível apagar o objeto ${chave}:`, (erro as Error).message)
  }
}

// Apaga as linhas de arquivo dentro da transação e devolve as chaves, para os
// objetos saírem do armazenamento depois do COMMIT
export async function apagarArquivosDoBanco(c: pg.PoolClient, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const { rows } = await c.query<{ chave_storage: string }>(
    "DELETE FROM arquivo WHERE id = ANY($1::uuid[]) RETURNING chave_storage",
    [ids],
  )
  return rows.map((r) => r.chave_storage)
}

export const rotasArquivos = Router()

// POST /api/arquivos  (corpo binário; metadados nos cabeçalhos)
//   Content-Type: image/webp | image/jpeg | image/png | application/pdf
//   X-Nome-Arquivo: nome original (codificado com encodeURIComponent)
//   X-Compressao: webp | gzip | nenhuma
//   X-Tamanho-Original: tamanho antes da compressão, em bytes
//   X-Destino: pasta do bucket — mural | acervo | documentos | socios | danos
rotasArquivos.post(
  "/arquivos",
  exigirAdmin,
  express.raw({ type: () => true, limit: LIMITE_ARQUIVO }),
  async (req, res) => {
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    if (bytes.length === 0) throw new ErroRegra(400, "Envie o conteúdo do arquivo.")

    const mime = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase()
    if (!MIMES.includes(mime)) throw new ErroRegra(400, "Formato não suportado. Envie PDF, JPG, PNG ou WEBP (RNF12).")
    if (mime.startsWith("image/") && bytes.length > LIMITE_IMAGEM) {
      throw new ErroRegra(413, `Imagem grande demais: o limite é ${mb(LIMITE_IMAGEM)}.`)
    }

    const compressao = String(req.headers["x-compressao"] ?? "nenhuma")
    const combina =
      compressao === "nenhuma" ||
      (compressao === "webp" && mime === "image/webp") ||
      (compressao === "gzip" && mime === "application/pdf")
    if (!combina) throw new ErroRegra(400, "Compressão inválida para o formato do arquivo.")
    if (!assinaturaConfere(bytes, mime, compressao)) {
      throw new ErroRegra(400, "O conteúdo do arquivo não corresponde ao formato informado.")
    }

    let nome = "arquivo"
    try {
      nome = decodeURIComponent(String(req.headers["x-nome-arquivo"] ?? "")).trim() || "arquivo"
    } catch {
      throw new ErroRegra(400, "Nome do arquivo inválido.")
    }
    if (nome.length > 255) nome = nome.slice(0, 255)

    const original = Number(req.headers["x-tamanho-original"] ?? bytes.length)
    const tamanhoOriginal = Number.isSafeInteger(original) && original >= 0 ? original : bytes.length

    const destino = String(req.headers["x-destino"] ?? "") as Destino
    if (!DESTINOS.includes(destino)) throw new ErroRegra(400, "Destino do arquivo inválido.")
    // fotos e imagens do mural e de danos são imagens; o acervo e os documentos aceitam PDF ou imagem
    if (["mural", "socios", "danos"].includes(destino) && !mime.startsWith("image/")) {
      throw new ErroRegra(400, "Envie uma imagem (JPG, PNG ou WEBP).")
    }

    const id = randomUUID()
    const chave = chaveDoArquivo(destino, id, mime)
    try {
      await armazenamento.gravar(chave, bytes, mime, compressao === "gzip")
    } catch (erro) {
      // S3 fora do ar, sem permissão ou disco cheio: o usuário tenta de novo
      console.error(`Falha ao gravar ${chave}:`, (erro as Error).message)
      throw new ErroRegra(503, "Não foi possível guardar o arquivo no armazenamento. Tente novamente em instantes.")
    }
    try {
      await pool.query(
        `INSERT INTO arquivo (id, nome_arquivo, mime, chave_storage, tamanho_original, tamanho_armazenado, compressao)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, nome, mime, chave, tamanhoOriginal, bytes.length, compressao],
      )
    } catch (erro) {
      await apagarObjeto(chave)
      throw erro
    }
    res.status(201).json({
      ok: true,
      arquivo: { id, nomeArquivo: nome, mime, tamanhoOriginal, tamanhoArmazenado: bytes.length, compressao },
    })
  },
)

// GET /api/arquivos/:id
// Público quando o arquivo é uma digitalização do repositório (RF17) ou uma
// imagem do mural (RF12); a foto
// do sócio, só para ele e para administradores; os demais, só administradores.
rotasArquivos.get("/arquivos/:id", usuarioOpcional, async (req, res) => {
  const id = idDe(req, "Arquivo não encontrado.")
  const usuario = res.locals.usuario as UsuarioLogado | null
  const { rows } = await pool.query<{
    nome_arquivo: string
    mime: string
    compressao: string
    chave_storage: string
    publico: boolean
    dono_foto: string | null
  }>(
    `SELECT a.nome_arquivo, a.mime, a.compressao, a.chave_storage,
            (EXISTS (SELECT 1 FROM documento_digital d WHERE d.arquivo_id = a.id)
              OR EXISTS (SELECT 1 FROM publicacao_imagem p WHERE p.arquivo_id = a.id)) AS publico,
            (SELECT s.id FROM socio_leitor s WHERE s.foto_arquivo_id = a.id LIMIT 1) AS dono_foto
       FROM arquivo a WHERE a.id = $1`,
    [id],
  )
  const arq = rows[0]
  if (!arq) throw new ErroRegra(404, "Arquivo não encontrado.")
  if (!arq.publico && usuario?.perfil !== "admin") {
    if (!usuario) throw new ErroRegra(401, "Sessão inválida ou expirada. Entre novamente.")
    if (arq.dono_foto !== usuario.id) throw new ErroRegra(404, "Arquivo não encontrado.")
  }

  let conteudo
  try {
    conteudo = await armazenamento.ler(arq.chave_storage)
  } catch (erro) {
    // o registro existe, mas o objeto sumiu do S3/disco (ou o S3 está fora do ar)
    console.error(`Falha ao ler ${arq.chave_storage}:`, (erro as Error).message)
    throw new ErroRegra(503, "Arquivo indisponível no momento. Tente novamente mais tarde.")
  }
  res.set({
    "Content-Type": arq.mime,
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(arq.nome_arquivo)}`,
    "X-Content-Type-Options": "nosniff",
    // o conteúdo de um id nunca muda
    "Cache-Control": arq.publico ? "public, max-age=86400" : "private, max-age=86400",
    // PDF guardado em gzip: o navegador descomprime sozinho
    ...(arq.compressao === "gzip" ? { "Content-Encoding": "gzip" } : {}),
  })
  try {
    await pipeline(conteudo, res)
  } catch (erro) {
    if (!res.headersSent) throw erro
    console.error(`Falha ao enviar o arquivo ${id}:`, (erro as Error).message)
    res.destroy()
  }
})

// DELETE /api/arquivos/:id  (só arquivo que nada referencia: limpa um upload
// cujo cadastro não chegou a ser concluído)
rotasArquivos.delete("/arquivos/:id", exigirAdmin, async (req, res) => {
  const id = idDe(req, "Arquivo não encontrado.")
  const chaves = await emTransacao(async (c) => {
    const arq = await c.query("SELECT 1 FROM arquivo WHERE id = $1 FOR UPDATE", [id])
    if (arq.rowCount === 0) throw new ErroRegra(404, "Arquivo não encontrado.")
    const { rows } = await c.query<{ referenciado: boolean }>(SQL_REFERENCIAS, [id])
    if (rows[0].referenciado) throw new ErroRegra(409, "O arquivo está em uso e não pode ser apagado.")
    return apagarArquivosDoBanco(c, [id])
  })
  for (const chave of chaves) await apagarObjeto(chave)
  res.json({ ok: true, mensagem: "Arquivo apagado." })
})

rotasArquivos.use((erro: Error & { type?: string }, req: Request, res: Response, next: NextFunction) => {
  // corpo acima de LIMITE_ARQUIVO, recusado por express.raw antes de chegar à rota
  if (erro.type === "entity.too.large") {
    res.status(413).json({ ok: false, mensagem: `Arquivo grande demais: o limite é ${mb(LIMITE_ARQUIVO)}.` })
    return
  }
  tratarErroDeRegra(erro, req, res, next)
})
