import { Router } from "express"
import type pg from "pg"
import { pool } from "./db.ts"
import { exigirAdmin, exigirLogin, type UsuarioLogado } from "./auth.ts"
import { ErroRegra, UUID, corpoDe, emTransacao, idDe, texto, tratarErroDeRegra } from "./comum.ts"
import { listarSocios } from "./socios.ts"

// Circulação (RF03 / RF07 / RN01–RN08 / RN13 / RN14 / RN17): empréstimos,
// renovações, devoluções, multas e reservas. Mesmas regras e mensagens das ações
// realizarEmprestimo, renovarEmprestimo, alterarEmprestimo, cancelarEmprestimo,
// devolverEmprestimo, quitarMulta, registrarJustificativa, julgarJustificativa,
// reservarLivro e cancelarReserva (src/lib/store.tsx). As regras que dependem
// de vários registros também são conferidas pelos triggers do banco.

const PRAZO_EMPRESTIMO_DIAS = 14 // RN02
const MAX_RENOVACOES = 3 // RN17
const MULTA_POR_DIA = 1.0 // RN03
const PRAZO_RESERVA_DIAS = 3
const MAX_EXEMPLARES_SIMULTANEOS = 3 // RN01
const MIN_JUSTIFICATIVA = 20 // RN07 / RF15
const MIN_MOTIVO = 10
const MAX_IMAGENS_DANO = 4
const CATEGORIAS_RESTRITAS = ["exemplar_unico", "raro", "cordel"] // RN04

const labelCategoria: Record<string, string> = { exemplar_unico: "Exemplar único", raro: "Obra rara", cordel: "Cordel" }

const moeda = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v)
const dataBr = (iso: string) => iso.split("-").reverse().join("/")

type Consulta = pg.PoolClient | pg.Pool

// ------------------------------------------------------------
// Consultas no formato de src/lib/types.ts
// ------------------------------------------------------------
async function listarEmprestimos(c: Consulta, filtro = "TRUE", valores: unknown[] = []) {
  const { rows } = await c.query(
    `SELECT e.id, e.socio_id AS "socioId", e.exemplar_id AS "exemplarId",
            to_char(e.data_emprestimo, 'YYYY-MM-DD') AS "dataEmprestimo",
            to_char(e.data_prevista, 'YYYY-MM-DD') AS "dataPrevista",
            to_char(e.data_devolucao, 'YYYY-MM-DD') AS "dataDevolucao",
            e.renovacoes, e.status, e.motivo_cancelamento AS "motivoCancelamento",
            e.devolvido_danificado AS "devolvidoDanificado",
            COALESCE((SELECT json_agg(json_build_object('data', ev.data, 'texto', ev.texto) ORDER BY ev.data, ev.id)
                        FROM emprestimo_evento ev WHERE ev.emprestimo_id = e.id), '[]') AS historico
       FROM emprestimo e WHERE ${filtro}
      ORDER BY e.data_emprestimo DESC, e.id`,
    valores,
  )
  return rows.map((e) => {
    if (!e.dataDevolucao) delete e.dataDevolucao
    if (!e.motivoCancelamento) delete e.motivoCancelamento
    return e
  })
}

async function listarMultas(c: Consulta, filtro = "TRUE", valores: unknown[] = []) {
  const { rows } = await c.query(
    `SELECT m.id, m.socio_id AS "socioId", m.emprestimo_id AS "emprestimoId", m.valor::float8 AS valor,
            m.motivo, m.status, m.dias, to_char(m.data, 'YYYY-MM-DD') AS data,
            m.justificativa_texto, to_char(m.justificativa_data, 'YYYY-MM-DD') AS justificativa_data,
            to_char(m.data_quitacao, 'YYYY-MM-DD') AS "dataQuitacao",
            COALESCE((SELECT json_agg(json_build_object(
                        'decisao', p.decisao, 'texto', p.texto, 'data', to_char(p.data, 'YYYY-MM-DD'),
                        'adminId', p.admin_id, 'justificativa', p.justificativa) ORDER BY p.data)
                        FROM parecer_multa p WHERE p.multa_id = m.id), '[]') AS pareceres
       FROM multa m WHERE ${filtro}
      ORDER BY m.data DESC, m.id`,
    valores,
  )
  return rows.map(({ justificativa_texto, justificativa_data, ...m }) => {
    if (m.dias === null) delete m.dias
    if (!m.dataQuitacao) delete m.dataQuitacao
    return justificativa_texto ? { ...m, justificativa: { texto: justificativa_texto, data: justificativa_data } } : m
  })
}

