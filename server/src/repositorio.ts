import { Router, type NextFunction, type Request, type Response } from "express"
import pg from "pg"
import { pool } from "./db.ts"
import { exigirAdmin } from "./auth.ts"
import { apagarArquivosDoBanco, apagarObjeto } from "./arquivos.ts"
import { ErroRegra, UUID, corpoDe, emTransacao, idDe, texto, tratarErroDeRegra } from "./comum.ts"

// Repositório digital (RF08 / RF17): documentos vinculados a uma obra ou a uma
// pasta histórica. Mesmas regras e mensagens de adicionarArquivo, excluirArquivo,
// salvarPasta e excluirPasta (src/lib/store.tsx).
// No front-end o id do documento é o id do arquivo (é o que o visualizador lê).

const SQL_DOCUMENTO = `
  SELECT a.id, d.titulo, d.formato, a.nome_arquivo, d.descricao, d.livro_id, d.pasta_id,
         a.tamanho_original, a.tamanho_armazenado, a.compressao,
         to_char(d.data_upload, 'YYYY-MM-DD') AS data_upload
    FROM documento_digital d JOIN arquivo a ON a.id = d.arquivo_id`

interface LinhaDocumento {
  id: string
  titulo: string
  formato: "pdf" | "imagem"
  nome_arquivo: string
  descricao: string | null
  livro_id: string | null
  pasta_id: string | null
  tamanho_original: string
  tamanho_armazenado: string
  compressao: string
  data_upload: string
}

const documentoJson = (d: LinhaDocumento) => ({
  id: d.id,
  titulo: d.titulo,
  formato: d.formato,
  nomeArquivo: d.nome_arquivo,
  ...(d.descricao ? { descricao: d.descricao } : {}),
  vinculo: d.livro_id ? { tipo: "livro", livroId: d.livro_id } : { tipo: "pasta", pastaId: d.pasta_id },
  tamanhoOriginal: Number(d.tamanho_original),
  tamanhoArmazenado: Number(d.tamanho_armazenado),
  compressao: d.compressao,
  dataUpload: d.data_upload,
})

function validarPasta(corpo: Record<string, unknown>) {
  const nome = texto(corpo.nome)
  if (nome.length < 3) throw new ErroRegra(400, "Informe o nome da pasta.")
  if (nome.length > 120) throw new ErroRegra(400, "Nome da pasta muito longo (máximo de 120 caracteres).")
  return { nome, descricao: texto(corpo.descricao) }
}

export const rotasRepositorio = Router()

// GET /api/repositorio  (público, RF17: visitantes consultam sem login)
rotasRepositorio.get("/repositorio", async (_req, res) => {
  const [pastas, documentos] = await Promise.all([
    pool.query("SELECT id, nome, descricao FROM pasta_historica ORDER BY lower(nome)"),
    pool.query<LinhaDocumento>(`${SQL_DOCUMENTO} ORDER BY d.data_upload DESC, d.titulo`),
  ])
  res.json({ ok: true, pastas: pastas.rows, documentos: documentos.rows.map(documentoJson) })
})

rotasRepositorio.use(["/documentos", "/pastas"], exigirAdmin)

