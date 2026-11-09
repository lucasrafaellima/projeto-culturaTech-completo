import { Router, type NextFunction, type Request, type Response } from "express"
import pg from "pg"
import { config } from "./config.ts"
import { pool } from "./db.ts"
import { exigirAdmin, exigirLogin, type UsuarioLogado } from "./auth.ts"
import { cpfValido } from "./cadastro.ts"
import { ErroRegra, UUID, corpoDe, emTransacao, idDe, texto, tratarErroDeRegra } from "./comum.ts"

// Mesas de estudo (RF10 / RF11), Espaço Kids (US29) e confirmação de uso (US30). Mesmas
// regras e mensagens de agendarMesa, agendarKids, entrarNaFila, entrarNaFilaKids,
// cancelarAgendamento, desistirDaFila e confirmarUso (src/lib/store.tsx) e de
// processarFila, validarCrianca e liberarVagasSemUso (src/lib/regras.ts).

type Consulta = pg.PoolClient | pg.Pool
type Turno = "manha" | "tarde" | "noite"
type Espaco = "estudo" | "kids"

const TURNOS: Turno[] = ["manha", "tarde", "noite"]
const INICIO_TURNO: Record<Turno, number> = { manha: 8, tarde: 13, noite: 18 }
const FIM_TURNO: Record<Turno, number> = { manha: 12, tarde: 17, noite: 21 }
const LABEL_TURNO: Record<Turno, string> = { manha: "Manhã", tarde: "Tarde", noite: "Noite" }
const DIAS_ANTECEDENCIA = 30
const IDADE_MAXIMA_KIDS = 11
const IDADE_MINIMA_SOCIO = 12
const TOLERANCIA_USO_MINUTOS = 15
const AVISO_TOLERANCIA = `Apresente-se no balcão em até ${TOLERANCIA_USO_MINUTOS} minutos do início do turno; sem a confirmação de uso, a vaga é liberada.`
const NEGADO = "Acesso negado: esta operação não é permitida para o seu perfil (RNF02)."

// O RDS roda em UTC; os turnos seguem o relógio de Arapiraca (FUSO_HORARIO)
const FUSO = config.fusoHorario
const AGORA_LOCAL = `(now() AT TIME ZONE '${FUSO}')`

interface Crianca {
  nome: string
  cpf: string
  dataNascimento: string
}

interface Pedido {
  data: string
  turno: Turno
  crianca: Crianca | null
}

const espacoDoPedido = (crianca: Crianca | null): Espaco => (crianca ? "kids" : "estudo")
const primeiroNome = (nome: string) => nome.split(" ")[0]
const dataBr = (data: string) => data.split("-").reverse().join("/")

function dataValida(data: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return false
  const [a, m, d] = data.split("-").map(Number)
  return new Date(Date.UTC(a, m - 1, d)).toISOString().slice(0, 10) === data
}

function idade(nascimento: string, ref: string): number {
  const [an, mn, dn] = nascimento.split("-").map(Number)
  const [ar, mr, dr] = ref.split("-").map(Number)
  return ar - an - (mr < mn || (mr === mn && dr < dn) ? 1 : 0)
}

async function relogio(c: Consulta) {
  const { rows } = await c.query<{ hoje: string; hora: number; limite: string }>(
    `SELECT to_char(${AGORA_LOCAL}, 'YYYY-MM-DD') AS hoje,
            extract(hour FROM ${AGORA_LOCAL})::int AS hora,
            to_char(${AGORA_LOCAL} + make_interval(days => $1), 'YYYY-MM-DD') AS limite`,
    [DIAS_ANTECEDENCIA],
  )
  return rows[0]
}

const horaDoTurno = (horas: Record<Turno, number>, turno: string) =>
  `CASE ${turno} WHEN 'manha' THEN ${horas.manha} WHEN 'tarde' THEN ${horas.tarde} ELSE ${horas.noite} END`

// Condição SQL de turno já encerrado no relógio local
const turnoEncerrado = (data: string, turno: string) => `(
  ${data} < ${AGORA_LOCAL}::date
  OR (${data} = ${AGORA_LOCAL}::date AND extract(hour FROM ${AGORA_LOCAL}) >= ${horaDoTurno(FIM_TURNO, turno)})
)`

// Serializa quem disputa as mesas e a fila de um mesmo turno e espaço
async function travarTurno(c: pg.PoolClient, data: string, turno: Turno, espaco: Espaco) {
  await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`mesas|${data}|${turno}|${espaco}`])
}