async function listarOcorrencias(c: Consulta, filtro = "TRUE", valores: unknown[] = []) {
  const { rows } = await c.query(
    `SELECT o.id, o.emprestimo_id AS "emprestimoId", e.exemplar_id AS "exemplarId", e.socio_id AS "socioId",
            o.multa_id AS "multaId", o.relatorio, o.valor_multa::float8 AS "valorMulta",
            to_char(o.data, 'YYYY-MM-DD') AS data,
            COALESCE((SELECT array_agg(i.arquivo_id) FROM ocorrencia_dano_imagem i WHERE i.ocorrencia_id = o.id),
                     '{}') AS "imagemIds"
       FROM ocorrencia_dano o JOIN emprestimo e ON e.id = o.emprestimo_id
      WHERE ${filtro}
      ORDER BY o.data DESC, o.id`,
    valores,
  )
  return rows
}

async function listarReservas(c: Consulta, filtro = "TRUE", valores: unknown[] = []) {
  const { rows } = await c.query(
    `SELECT r.id, r.socio_id AS "socioId", r.exemplar_id AS "exemplarId",
            to_char(r.data_reserva, 'YYYY-MM-DD') AS "dataReserva",
            to_char(r.expira_em, 'YYYY-MM-DD') AS "expiraEm", r.status
       FROM reserva r WHERE ${filtro}
      ORDER BY r.data_reserva DESC, r.id`,
    valores,
  )
  return rows
}

const umEmprestimo = async (c: Consulta, id: string) => (await listarEmprestimos(c, "e.id = $1", [id]))[0]
const umaMulta = async (c: Consulta, id: string) => (await listarMultas(c, "m.id = $1", [id]))[0]
const umaReserva = async (c: Consulta, id: string) => (await listarReservas(c, "r.id = $1", [id]))[0]

// Reserva não retirada em 3 dias expira; o trigger libera o exemplar
async function expirarReservas(c: Consulta) {
  await c.query("UPDATE reserva SET status = 'expirada' WHERE status = 'ativa' AND expira_em < CURRENT_DATE")
}

// RN08: mesmo texto de motivoBloqueio (src/lib/regras.ts)
async function motivoBloqueio(c: Consulta, socioId: string): Promise<string | null> {
  const { rows } = await c.query<{ emprestimos_atrasados: string; multas_abertas: string; total_multas: string }>(
    "SELECT emprestimos_atrasados, multas_abertas, total_multas FROM vw_situacao_socio WHERE socio_id = $1",
    [socioId],
  )
  const s = rows[0]
  if (!s) return null
  const partes: string[] = []
  if (Number(s.emprestimos_atrasados) > 0) partes.push(`${s.emprestimos_atrasados} devolução(ões) em atraso`)
  if (Number(s.multas_abertas) > 0) partes.push(`multas em aberto de ${moeda(Number(s.total_multas))}`)
  return partes.length ? partes.join(" e ") : null
}

// Situação do sócio para o balcão (US08 / US11): limite de empréstimos, pendências
// e a multa que corre nos exemplares atrasados — R$ 1,00 por dia e por exemplar,
// somados (RN03). A multa corrente vira multa de verdade na devolução de cada um.
async function situacaoDoSocio(c: Consulta, socioId: string) {
  const { rows } = await c.query<{
    ativo: boolean
    emprestimos_ativos: number
    reservas_ativas: number
    multas_abertas: number
    total_multas: number
    emprestimos_atrasados: number
    multa_corrente: number
  }>(
    `SELECT s.ativo AND NOT s.anonimizado AS ativo,
            (SELECT count(*) FROM emprestimo WHERE socio_id = s.id AND status = 'ativo')::int AS emprestimos_ativos,
            (SELECT count(*) FROM reserva WHERE socio_id = s.id AND status = 'ativa')::int AS reservas_ativas,
            v.multas_abertas::int AS multas_abertas, v.total_multas::float8 AS total_multas,
            v.emprestimos_atrasados::int AS emprestimos_atrasados, v.multa_corrente::float8 AS multa_corrente
       FROM socio_leitor s JOIN vw_situacao_socio v ON v.socio_id = s.id
      WHERE s.id = $1`,
    [socioId],
  )
  const s = rows[0]
  if (!s) return null
  const motivo = await motivoBloqueio(c, socioId)
  return {
    ativo: s.ativo, // RN06
    emprestimosAtivos: s.emprestimos_ativos,
    reservasAtivas: s.reservas_ativas,
    limite: MAX_EXEMPLARES_SIMULTANEOS, // RN01: empréstimos e reservas somados
    emprestimosAtrasados: s.emprestimos_atrasados,
    multaCorrente: s.multa_corrente,
    multasAbertas: s.multas_abertas,
    totalMultas: s.total_multas,
    bloqueado: motivo !== null, // RN08
    ...(motivo ? { motivo } : {}),
  }
}

