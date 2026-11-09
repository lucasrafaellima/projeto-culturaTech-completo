import { Router, type NextFunction, type Request, type Response } from "express"
import pg from "pg"
import { pool } from "./db.ts"
import { exigirLogin, type UsuarioLogado } from "./auth.ts"
import { ErroRegra, UUID, corpoDe, emTransacao, idDe, texto, tratarErroDeRegra } from "./comum.ts"

// Mesas de estudo e espaço infantil (RF10 / RF11 / US28). Mesmas regras e mensagens de
// agendarMesa, entrarNaFila, cancelarAgendamento e desistirDaFila (src/lib/store.tsx)
// e de processarFila (src/lib/regras.ts).

type Consulta = pg.PoolClient | pg.Pool
type Turno = "manha" | "tarde" | "noite"
type Espaco = "estudo" | "infantil"

const TURNOS: Turno[] = ["manha", "tarde", "noite"]
const FIM_TURNO: Record<Turno, number> = { manha: 12, tarde: 17, noite: 21 }
const LABEL_TURNO: Record<Turno, string> = { manha: "Manhã", tarde: "Tarde", noite: "Noite" }
const DIAS_ANTECEDENCIA = 30
const IDADE_MINIMA_RESPONSAVEL = 16
const IDADE_MAXIMA_CRIANCA = 11
const MAX_CRIANCAS_POR_DIA = 3

// O RDS roda em UTC; os turnos seguem o relógio de Arapiraca
const AGORA_LOCAL = "(now() AT TIME ZONE 'America/Maceio')"

interface Crianca {
  nome: string
  idade: number
}

interface Pedido {
  data: string
  turno: Turno
  crianca: Crianca | null
}

const espacoDoPedido = (crianca: Crianca | null): Espaco => (crianca ? "infantil" : "estudo")

async function relogio(c: Consulta) {
  const { rows } = await c.query<{ hoje: string; hora: number; limite: string }>(
    `SELECT to_char(${AGORA_LOCAL}, 'YYYY-MM-DD') AS hoje,
            extract(hour FROM ${AGORA_LOCAL})::int AS hora,
            to_char(${AGORA_LOCAL} + make_interval(days => $1), 'YYYY-MM-DD') AS limite`,
    [DIAS_ANTECEDENCIA],
  )
  return rows[0]
}

// Condição SQL de turno já encerrado no relógio local
const turnoEncerrado = (data: string, turno: string) => `(
  ${data} < ${AGORA_LOCAL}::date
  OR (${data} = ${AGORA_LOCAL}::date AND extract(hour FROM ${AGORA_LOCAL}) >=
      CASE ${turno} WHEN 'manha' THEN ${FIM_TURNO.manha} WHEN 'tarde' THEN ${FIM_TURNO.tarde} ELSE ${FIM_TURNO.noite} END)
)`

async function expirarFila(c: Consulta) {
  await c.query(
    `UPDATE fila_espera SET status = 'expirada' WHERE status = 'aguardando' AND ${turnoEncerrado("data", "turno")}`,
  )
}

// Sem o administrador ou o próprio sócio, a resposta mostra a ocupação e a posição na
// fila, mas não quem está lá nem os dados da criança
function daVisao(linha: Record<string, unknown>, usuario: UsuarioLogado) {
  const { crianca_nome, crianca_idade, ...resto } = linha
  if (usuario.perfil !== "admin" && linha.socioId !== usuario.id) return { ...resto, socioId: "" }
  if (!crianca_nome) return resto
  return {
    ...resto,
    crianca: { nome: crianca_nome, ...(crianca_idade === null ? {} : { idade: crianca_idade }) },
  }
}

