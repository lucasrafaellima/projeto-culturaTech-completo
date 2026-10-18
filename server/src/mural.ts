import { Router } from "express"
import type pg from "pg"
import { pool } from "./db.ts"
import { exigirAdmin, type UsuarioLogado } from "./auth.ts"
import { apagarArquivosDoBanco, apagarObjeto } from "./arquivos.ts"
import { ErroRegra, UUID, corpoDe, emTransacao, idDe, texto, tratarErroDeRegra } from "./comum.ts"

// Mural digital (RF12): notícias, eventos e novidades literárias. Leitura pública;
// cadastro, edição e exclusão só pelo administrador. Mesmas regras e mensagens de
// salvarPublicacao e excluirPublicacao (src/lib/store.tsx). As imagens ficam no
// armazenamento (S3) e são ligadas à publicação por publicacao_imagem.

const TIPOS = ["noticia", "evento", "novidade"]
const MAX_IMAGENS = 10

type Consulta = pg.PoolClient | pg.Pool

// Formato de Publicacao (src/lib/types.ts)
async function listarPublicacoes(c: Consulta, filtro = "TRUE", valores: unknown[] = []) {
  const { rows } = await c.query(
    `SELECT p.id, p.tipo, p.titulo, p.descricao, to_char(p.data, 'YYYY-MM-DD') AS data,
            COALESCE((SELECT array_agg(i.arquivo_id ORDER BY i.ordem) FROM publicacao_imagem i
                       WHERE i.publicacao_id = p.id), '{}') AS "imagemIds"
       FROM publicacao p WHERE ${filtro}
      ORDER BY p.data DESC, p.titulo`,
    valores,
  )
  return rows
}

interface DadosPublicacao {
  tipo: string
  titulo: string
  descricao: string
  data: string
  imagemIds: string[]
}

function validar(corpo: Record<string, unknown>): DadosPublicacao {
  const tipo = texto(corpo.tipo)
  if (!TIPOS.includes(tipo)) throw new ErroRegra(400, "Tipo de publicação inválido.")
  const titulo = texto(corpo.titulo)
  if (titulo.length < 3) throw new ErroRegra(400, "Informe o título da publicação.")
  if (titulo.length > 200) throw new ErroRegra(400, "Título muito longo (máximo de 200 caracteres).")
  const descricao = texto(corpo.descricao)
  if (descricao.length > 10_000) throw new ErroRegra(400, "Descrição muito longa (máximo de 10.000 caracteres).")
  const imagemIds = (Array.isArray(corpo.imagemIds) ? corpo.imagemIds : []).map(texto)
  if (imagemIds.length > MAX_IMAGENS) throw new ErroRegra(400, `Anexe no máximo ${MAX_IMAGENS} imagens.`)
  if (imagemIds.some((i) => !UUID.test(i)) || new Set(imagemIds).size !== imagemIds.length) {
    throw new ErroRegra(400, "Imagem inválida. Envie as imagens novamente.")
  }
  // RF12: descrição e/ou imagem
  if (!descricao && imagemIds.length === 0) throw new ErroRegra(400, "Informe uma descrição e/ou anexe imagem(ns).")
  const data = texto(corpo.data)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(Date.parse(`${data}T00:00:00Z`))) {
    throw new ErroRegra(400, "Informe a data da publicação ou do evento.")
  }
  return { tipo, titulo, descricao, data, imagemIds }
}

// As imagens precisam ser arquivos de imagem já enviados e livres (ou já desta publicação)
async function conferirImagens(c: pg.PoolClient, ids: string[], publicacaoId: string | null) {
  if (ids.length === 0) return
  const { rows } = await c.query<{ id: string; livre: boolean }>(
    `SELECT a.id,
            NOT (EXISTS (SELECT 1 FROM documento_digital WHERE arquivo_id = a.id)
              OR EXISTS (SELECT 1 FROM socio_leitor WHERE foto_arquivo_id = a.id)
              OR EXISTS (SELECT 1 FROM ocorrencia_dano_imagem WHERE arquivo_id = a.id)
              OR EXISTS (SELECT 1 FROM publicacao_imagem
                          WHERE arquivo_id = a.id AND publicacao_id IS DISTINCT FROM $2::uuid)) AS livre
       FROM arquivo a
      WHERE a.id = ANY($1::uuid[]) AND a.mime LIKE 'image/%'
        -- imagem nova vem da pasta "mural/"; as que a publicação já tem continuam valendo
        AND (a.chave_storage LIKE 'mural/%'
             OR EXISTS (SELECT 1 FROM publicacao_imagem WHERE arquivo_id = a.id AND publicacao_id = $2::uuid))`,
    [ids, publicacaoId],
  )
  if (rows.length !== ids.length || rows.some((r) => !r.livre)) {
    throw new ErroRegra(400, "Imagem inválida. Envie as imagens novamente.")
  }
}