async function evento(c: pg.PoolClient, emprestimoId: string, textoEvento: string) {
  await c.query("INSERT INTO emprestimo_evento (emprestimo_id, texto) VALUES ($1, $2)", [emprestimoId, textoEvento])
}

// Empréstimo ativo travado para alteração
async function emprestimoAtivo(c: pg.PoolClient, id: string, mensagem: string) {
  const { rows } = await c.query<{
    id: string
    renovacoes: number
    data_emprestimo: string
    data_prevista: string
    atraso: number
    socio_id: string
    exemplar_id: string
  }>(
    `SELECT id, renovacoes, socio_id, exemplar_id,
            to_char(data_emprestimo, 'YYYY-MM-DD') AS data_emprestimo,
            to_char(data_prevista, 'YYYY-MM-DD') AS data_prevista,
            GREATEST(CURRENT_DATE - data_prevista, 0) AS atraso
       FROM emprestimo WHERE id = $1 AND status = 'ativo' FOR UPDATE`,
    [id],
  )
  if (!rows[0]) throw new ErroRegra(409, mensagem)
  return rows[0]
}

function motivoDe(corpo: Record<string, unknown>, mensagem: string) {
  const motivo = texto(corpo.motivo)
  if (motivo.length < MIN_MOTIVO) throw new ErroRegra(400, mensagem)
  if (motivo.length > 1000) throw new ErroRegra(400, "Texto muito longo (máximo de 1000 caracteres).")
  return motivo
}

export const rotasCirculacao = Router()

// ------------------------------------------------------------
// Leitura
// ------------------------------------------------------------

// GET /api/circulacao  (admin: tudo o que a tela de circulação usa)
rotasCirculacao.get("/circulacao", exigirAdmin, async (_req, res) => {
  await expirarReservas(pool)
  const [socios, emprestimos, multas, ocorrencias, reservas] = await Promise.all([
    listarSocios(pool),
    listarEmprestimos(pool),
    listarMultas(pool),
    listarOcorrencias(pool),
    listarReservas(pool),
  ])
  res.json({ ok: true, socios, emprestimos, multas, ocorrencias, reservas })
})

// GET /api/eu/circulacao  (sócio: os próprios empréstimos, multas e reservas)
rotasCirculacao.get("/eu/circulacao", exigirLogin, async (_req, res) => {
  const usuario = res.locals.usuario as UsuarioLogado
  if (usuario.perfil !== "socio") throw new ErroRegra(403, "Rota exclusiva para sócios-leitores.")
  await expirarReservas(pool)
  const [socio, emprestimos, multas, reservas, situacao] = await Promise.all([
    listarSocios(pool, "s.id = $1", [usuario.id]),
    listarEmprestimos(pool, "e.socio_id = $1", [usuario.id]),
    listarMultas(pool, "m.socio_id = $1", [usuario.id]),
    listarReservas(pool, "r.socio_id = $1", [usuario.id]),
    situacaoDoSocio(pool, usuario.id),
  ])
  res.json({ ok: true, socio: socio[0], emprestimos, multas, reservas, situacao })
})

// GET /api/socios/:id/situacao  (admin: conferência no balcão antes do empréstimo)
rotasCirculacao.get("/socios/:id/situacao", exigirAdmin, async (req, res) => {
  const id = idDe(req, "Sócio-leitor não encontrado.")
  const situacao = await situacaoDoSocio(pool, id)
  if (!situacao) throw new ErroRegra(404, "Sócio-leitor não encontrado.")
  res.json({ ok: true, situacao })
})

// ------------------------------------------------------------
// Empréstimos (US08 / US09 / US10 / US11)
// ------------------------------------------------------------

