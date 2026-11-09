import { Router, type NextFunction, type Request, type Response } from "express"
import pg from "pg"
import { pool } from "./db.ts"
import { exigirAdmin } from "./auth.ts"
import { gravarExemplares, validarTombamentos } from "./acervo.ts"
import { cpfValido } from "./cadastro.ts"
import { ErroRegra, UUID, corpoDe, emTransacao, idDe, texto, tratarErroDeRegra } from "./comum.ts"

// Instituições e movimentações do acervo (RF13 / RN25 / RN26). Mesmas regras e mensagens de
// salvarReceptor, excluirReceptor, registrarDoacao e registrarAquisicao (src/lib/store.tsx).

type Consulta = pg.PoolClient | pg.Pool

const MAX_DOACOES_PESSOA_FISICA = 1 // RN26
const TAMANHO_OBSERVACAO = 500

function cnpjValido(cnpj: string): boolean {
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false
  const calc = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const soma = [...base].reduce((acc, n, i) => acc + Number(n) * pesos[i], 0)
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }
  return calc(cnpj.slice(0, 12)) === Number(cnpj[12]) && calc(cnpj.slice(0, 13)) === Number(cnpj[13])
}

const SQL_INSTITUICAO = "SELECT id, tipo, nome, documento, endereco, contato FROM instituicao"

// Formato de Movimentacao (src/lib/types.ts)
async function listarMovimentacoes(c: Consulta, filtro = "TRUE", valores: unknown[] = []) {
  const { rows } = await c.query(
    `SELECT m.id, m.tipo, m.livro_id AS "livroId", m.receptor_id AS "receptorId", to_char(m.data, 'YYYY-MM-DD') AS data,
            m.observacao,
            COALESCE((SELECT array_agg(e.tombamento ORDER BY e.tombamento)
                        FROM movimentacao_exemplar me JOIN exemplar e ON e.id = me.exemplar_id
                       WHERE me.movimentacao_id = m.id), '{}') AS tombamentos
       FROM movimentacao m WHERE ${filtro}
      ORDER BY m.data DESC, m.id`,
    valores,
  )
  return rows.map(({ observacao, ...m }) => ({ ...m, ...(observacao ? { observacao } : {}) }))
}

function validarInstituicao(corpo: Record<string, unknown>) {
  const tipo = texto(corpo.tipo)
  if (tipo !== "instituicao" && tipo !== "pessoa_fisica") throw new ErroRegra(400, "Tipo de cadastro inválido.")
  const nome = texto(corpo.nome)
  if (nome.length < 3) throw new ErroRegra(400, "Informe o nome.")
  if (nome.length > 150) throw new ErroRegra(400, "Nome muito longo (máximo de 150 caracteres).")
  const documento = texto(corpo.documento).replace(/\D/g, "")
  if (tipo === "instituicao" && !cnpjValido(documento)) throw new ErroRegra(400, "CNPJ inválido.")
  if (tipo === "pessoa_fisica" && !cpfValido(documento)) throw new ErroRegra(400, "CPF inválido.")
  const endereco = texto(corpo.endereco)
  if (endereco.length < 5) throw new ErroRegra(400, "Informe o endereço.")
  if (endereco.length > 250) throw new ErroRegra(400, "Endereço muito longo (máximo de 250 caracteres).")
  const contato = texto(corpo.contato)
  if (contato.length < 5) throw new ErroRegra(400, "Informe um contato (telefone ou e-mail).")
  if (contato.length > 150) throw new ErroRegra(400, "Contato muito longo (máximo de 150 caracteres).")
  return { tipo, nome, documento, endereco, contato }
}

function lerObservacao(corpo: Record<string, unknown>): string | null {
  const observacao = texto(corpo.observacao)
  if (observacao.length > TAMANHO_OBSERVACAO) {
    throw new ErroRegra(400, `Observação muito longa (máximo de ${TAMANHO_OBSERVACAO} caracteres).`)
  }
  return observacao || null
}

// RN25: o receptor precisa existir; a linha fica travada para a contagem da RN26 ser exata
async function travarReceptor(c: pg.PoolClient, receptorId: string, mensagem: string) {
  if (!UUID.test(receptorId)) throw new ErroRegra(409, mensagem)
  const { rows } = await c.query<{ id: string; tipo: string; nome: string }>(
    "SELECT id, tipo, nome FROM instituicao WHERE id = $1 FOR UPDATE",
    [receptorId],
  )
  if (!rows[0]) throw new ErroRegra(409, mensagem)
  return rows[0]
}