// ---------- leitura ----------

// Sem o administrador ou o próprio sócio, a resposta mostra a ocupação e a posição na
// fila, mas não quem está lá nem os dados da criança
function daVisao(linha: Record<string, unknown>, usuario: UsuarioLogado) {
  const { crianca_nome, crianca_cpf, crianca_nascimento, usoConfirmadoEm, ...resto } = linha
  const base = usoConfirmadoEm ? { ...resto, usoConfirmadoEm } : resto
  if (usuario.perfil !== "admin" && linha.socioId !== usuario.id) return { ...base, socioId: "" }
  if (!crianca_nome) return base
  return {
    ...base,
    crianca: { nome: crianca_nome, cpf: crianca_cpf ?? "", dataNascimento: crianca_nascimento ?? "" },
  }
}

// Agendamentos e fila em aberto, de hoje em diante
export async function estadoDasMesas(c: Consulta, usuario: UsuarioLogado) {
  const [agendamentos, fila] = await Promise.all([
    c.query(
      `SELECT id, mesa_id AS "mesaId", socio_id AS "socioId", to_char(data, 'YYYY-MM-DD') AS data, turno, status, origem,
              criado_em AS "criadoEm", uso_confirmado_em AS "usoConfirmadoEm",
              crianca_nome, crianca_cpf, to_char(crianca_nascimento, 'YYYY-MM-DD') AS crianca_nascimento
         FROM agendamento
        WHERE status IN ('confirmado', 'nao_compareceu') AND data >= ${AGORA_LOCAL}::date
        ORDER BY data, turno, criado_em`,
    ),
    c.query(
      `SELECT id, socio_id AS "socioId", to_char(data, 'YYYY-MM-DD') AS data, turno, status, criado_em AS "criadoEm",
              CASE WHEN crianca_nome IS NULL THEN 'estudo' ELSE 'kids' END AS espaco,
              crianca_nome, crianca_cpf, to_char(crianca_nascimento, 'YYYY-MM-DD') AS crianca_nascimento
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

// ---------- pedido ----------

function lerPedido(corpo: Record<string, unknown>): Pedido {
  const data = texto(corpo.data)
  if (!dataValida(data)) throw new ErroRegra(400, "Escolha a data.")
  const turno = texto(corpo.turno) as Turno
  if (!TURNOS.includes(turno)) throw new ErroRegra(400, "Turno inválido.")
  if (corpo.crianca === undefined || corpo.crianca === null) return { data, turno, crianca: null }
  const bruta = (typeof corpo.crianca === "object" ? corpo.crianca : {}) as Record<string, unknown>
  return {
    data,
    turno,
    crianca: {
      nome: texto(bruta.nome).replace(/\s+/g, " "),
      cpf: texto(bruta.cpf).replace(/\D/g, ""),
      dataNascimento: texto(bruta.dataNascimento),
    },
  }
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
  return hoje
}

// RN06. FOR NO KEY UPDATE serializa os pedidos do mesmo sócio sem bloquear a chave estrangeira
// das inserções de processarFila, que já seguram a trava do turno: FOR UPDATE causaria deadlock.
async function conferirSocio(c: pg.PoolClient, socioId: string, kids: boolean) {
  const { rows } = await c.query<{ ativo: boolean; anonimizado: boolean }>(
    "SELECT ativo, anonimizado FROM socio_leitor WHERE id = $1 FOR NO KEY UPDATE",
    [socioId],
  )
  const s = rows[0]
  if (!s || !s.ativo || s.anonimizado) {
    throw new ErroRegra(
      409,
      kids
        ? "Somente sócios-leitores ativos podem agendar o Espaço Kids (RN06)."
        : "Somente sócios-leitores ativos podem agendar mesas (RN06).",
    )
  }
}

// US29: mesmas regras de validarCrianca (src/lib/regras.ts)
async function conferirCrianca(c: pg.PoolClient, cr: Crianca, hoje: string, dataAgendamento: string) {
  if (cr.nome.split(" ").length < 2) throw new ErroRegra(400, "Informe o nome completo da criança.", { campo: "nome" })
  if (cr.nome.length > 150) throw new ErroRegra(400, "Nome da criança muito longo (máximo de 150 caracteres).", { campo: "nome" })
  if (!cpfValido(cr.cpf)) throw new ErroRegra(400, "CPF da criança inválido. Confira os dígitos.", { campo: "cpf" })
  const socio = await c.query("SELECT 1 FROM socio_leitor WHERE cpf = $1", [cr.cpf])
  if (socio.rowCount) {
    throw new ErroRegra(
      409,
      "Este CPF pertence a um sócio-leitor cadastrado. O Espaço Kids é para crianças sem cadastro próprio.",
      { campo: "cpf" },
    )
  }
  if (!dataValida(cr.dataNascimento)) {
    throw new ErroRegra(400, "Informe a data de nascimento da criança.", { campo: "dataNascimento" })
  }
  if (cr.dataNascimento > hoje) {
    throw new ErroRegra(400, "A data de nascimento não pode estar no futuro.", { campo: "dataNascimento" })
  }
  if (idade(cr.dataNascimento, dataAgendamento) > IDADE_MAXIMA_KIDS) {
    throw new ErroRegra(
      409,
      `O Espaço Kids é só para crianças de até ${IDADE_MAXIMA_KIDS} anos. A partir dos ${IDADE_MINIMA_SOCIO} anos, ela pode criar a própria conta de sócio-leitor.`,
      { campo: "dataNascimento" },
    )
  }
}

// RN05: o turno do dia já agendado para o sócio (sem criança) ou para a criança (pelo CPF)
async function agendamentoNoDia(c: Consulta, socioId: string, data: string, crianca: Crianca | null) {
  const { rows } = await c.query<{ turno: Turno }>(
    crianca
      ? "SELECT turno FROM agendamento WHERE crianca_cpf = $1 AND data = $2 AND status = 'confirmado' LIMIT 1"
      : "SELECT turno FROM agendamento WHERE socio_id = $1 AND data = $2 AND status = 'confirmado' AND crianca_nome IS NULL LIMIT 1",
    [crianca ? crianca.cpf : socioId, data],
  )
  return rows[0] ?? null
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

// RF11: enquanto houver mesa livre, contempla o primeiro da fila do espaço. Quem já tem
// agendamento no dia (o sócio, ou a criança no Espaço Kids) sai da fila.
async function processarFila(c: pg.PoolClient, data: string, turno: Turno, espaco: Espaco) {
  const { rows } = await c.query<{
    id: string
    socio_id: string
    crianca_nome: string | null
    crianca_cpf: string | null
    crianca_nascimento: string | null
  }>(
    `SELECT id, socio_id, crianca_nome, crianca_cpf, to_char(crianca_nascimento, 'YYYY-MM-DD') AS crianca_nascimento
       FROM fila_espera
      WHERE data = $1 AND turno = $2 AND status = 'aguardando' AND (crianca_nome IS NOT NULL) = $3
      ORDER BY criado_em, id`,
    [data, turno, espaco === "kids"],
  )
  let contemplados = 0
  for (const f of rows) {
    const crianca = f.crianca_cpf ? { nome: f.crianca_nome!, cpf: f.crianca_cpf, dataNascimento: f.crianca_nascimento! } : null
    if (await agendamentoNoDia(c, f.socio_id, data, crianca)) {
      await c.query("UPDATE fila_espera SET status = 'desistiu' WHERE id = $1", [f.id])
      continue
    }
    const mesa = (await mesasLivres(c, data, turno, espaco))[0]
    if (!mesa) break
    const ag = await c.query<{ id: string }>(
      `INSERT INTO agendamento (mesa_id, socio_id, data, turno, origem, crianca_nome, crianca_cpf, crianca_nascimento)
       VALUES ($1, $2, $3, $4, 'fila', $5, $6, $7) RETURNING id`,
      [mesa.id, f.socio_id, data, turno, f.crianca_nome, f.crianca_cpf, f.crianca_nascimento],
    )
    await c.query("UPDATE fila_espera SET status = 'contemplado', agendamento_id = $2 WHERE id = $1", [f.id, ag.rows[0].id])
    contemplados++
  }
  return contemplados
}

// ---------- rotinas ----------

async function expirarFila(c: Consulta) {
  await c.query(
    `UPDATE fila_espera SET status = 'expirada' WHERE status = 'aguardando' AND ${turnoEncerrado("data", "turno")}`,
  )
}

// US30: agendamentos de hoje sem confirmação de uso depois da tolerância (contada do início
// do turno ou, se o agendamento veio depois, de quando foi feito) liberam a vaga para a fila
const SEM_USO = `
  a.status = 'confirmado' AND a.uso_confirmado_em IS NULL AND a.data = ${AGORA_LOCAL}::date
  AND extract(hour FROM ${AGORA_LOCAL}) < ${horaDoTurno(FIM_TURNO, "a.turno")}
  AND ${AGORA_LOCAL} >= GREATEST(a.data + make_interval(hours => ${horaDoTurno(INICIO_TURNO, "a.turno")}),
                                 a.criado_em AT TIME ZONE '${FUSO}')
                        + make_interval(mins => ${TOLERANCIA_USO_MINUTOS})`

async function liberarVagasSemUso() {
  const { rows } = await pool.query<{ data: string; turno: Turno; espaco: Espaco }>(
    `SELECT DISTINCT to_char(a.data, 'YYYY-MM-DD') AS data, a.turno, m.espaco
       FROM agendamento a JOIN mesa_estudo m ON m.id = a.mesa_id WHERE ${SEM_USO} ORDER BY 1, 2, 3`,
  )
  if (rows.length === 0) return
  await emTransacao(async (c) => {
    for (const t of rows) await travarTurno(c, t.data, t.turno, t.espaco)
    await c.query(`UPDATE agendamento a SET status = 'nao_compareceu' WHERE ${SEM_USO}`)
    for (const t of rows) await processarFila(c, t.data, t.turno, t.espaco)
  })
}

// Antes de ler ou de agendar: fila de turnos encerrados expira e vagas sem uso são liberadas
async function rotinaDasMesas() {
  await expirarFila(pool)
  await liberarVagasSemUso()
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

// Anonimização (LGPD): tira os dados das crianças do que ficou no histórico. O nome vira um
// código por linha, para o registro continuar sendo do Espaço Kids.
export async function anonimizarCriancasDoSocio(c: pg.PoolClient, socioId: string) {
  for (const tabela of ["agendamento", "fila_espera"]) {
    await c.query(
      `UPDATE ${tabela}
          SET crianca_nome = 'Criança ' || upper(left(id::text, 8)), crianca_cpf = NULL, crianca_nascimento = NULL
        WHERE socio_id = $1 AND crianca_nome IS NOT NULL`,
      [socioId],
    )
  }
}

// ---------- rotas ----------

export const rotasMesas = Router()

// GET /api/mesas  (admin ou sócio)
rotasMesas.get("/mesas", exigirLogin, async (_req, res) => {
  const usuario = res.locals.usuario as UsuarioLogado
  await rotinaDasMesas()
  const { rows: mesas } = await pool.query(
    "SELECT id, nome, local, espaco FROM mesa_estudo WHERE ativa ORDER BY espaco, nome",
  )
  res.json({ ok: true, mesas, ...(await estadoDasMesas(pool, usuario)) })
})

// POST /api/agendamentos  { socioId?, data, turno, mesaId?, crianca?: { nome, cpf, dataNascimento } }
rotasMesas.post("/agendamentos", exigirLogin, async (req, res) => {
  const usuario = res.locals.usuario as UsuarioLogado
  const corpo = corpoDe(req)
  const pedido = lerPedido(corpo)
  const socioId = socioDoPedido(corpo, usuario)
  const mesaId = texto(corpo.mesaId)
  if (mesaId && !UUID.test(mesaId)) throw new ErroRegra(400, "Mesa não encontrada.")
  const espaco = espacoDoPedido(pedido.crianca)
  const cr = pedido.crianca
  await rotinaDasMesas()

  const mesa = await emTransacao(async (c) => {
    await conferirSocio(c, socioId, !!cr)
    const hoje = await conferirTurno(c, pedido)
    if (cr) await conferirCrianca(c, cr, hoje, pedido.data)
    await travarTurno(c, pedido.data, pedido.turno, espaco)
    const existente = await agendamentoNoDia(c, socioId, pedido.data, cr)
    if (existente) {
      throw new ErroRegra(
        409,
        cr
          ? `${primeiroNome(cr.nome)} já tem agendamento no Espaço Kids neste dia (${LABEL_TURNO[existente.turno]}). O limite é 1 turno por dia (RN05).`
          : `Já existe um agendamento neste dia (${LABEL_TURNO[existente.turno]}). O limite é 1 turno por dia (RN05).`,
      )
    }
    if (mesaId) {
      const escolhida = await c.query<{ espaco: Espaco }>("SELECT espaco FROM mesa_estudo WHERE id = $1 AND ativa", [mesaId])
      if (!escolhida.rows[0]) throw new ErroRegra(404, "Mesa não encontrada.")
      if (escolhida.rows[0].espaco !== espaco) {
        throw new ErroRegra(
          409,
          cr ? "Esta mesa não é do Espaço Kids. Escolha uma mesa Kids." : "Para agendar o Espaço Kids, informe os dados da criança.",
        )
      }
    }
    const livres = await mesasLivres(c, pedido.data, pedido.turno, espaco)
    if (livres.length === 0) {
      throw new ErroRegra(
        409,
        cr ? "Todas as mesas do Espaço Kids estão ocupadas neste turno (RN09)." : "Todas as mesas estão ocupadas neste turno (RN09).",
        { ofereceFila: true },
      )
    }
    const alvo = mesaId ? livres.find((m) => m.id === mesaId) : livres[0]
    if (!alvo) throw new ErroRegra(409, "A mesa escolhida já está ocupada neste turno (RN09). Escolha outra.")
    await c.query(
      `INSERT INTO agendamento (mesa_id, socio_id, data, turno, crianca_nome, crianca_cpf, crianca_nascimento)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [alvo.id, socioId, pedido.data, pedido.turno, cr?.nome ?? null, cr?.cpf ?? null, cr?.dataNascimento ?? null],
    )
    return alvo
  })
  const turno = LABEL_TURNO[pedido.turno].toLowerCase()
  res.status(201).json({
    ok: true,
    mensagem: cr
      ? `${mesa.nome} agendada para ${primeiroNome(cr.nome)} em ${dataBr(pedido.data)}, turno da ${turno}. ${AVISO_TOLERANCIA}`
      : `${mesa.nome} agendada para ${dataBr(pedido.data)}, turno da ${turno}. ${AVISO_TOLERANCIA}`,
    ...(await estadoDasMesas(pool, usuario)),
  })
})