// POST /api/emprestimos  { "socioId": "...", "exemplarId": "..." }
rotasCirculacao.post("/emprestimos", exigirAdmin, async (req, res) => {
  const corpo = corpoDe(req)
  const socioId = texto(corpo.socioId)
  const exemplarId = texto(corpo.exemplarId)
  if (!UUID.test(socioId)) throw new ErroRegra(400, "Somente sócios-leitores ativos podem fazer empréstimos (RN06).")
  if (!UUID.test(exemplarId)) throw new ErroRegra(404, "Exemplar não encontrado no acervo.")

  const emprestimo = await emTransacao(async (c) => {
    await expirarReservas(c)
    // RN06: somente sócios-leitores ativos
    const s = await c.query("SELECT 1 FROM socio_leitor WHERE id = $1 AND ativo AND NOT anonimizado FOR UPDATE", [socioId])
    if (!s.rowCount) throw new ErroRegra(409, "Somente sócios-leitores ativos podem fazer empréstimos (RN06).")
    // RN08: dívidas pendentes bloqueiam
    const motivo = await motivoBloqueio(c, socioId)
    if (motivo) throw new ErroRegra(409, `Empréstimo bloqueado: o sócio-leitor possui ${motivo} (RN08).`)

    const ex = (
      await c.query<{ categoria: string }>(
        `SELECT l.categoria FROM exemplar e JOIN livro l ON l.id = e.livro_id
          WHERE e.id = $1 AND e.baixa_data IS NULL FOR UPDATE OF e`,
        [exemplarId],
      )
    ).rows[0]
    if (!ex) throw new ErroRegra(404, "Exemplar não encontrado no acervo.")
    // RN04: obras restritas
    if (CATEGORIAS_RESTRITAS.includes(ex.categoria)) {
      throw new ErroRegra(409, `${labelCategoria[ex.categoria]}: obra de consulta local, não pode ser emprestada (RN04).`)
    }
    // RN14: exemplar sem empréstimo ativo
    const ativo = await c.query("SELECT 1 FROM emprestimo WHERE exemplar_id = $1 AND status = 'ativo'", [exemplarId])
    if (ativo.rowCount) throw new ErroRegra(409, "Este exemplar já possui um empréstimo ativo (RN14).")

    // RN01, disponibilidade e reserva de outro sócio: trigger fn_validar_emprestimo
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO emprestimo (socio_id, exemplar_id, data_prevista)
       VALUES ($1, $2, CURRENT_DATE + $3::int) RETURNING id`,
      [socioId, exemplarId, PRAZO_EMPRESTIMO_DIAS],
    )
    await evento(c, rows[0].id, "Empréstimo registrado.")
    return umEmprestimo(c, rows[0].id)
  })
  res.status(201).json({
    ok: true,
    mensagem: `Empréstimo registrado. Devolução prevista para ${dataBr(emprestimo.dataPrevista)}.`,
    emprestimo,
  })
})

// POST /api/emprestimos/:id/renovar  (RN02 / RN17)
rotasCirculacao.post("/emprestimos/:id/renovar", exigirAdmin, async (req, res) => {
  const id = idDe(req, "Somente empréstimos em andamento podem ser renovados.")
  const r = await emTransacao(async (c) => {
    const emp = await emprestimoAtivo(c, id, "Somente empréstimos em andamento podem ser renovados.")
    if (emp.renovacoes >= MAX_RENOVACOES) throw new ErroRegra(409, `Limite de ${MAX_RENOVACOES} renovações atingido (RN17).`)
    if (emp.atraso > 0) {
      throw new ErroRegra(409, "Empréstimo em atraso não pode ser renovado. Registre a devolução para calcular a multa.")
    }
    const { rows } = await c.query<{ nova: string }>(
      `UPDATE emprestimo SET renovacoes = renovacoes + 1, data_prevista = data_prevista + $2::int
        WHERE id = $1 RETURNING to_char(data_prevista, 'YYYY-MM-DD') AS nova`,
      [id, PRAZO_EMPRESTIMO_DIAS],
    )
    await evento(c, id, `Renovação ${emp.renovacoes + 1}: novo prazo ${rows[0].nova}.`)
    return { renovacao: emp.renovacoes + 1, emprestimo: await umEmprestimo(c, id) }
  })
  res.json({
    ok: true,
    mensagem: `Empréstimo renovado por mais ${PRAZO_EMPRESTIMO_DIAS} dias (${r.renovacao}/${MAX_RENOVACOES}).`,
    emprestimo: r.emprestimo,
  })
})

// PATCH /api/emprestimos/:id  { "dataPrevista": "AAAA-MM-DD", "motivo": "..." }  (RF07)
rotasCirculacao.patch("/emprestimos/:id", exigirAdmin, async (req, res) => {
  const id = idDe(req, "Somente empréstimos em andamento podem ser alterados.")
  const corpo = corpoDe(req)
  const novaData = texto(corpo.dataPrevista)
  const dataOk = /^\d{4}-\d{2}-\d{2}$/.test(novaData) && !Number.isNaN(Date.parse(`${novaData}T00:00:00Z`))
  const emprestimo = await emTransacao(async (c) => {
    const emp = await emprestimoAtivo(c, id, "Somente empréstimos em andamento podem ser alterados.")
    if (!dataOk || novaData < emp.data_emprestimo) {
      throw new ErroRegra(400, "A data prevista não pode ser anterior à data de saída.")
    }
    const motivo = motivoDe(corpo, "Descreva o motivo da alteração (mínimo 10 caracteres).")
    await c.query("UPDATE emprestimo SET data_prevista = $2 WHERE id = $1", [id, novaData])
    await evento(c, id, `Prazo alterado de ${emp.data_prevista} para ${novaData}: ${motivo}`)
    return umEmprestimo(c, id)
  })
  res.json({ ok: true, mensagem: "Empréstimo alterado. A alteração ficou registrada no histórico.", emprestimo })
})

// POST /api/emprestimos/:id/cancelar  { "motivo": "..." }  (registro feito por engano: sem multa)
rotasCirculacao.post("/emprestimos/:id/cancelar", exigirAdmin, async (req, res) => {
  const id = idDe(req, "Somente empréstimos em andamento podem ser cancelados.")
  const corpo = corpoDe(req)
  const emprestimo = await emTransacao(async (c) => {
    await emprestimoAtivo(c, id, "Somente empréstimos em andamento podem ser cancelados.")
    const motivo = motivoDe(corpo, "Descreva o motivo do cancelamento (mínimo 10 caracteres).")
    // o trigger fn_sincronizar_emprestimo devolve o exemplar para "disponível"
    await c.query("UPDATE emprestimo SET status = 'cancelado', motivo_cancelamento = $2 WHERE id = $1", [id, motivo])
    await evento(c, id, `Cancelado: ${motivo}`)
    return umEmprestimo(c, id)
  })
  res.json({ ok: true, mensagem: "Empréstimo cancelado. O exemplar voltou a ficar disponível.", emprestimo })
})

// POST /api/emprestimos/:id/devolver  { "dano"?: { "relatorio": "...", "valor": 25, "imagemIds": [...] } }
// RN03: atraso gera multa de R$ 1,00 por dia; RF15 / RN13: dano gera multa e ocorrência
rotasCirculacao.post("/emprestimos/:id/devolver", exigirAdmin, async (req, res) => {
  const id = idDe(req, "Empréstimo não está em andamento.")
  const admin = res.locals.usuario as UsuarioLogado
  const bruto = corpoDe(req).dano
  let dano: { relatorio: string; valor: number; imagemIds: string[] } | null = null
  if (bruto !== undefined && bruto !== null) {
    const d = (typeof bruto === "object" ? bruto : {}) as Record<string, unknown>
    const relatorio = texto(d.relatorio)
    const valor = typeof d.valor === "number" ? Math.round(d.valor * 100) / 100 : NaN
    const imagemIds = (Array.isArray(d.imagemIds) ? d.imagemIds : []).map(texto)
    if (relatorio.length < MIN_JUSTIFICATIVA) {
      throw new ErroRegra(400, `Descreva o dano no relatório (mínimo ${MIN_JUSTIFICATIVA} caracteres) (RF15).`)
    }
    if (!(valor > 0) || valor > 99_999_999) throw new ErroRegra(400, "Informe o valor da multa pelo dano (RN13).")
    if (imagemIds.length > MAX_IMAGENS_DANO) throw new ErroRegra(400, `Anexe no máximo ${MAX_IMAGENS_DANO} imagens.`)
    if (imagemIds.some((i) => !UUID.test(i)) || new Set(imagemIds).size !== imagemIds.length) {
      throw new ErroRegra(400, "Imagem do dano inválida. Envie as imagens novamente.")
    }
    dano = { relatorio, valor, imagemIds }
  }

  const r = await emTransacao(async (c) => {
    const emp = await emprestimoAtivo(c, id, "Empréstimo não está em andamento.")
    const multaIds: string[] = []
    // RN03: R$ 1,00 por dia de atraso, por exemplar
    if (emp.atraso > 0) {
      const m = await c.query<{ id: string }>(
        `INSERT INTO multa (socio_id, emprestimo_id, valor, motivo, dias)
         VALUES ($1, $2, $3, 'atraso', $4) RETURNING id`,
        [emp.socio_id, id, emp.atraso * MULTA_POR_DIA, emp.atraso],
      )
      multaIds.push(m.rows[0].id)
    }
    let ocorrenciaId: string | null = null
    if (dano) {
      if (dano.imagemIds.length) {
        const { rows } = await c.query<{ id: string; livre: boolean }>(
          `SELECT a.id,
                  NOT (EXISTS (SELECT 1 FROM documento_digital WHERE arquivo_id = a.id)
                    OR EXISTS (SELECT 1 FROM socio_leitor WHERE foto_arquivo_id = a.id)
                    OR EXISTS (SELECT 1 FROM ocorrencia_dano_imagem WHERE arquivo_id = a.id)
                    OR EXISTS (SELECT 1 FROM publicacao_imagem WHERE arquivo_id = a.id)) AS livre
             FROM arquivo a
            WHERE a.id = ANY($1::uuid[]) AND a.mime LIKE 'image/%' AND a.chave_storage LIKE 'danos/%'`,
          [dano.imagemIds],
        )
        if (rows.length !== dano.imagemIds.length || rows.some((x) => !x.livre)) {
          throw new ErroRegra(400, "Imagem do dano inválida. Envie as imagens novamente.")
        }
      }
      const m = await c.query<{ id: string }>(
        `INSERT INTO multa (socio_id, emprestimo_id, valor, motivo) VALUES ($1, $2, $3, 'dano') RETURNING id`,
        [emp.socio_id, id, dano.valor],
      )
      multaIds.push(m.rows[0].id)
      const o = await c.query<{ id: string }>(
        `INSERT INTO ocorrencia_dano (emprestimo_id, multa_id, admin_id, relatorio, valor_multa)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [id, m.rows[0].id, admin.id, dano.relatorio, dano.valor],
      )
      ocorrenciaId = o.rows[0].id
      for (const img of dano.imagemIds) {
        await c.query("INSERT INTO ocorrencia_dano_imagem (ocorrencia_id, arquivo_id) VALUES ($1, $2)", [ocorrenciaId, img])
      }
    }
    // RF07: data de devolução; o trigger deixa o exemplar "disponível" ou "danificado" (RN12 / RN13)
    await c.query(
      `UPDATE emprestimo SET status = 'devolvido', data_devolucao = CURRENT_DATE, devolvido_danificado = $2
        WHERE id = $1`,
      [id, !!dano],
    )
    await evento(c, id, dano ? "Devolvido com dano." : "Devolvido.")
    return {
      atraso: emp.atraso,
      emprestimo: await umEmprestimo(c, id),
      multas: multaIds.length ? await listarMultas(c, "m.id = ANY($1::uuid[])", [multaIds]) : [],
      ocorrencia: ocorrenciaId ? (await listarOcorrencias(c, "o.id = $1", [ocorrenciaId]))[0] : null,
    }
  })

  const partes = ["Devolução registrada."]
  if (r.atraso > 0) partes.push(`Multa por atraso: ${moeda(r.atraso * MULTA_POR_DIA)} (${r.atraso} dia(s)).`)
  if (dano) partes.push(`Multa por dano: ${moeda(dano.valor)}.`)
  res.json({ ok: true, mensagem: partes.join(" "), emprestimo: r.emprestimo, multas: r.multas, ocorrencia: r.ocorrencia })
})