async function gravarImagens(c: pg.PoolClient, publicacaoId: string, ids: string[]) {
  await c.query("DELETE FROM publicacao_imagem WHERE publicacao_id = $1", [publicacaoId])
  for (const [i, arquivoId] of ids.entries()) {
    await c.query("INSERT INTO publicacao_imagem (publicacao_id, arquivo_id, ordem) VALUES ($1, $2, $3)", [
      publicacaoId,
      arquivoId,
      i + 1,
    ])
  }
}

export const rotasMural = Router()

// GET /api/mural  (público, RF12: o mural é visto sem login)
rotasMural.get("/mural", async (_req, res) => {
  res.json({ ok: true, publicacoes: await listarPublicacoes(pool) })
})

rotasMural.use("/publicacoes", exigirAdmin)

// POST /api/publicacoes  { tipo, titulo, descricao, data, imagemIds }
rotasMural.post("/publicacoes", async (req, res) => {
  const d = validar(corpoDe(req))
  const admin = res.locals.usuario as UsuarioLogado
  const publicacao = await emTransacao(async (c) => {
    await conferirImagens(c, d.imagemIds, null)
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO publicacao (tipo, titulo, descricao, data, admin_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [d.tipo, d.titulo, d.descricao, d.data, admin.id],
    )
    await gravarImagens(c, rows[0].id, d.imagemIds)
    return (await listarPublicacoes(c, "p.id = $1", [rows[0].id]))[0]
  })
  res.status(201).json({ ok: true, mensagem: "Publicação adicionada ao mural.", publicacao })
})

// PUT /api/publicacoes/:id  (as imagens retiradas da publicação são apagadas)
rotasMural.put("/publicacoes/:id", async (req, res) => {
  const id = idDe(req, "Publicação não encontrada.")
  const d = validar(corpoDe(req))
  const r = await emTransacao(async (c) => {
    const p = await c.query("SELECT 1 FROM publicacao WHERE id = $1 FOR UPDATE", [id])
    if (p.rowCount === 0) throw new ErroRegra(404, "Publicação não encontrada.")
    const antes = (
      await c.query<{ arquivo_id: string }>("SELECT arquivo_id FROM publicacao_imagem WHERE publicacao_id = $1", [id])
    ).rows.map((x) => x.arquivo_id)
    await conferirImagens(c, d.imagemIds, id)
    await c.query("UPDATE publicacao SET tipo = $2, titulo = $3, descricao = $4, data = $5 WHERE id = $1", [
      id,
      d.tipo,
      d.titulo,
      d.descricao,
      d.data,
    ])
    await gravarImagens(c, id, d.imagemIds)
    const removidas = await apagarArquivosDoBanco(c, antes.filter((a) => !d.imagemIds.includes(a)))
    return { removidas, publicacao: (await listarPublicacoes(c, "p.id = $1", [id]))[0] }
  })
  for (const chave of r.removidas) await apagarObjeto(chave)
  res.json({ ok: true, mensagem: "Publicação atualizada.", publicacao: r.publicacao })
})

// DELETE /api/publicacoes/:id  (remove também as imagens)
rotasMural.delete("/publicacoes/:id", async (req, res) => {
  const id = idDe(req, "Publicação não encontrada.")
  const imagens = await emTransacao(async (c) => {
    const ids = (
      await c.query<{ arquivo_id: string }>("SELECT arquivo_id FROM publicacao_imagem WHERE publicacao_id = $1", [id])
    ).rows.map((x) => x.arquivo_id)
    const r = await c.query("DELETE FROM publicacao WHERE id = $1", [id])
    if (r.rowCount === 0) throw new ErroRegra(404, "Publicação não encontrada.")
    return apagarArquivosDoBanco(c, ids)
  })
  for (const chave of imagens) await apagarObjeto(chave)
  res.json({ ok: true, mensagem: "Publicação removida do mural." })
})

rotasMural.use(tratarErroDeRegra)