// Agendamentos confirmados e fila em aberto, de hoje em diante
export async function estadoDasMesas(c: Consulta, usuario: UsuarioLogado) {
  const [agendamentos, fila] = await Promise.all([
    c.query(
      `SELECT id, mesa_id AS "mesaId", socio_id AS "socioId", to_char(data, 'YYYY-MM-DD') AS data, turno, status, origem,
              criado_em AS "criadoEm", crianca_nome, crianca_idade
         FROM agendamento
        WHERE status = 'confirmado' AND data >= ${AGORA_LOCAL}::date
        ORDER BY data, turno, criado_em`,
    ),
    c.query(
      `SELECT id, socio_id AS "socioId", to_char(data, 'YYYY-MM-DD') AS data, turno, status, criado_em AS "criadoEm",
              CASE WHEN crianca_nome IS NULL THEN 'estudo' ELSE 'infantil' END AS espaco, crianca_nome, crianca_idade
         FROM fila_espera
        WHERE status = 'aguardando' AND data >= ${AGORA_LOCAL}::date
        ORDER BY criado_em, id`,
    ),
  ])
  return {
    agendamentos: agendamentos.rows.map((a) => daVisao(a, usuario)),
    fila: fila.rows.map((f) => daVisao(f, usuario)),
  }
}

function lerPedido(corpo: Record<string, unknown>): Pedido {
  const data = texto(corpo.data)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(Date.parse(`${data}T00:00:00Z`))) {
    throw new ErroRegra(400, "Escolha a data.")
  }
  const turno = texto(corpo.turno) as Turno
  if (!TURNOS.includes(turno)) throw new ErroRegra(400, "Turno inválido.")
  if (corpo.crianca === undefined || corpo.crianca === null) return { data, turno, crianca: null }

  const bruta = corpo.crianca as Record<string, unknown>
  const nome = texto(bruta.nome).replace(/\s+/g, " ")
  if (nome.length < 2) throw new ErroRegra(400, "Informe o nome da criança.")
  if (nome.length > 150) throw new ErroRegra(400, "Nome da criança muito longo (máximo de 150 caracteres).")
  const idade = bruta.idade
  if (typeof idade !== "number" || !Number.isInteger(idade) || idade < 0 || idade > IDADE_MAXIMA_CRIANCA) {
    throw new ErroRegra(400, `A idade da criança deve ser de 0 a ${IDADE_MAXIMA_CRIANCA} anos.`)
  }
  return { data, turno, crianca: { nome, idade } }
}

// Com token de sócio vale sempre o próprio id; o administrador informa para quem é
function socioDoPedido(corpo: Record<string, unknown>, usuario: UsuarioLogado): string {
  if (usuario.perfil === "socio") return usuario.id
  const socioId = texto(corpo.socioId)
  if (!UUID.test(socioId)) throw new ErroRegra(400, "Selecione o sócio-leitor.")
  return socioId
}

async function conferirTurno(c: Consulta, { data, turno }: Pedido) {
  const { hoje, hora, limite } = await relogio(c)
  if (data < hoje) throw new ErroRegra(409, "Não é possível agendar em uma data passada.")
  if (data === hoje && hora >= FIM_TURNO[turno]) throw new ErroRegra(409, "Este turno já foi encerrado.")
  if (data > limite) {
    throw new ErroRegra(409, `Os agendamentos podem ser feitos com até ${DIAS_ANTECEDENCIA} dias de antecedência.`)
  }
}

// RN06 e, para criança, a idade do responsável na data do agendamento (US28).
// FOR NO KEY UPDATE serializa os pedidos do mesmo sócio sem bloquear a chave estrangeira das
// inserções de processarFila, que já seguram a trava do turno: FOR UPDATE aqui causaria deadlock.
async function conferirSocio(c: pg.PoolClient, socioId: string, pedido: Pedido) {
  const { rows } = await c.query<{ ativo: boolean; anonimizado: boolean; idade: number | null }>(
    `SELECT ativo, anonimizado,
            extract(year FROM age($2::date, data_nascimento))::int AS idade
       FROM socio_leitor WHERE id = $1 FOR NO KEY UPDATE`,
    [socioId, pedido.data],
  )
  const s = rows[0]
  if (!s || !s.ativo || s.anonimizado) {
    throw new ErroRegra(409, "Somente sócios-leitores ativos podem agendar mesas (RN06).")
  }
  if (!pedido.crianca) return
  if (s.idade === null) {
    throw new ErroRegra(
      409,
      "A data de nascimento não está no cadastro. Peça ao administrador para preenchê-la antes de agendar para uma criança.",
    )
  }
  if (s.idade < IDADE_MINIMA_RESPONSAVEL) {
    throw new ErroRegra(409, `Somente maiores de ${IDADE_MINIMA_RESPONSAVEL} anos podem agendar para uma criança.`)
  }
}