// ------------------------------------------------------------
// Multas (RN03 / RN07)
// ------------------------------------------------------------

// POST /api/multas/:id/quitar
rotasCirculacao.post("/multas/:id/quitar", exigirAdmin, async (req, res) => {
  const id = idDe(req, "Multa não está em aberto.")
  const { rows } = await pool.query<{ valor: number }>(
    `UPDATE multa SET status = 'paga', data_quitacao = CURRENT_DATE
      WHERE id = $1 AND status IN ('pendente', 'em_analise') RETURNING valor::float8 AS valor`,
    [id],
  )
  if (!rows[0]) throw new ErroRegra(409, "Multa não está em aberto.")
  res.json({ ok: true, mensagem: `Pagamento de ${moeda(rows[0].valor)} registrado.`, multa: await umaMulta(pool, id) })
})

// POST /api/multas/:id/justificativa  { "texto": "..." }  (o próprio sócio ou o balcão em nome dele)
rotasCirculacao.post("/multas/:id/justificativa", exigirLogin, async (req, res) => {
  const id = idDe(req, "Multa não encontrada.")
  const usuario = res.locals.usuario as UsuarioLogado
  const justificativa = texto(corpoDe(req).texto)
  const multa = await emTransacao(async (c) => {
    const m = (
      await c.query<{ socio_id: string; status: string }>("SELECT socio_id, status FROM multa WHERE id = $1 FOR UPDATE", [id])
    ).rows[0]
    if (!m) throw new ErroRegra(404, "Multa não encontrada.")
    if (usuario.perfil !== "admin" && usuario.id !== m.socio_id) {
      throw new ErroRegra(403, "Acesso negado: esta operação não é permitida para o seu perfil (RNF02).")
    }
    if (m.status !== "pendente") throw new ErroRegra(409, "Só é possível justificar uma multa pendente.")
    if (justificativa.length < MIN_JUSTIFICATIVA) {
      throw new ErroRegra(400, `Escreva uma justificativa fundamentada (mínimo ${MIN_JUSTIFICATIVA} caracteres).`)
    }
    if (justificativa.length > 4000) throw new ErroRegra(400, "Texto muito longo (máximo de 4000 caracteres).")
    await c.query(
      `UPDATE multa SET status = 'em_analise', justificativa_texto = $2, justificativa_data = now() WHERE id = $1`,
      [id, justificativa],
    )
    return umaMulta(c, id)
  })
  res.json({ ok: true, mensagem: "Justificativa enviada. Ela será avaliada pela administração da biblioteca.", multa })
})

