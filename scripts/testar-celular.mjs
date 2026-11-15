// US30 / US17 c5 / US23 c2: as telas se adaptam ao celular e ao tablet (Chrome headless, sem dependências).
// Uso: npm run build, depois npm run preview em outro terminal (API desligada), depois npm run testar-celular
// Mede cada tela em 390 px (celular) e 768 px (tablet): nada pode passar da largura da tela, exceto o que
// fica dentro de uma área com rolagem própria (tabelas largas, por exemplo). Em 390 px, o menu fica recolhido.
import { spawn } from "node:child_process"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe"
const BASE = "http://localhost:4173/"
const perfil = join(tmpdir(), "ct-celular-" + Date.now())
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9348", `--user-data-dir=${perfil}`, "--no-first-run", "about:blank"])
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
let wsUrl
for (let i = 0; i < 50 && !wsUrl; i++) {
  await espera(200)
  try {
    wsUrl = (await (await fetch("http://127.0.0.1:9348/json")).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl
  } catch {}
}
const ws = new WebSocket(wsUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pend = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pend.has(m.id)) {
    pend.get(m.id)(m)
    pend.delete(m.id)
  }
}
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const js = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value
const digitar = (sel, v) =>
  js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })) })()`)

let falhas = 0
const ok = (c, nome) => {
  console.log(`${c ? "ok  " : "FALHOU"}  ${nome}`)
  if (!c) falhas++
}

// elementos que passam da tela sem estar dentro de uma área com rolagem própria
const medir = (largura) => js(`(() => {
  const larg = document.documentElement.scrollWidth
  const culpados = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.right <= ${largura} + 1) continue
    let p = el.parentElement, rola = false
    while (p) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { rola = true; break } p = p.parentElement }
    if (!rola) culpados.push((el.tagName + '.' + String(el.className).split(' ').slice(0, 3).join('.')).slice(0, 60))
  }
  return { larg, culpados: [...new Set(culpados)].slice(0, 3) }
})()`)

async function telas(perfilUsuario, rotas) {
  for (const largura of [390, 768]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width: largura, height: 900, deviceScaleFactor: 2, mobile: largura < 768 })
    for (const r of rotas) {
      await cdp("Page.navigate", { url: BASE + "#/" + r })
      await espera(900)
      const m = await medir(largura)
      ok(m.larg <= largura && m.culpados.length === 0, `[${perfilUsuario}] #/${r} em ${largura} px${m.culpados.length ? ": " + m.culpados.join(" | ") : ""}`)
    }
  }
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 2, mobile: true })
  await cdp("Page.navigate", { url: BASE + "#/" + rotas[0] })
  await espera(700)
  ok(await js(`!!document.querySelector('[aria-label="Abrir menu"]') && document.querySelector('[aria-label="Abrir menu"]').offsetParent !== null`), `[${perfilUsuario}] menu recolhido em 390 px, com botão para abrir`)
}

async function entrar(usuario, senha) {
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 2, mobile: true })
  await cdp("Page.navigate", { url: BASE + "#/entrar" })
  await espera(1200)
  await digitar("input[autocomplete=username]", usuario)
  await digitar("input[autocomplete=current-password]", senha)
  await js("document.querySelector('form').requestSubmit()")
  await espera(1500)
  await js(`document.querySelector('[role=dialog] [aria-label=Fechar]')?.click()`)
  await espera(300)
}
async function sair() {
  await js(`localStorage.removeItem("culturatech:sessao")`)
  await cdp("Page.navigate", { url: BASE + "#/mural" })
  await cdp("Page.reload")
  await espera(1200)
}

await cdp("Page.enable")
await cdp("Page.navigate", { url: BASE })
await espera(2500)
await telas("visitante", ["mural", "consulta", "repositorio", "entrar", "cadastro"])
await entrar("153.509.460-56", "123456")
await telas("sócio", ["minha-area", "mesas", "consulta", "repositorio", "mural"])
await sair()
await entrar("admin", "admin123")
await telas("admin", ["acervo", "socios", "circulacao", "mesas", "acompanhamento", "notificacoes", "parcerias", "importacao", "backups", "mural", "repositorio"])

ws.close()
chrome.kill()
await espera(300)
try { rmSync(perfil, { recursive: true, force: true }) } catch {}
console.log(falhas ? `\n${falhas} verificação(ões) falharam` : "\nTodas as telas se adaptam ao celular e ao tablet")
process.exit(falhas ? 1 : 0)