// Mesmas regras de conflitoAgendamento (src/lib/regras.ts)
async function conflitoDoAgendamento(c: pg.PoolClient, socioId: string, p: Pedido): Promise<string | null> {
  const { rows } = await c.query<{ turno: Turno; crianca_nome: string | null }>(
    "SELECT turno, crianca_nome FROM agendamento WHERE socio_id = $1 AND data = $2 AND status = 'confirmado'",
    [socioId, p.data],
  )
  if (!p.crianca) {
    const proprio = rows.find((a) => !a.crianca_nome)
    if (proprio) {
      return `Já existe um agendamento neste dia (${LABEL_TURNO[proprio.turno]}). O limite é 1 turno por dia (RN05).`
    }
    if (rows.some((a) => a.turno === p.turno)) {
      return "Você tem uma criança agendada neste turno e precisa estar com ela no espaço infantil."
    }
    return null
  }
  const criancas = rows.filter((a) => a.crianca_nome)
  if (criancas.some((a) => a.crianca_nome!.toLowerCase() === p.crianca!.nome.toLowerCase())) {
    return `${p.crianca.nome} já tem um agendamento neste dia.`
  }
  if (criancas.length >= MAX_CRIANCAS_POR_DIA) {
    return `O limite é de ${MAX_CRIANCAS_POR_DIA} crianças por dia para cada responsável.`
  }
  if (rows.some((a) => !a.crianca_nome && a.turno === p.turno)) {
    return "Você tem mesa de estudo agendada neste turno e precisa estar com a criança no espaço infantil."
  }
  return null
}

// Serializa quem disputa as mesas e a fila de um mesmo turno e espaço
async function travarTurno(c: pg.PoolClient, data: string, turno: Turno, espaco: Espaco) {
  await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`mesas|${data}|${turno}|${espaco}`])
}

async function mesasLivres(c: Consulta, data: string, turno: Turno, espaco: Espaco) {
  const { rows } = await c.query<{ id: string; nome: string }>(
    `SELECT m.id, m.nome FROM mesa_estudo m
      WHERE m.ativa AND m.espaco = $3
        AND NOT EXISTS (SELECT 1 FROM agendamento a
                         WHERE a.mesa_id = m.id AND a.data = $1 AND a.turno = $2 AND a.status = 'confirmado')
      ORDER BY m.nome`,
    [data, turno, espaco],
  )
  return rows
}

// RF11: enquanto houver mesa livre, contempla o primeiro da fila do espaço. Quem já não
// pode ser atendido (conflito com outro agendamento do dia) sai da fila.
async function processarFila(c: pg.PoolClient, data: string, turno: Turno, espaco: Espaco) {
  const { rows } = await c.query<{
    id: string
    socio_id: string
    crianca_nome: string | null
    crianca_idade: number | null
  }>(
    `SELECT id, socio_id, crianca_nome, crianca_idade FROM fila_espera
      WHERE data = $1 AND turno = $2 AND status = 'aguardando' AND (crianca_nome IS NOT NULL) = $3
      ORDER BY criado_em, id`,
    [data, turno, espaco === "infantil"],
  )
  let contemplados = 0
  for (const f of rows) {
    const crianca = f.crianca_nome ? { nome: f.crianca_nome, idade: f.crianca_idade ?? 0 } : null
    if (await conflitoDoAgendamento(c, f.socio_id, { data, turno, crianca })) {
      await c.query("UPDATE fila_espera SET status = 'desistiu' WHERE id = $1", [f.id])
      continue
    }
    const mesa = (await mesasLivres(c, data, turno, espaco))[0]
    if (!mesa) break
    const ag = await c.query<{ id: string }>(
      `INSERT INTO agendamento (mesa_id, socio_id, data, turno, origem, crianca_nome, crianca_idade)
       VALUES ($1, $2, $3, $4, 'fila', $5, $6) RETURNING id`,
      [mesa.id, f.socio_id, data, turno, f.crianca_nome, f.crianca_idade],
    )
    await c.query("UPDATE fila_espera SET status = 'contemplado', agendamento_id = $2 WHERE id = $1", [f.id, ag.rows[0].id])
    contemplados++
  }
  return contemplados
}