// POST /api/documentos
//   { "arquivoId": "...", "titulo": "...", "formato": "pdf" | "imagem", "descricao"?: "...",
//     "vinculo": { "tipo": "livro", "livroId": "..." } | { "tipo": "pasta", "pastaId": "..." } }
rotasRepositorio.post("/documentos", async (req, res) => {
  const corpo = corpoDe(req)
  const arquivoId = texto(corpo.arquivoId)
  if (!UUID.test(arquivoId)) throw new ErroRegra(400, "Envie o arquivo antes de anexá-lo.")
  const titulo = texto(corpo.titulo)
  if (titulo.length < 3) throw new ErroRegra(400, "Informe o título do arquivo.")
  if (titulo.length > 300) throw new ErroRegra(400, "Título muito longo (máximo de 300 caracteres).")
  const formato = texto(corpo.formato)
  if (formato !== "pdf" && formato !== "imagem") throw new ErroRegra(400, "Formato inválido.")
  const descricao = texto(corpo.descricao) || null

  const vinculo = (typeof corpo.vinculo === "object" && corpo.vinculo ? corpo.vinculo : {}) as Record<string, unknown>
  const livroId = vinculo.tipo === "livro" ? texto(vinculo.livroId) : null
  const pastaId = vinculo.tipo === "pasta" ? texto(vinculo.pastaId) : null
  if (!livroId && !pastaId) throw new ErroRegra(400, "Vincule o arquivo a uma obra ou a uma pasta (RF08).")

  const documento = await emTransacao(async (c) => {
    // RF08: o vínculo precisa existir
    if (livroId) {
      const l = UUID.test(livroId) ? await c.query("SELECT 1 FROM livro WHERE id = $1", [livroId]) : { rowCount: 0 }
      if (!l.rowCount) throw new ErroRegra(404, "A obra vinculada não está cadastrada (RF08).")
    } else {
      const p = UUID.test(pastaId!) ? await c.query("SELECT 1 FROM pasta_historica WHERE id = $1", [pastaId]) : { rowCount: 0 }
      if (!p.rowCount) throw new ErroRegra(404, "A pasta vinculada não está cadastrada (RF08).")
    }

    const arq = (
      await c.query<{ mime: string; chave_storage: string; em_uso: boolean }>(
        `SELECT mime, chave_storage,
                EXISTS (SELECT 1 FROM documento_digital WHERE arquivo_id = a.id)
             OR EXISTS (SELECT 1 FROM socio_leitor WHERE foto_arquivo_id = a.id)
             OR EXISTS (SELECT 1 FROM ocorrencia_dano_imagem WHERE arquivo_id = a.id)
             OR EXISTS (SELECT 1 FROM publicacao_imagem WHERE arquivo_id = a.id) AS em_uso
           FROM arquivo a WHERE id = $1 FOR UPDATE`,
        [arquivoId],
      )
    ).rows[0]
    if (!arq) throw new ErroRegra(404, "Arquivo não encontrado. Envie o arquivo novamente.")
    if (arq.em_uso) throw new ErroRegra(409, "Este arquivo já está em uso.")
    if ((formato === "pdf") !== (arq.mime === "application/pdf")) {
      throw new ErroRegra(400, "O formato informado não corresponde ao arquivo enviado.")
    }
    // digitalização de obra fica em "acervo/"; de pasta histórica, em "documentos/"
    const pasta = livroId ? "acervo/" : "documentos/"
    if (!arq.chave_storage.startsWith(pasta)) {
      throw new ErroRegra(400, "O arquivo foi enviado para outra pasta. Envie-o novamente.")
    }

    await c.query(
      `INSERT INTO documento_digital (titulo, formato, descricao, arquivo_id, livro_id, pasta_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [titulo, formato, descricao, arquivoId, livroId, pastaId],
    )
    return (await c.query<LinhaDocumento>(`${SQL_DOCUMENTO} WHERE a.id = $1`, [arquivoId])).rows[0]
  })
  res.status(201).json({
    ok: true,
    mensagem: "Arquivo anexado e comprimido para armazenamento (RNF13).",
    documento: documentoJson(documento),
  })
})

// DELETE /api/documentos/:arquivoId  (apaga o documento, o arquivo e o objeto no armazenamento)
rotasRepositorio.delete("/documentos/:id", async (req, res) => {
  const id = idDe(req, "Arquivo não encontrado no repositório.")
  const chaves = await emTransacao(async (c) => {
    const d = await c.query("DELETE FROM documento_digital WHERE arquivo_id = $1", [id])
    if (d.rowCount === 0) throw new ErroRegra(404, "Arquivo não encontrado no repositório.")
    return apagarArquivosDoBanco(c, [id])
  })
  for (const chave of chaves) await apagarObjeto(chave)
  res.json({ ok: true, mensagem: "Arquivo removido do repositório." })
})

// POST /api/pastas  { "nome": "...", "descricao": "..." }
rotasRepositorio.post("/pastas", async (req, res) => {
  const d = validarPasta(corpoDe(req))
  const { rows } = await pool.query(
    "INSERT INTO pasta_historica (nome, descricao) VALUES ($1, $2) RETURNING id, nome, descricao",
    [d.nome, d.descricao],
  )
  res.status(201).json({ ok: true, mensagem: "Pasta de recortes cadastrada.", pasta: rows[0] })
})

// PUT /api/pastas/:id
rotasRepositorio.put("/pastas/:id", async (req, res) => {
  const id = idDe(req, "Pasta não encontrada.")
  const d = validarPasta(corpoDe(req))
  const { rows } = await pool.query(
    "UPDATE pasta_historica SET nome = $1, descricao = $2 WHERE id = $3 RETURNING id, nome, descricao",
    [d.nome, d.descricao, id],
  )
  if (!rows[0]) throw new ErroRegra(404, "Pasta não encontrada.")
  res.json({ ok: true, mensagem: "Pasta atualizada.", pasta: rows[0] })
})

// DELETE /api/pastas/:id  (só sem documentos: documento_digital apaga em cascata)
rotasRepositorio.delete("/pastas/:id", async (req, res) => {
  const id = idDe(req, "Pasta não encontrada.")
  await emTransacao(async (c) => {
    const p = await c.query("SELECT 1 FROM pasta_historica WHERE id = $1 FOR UPDATE", [id])
    if (p.rowCount === 0) throw new ErroRegra(404, "Pasta não encontrada.")
    const docs = await c.query("SELECT 1 FROM documento_digital WHERE pasta_id = $1 LIMIT 1", [id])
    if (docs.rowCount) throw new ErroRegra(409, "A pasta possui arquivos. Remova-os antes de excluir a pasta.")
    await c.query("DELETE FROM pasta_historica WHERE id = $1", [id])
  })
  res.json({ ok: true, mensagem: "Pasta excluída." })
})

rotasRepositorio.use((erro: unknown, req: Request, res: Response, next: NextFunction) => {
  if (erro instanceof pg.DatabaseError && erro.code === "23505" && erro.constraint === "pasta_historica_nome_key") {
    res.status(409).json({ ok: false, mensagem: "Já existe uma pasta com este nome." })
    return
  }
  tratarErroDeRegra(erro, req, res, next)
})
