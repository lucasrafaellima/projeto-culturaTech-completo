import express, { Router, type NextFunction, type Request, type Response } from "express"
import pg from "pg"
import { pool } from "./db.ts"
import { exigirAdmin, type UsuarioLogado } from "./auth.ts"
import { ErroRegra, corpoDe, emTransacao, idDe, texto, tratarErroDeRegra } from "./comum.ts"

// Rotas do acervo (RF01 / RF16), só para administradores (RN15).
// Mesmas regras e mensagens das ações salvarLivro, excluirLivro,
// adicionarExemplares, editarExemplar, excluirExemplar e desbastarExemplar
// de src/lib/store.tsx.

const CATEGORIAS = ["literatura", "infantil", "didatico", "historia", "ciencias", "cordel", "raro", "exemplar_unico"]
const STATUS = ["disponivel", "reservado", "em_restauro", "indisponivel", "extraviado", "ocioso", "danificado"]
const STATUS_DESBASTAVEIS = ["ocioso", "danificado"] // RN31
const MIN_RELATORIO = 20 // RN24
const MAX_EXEMPLARES_POR_VEZ = 100
const MAX_OBRAS_IMPORTACAO = 1000
const LIMITE_CORPO_IMPORTACAO = "2mb"

const labelStatus: Record<string, string> = {
  disponivel: "Disponível",
  reservado: "Reservado",
  em_restauro: "Em restauro",
  indisponivel: "Indisponível",
  extraviado: "Extraviado",
  ocioso: "Ocioso",
  danificado: "Danificado",
}

const normalizar = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()

// ISBN-10 ou ISBN-13 com dígito verificador (igual a src/lib/utils.ts)
function isbnValido(valor: string): boolean {
  const isbn = valor.replace(/[-\s]/g, "").toUpperCase()
  if (/^\d{13}$/.test(isbn)) {
    const soma = isbn
      .slice(0, 12)
      .split("")
      .reduce((acc, n, i) => acc + Number(n) * (i % 2 === 0 ? 1 : 3), 0)
    return (10 - (soma % 10)) % 10 === Number(isbn[12])
  }
  if (/^\d{9}[\dX]$/.test(isbn)) {
    const soma = isbn.split("").reduce((acc, c, i) => acc + (c === "X" ? 10 : Number(c)) * (10 - i), 0)
    return soma % 11 === 0
  }
  return false
}

// ------------------------------------------------------------
// Consultas e formato das respostas (nomes de src/lib/types.ts)
// ------------------------------------------------------------
const SQL_LIVRO = `
  SELECT l.id, l.titulo, l.editora, l.edicao, l.ano, l.categoria, l.secao, l.isbn, l.sinopse,
         COALESCE((SELECT json_agg(json_build_object('id', a.id, 'nome', a.nome) ORDER BY la.ordem)
                     FROM livro_autor la JOIN autor a ON a.id = la.autor_id
                    WHERE la.livro_id = l.id), '[]') AS autores,
         (SELECT count(*)::int FROM exemplar e
           WHERE e.livro_id = l.id AND e.baixa_data IS NULL) AS exemplares_no_acervo
    FROM livro l`

interface LinhaLivro {
  id: string
  titulo: string
  editora: string
  edicao: string
  ano: number
  categoria: string
  secao: string
  isbn: string | null
  sinopse: string | null
  autores: { id: string; nome: string }[]
  exemplares_no_acervo: number
}

const livroJson = (l: LinhaLivro) => ({
  id: l.id,
  titulo: l.titulo,
  autores: l.autores,
  editora: l.editora,
  edicao: l.edicao,
  ano: l.ano,
  categoria: l.categoria,
  secao: l.secao,
  isbn: l.isbn ?? "",
  sinopse: l.sinopse ?? undefined,
  exemplaresNoAcervo: l.exemplares_no_acervo,
})