// Sócio inativado ou anonimizado: as mesas futuras voltam para a fila
export async function liberarMesasDoSocio(c: pg.PoolClient, socioId: string) {
  const { rows } = await c.query<{ data: string; turno: Turno; espaco: Espaco }>(
    `SELECT DISTINCT to_char(a.data, 'YYYY-MM-DD') AS data, a.turno, m.espaco
       FROM agendamento a JOIN mesa_estudo m ON m.id = a.mesa_id
      WHERE a.socio_id = $1 AND a.status = 'confirmado' AND NOT ${turnoEncerrado("a.data", "a.turno")}
      ORDER BY 1, 2, 3`,
    [socioId],
  )
  for (const t of rows) await travarTurno(c, t.data, t.turno, t.espaco)
  await c.query(
    `UPDATE agendamento SET status = 'cancelado'
      WHERE socio_id = $1 AND status = 'confirmado' AND NOT ${turnoEncerrado("data", "turno")}`,
    [socioId],
  )
  await c.query("UPDATE fila_espera SET status = 'desistiu' WHERE socio_id = $1 AND status = 'aguardando'", [socioId])
  for (const t of rows) await processarFila(c, t.data, t.turno, t.espaco)
}

// Anonimização: tira os dados das crianças do que ficou no histórico. O nome vira um
// código por linha porque o índice único ainda precisa distinguir as crianças do dia.
export async function anonimizarCriancasDoSocio(c: pg.PoolClient, socioId: string) {
  for (const tabela of ["agendamento", "fila_espera"]) {
    await c.query(
      `UPDATE ${tabela} SET crianca_nome = 'Criança ' || upper(left(id::text, 8)), crianca_idade = NULL
        WHERE socio_id = $1 AND crianca_nome IS NOT NULL`,
      [socioId],
    )
  }
}

export const rotasMesas = Router()

// GET /api/mesas  (admin ou sócio)
rotasMesas.get("/mesas", exigirLogin, async (_req, res) => {
  const usuario = res.locals.usuario as UsuarioLogado
  await expirarFila(pool)
  const { rows: mesas } = await pool.query(
    "SELECT id, nome, local, espaco FROM mesa_estudo WHERE ativa ORDER BY espaco, nome",
  )
  res.json({ ok: true, mesas, ...(await estadoDasMesas(pool, usuario)) })
})