// POST /api/multas/:id/julgar  { "decisao": "deferido" | "indeferido", "texto": "..." }  (RN07)
rotasCirculacao.post("/multas/:id/julgar", exigirAdmin, async (req, res) => {
  const id = idDe(req, "Não há justificativa aguardando julgamento.")
  const admin = res.locals.usuario as UsuarioLogado
  const corpo = corpoDe(req)
  const decisao = texto(corpo.decisao)
  const parecer = texto(corpo.texto)
  if (decisao !== "deferido" && decisao !== "indeferido") throw new ErroRegra(400, "Decisão inválida.")
  const multa = await emTransacao(async (c) => {
    const m = (
      await c.query<{ status: string; justificativa_texto: string | null }>(
        "SELECT status, justificativa_texto FROM multa WHERE id = $1 FOR UPDATE",
        [id],
      )
    ).rows[0]
    if (!m || m.status !== "em_analise" || !m.justificativa_texto) {
      throw new ErroRegra(409, "Não há justificativa aguardando julgamento.")
    }
    if (parecer.length < MIN_MOTIVO) throw new ErroRegra(400, "Registre o parecer da decisão (mínimo 10 caracteres).")
    if (parecer.length > 4000) throw new ErroRegra(400, "Texto muito longo (máximo de 4000 caracteres).")
    await c.query(
      `INSERT INTO parecer_multa (multa_id, admin_id, decisao, texto, justificativa) VALUES ($1, $2, $3, $4, $5)`,
      [id, admin.id, decisao, parecer, m.justificativa_texto],
    )
    // deferido abona a multa; indeferido mantém a dívida e permite nova justificativa
    if (decisao === "deferido") {
      await c.query("UPDATE multa SET status = 'abonada', data_quitacao = CURRENT_DATE WHERE id = $1", [id])
    } else {
      await c.query(
        "UPDATE multa SET status = 'pendente', justificativa_texto = NULL, justificativa_data = NULL WHERE id = $1",
        [id],
      )
    }
    return umaMulta(c, id)
  })
  res.json({
    ok: true,
    mensagem:
      decisao === "deferido"
        ? "Justificativa deferida: multa abonada e pendência liberada."
        : "Justificativa indeferida: a dívida foi mantida.",
    multa,
  })
})