// POST /api/agendamentos/:id/cancelar  (admin ou o próprio sócio)
rotasMesas.post("/agendamentos/:id/cancelar", exigirLogin, async (req, res) => {
  const usuario = res.locals.usuario as UsuarioLogado
  const id = idDe(req, "Agendamento não encontrado.")
  const contemplados = await emTransacao(async (c) => {
    const { rows } = await c.query<{ socio_id: string; data: string; turno: Turno; espaco: Espaco }>(
      `SELECT a.socio_id, to_char(a.data, 'YYYY-MM-DD') AS data, a.turno, m.espaco
         FROM agendamento a JOIN mesa_estudo m ON m.id = a.mesa_id WHERE a.id = $1 AND a.status = 'confirmado'`,
      [id],
    )
    const ag = rows[0]
    if (!ag) throw new ErroRegra(404, "Agendamento não encontrado.")
    if (usuario.perfil !== "admin" && ag.socio_id !== usuario.id) throw new ErroRegra(403, NEGADO)
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

// POST /api/agendamentos/:id/uso  (US30: o funcionário confirma que o espaço está em uso)
rotasMesas.post("/agendamentos/:id/uso", exigirAdmin, async (req, res) => {
  const usuario = res.locals.usuario as UsuarioLogado
  const id = idDe(req, "Agendamento não encontrado.")
  const r = await emTransacao(async (c) => {
    const { rows } = await c.query<{
      socio: string
      data: string
      turno: Turno
      espaco: Espaco
      crianca_nome: string | null
      uso_confirmado_em: Date | null
    }>(
      `SELECT s.nome AS socio, to_char(a.data, 'YYYY-MM-DD') AS data, a.turno, m.espaco, a.crianca_nome, a.uso_confirmado_em
         FROM agendamento a JOIN mesa_estudo m ON m.id = a.mesa_id JOIN socio_leitor s ON s.id = a.socio_id
        WHERE a.id = $1 AND a.status = 'confirmado'`,
      [id],
    )
    const ag = rows[0]
    if (!ag) throw new ErroRegra(404, "Agendamento não encontrado.")
    await travarTurno(c, ag.data, ag.turno, ag.espaco)
    if (ag.uso_confirmado_em) throw new ErroRegra(409, "O uso deste agendamento já foi confirmado.")
    const { hoje, hora } = await relogio(c)
    if (ag.data !== hoje) throw new ErroRegra(409, "O uso só pode ser confirmado no dia do agendamento.")
    if (hora >= FIM_TURNO[ag.turno]) throw new ErroRegra(409, "O turno já foi encerrado.")
    await c.query("UPDATE agendamento SET uso_confirmado_em = now() WHERE id = $1", [id])
    // US29: com o uso do Espaço Kids confirmado, os demais da fila daquele turno saem dela
    const retirados =
      ag.espaco === "kids"
        ? (
            await c.query(
              `UPDATE fila_espera SET status = 'retirada'
                WHERE data = $1 AND turno = $2 AND status = 'aguardando' AND crianca_nome IS NOT NULL`,
              [ag.data, ag.turno],
            )
          ).rowCount ?? 0
        : 0
    return { quem: primeiroNome(ag.crianca_nome ?? ag.socio), retirados }
  })
  res.json({
    ok: true,
    mensagem:
      `Uso confirmado: ${r.quem} está no espaço.` +
      (r.retirados > 0
        ? ` ${r.retirados} sócio(s)-leitor(es) foram retirados da fila de espera do Espaço Kids deste turno.`
        : ""),
    ...(await estadoDasMesas(pool, usuario)),
  })
})

// POST /api/fila  { socioId?, data, turno, crianca?: { nome, cpf, dataNascimento } }
rotasMesas.post("/fila", exigirLogin, async (req, res) => {
  const usuario = res.locals.usuario as UsuarioLogado
  const corpo = corpoDe(req)
  const pedido = lerPedido(corpo)
  const socioId = socioDoPedido(corpo, usuario)
  const espaco = espacoDoPedido(pedido.crianca)
  const cr = pedido.crianca
  await rotinaDasMesas()

  const posicao = await emTransacao(async (c) => {
    await conferirSocio(c, socioId, !!cr)
    const hoje = await conferirTurno(c, pedido)
    if (cr) await conferirCrianca(c, cr, hoje, pedido.data)
    await travarTurno(c, pedido.data, pedido.turno, espaco)
    if (await agendamentoNoDia(c, socioId, pedido.data, cr)) {
      throw new ErroRegra(
        409,
        cr ? `${primeiroNome(cr.nome)} já tem agendamento no Espaço Kids neste dia (RN05).` : "Você já tem um agendamento neste dia (RN05).",
      )
    }
    if ((await mesasLivres(c, pedido.data, pedido.turno, espaco)).length > 0) {
      throw new ErroRegra(
        409,
        cr ? "Há mesas livres no Espaço Kids neste turno: faça o agendamento direto." : "Há mesas livres neste turno: faça o agendamento direto.",
      )
    }
    if (cr) {
      const naFila = await c.query(
        "SELECT 1 FROM fila_espera WHERE crianca_cpf = $1 AND data = $2 AND status = 'aguardando'",
        [cr.cpf, pedido.data],
      )
      if (naFila.rowCount) throw new ErroRegra(409, `${primeiroNome(cr.nome)} já está na fila do Espaço Kids neste dia.`)
    } else {
      const { rows } = await c.query<{ turno: Turno }>(
        "SELECT turno FROM fila_espera WHERE socio_id = $1 AND data = $2 AND status = 'aguardando' AND crianca_nome IS NULL",
        [socioId, pedido.data],
      )
      if (rows.some((f) => f.turno === pedido.turno)) throw new ErroRegra(409, "Você já está na fila deste turno.")
      if (rows.length > 0) throw new ErroRegra(409, "Você já está na fila de outro turno neste dia (RN05).")
    }
    await c.query(
      `INSERT INTO fila_espera (socio_id, data, turno, crianca_nome, crianca_cpf, crianca_nascimento)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [socioId, pedido.data, pedido.turno, cr?.nome ?? null, cr?.cpf ?? null, cr?.dataNascimento ?? null],
    )
    const total = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM fila_espera
        WHERE data = $1 AND turno = $2 AND status = 'aguardando' AND (crianca_nome IS NOT NULL) = $3`,
      [pedido.data, pedido.turno, espaco === "kids"],
    )
    return total.rows[0].n
  })
  res.status(201).json({
    ok: true,
    mensagem: cr
      ? `${primeiroNome(cr.nome)} entrou na fila de espera do Espaço Kids na posição ${posicao}.`
      : `Você entrou na fila de espera na posição ${posicao}.`,
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
  if (usuario.perfil !== "admin" && rows[0].socio_id !== usuario.id) throw new ErroRegra(403, NEGADO)
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