// POST /api/agendamentos  { socioId?, data, turno, mesaId?, crianca?: { nome, idade } }
rotasMesas.post("/agendamentos", exigirLogin, async (req, res) => {
  const usuario = res.locals.usuario as UsuarioLogado
  const corpo = corpoDe(req)
  const pedido = lerPedido(corpo)
  const socioId = socioDoPedido(corpo, usuario)
  const mesaId = texto(corpo.mesaId)
  if (mesaId && !UUID.test(mesaId)) throw new ErroRegra(400, "Mesa não encontrada.")
  const espaco = espacoDoPedido(pedido.crianca)

  const mesa = await emTransacao(async (c) => {
    await conferirTurno(c, pedido)
    await conferirSocio(c, socioId, pedido)
    await travarTurno(c, pedido.data, pedido.turno, espaco)
    const conflito = await conflitoDoAgendamento(c, socioId, pedido)
    if (conflito) throw new ErroRegra(409, conflito)

    if (mesaId) {
      const escolhida = await c.query<{ espaco: Espaco }>("SELECT espaco FROM mesa_estudo WHERE id = $1 AND ativa", [mesaId])
      if (!escolhida.rows[0]) throw new ErroRegra(404, "Mesa não encontrada.")
      if (escolhida.rows[0].espaco !== espaco) {
        throw new ErroRegra(
          409,
          espaco === "infantil"
            ? "Agendamento para criança só pode ser feito em mesa do espaço infantil."
            : "As mesas do espaço infantil são para agendamentos de crianças.",
        )
      }
    }
    const livres = await mesasLivres(c, pedido.data, pedido.turno, espaco)
    if (livres.length === 0) {
      throw new ErroRegra(409, "Todas as mesas estão ocupadas neste turno (RN09).", { ofereceFila: true })
    }
    const alvo = mesaId ? livres.find((m) => m.id === mesaId) : livres[0]
    if (!alvo) throw new ErroRegra(409, "A mesa escolhida já está ocupada neste turno (RN09). Escolha outra.")
    await c.query(
      `INSERT INTO agendamento (mesa_id, socio_id, data, turno, crianca_nome, crianca_idade)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [alvo.id, socioId, pedido.data, pedido.turno, pedido.crianca?.nome ?? null, pedido.crianca?.idade ?? null],
    )
    return alvo
  })
  const dataBr = pedido.data.split("-").reverse().join("/")
  res.status(201).json({
    ok: true,
    mensagem: `${mesa.nome} agendada para ${dataBr}, turno da ${LABEL_TURNO[pedido.turno].toLowerCase()}.`,
    ...(await estadoDasMesas(pool, usuario)),
  })
})

// POST /api/agendamentos/:id/cancelar  (admin ou o próprio sócio)
rotasMesas.post("/agendamentos/:id/cancelar", exigirLogin, async (req, res) => {
  const usuario = res.locals.usuario as UsuarioLogado
  const id = idDe(req, "Agendamento não encontrado.")
  const contemplados = await emTransacao(async (c) => {
    const { rows } = await c.query<{ socio_id: string; data: string; turno: Turno; status: string; espaco: Espaco }>(
      `SELECT a.socio_id, to_char(a.data, 'YYYY-MM-DD') AS data, a.turno, a.status, m.espaco
         FROM agendamento a JOIN mesa_estudo m ON m.id = a.mesa_id WHERE a.id = $1`,
      [id],
    )
    const ag = rows[0]
    if (!ag) throw new ErroRegra(404, "Agendamento não encontrado.")
    if (usuario.perfil !== "admin" && ag.socio_id !== usuario.id) {
      throw new ErroRegra(403, "Acesso negado: esta operação não é permitida para o seu perfil (RNF02).")
    }
    await travarTurno(c, ag.data, ag.turno, ag.espaco)
    const { hoje, hora } = await relogio(c)
    if (ag.data < hoje || (ag.data === hoje && hora >= FIM_TURNO[ag.turno])) {
      throw new ErroRegra(409, "O turno já foi encerrado.")
    }
    const r = await c.query("UPDATE agendamento SET status = 'cancelado' WHERE id = $1 AND status = 'confirmado'", [id])
    if (r.rowCount === 0) throw new ErroRegra(404, "Agendamento não encontrado.")
    return processarFila(c, ag.data, ag.turno, ag.espaco)
  })
  res.json({
    ok: true,
    mensagem:
      contemplados > 0
        ? "Agendamento cancelado. A mesa foi repassada ao primeiro da fila de espera."
        : "Agendamento cancelado. A mesa está livre.",
    ...(await estadoDasMesas(pool, usuario)),
  })
})

// POST /api/fila  { socioId?, data, turno, crianca?: { nome, idade } }
rotasMesas.post("/fila", exigirLogin, async (req, res) => {
  const usuario = res.locals.usuario as UsuarioLogado
  const corpo = corpoDe(req)
  const pedido = lerPedido(corpo)
  const socioId = socioDoPedido(corpo, usuario)
  const espaco = espacoDoPedido(pedido.crianca)

  const posicao = await emTransacao(async (c) => {
    await conferirTurno(c, pedido)
    await conferirSocio(c, socioId, pedido)
    await travarTurno(c, pedido.data, pedido.turno, espaco)
    const conflito = await conflitoDoAgendamento(c, socioId, pedido)
    if (conflito) throw new ErroRegra(409, conflito)
    if ((await mesasLivres(c, pedido.data, pedido.turno, espaco)).length > 0) {
      throw new ErroRegra(409, "Há mesas livres neste turno: faça o agendamento direto.")
    }
    const { rows } = await c.query<{ turno: Turno; crianca_nome: string | null }>(
      "SELECT turno, crianca_nome FROM fila_espera WHERE socio_id = $1 AND data = $2 AND status = 'aguardando'",
      [socioId, pedido.data],
    )
    const nome = pedido.crianca?.nome.toLowerCase() ?? null
    const mesmaPessoa = rows.filter((f) => (f.crianca_nome?.toLowerCase() ?? null) === nome)
    if (mesmaPessoa.some((f) => f.turno === pedido.turno)) {
      throw new ErroRegra(409, pedido.crianca ? `${pedido.crianca.nome} já está na fila deste turno.` : "Você já está na fila deste turno.")
    }
    if (mesmaPessoa.length > 0) {
      throw new ErroRegra(
        409,
        pedido.crianca ? `${pedido.crianca.nome} já está na fila de outro turno neste dia.` : "Você já está na fila de outro turno neste dia (RN05).",
      )
    }
    await c.query(
      "INSERT INTO fila_espera (socio_id, data, turno, crianca_nome, crianca_idade) VALUES ($1, $2, $3, $4, $5)",
      [socioId, pedido.data, pedido.turno, pedido.crianca?.nome ?? null, pedido.crianca?.idade ?? null],
    )
    const total = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM fila_espera
        WHERE data = $1 AND turno = $2 AND status = 'aguardando' AND (crianca_nome IS NOT NULL) = $3`,
      [pedido.data, pedido.turno, espaco === "infantil"],
    )
    return total.rows[0].n
  })
  res.status(201).json({
    ok: true,
    mensagem: `Você entrou na fila de espera na posição ${posicao}.`,
    ...(await estadoDasMesas(pool, usuario)),
  })
})