// ------------------------------------------------------------
// Reservas (RF14 / RN28)
// ------------------------------------------------------------

// POST /api/reservas  { "livroId": "...", "socioId"?: "..." }  (sócio reserva para si; admin informa o sócio)
rotasCirculacao.post("/reservas", exigirLogin, async (req, res) => {
  const usuario = res.locals.usuario as UsuarioLogado
  const corpo = corpoDe(req)
  const socioId = usuario.perfil === "socio" ? usuario.id : texto(corpo.socioId)
  const livroId = texto(corpo.livroId)
  if (!UUID.test(socioId)) throw new ErroRegra(400, "Selecione o sócio-leitor.")
  if (!UUID.test(livroId)) throw new ErroRegra(404, "Obra não encontrada.")

  const reserva = await emTransacao(async (c) => {
    await expirarReservas(c)
    const s = await c.query("SELECT 1 FROM socio_leitor WHERE id = $1 AND ativo AND NOT anonimizado FOR UPDATE", [socioId])
    if (!s.rowCount) throw new ErroRegra(409, "Somente sócios-leitores ativos podem reservar (RN06).")
    const livro = (await c.query<{ categoria: string }>("SELECT categoria FROM livro WHERE id = $1", [livroId])).rows[0]
    if (!livro) throw new ErroRegra(404, "Obra não encontrada.")
    if (CATEGORIAS_RESTRITAS.includes(livro.categoria)) {
      throw new ErroRegra(409, "Obra de consulta local: não pode ser reservada (RN04).")
    }
    const motivo = await motivoBloqueio(c, socioId)
    if (motivo) throw new ErroRegra(409, `Reserva bloqueada: há ${motivo} (RN08).`)
    const mesma = await c.query(
      `SELECT 1 FROM reserva r JOIN exemplar e ON e.id = r.exemplar_id
        WHERE r.socio_id = $1 AND r.status = 'ativa' AND e.livro_id = $2`,
      [socioId, livroId],
    )
    if (mesma.rowCount) throw new ErroRegra(409, "Você já possui uma reserva ativa desta obra.")
    const ocupados = await c.query<{ n: number }>(
      `SELECT (SELECT count(*) FROM emprestimo WHERE socio_id = $1 AND status = 'ativo')::int
            + (SELECT count(*) FROM reserva WHERE socio_id = $1 AND status = 'ativa')::int AS n`,
      [socioId],
    )
    if (ocupados.rows[0].n >= MAX_EXEMPLARES_SIMULTANEOS) {
      throw new ErroRegra(409, `Empréstimos e reservas somados não podem passar de ${MAX_EXEMPLARES_SIMULTANEOS} (RN01).`)
    }
    const ex = (
      await c.query<{ id: string }>(
        `SELECT e.id FROM exemplar e
          WHERE e.livro_id = $1 AND e.status = 'disponivel' AND e.baixa_data IS NULL
            AND NOT EXISTS (SELECT 1 FROM emprestimo WHERE exemplar_id = e.id AND status = 'ativo')
          ORDER BY e.tombamento LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [livroId],
      )
    ).rows[0]
    if (!ex) throw new ErroRegra(409, "Não há exemplar disponível para reserva no momento.")
    // o trigger fn_validar_reserva confere de novo e fn_sincronizar_reserva marca o exemplar como "reservado"
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO reserva (socio_id, exemplar_id, expira_em) VALUES ($1, $2, CURRENT_DATE + $3::int) RETURNING id`,
      [socioId, ex.id, PRAZO_RESERVA_DIAS],
    )
    return umaReserva(c, rows[0].id)
  })
  res.status(201).json({
    ok: true,
    mensagem: `Reserva confirmada. Retire o livro no balcão até ${dataBr(reserva.expiraEm)}.`,
    reserva,
  })
})

// POST /api/reservas/:id/cancelar  (administrador ou o próprio sócio, RN28)
rotasCirculacao.post("/reservas/:id/cancelar", exigirLogin, async (req, res) => {
  const id = idDe(req, "Reserva não está ativa.")
  const usuario = res.locals.usuario as UsuarioLogado
  const reserva = await emTransacao(async (c) => {
    const r = (
      await c.query<{ socio_id: string }>("SELECT socio_id FROM reserva WHERE id = $1 AND status = 'ativa' FOR UPDATE", [id])
    ).rows[0]
    if (!r) throw new ErroRegra(409, "Reserva não está ativa.")
    if (usuario.perfil !== "admin" && usuario.id !== r.socio_id) {
      throw new ErroRegra(403, "Acesso negado: esta operação não é permitida para o seu perfil (RNF02).")
    }
    await c.query("UPDATE reserva SET status = 'cancelada' WHERE id = $1", [id])
    return umaReserva(c, id)
  })
  res.json({ ok: true, mensagem: "Reserva cancelada.", reserva })
})

rotasCirculacao.use(tratarErroDeRegra)
