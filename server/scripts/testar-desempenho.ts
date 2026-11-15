// US17 c2 (RNF07): com 5.000 livros no acervo, a busca da consulta pública responde em até 5 segundos.
// Uso: com a API (npm run dev) e o front (npm run build + npm run preview, porta 4173) rodando,
// execute npm run testar-desempenho. Precisa do Chrome (variável CHROME para outro caminho).
// Atenção: insere 5.000 obras de teste direto no banco (variáveis PG* do .env) e as apaga ao final.
// Rode contra um banco de testes, nunca contra o de produção.
import { spawn } from "node:child_process"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pool } from "../src/db.ts"

const BASE = process.env.API_URL ?? "http://localhost:3333"
const FRONT = process.env.FRONT_URL ?? "http://localhost:4173/"
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe"
const TOTAL = 5000
const LIMITE_MS = 5000

let falhas = 0
function conferir(descricao: string, condicao: boolean, detalhe?: unknown) {
  console.log(`${condicao ? "ok  " : "FALHOU"}  ${descricao}`)
  if (!condicao) {
    falhas++
    if (detalhe !== undefined) console.log("        ", JSON.stringify(detalhe).slice(0, 400))
  }
}

const prefixo = `DES${Date.now().toString(36).toUpperCase()}`
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function semear() {
  const { rowCount } = await pool.query(
    `WITH novos AS (
       INSERT INTO culturatech.livro (titulo, editora, edicao, ano, categoria, secao)
       SELECT $1 || ' Obra de carga ' || n, 'Editora de Carga', '1ª', 1950 + n % 70,
              (ARRAY['literatura','infantil','didatico','historia','ciencias'])[1 + n % 5],
              chr(65 + n % 26)
         FROM generate_series(1, $2::int) AS n
       RETURNING id, titulo)
     INSERT INTO culturatech.exemplar (livro_id, tombamento)
     SELECT id, replace(titulo, ' Obra de carga ', '-') FROM novos`,
    [prefixo, TOTAL],
  )
  return rowCount ?? 0
}

async function limpar() {
  await pool.query(
    "DELETE FROM culturatech.exemplar WHERE livro_id IN (SELECT id FROM culturatech.livro WHERE titulo LIKE $1)",
    [`${prefixo} %`],
  )
  await pool.query("DELETE FROM culturatech.livro WHERE titulo LIKE $1", [`${prefixo} %`])
}

// Mede a consulta pública no navegador: abrir a página até a lista aparecer, e uma busca por termo
async function medirNoNavegador() {
  const perfil = join(tmpdir(), "ct-desempenho-" + Date.now())
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9347", `--user-data-dir=${perfil}`, "--no-first-run", "about:blank"])
  let wsUrl: string | undefined
  for (let i = 0; i < 50 && !wsUrl; i++) {
    await espera(200)
    try {
      const alvos = (await (await fetch("http://127.0.0.1:9347/json")).json()) as { type: string; webSocketDebuggerUrl: string }[]
      wsUrl = alvos.find((t) => t.type === "page")?.webSocketDebuggerUrl
    } catch {}
  }
  const ws = new WebSocket(wsUrl!)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const pend = new Map<number, (m: { result?: { result?: { value?: unknown } } }) => void>()
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.id && pend.has(m.id)) {
      pend.get(m.id)!(m)
      pend.delete(m.id)
    }
  }
  const cdp = (method: string, params = {}) =>
    new Promise<{ result?: { result?: { value?: unknown } } }>((r) => {
      const n = ++id
      pend.set(n, r)
      ws.send(JSON.stringify({ id: n, method, params }))
    })
  const js = async (expr: string) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value
  const ate = async (expr: string, limite = 30_000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < limite) {
      if (await js(expr)) return Date.now() - t0
      await espera(50)
    }
    return Number.POSITIVE_INFINITY
  }

  await cdp("Page.enable")
  const inicio = Date.now()
  await cdp("Page.navigate", { url: FRONT + "#/consulta" })
  // a contagem soma as obras de carga às dos dados de exemplo
  const carga = await ate(`Number((document.body.innerText.match(/(\\d+) obra\\(s\\) encontrada\\(s\\)/) ?? [])[1] ?? 0) >= ${TOTAL}`)
  const tempoCarga = carga === Number.POSITIVE_INFINITY ? carga : Date.now() - inicio

  const termo = `${prefixo} Obra de carga 4321`
  const t0 = Date.now()
  await js(`(() => { const el = document.querySelector('input[aria-label="Termo de busca"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(termo)}); el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  const achou = await ate(`document.body.innerText.includes(${JSON.stringify(termo)}) && document.body.innerText.includes("1 obra(s) encontrada(s)")`)
  const tempoBusca = achou === Number.POSITIVE_INFINITY ? achou : Date.now() - t0

  ws.close()
  chrome.kill()
  await espera(300)
  try {
    rmSync(perfil, { recursive: true, force: true })
  } catch {}
  return { tempoCarga, tempoBusca }
}

try {
  const inseridos = await semear()
  conferir(`${TOTAL} obras de carga inseridas, com 1 exemplar cada`, inseridos === TOTAL, inseridos)

  const t0 = Date.now()
  const r = await fetch(`${BASE}/api/acervo/publico`)
  const corpo = (await r.json()) as { livros?: unknown[] }
  const tempoApi = Date.now() - t0
  conferir(
    `API: consulta pública com ${corpo.livros?.length ?? 0} obras em ${tempoApi} ms (limite ${LIMITE_MS} ms)`,
    r.status === 200 && (corpo.livros?.length ?? 0) >= TOTAL && tempoApi <= LIMITE_MS,
  )

  const { tempoCarga, tempoBusca } = await medirNoNavegador()
  conferir(`navegador: consulta pública carregada em ${tempoCarga} ms (limite ${LIMITE_MS} ms)`, tempoCarga <= LIMITE_MS)
  conferir(`navegador: busca por título respondida em ${tempoBusca} ms (limite ${LIMITE_MS} ms)`, tempoBusca <= LIMITE_MS)
} finally {
  await limpar()
  await pool.end()
}

console.log(falhas ? `\n${falhas} verificação(ões) falharam` : "\nTodas as verificações passaram")
process.exit(falhas ? 1 : 0)