// POST /api/fila/:id/desistir  (admin ou o próprio sócio)
rotasMesas.post("/fila/:id/desistir", exigirLogin, async (req, res) => {
  const usuario = res.locals.usuario as UsuarioLogado
  const id = idDe(req, "Entrada não está na fila.")
  const { rows } = await pool.query<{ socio_id: string }>(
    "SELECT socio_id FROM fila_espera WHERE id = $1 AND status = 'aguardando'",
    [id],
  )
  if (!rows[0]) throw new ErroRegra(404, "Entrada não está na fila.")
  if (usuario.perfil !== "admin" && rows[0].socio_id !== usuario.id) {
    throw new ErroRegra(403, "Acesso negado: esta operação não é permitida para o seu perfil (RNF02).")
  }
  await pool.query("UPDATE fila_espera SET status = 'desistiu' WHERE id = $1 AND status = 'aguardando'", [id])
  res.json({ ok: true, mensagem: "Você saiu da fila. As posições foram reordenadas.", ...(await estadoDasMesas(pool, usuario)) })
})

rotasMesas.use((erro: unknown, req: Request, res: Response, next: NextFunction) => {
  // pedido simultâneo que passou pelas conferências e parou nos índices únicos
  if (erro instanceof pg.DatabaseError && erro.code === "23505") {
    res.status(409).json({ ok: false, mensagem: "Este horário acabou de ser ocupado. Atualize a página e tente de novo." })
    return
  }
  tratarErroDeRegra(erro, req, res, next)
})