async function ligarExemplares(
  c: pg.PoolClient,
  tipo: "doacao" | "aquisicao",
  livroId: string,
  receptorId: string,
  observacao: string | null,
  exemplarIds: string[],
) {
  const { rows } = await c.query<{ id: string }>(
    "INSERT INTO movimentacao (tipo, livro_id, receptor_id, observacao) VALUES ($1, $2, $3, $4) RETURNING id",
    [tipo, livroId, receptorId, observacao],
  )
  await c.query(
    "INSERT INTO movimentacao_exemplar (movimentacao_id, exemplar_id) SELECT $1, unnest($2::uuid[])",
    [rows[0].id, exemplarIds],
  )
  return (await listarMovimentacoes(c, "m.id = $1", [rows[0].id]))[0]
}

export const rotasParcerias = Router()
rotasParcerias.use(["/parcerias", "/instituicoes", "/movimentacoes"], exigirAdmin)

// GET /api/parcerias
rotasParcerias.get("/parcerias", async (_req, res) => {
  const [instituicoes, movimentacoes] = await Promise.all([
    pool.query(`${SQL_INSTITUICAO} ORDER BY lower(nome)`),
    listarMovimentacoes(pool),
  ])
  res.json({ ok: true, instituicoes: instituicoes.rows, movimentacoes })
})

// POST /api/instituicoes  { tipo, nome, documento, endereco, contato }
rotasParcerias.post("/instituicoes", async (req, res) => {
  const d = validarInstituicao(corpoDe(req))
  const { rows } = await pool.query(
    `INSERT INTO instituicao (tipo, nome, documento, endereco, contato) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, tipo, nome, documento, endereco, contato`,
    [d.tipo, d.nome, d.documento, d.endereco, d.contato],
  )
  res.status(201).json({ ok: true, mensagem: "Receptor cadastrado.", instituicao: rows[0] })
})

// PUT /api/instituicoes/:id
rotasParcerias.put("/instituicoes/:id", async (req, res) => {
  const id = idDe(req, "Cadastro não encontrado.")
  const d = validarInstituicao(corpoDe(req))
  const { rows } = await pool.query(
    `UPDATE instituicao SET tipo = $2, nome = $3, documento = $4, endereco = $5, contato = $6 WHERE id = $1
     RETURNING id, tipo, nome, documento, endereco, contato`,
    [id, d.tipo, d.nome, d.documento, d.endereco, d.contato],
  )
  if (!rows[0]) throw new ErroRegra(404, "Cadastro não encontrado.")
  res.json({ ok: true, mensagem: "Cadastro atualizado.", instituicao: rows[0] })
})

// DELETE /api/instituicoes/:id  (só sem movimentações: rastreabilidade)
rotasParcerias.delete("/instituicoes/:id", async (req, res) => {
  const id = idDe(req, "Cadastro não encontrado.")
  await emTransacao(async (c) => {
    const inst = await c.query("SELECT 1 FROM instituicao WHERE id = $1 FOR UPDATE", [id])
    if (inst.rowCount === 0) throw new ErroRegra(404, "Cadastro não encontrado.")
    const mov = await c.query("SELECT 1 FROM movimentacao WHERE receptor_id = $1 LIMIT 1", [id])
    if (mov.rowCount) {
      throw new ErroRegra(409, "O receptor possui doações ou aquisições registradas e não pode ser excluído (rastreabilidade).")
    }
    await c.query("DELETE FROM instituicao WHERE id = $1", [id])
  })
  res.json({ ok: true, mensagem: "Receptor excluído." })
})