const COLUNAS_EXEMPLAR = `id, livro_id, tombamento, status, localizacao,
         to_char(data_entrada, 'YYYY-MM-DD') AS data_entrada,
         to_char(baixa_data, 'YYYY-MM-DD') AS baixa_data, baixa_motivo`
const SQL_EXEMPLAR = `SELECT ${COLUNAS_EXEMPLAR} FROM exemplar`

interface LinhaExemplar {
  id: string
  livro_id: string
  tombamento: string
  status: string
  localizacao: string | null
  data_entrada: string
  baixa_data: string | null
  baixa_motivo: "desbaste" | "doacao" | null
}

const exemplarJson = (e: LinhaExemplar) => ({
  id: e.id,
  livroId: e.livro_id,
  tombamento: e.tombamento,
  status: e.status,
  ...(e.localizacao ? { localizacao: e.localizacao } : {}),
  dataEntrada: e.data_entrada,
  ...(e.baixa_data && e.baixa_motivo ? { baixa: { data: e.baixa_data, motivo: e.baixa_motivo } } : {}),
})

// Localização física da cópia (US03): opcional; vazio vira NULL
function validarLocalizacao(bruto: unknown): string | null {
  const v = texto(bruto)
  if (v.length > 80) throw new ErroRegra(400, "Localização muito longa (máximo de 80 caracteres).")
  return v || null
}

async function buscarLivro(c: pg.PoolClient | pg.Pool, id: string) {
  const { rows } = await c.query<LinhaLivro>(`${SQL_LIVRO} WHERE l.id = $1`, [id])
  return rows[0] ? livroJson(rows[0]) : null
}

// ------------------------------------------------------------
// Validação da obra (salvarLivro)
// ------------------------------------------------------------
interface DadosLivro {
  titulo: string
  autores: string[]
  editora: string
  edicao: string
  ano: number
  categoria: string
  secao: string
  isbn: string
  sinopse: string | null
}

function validarLivro(corpo: Record<string, unknown>): DadosLivro {
  const titulo = texto(corpo.titulo)
  if (!titulo) throw new ErroRegra(400, "Informe o título da obra.")
  if (titulo.length > 300) throw new ErroRegra(400, "Título muito longo (máximo de 300 caracteres).")

  // RN18 / RN19: um ou mais autores, sem repetir, na ordem informada
  const autores = (Array.isArray(corpo.autores) ? corpo.autores : []).map(texto).filter(Boolean)
  if (autores.length === 0) throw new ErroRegra(400, "Informe ao menos um autor.")
  if (autores.some((n) => n.length < 3)) {
    throw new ErroRegra(400, "Cada autor deve ter o nome completo (mínimo 3 caracteres).")
  }
  if (autores.some((n) => n.length > 150)) throw new ErroRegra(400, "Nome de autor muito longo (máximo de 150 caracteres).")
  if (new Set(autores.map(normalizar)).size !== autores.length) {
    throw new ErroRegra(400, "O mesmo autor foi informado mais de uma vez para a obra (RN19).")
  }

  const editora = texto(corpo.editora)
  if (!editora) throw new ErroRegra(400, "Informe a editora.")
  if (editora.length > 150) throw new ErroRegra(400, "Editora muito longa (máximo de 150 caracteres).")
  const edicao = texto(corpo.edicao)
  if (!edicao) throw new ErroRegra(400, "Informe a edição.")
  if (edicao.length > 30) throw new ErroRegra(400, "Edição muito longa (máximo de 30 caracteres).")

  const ano = typeof corpo.ano === "number" ? corpo.ano : Number(texto(corpo.ano) || NaN)
  const anoAtual = new Date().getFullYear()
  if (!Number.isInteger(ano) || ano < 1400 || ano > anoAtual) {
    throw new ErroRegra(400, `Ano inválido. Informe um ano entre 1400 e ${anoAtual}.`)
  }

  const categoria = texto(corpo.categoria)
  if (!CATEGORIAS.includes(categoria)) throw new ErroRegra(400, "Categoria inválida.")

  const secao = texto(corpo.secao).toUpperCase()
  if (!/^[A-Z]$/.test(secao)) throw new ErroRegra(400, "A seção deve ser uma letra de A a Z (RN22).")

  const isbn = texto(corpo.isbn)
  if (!isbnValido(isbn) || isbn.length > 17) {
    throw new ErroRegra(400, "ISBN inválido. Confira os dígitos (ISBN-10 ou ISBN-13).")
  }

  return { titulo, autores, editora, edicao, ano, categoria, secao, isbn, sinopse: texto(corpo.sinopse) || null }
}

