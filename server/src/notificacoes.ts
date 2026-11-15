import { Router } from "express"
import type pg from "pg"
import { config } from "./config.ts"
import { pool } from "./db.ts"
import { exigirAdmin, exigirLogin, type UsuarioLogado } from "./auth.ts"
import { ErroRegra, tratarErroDeRegra } from "./comum.ts"

// Avisos de prazo de devolução (RF05 / US15), entregues dentro do sistema: o sócio os vê na
// Minha Área e o administrador, em Notificações. Mesmas regras e textos de gerarNotificacoes
// e montarNotificacao (src/lib/regras.ts).

type Consulta = pg.PoolClient | pg.Pool
type Tipo = "lembrete" | "vencimento" | "atraso"

const DIAS_LEMBRETE = 3
const DESTINO = "Minha Área"
const HOJE_LOCAL = `(now() AT TIME ZONE '${config.fusoHorario}')::date`

const dataBr = (data: string) => data.split("-").reverse().join("/")
const primeiroNome = (nome: string) => nome.split(" ")[0]

function textos(tipo: Tipo, nome: string, titulo: string, prazo: string, dias: number) {
  const p = dataBr(prazo)
  if (tipo === "lembrete") {
    return {
      assunto: `Lembrete: devolução de "${titulo}" em ${p}`,
      corpo: `Olá, ${nome}! O prazo de devolução do livro "${titulo}" termina em ${p} (faltam ${dias} dia(s)). Se precisar de mais tempo, procure a biblioteca para renovar. Após o prazo, é cobrada multa de R$ 1,00 por dia.`,
    }
  }
  if (tipo === "vencimento") {
    return {
      assunto: `Hoje é o último dia para devolver "${titulo}"`,
      corpo: `Olá, ${nome}! O livro "${titulo}" deve ser devolvido hoje (${p}). A partir de amanhã é cobrada multa de R$ 1,00 por dia de atraso.`,
    }
  }
  return {
    assunto: `Devolução em atraso: "${titulo}"`,
    corpo: `Olá, ${nome}. O livro "${titulo}" deveria ter sido devolvido em ${p} e está com ${-dias} dia(s) de atraso. A multa é de R$ 1,00 por dia e novos empréstimos ficam bloqueados até a regularização.`,
  }
}

// Gera os avisos devidos hoje. Cada aviso sai uma única vez por prazo: o índice único
// (emprestimo_id, tipo, referencia) descarta o que já existe, mesmo com duas leituras ao mesmo tempo.
export async function gerarAvisos(c: Consulta): Promise<number> {
  const { rows } = await c.query<{
    emprestimo_id: string
    socio_id: string
    nome: string
    titulo: string
    prevista: string
    dias: number
  }>(
    `SELECT e.id AS emprestimo_id, e.socio_id, s.nome, l.titulo,
            to_char(e.data_prevista, 'YYYY-MM-DD') AS prevista, (e.data_prevista - ${HOJE_LOCAL})::int AS dias
       FROM emprestimo e
       JOIN socio_leitor s ON s.id = e.socio_id
       JOIN exemplar x ON x.id = e.exemplar_id
       JOIN livro l ON l.id = x.livro_id
      WHERE e.status = 'ativo' AND e.data_prevista <= ${HOJE_LOCAL} + ${DIAS_LEMBRETE}`,
  )
  let geradas = 0
  for (const r of rows) {
    const tipo: Tipo = r.dias > 0 ? "lembrete" : r.dias === 0 ? "vencimento" : "atraso"
    const t = textos(tipo, primeiroNome(r.nome), r.titulo, r.prevista, r.dias)
    const ins = await c.query(
      `INSERT INTO notificacao (socio_id, emprestimo_id, tipo, referencia, destinatario, assunto, corpo, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'enviado')
       ON CONFLICT (emprestimo_id, tipo, referencia) DO NOTHING`,
      [r.socio_id, r.emprestimo_id, tipo, r.prevista, DESTINO, t.assunto, t.corpo],
    )
    geradas += ins.rowCount ?? 0
  }
  return geradas
}

// Formato de Notificacao (src/lib/types.ts)
async function listarAvisos(c: Consulta, socioId: string | null) {
  const { rows } = await c.query(
    `SELECT id, socio_id AS "socioId", emprestimo_id AS "emprestimoId", tipo,
            to_char(referencia, 'YYYY-MM-DD') AS referencia, destinatario, assunto, corpo, data, status
       FROM notificacao
      WHERE $1::uuid IS NULL OR socio_id = $1
      ORDER BY data DESC, id
      LIMIT 200`,
    [socioId],
  )
  return rows
}

export const rotasNotificacoes = Router()

// GET /api/notificacoes  (admin: todos os avisos)
rotasNotificacoes.get("/notificacoes", exigirAdmin, async (_req, res) => {
  await gerarAvisos(pool)
  res.json({ ok: true, notificacoes: await listarAvisos(pool, null) })
})

// POST /api/notificacoes/rotina  (admin: "Executar rotina agora")
rotasNotificacoes.post("/notificacoes/rotina", exigirAdmin, async (_req, res) => {
  const geradas = await gerarAvisos(pool)
  res.json({
    ok: true,
    mensagem:
      geradas > 0
        ? `${geradas} aviso(s) gerado(s).`
        : "Nenhum aviso pendente para hoje: todos os avisos devidos já foram gerados.",
    geradas,
    notificacoes: await listarAvisos(pool, null),
  })
})

// GET /api/eu/notificacoes  (sócio: só os próprios avisos)
rotasNotificacoes.get("/eu/notificacoes", exigirLogin, async (_req, res) => {
  const usuario = res.locals.usuario as UsuarioLogado
  if (usuario.perfil !== "socio") throw new ErroRegra(403, "Acesso negado: esta operação não é permitida para o seu perfil.")
  await gerarAvisos(pool)
  res.json({ ok: true, notificacoes: await listarAvisos(pool, usuario.id) })
})

rotasNotificacoes.use(tratarErroDeRegra)