// POST /api/movimentacoes/doacao  { receptorId, exemplarIds, observacao? }
rotasParcerias.post("/movimentacoes/doacao", async (req, res) => {
  const corpo = corpoDe(req)
  const observacao = lerObservacao(corpo)
  const receptorId = texto(corpo.receptorId)
  const exemplarIds = (Array.isArray(corpo.exemplarIds) ? corpo.exemplarIds : []).map(texto)
  const r = await emTransacao(async (c) => {
    const receptor = await travarReceptor(c, receptorId, "O receptor precisa estar cadastrado antes da doação (RN25).")
    if (exemplarIds.length === 0) throw new ErroRegra(400, "Selecione o(s) exemplar(es) doado(s).")
    if (exemplarIds.some((id) => !UUID.test(id)) || new Set(exemplarIds).size !== exemplarIds.length) {
      throw new ErroRegra(400, "Exemplar não encontrado no acervo.")
    }
    const { rows: exs } = await c.query<{ id: string; livro_id: string; tombamento: string; status: string }>(
      `SELECT id, livro_id, tombamento, status FROM exemplar
        WHERE id = ANY($1::uuid[]) AND baixa_data IS NULL ORDER BY tombamento FOR UPDATE`,
      [exemplarIds],
    )
    if (exs.length !== exemplarIds.length) throw new ErroRegra(409, "Exemplar não encontrado no acervo.")
    if (new Set(exs.map((x) => x.livro_id)).size !== 1) throw new ErroRegra(400, "Registre uma doação por obra.")
    const indisponivel = exs.find((x) => x.status !== "disponivel" && x.status !== "ocioso")
    if (indisponivel) {
      throw new ErroRegra(409, `O exemplar ${indisponivel.tombamento} não está disponível e não pode ser doado.`)
    }
    // RN26: o limite é de livros, e uma doação pode ter mais de um exemplar
    if (receptor.tipo === "pessoa_fisica") {
      const { rows } = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM movimentacao m JOIN movimentacao_exemplar me ON me.movimentacao_id = m.id
          WHERE m.receptor_id = $1 AND m.tipo = 'doacao'`,
        [receptor.id],
      )
      if (rows[0].n + exs.length > MAX_DOACOES_PESSOA_FISICA) {
        throw new ErroRegra(
          409,
          `Pessoa física pode receber no máximo ${MAX_DOACOES_PESSOA_FISICA} livro. ${receptor.nome} já recebeu ${rows[0].n} (RN26).`,
        )
      }
    }
    const movimentacao = await ligarExemplares(c, "doacao", exs[0].livro_id, receptor.id, observacao, exemplarIds)
    await c.query(
      "UPDATE exemplar SET baixa_data = CURRENT_DATE, baixa_motivo = 'doacao' WHERE id = ANY($1::uuid[])",
      [exemplarIds],
    )
    return { movimentacao, nome: receptor.nome }
  })
  res.status(201).json({ ok: true, mensagem: `Doação registrada para ${r.nome}.`, movimentacao: r.movimentacao })
})

// POST /api/movimentacoes/aquisicao  { receptorId, livroId, tombamentos, observacao? }
rotasParcerias.post("/movimentacoes/aquisicao", async (req, res) => {
  const corpo = corpoDe(req)
  const observacao = lerObservacao(corpo)
  const receptorId = texto(corpo.receptorId)
  const livroId = texto(corpo.livroId)
  const r = await emTransacao(async (c) => {
    const receptor = await travarReceptor(c, receptorId, "A instituição ou pessoa de origem precisa estar cadastrada (RN25).")
    if (!UUID.test(livroId)) throw new ErroRegra(400, "Selecione a obra.")
    const lista = validarTombamentos(corpo.tombamentos)
    const exemplares = await gravarExemplares(c, livroId, lista)
    const movimentacao = await ligarExemplares(c, "aquisicao", livroId, receptor.id, observacao, exemplares.map((e) => e.id))
    return { exemplares, movimentacao }
  })
  res.status(201).json({
    ok: true,
    mensagem: `Aquisição registrada: ${r.exemplares.length} exemplar(es) incorporado(s) ao acervo.`,
    exemplares: r.exemplares,
    movimentacao: r.movimentacao,
  })
})

rotasParcerias.use((erro: unknown, req: Request, res: Response, next: NextFunction) => {
  if (erro instanceof pg.DatabaseError && erro.code === "23505") {
    const mensagem =
      erro.constraint === "exemplar_tombamento_key"
        ? "O tombamento informado já pertence a outro exemplar."
        : "Já existe um receptor cadastrado com este documento."
    res.status(409).json({ ok: false, mensagem })
    return
  }
  tratarErroDeRegra(erro, req, res, next)
})