// Grava a obra e seus autores dentro da transação do cliente; devolve a obra salva
async function gravarLivro(c: pg.PoolClient, d: DadosLivro, id?: string) {
  // ISBN não tem índice único no banco: a trava evita duas obras com o
  // mesmo ISBN gravadas ao mesmo tempo
  const chaveIsbn = d.isbn.replace(/[-\s]/g, "").toUpperCase()
  await c.query("SELECT pg_advisory_xact_lock(hashtext('isbn:' || $1))", [chaveIsbn])
  const dup = await c.query<{ titulo: string }>(
    `SELECT titulo FROM livro
      WHERE upper(regexp_replace(isbn, '[-\\s]', '', 'g')) = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)
      LIMIT 1`,
    [chaveIsbn, id ?? null],
  )
  if (dup.rows[0]) throw new ErroRegra(409, `Já existe uma obra com este ISBN: "${dup.rows[0].titulo}".`)

  const valores = [d.titulo, d.editora, d.edicao, d.ano, d.categoria, d.secao, d.isbn, d.sinopse]
  let livroId: string
  if (id) {
    const r = await c.query(
      `UPDATE livro SET titulo = $1, editora = $2, edicao = $3, ano = $4, categoria = $5,
                        secao = $6, isbn = $7, sinopse = $8
        WHERE id = $9`,
      [...valores, id],
    )
    if (r.rowCount === 0) throw new ErroRegra(404, "Obra não encontrada.")
    livroId = id
    await c.query("DELETE FROM livro_autor WHERE livro_id = $1", [livroId])
  } else {
    const r = await c.query<{ id: string }>(
      `INSERT INTO livro (titulo, editora, edicao, ano, categoria, secao, isbn, sinopse)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      valores,
    )
    livroId = r.rows[0].id
  }

  // reaproveita autores já cadastrados (evita duplicidade no catálogo)
  for (const [i, nome] of d.autores.entries()) {
    const existente = await c.query<{ id: string }>(
      "SELECT id FROM autor WHERE lower(nome) = lower($1) ORDER BY id LIMIT 1",
      [nome],
    )
    const autorId =
      existente.rows[0]?.id ??
      (await c.query<{ id: string }>("INSERT INTO autor (nome) VALUES ($1) RETURNING id", [nome])).rows[0].id
    await c.query("INSERT INTO livro_autor (livro_id, autor_id, ordem) VALUES ($1, $2, $3)", [livroId, autorId, i + 1])
  }

  return (await buscarLivro(c, livroId))!
}

const salvarLivro = (d: DadosLivro, id?: string) => emTransacao((c) => gravarLivro(c, d, id))

// Valida a lista de tombamentos (maiúsculas, sem vazios nem repetidos)
function validarTombamentos(brutos: unknown): string[] {
  const lista = (Array.isArray(brutos) ? brutos : []).map((t) => texto(t).toUpperCase()).filter(Boolean)
  if (lista.length === 0) throw new ErroRegra(400, "Informe ao menos um código de tombamento.")
  if (lista.length > MAX_EXEMPLARES_POR_VEZ) {
    throw new ErroRegra(400, `Cadastre no máximo ${MAX_EXEMPLARES_POR_VEZ} exemplares por vez.`)
  }
  if (lista.some((t) => t.length > 30)) throw new ErroRegra(400, "Código de tombamento muito longo (máximo de 30 caracteres).")
  if (new Set(lista).size !== lista.length) throw new ErroRegra(400, "Há códigos de tombamento repetidos na lista.")
  return lista
}

// Insere os exemplares de uma obra dentro da transação do cliente
async function gravarExemplares(c: pg.PoolClient, livroId: string, lista: string[], localizacao: string | null = null) {
  const livro = await c.query("SELECT 1 FROM livro WHERE id = $1", [livroId])
  if (livro.rowCount === 0) {
    throw new ErroRegra(404, "Não é possível cadastrar o exemplar: a obra não está cadastrada (RN16).")
  }
  const emUso = await c.query<{ tombamento: string }>(
    "SELECT tombamento FROM exemplar WHERE upper(tombamento) = ANY($1::text[]) LIMIT 1",
    [lista],
  )
  if (emUso.rows[0]) throw new ErroRegra(409, `O tombamento ${emUso.rows[0].tombamento} já pertence a outro exemplar.`)
  // o id (UUID) é gerado pelo banco (RN20)
  const { rows } = await c.query<LinhaExemplar>(
    `INSERT INTO exemplar (livro_id, tombamento, localizacao)
     SELECT $1, t, $3 FROM unnest($2::text[]) WITH ORDINALITY AS u(t, n) ORDER BY n
     RETURNING ${COLUNAS_EXEMPLAR}`,
    [livroId, lista, localizacao],
  )
  return rows
}

// ------------------------------------------------------------
// Rotas
// ------------------------------------------------------------
export const rotasAcervo = Router()

const SQL_AUTORES = "SELECT id, nome FROM autor ORDER BY lower(nome)"
const SQL_LIVROS_ESTADO = `
  SELECT l.id, l.titulo, l.editora, l.edicao, l.ano, l.categoria, l.secao, l.isbn, l.sinopse,
         COALESCE((SELECT array_agg(la.autor_id ORDER BY la.ordem) FROM livro_autor la WHERE la.livro_id = l.id),
                  '{}') AS "autorIds"
    FROM livro l ORDER BY lower(l.titulo)`
const livroEstado = (l: Record<string, unknown>) => ({ ...l, isbn: l.isbn ?? "", sinopse: l.sinopse ?? undefined })

// GET /api/acervo/publico  (consulta pública, sem login: RN30 mascara os status
// internos e os exemplares baixados não aparecem, como em vw_consulta_publica)
rotasAcervo.get("/acervo/publico", async (_req, res) => {
  const [autores, livros, exemplares] = await Promise.all([
    pool.query(SQL_AUTORES),
    pool.query(SQL_LIVROS_ESTADO),
    pool.query(
      `SELECT exemplar_id AS id, livro_id AS "livroId", tombamento, status
         FROM vw_consulta_publica ORDER BY tombamento`,
    ),
  ])
  res.json({
    ok: true,
    autores: autores.rows,
    livros: livros.rows.map(livroEstado),
    exemplares: exemplares.rows,
    desbastes: [],
  })
})

rotasAcervo.use(["/acervo", "/livros", "/exemplares", "/desbastes"], exigirAdmin)

// GET /api/acervo  (o acervo inteiro, no formato do estado do front-end)
rotasAcervo.get("/acervo", async (_req, res) => {
  const [autores, livros, exemplares, desbastes] = await Promise.all([
    pool.query(SQL_AUTORES),
    pool.query(SQL_LIVROS_ESTADO),
    pool.query<LinhaExemplar>(`${SQL_EXEMPLAR} ORDER BY tombamento`),
    pool.query(
      `SELECT d.id, d.exemplar_id AS "exemplarId", e.livro_id AS "livroId", e.tombamento,
              d.status_anterior AS "statusAnterior", d.relatorio, to_char(d.data, 'YYYY-MM-DD') AS data,
              a.nome AS admin
         FROM desbaste d JOIN exemplar e ON e.id = d.exemplar_id
         LEFT JOIN administrador a ON a.id = d.admin_id
        ORDER BY d.data DESC, e.tombamento`,
    ),
  ])
  res.json({
    ok: true,
    autores: autores.rows,
    livros: livros.rows.map(livroEstado),
    exemplares: exemplares.rows.map(exemplarJson),
    desbastes: desbastes.rows.map(({ admin, ...d }) => (admin ? { ...d, admin } : d)),
  })
})

// GET /api/livros?busca=&categoria=
rotasAcervo.get("/livros", async (req, res) => {
  const busca = texto(req.query.busca)
  const categoria = texto(req.query.categoria)
  const filtros: string[] = []
  const valores: unknown[] = []
  if (busca) {
    valores.push(`%${busca.replace(/[\\%_]/g, "\\$&")}%`)
    const p = `$${valores.length}`
    filtros.push(`(l.titulo ILIKE ${p} OR l.isbn ILIKE ${p} OR EXISTS (
      SELECT 1 FROM livro_autor la JOIN autor a ON a.id = la.autor_id
       WHERE la.livro_id = l.id AND a.nome ILIKE ${p}))`)
  }
  if (categoria) {
    valores.push(categoria)
    filtros.push(`l.categoria = $${valores.length}`)
  }
  const where = filtros.length ? `WHERE ${filtros.join(" AND ")}` : ""
  const { rows } = await pool.query<LinhaLivro>(`${SQL_LIVRO} ${where} ORDER BY lower(l.titulo)`, valores)
  res.json({ ok: true, livros: rows.map(livroJson) })
})

// GET /api/livros/:id  (com os exemplares, inclusive os baixados)
rotasAcervo.get("/livros/:id", async (req, res) => {
  const id = idDe(req, "Obra não encontrada.")
  const livro = await buscarLivro(pool, id)
  if (!livro) throw new ErroRegra(404, "Obra não encontrada.")
  const { rows } = await pool.query<LinhaExemplar>(`${SQL_EXEMPLAR} WHERE livro_id = $1 ORDER BY tombamento`, [id])
  res.json({ ok: true, livro: { ...livro, exemplares: rows.map(exemplarJson) } })
})

// POST /api/livros
rotasAcervo.post("/livros", async (req, res) => {
  const livro = await salvarLivro(validarLivro(corpoDe(req)))
  res.status(201).json({ ok: true, mensagem: "Obra cadastrada. Agora cadastre os exemplares (RN16).", livro })
})

// POST /api/livros/importar  { "obras": [{ ...obra, "tombamentos": [...], "linha"?: 2 }] }
// Importação em lote (RN21 / RNF03): tudo ou nada, numa única transação
rotasAcervo.post("/livros/importar", express.json({ limit: LIMITE_CORPO_IMPORTACAO }), async (req, res) => {
  const brutas = corpoDe(req).obras
  if (!Array.isArray(brutas) || brutas.length === 0) throw new ErroRegra(400, "Nenhuma obra para importar.")
  if (brutas.length > MAX_OBRAS_IMPORTACAO) {
    throw new ErroRegra(400, `Importe no máximo ${MAX_OBRAS_IMPORTACAO} obras por vez.`)
  }

  const resultado = await emTransacao(async (c) => {
    const livros = []
    const exemplares = []
    for (const [i, bruta] of brutas.entries()) {
      const item = (typeof bruta === "object" && bruta !== null ? bruta : {}) as Record<string, unknown>
      const linha = Number.isInteger(item.linha) ? Number(item.linha) : i + 1
      try {
        const livro = await gravarLivro(c, validarLivro(item))
        const novos = await gravarExemplares(c, livro.id, validarTombamentos(item.tombamentos))
        livros.push(livro)
        exemplares.push(...novos)
      } catch (erro) {
        if (erro instanceof ErroRegra) throw new ErroRegra(erro.status, `Linha ${linha}: ${erro.message}`)
        throw erro
      }
    }
    return { livros, exemplares }
  })
  res.status(201).json({
    ok: true,
    mensagem: `${resultado.livros.length} obra(s) e ${resultado.exemplares.length} exemplar(es) importados.`,
    livros: resultado.livros,
    exemplares: resultado.exemplares.map(exemplarJson),
  })
})

// PUT /api/livros/:id
rotasAcervo.put("/livros/:id", async (req, res) => {
  const id = idDe(req, "Obra não encontrada.")
  const livro = await salvarLivro(validarLivro(corpoDe(req)), id)
  res.json({ ok: true, mensagem: "Obra atualizada.", livro })
})

// DELETE /api/livros/:id
rotasAcervo.delete("/livros/:id", async (req, res) => {
  const id = idDe(req, "Obra não encontrada.")
  await emTransacao(async (c) => {
    const livro = await c.query("SELECT 1 FROM livro WHERE id = $1 FOR UPDATE", [id])
    if (livro.rowCount === 0) throw new ErroRegra(404, "Obra não encontrada.")

    const { rows } = await c.query<{ no_acervo: number; baixados: number; doacoes: boolean; arquivos: boolean }>(
      `SELECT (SELECT count(*)::int FROM exemplar WHERE livro_id = $1 AND baixa_data IS NULL) AS no_acervo,
              (SELECT count(*)::int FROM exemplar WHERE livro_id = $1 AND baixa_data IS NOT NULL) AS baixados,
              EXISTS (SELECT 1 FROM movimentacao WHERE livro_id = $1) AS doacoes,
              EXISTS (SELECT 1 FROM documento_digital WHERE livro_id = $1) AS arquivos`,
      [id],
    )
    const s = rows[0]
    if (s.no_acervo > 0) {
      throw new ErroRegra(409, "A obra possui exemplares no acervo. Desbaste ou exclua os exemplares antes.")
    }
    // exemplares baixados guardam o histórico de empréstimos, desbastes e doações
    if (s.baixados > 0 || s.doacoes) {
      throw new ErroRegra(409, "A obra tem histórico de empréstimos ou doações e não pode ser excluída.")
    }
    // documento_digital tem ON DELETE CASCADE: sem esta checagem os arquivos sumiriam junto
    if (s.arquivos) {
      throw new ErroRegra(409, "Há digitalizações vinculadas a esta obra no repositório. Remova-as antes.")
    }
    await c.query("DELETE FROM livro WHERE id = $1", [id])
  })
  res.json({ ok: true, mensagem: "Obra excluída." })
})

// POST /api/livros/:id/exemplares  { "tombamentos": ["BMA-0001", ...], "localizacao"?: "Estante 3" }
rotasAcervo.post("/livros/:id/exemplares", async (req, res) => {
  const livroId = idDe(req, "Não é possível cadastrar o exemplar: a obra não está cadastrada (RN16).")
  const corpo = corpoDe(req)
  const lista = validarTombamentos(corpo.tombamentos)
  const localizacao = validarLocalizacao(corpo.localizacao)
  const novos = await emTransacao((c) => gravarExemplares(c, livroId, lista, localizacao))
  res.status(201).json({
    ok: true,
    mensagem: `${novos.length} exemplar(es) cadastrado(s) com identificador único (UUID).`,
    exemplares: novos.map(exemplarJson),
  })
})

// PATCH /api/exemplares/:id  { "tombamento"?: "...", "status"?: "...", "localizacao"?: "..." }  (RN12)
rotasAcervo.patch("/exemplares/:id", async (req, res) => {
  const id = idDe(req, "Exemplar não encontrado.")
  const corpo = corpoDe(req)
  const novoTomb = corpo.tombamento === undefined ? undefined : texto(corpo.tombamento).toUpperCase()
  const novoStatus = corpo.status === undefined ? undefined : texto(corpo.status)
  const novaLocalizacao = corpo.localizacao === undefined ? undefined : validarLocalizacao(corpo.localizacao)
  if (novoTomb === undefined && novoStatus === undefined && novaLocalizacao === undefined) {
    throw new ErroRegra(400, "Informe o tombamento, o status ou a localização.")
  }
  if (novoTomb !== undefined) {
    if (!novoTomb) throw new ErroRegra(400, "Informe o código de tombamento.")
    if (novoTomb.length > 30) throw new ErroRegra(400, "Código de tombamento muito longo (máximo de 30 caracteres).")
  }
  if (novoStatus !== undefined && !STATUS.includes(novoStatus)) throw new ErroRegra(400, "Status inválido.")

  const exemplar = await emTransacao(async (c) => {
    const atual = (await c.query<LinhaExemplar>(`${SQL_EXEMPLAR} WHERE id = $1 FOR UPDATE`, [id])).rows[0]
    if (!atual) throw new ErroRegra(404, "Exemplar não encontrado.")
    if (atual.baixa_data) {
      throw new ErroRegra(409, "Exemplar baixado do acervo (desbaste ou doação) não pode ser alterado.")
    }

    const tombamento = novoTomb ?? atual.tombamento
    if (novoTomb !== undefined) {
      const emUso = await c.query("SELECT 1 FROM exemplar WHERE upper(tombamento) = $1 AND id <> $2", [novoTomb, id])
      if (emUso.rowCount) throw new ErroRegra(409, `O tombamento ${novoTomb} já pertence a outro exemplar.`)
    }

    const status = novoStatus ?? atual.status
    if (status !== atual.status) {
      const { rows } = await c.query<{ emprestado: boolean; reservado: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM emprestimo WHERE exemplar_id = $1 AND status = 'ativo') AS emprestado,
                EXISTS (SELECT 1 FROM reserva WHERE exemplar_id = $1 AND status = 'ativa') AS reservado`,
        [id],
      )
      if (rows[0].emprestado) {
        throw new ErroRegra(409, "O exemplar está emprestado. O status muda automaticamente na devolução.")
      }
      if (rows[0].reservado) {
        throw new ErroRegra(409, "O exemplar está reservado. Cancele a reserva antes de alterar o status.")
      }
      if (status === "reservado") {
        throw new ErroRegra(400, 'O status "Reservado" é definido pela reserva de um sócio-leitor.')
      }
    }

    const localizacao = novaLocalizacao === undefined ? atual.localizacao : novaLocalizacao
    await c.query("UPDATE exemplar SET tombamento = $1, status = $2, localizacao = $3 WHERE id = $4", [
      tombamento,
      status,
      localizacao,
      id,
    ])
    return (await c.query<LinhaExemplar>(`${SQL_EXEMPLAR} WHERE id = $1`, [id])).rows[0]
  })
  res.json({ ok: true, mensagem: "Exemplar atualizado.", exemplar: exemplarJson(exemplar) })
})

// DELETE /api/exemplares/:id  (cadastro feito por engano, sem histórico)
rotasAcervo.delete("/exemplares/:id", async (req, res) => {
  const id = idDe(req, "Exemplar não encontrado.")
  await emTransacao(async (c) => {
    const ex = await c.query("SELECT 1 FROM exemplar WHERE id = $1 FOR UPDATE", [id])
    if (ex.rowCount === 0) throw new ErroRegra(404, "Exemplar não encontrado.")
    const { rows } = await c.query<{ historico: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM emprestimo WHERE exemplar_id = $1)
           OR EXISTS (SELECT 1 FROM reserva WHERE exemplar_id = $1)
           OR EXISTS (SELECT 1 FROM desbaste WHERE exemplar_id = $1)
           OR EXISTS (SELECT 1 FROM movimentacao_exemplar WHERE exemplar_id = $1) AS historico`,
      [id],
    )
    if (rows[0].historico) {
      throw new ErroRegra(409, "O exemplar tem histórico de circulação. Para retirá-lo do acervo, use o desbastamento.")
    }
    await c.query("DELETE FROM exemplar WHERE id = $1", [id])
  })
  res.json({ ok: true, mensagem: "Exemplar excluído (cadastro feito por engano)." })
})

// POST /api/exemplares/:id/desbaste  { "relatorio": "..." }  (RN24 / RN31)
rotasAcervo.post("/exemplares/:id/desbaste", async (req, res) => {
  const id = idDe(req, "Exemplar não encontrado no acervo.")
  const relatorio = texto(corpoDe(req).relatorio)
  const admin = res.locals.usuario as UsuarioLogado

  const resultado = await emTransacao(async (c) => {
    const ex = (await c.query<LinhaExemplar>(`${SQL_EXEMPLAR} WHERE id = $1 FOR UPDATE`, [id])).rows[0]
    if (!ex || ex.baixa_data) throw new ErroRegra(404, "Exemplar não encontrado no acervo.")
    // RN31: somente ociosos ou danificados
    if (!STATUS_DESBASTAVEIS.includes(ex.status)) {
      throw new ErroRegra(
        409,
        `Somente exemplares ociosos ou danificados podem ser desbastados (RN31). Status atual: ${labelStatus[ex.status]}.`,
      )
    }
    // RN24: relatório justificando a decisão
    if (relatorio.length < MIN_RELATORIO) {
      throw new ErroRegra(400, `Anexe o relatório justificando o desbastamento (mínimo ${MIN_RELATORIO} caracteres) (RN24).`)
    }
    const d = await c.query<{ id: string; data: string }>(
      `INSERT INTO desbaste (exemplar_id, admin_id, status_anterior, relatorio)
       VALUES ($1, $2, $3, $4) RETURNING id, to_char(data, 'YYYY-MM-DD') AS data`,
      [id, admin.id, ex.status, relatorio],
    )
    // o exemplar não é apagado: fica baixado, para manter o histórico
    await c.query("UPDATE exemplar SET baixa_data = CURRENT_DATE, baixa_motivo = 'desbaste' WHERE id = $1", [id])
    return {
      tombamento: ex.tombamento,
      desbaste: {
        id: d.rows[0].id,
        exemplarId: id,
        livroId: ex.livro_id,
        tombamento: ex.tombamento,
        statusAnterior: ex.status,
        relatorio,
        data: d.rows[0].data,
        admin: admin.nome,
      },
    }
  })
  res.status(201).json({
    ok: true,
    mensagem: `Exemplar ${resultado.tombamento} desbastado. O relatório foi registrado.`,
    desbaste: resultado.desbaste,
  })
})

// GET /api/desbastes  (relatório)
rotasAcervo.get("/desbastes", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT d.id, d.exemplar_id AS "exemplarId", e.livro_id AS "livroId", l.titulo, e.tombamento,
            d.status_anterior AS "statusAnterior", d.relatorio, to_char(d.data, 'YYYY-MM-DD') AS data,
            a.nome AS admin
       FROM desbaste d
       JOIN exemplar e ON e.id = d.exemplar_id
       JOIN livro l ON l.id = e.livro_id
       LEFT JOIN administrador a ON a.id = d.admin_id
      ORDER BY d.data DESC, l.titulo`,
  )
  res.json({ ok: true, desbastes: rows })
})

// Erros de regra viram { ok: false, mensagem }; os demais seguem para o
// tratador geral (500)
rotasAcervo.use((erro: unknown, req: Request, res: Response, next: NextFunction) => {
  // tombamento repetido gravado por duas requisições ao mesmo tempo
  if (erro instanceof pg.DatabaseError && erro.code === "23505" && erro.constraint === "exemplar_tombamento_key") {
    res.status(409).json({ ok: false, mensagem: "O tombamento informado já pertence a outro exemplar." })
    return
  }
  tratarErroDeRegra(erro, req, res, next)
})
