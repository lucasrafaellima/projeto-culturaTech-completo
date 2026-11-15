// Teste de ponta a ponta das telas com a API no ar (Chrome headless, sem dependências): mesas, Espaço Kids
// (US29), fila, parcerias e doações (US24 / US25), avisos de prazo (US15) e reservas do sócio (US27 c2).
// Pré-requisitos: banco de TESTES recém-carregado com database/01 e 02, API na 3333 e npm run preview na 4173.
// Uso: npm run testar-telas-api (ou pelo scripts/testar-tudo.ps1). Grava no banco: nunca rode contra o de produção.
import { spawn } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"

const BASE = "http://localhost:4173/"
const API = "http://localhost:3333/api"
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe"
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9346", `--user-data-dir=${join(tmpdir(), "ct-telas-api-" + Date.now())}`, "--no-first-run", "--window-size=1366,900", "about:blank"])
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
let wsUrl
for (let i = 0; i < 50 && !wsUrl; i++) { await espera(200); try { wsUrl = (await (await fetch("http://127.0.0.1:9346/json")).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl } catch {} }
const ws = new WebSocket(wsUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pend = new Map()
const erros = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
  if (m.method === "Runtime.exceptionThrown") erros.push(m.params.exceptionDetails?.exception?.description ?? "exceção")
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") erros.push(m.params.args.map((a) => a.value ?? a.description).join(" "))
}
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const js = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value
await cdp("Page.enable"); await cdp("Runtime.enable")

let falhas = 0
const ok = (c, d, x) => { console.log(`${c ? "ok  " : "FALHOU"}  ${d}`); if (!c) { falhas++; if (x !== undefined) console.log("        ", String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)) } }
const texto = () => js("document.body.innerText.replace(/\\u00a0/g, ' ')")
const toast = () => js(`[...document.querySelectorAll('[role=status] span')].map(s => s.innerText).join(' | ')`)
const clicar = (rotulo, escopo = "document") =>
  js(`(() => { const b = [...${escopo}.querySelectorAll('button')].find(x => x.innerText.trim().includes(${JSON.stringify(rotulo)}) && !x.disabled); if (!b) return false; b.click(); return true })()`)
const digitar = (sel, v) =>
  js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true })()`)
const preencher = async (rotulo, v) => {
  const idCampo = await js(`[...document.querySelectorAll('label')].find(x => x.innerText.trim().startsWith(${JSON.stringify(rotulo)}))?.htmlFor ?? null`)
  if (!idCampo) throw new Error("campo não encontrado: " + rotulo)
  await digitar(`[id="${idCampo}"]`, v)
}
const sessao = async () => JSON.parse((await js(`localStorage.getItem("culturatech:sessao")`)) ?? "{}")
async function ate(fn, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await espera(150) } return false }
const esperaToast = (parte) => ate(async () => (await toast()).includes(parte))
// clica em um botão dentro do cartão do turno
const noTurno = (turno, rotulo) =>
  js(`(() => { const c = [...document.querySelectorAll('p')].find(p => p.innerText.trim() === ${JSON.stringify(turno)})?.closest('.flex.flex-col'); const b = c && [...c.querySelectorAll('button')].find(x => x.innerText.includes(${JSON.stringify(rotulo)})); if (!b) return false; b.click(); return true })()`)

const hojeLocal = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Maceio" }).format(new Date())
const dia = (n) => { const d = new Date(`${hojeLocal}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

async function entrar(usuario, senha) {
  await cdp("Page.navigate", { url: BASE + "#/entrar" })
  await ate(async () => js(`!!document.querySelector('input[autocomplete=username]')`), 10000)
  await digitar("input[autocomplete=username]", usuario)
  await digitar("input[autocomplete=current-password]", senha)
  await js("document.querySelector('form').requestSubmit()")
  return ate(async () => { const s = await sessao(); return s.perfil !== "publico" && !!s.token }, 15000)
}
async function sair() {
  await clicar("Sair")
  await ate(async () => (await sessao()).perfil === "publico")
}
async function fecharAlerta() {
  await espera(500)
  await js(`document.querySelector('[role=dialog] [aria-label=Fechar]')?.click()`)
  await espera(200)
}
const irMesas = async () => { await cdp("Page.navigate", { url: BASE + "#/mesas" }); await ate(async () => (await texto()).includes("Meus agendamentos") || (await texto()).includes("Agendamentos de")); await espera(300) }
const abaKids = async () => { await clicar("Espaço Kids"); await espera(300) }
const agendarNoTurno = (turno) => noTurno(turno, "Agendar")

// ================= cadastro =================
await cdp("Page.navigate", { url: BASE + "#/cadastro" }); await espera(1500)
ok((await texto()).includes("Data de nascimento"), "o cadastro pede a data de nascimento")

// ================= sócio: mesas de estudo =================
ok(await entrar("153.509.460-56", "123456"), "João entra pela API")
await fecharAlerta()
await irMesas()
await preencher("Data", dia(2)); await espera(300)
await agendarNoTurno("Manhã")
ok(await esperaToast("agendada"), "sócio agenda mesa de estudo pela tela, gravada no banco", await toast())
ok((await toast()).includes("15 minutos"), "a mensagem avisa da tolerância de 15 minutos (US30)")

// ================= sócio: Espaço Kids =================
await abaKids()
let t = await texto()
ok(t.includes("Mesa Kids 1") && t.includes("Nome completo da criança"), "aba Espaço Kids com as mesas do banco", t.slice(0, 600))
await agendarNoTurno("Tarde")
ok(await ate(async () => (await texto()).includes("nome completo da criança")), "criança sem nome: a API aponta o campo")
await preencher("Nome completo da criança", "Bia Santos Lima")
await preencher("CPF da criança", "153.509.460-56")
await preencher("Data de nascimento", dia(-6 * 365))
await agendarNoTurno("Tarde")
ok(await ate(async () => (await texto()).includes("pertence a um sócio-leitor")), "CPF de sócio recusado pela API")
await preencher("CPF da criança", "604.917.382-69")
await agendarNoTurno("Tarde")
ok(await esperaToast("agendada para Bia"), "agendamento no Espaço Kids gravado no banco", await toast())
await espera(300)
t = await texto()
ok(t.includes("Criança: Bia Santos Lima") && t.includes("Responsável: você"), "a lista identifica a criança", t.slice(-700))

// amanhã à tarde o Espaço Kids está lotado nos dados de exemplo
await preencher("Data", dia(1)); await espera(300)
await preencher("Nome completo da criança", "Teo Santos Lima")
await preencher("CPF da criança", "390.533.447-05")
await preencher("Data de nascimento", dia(-4 * 365))
await espera(300)
t = await texto()
ok(/Lotado/.test(t) && t.includes("1 pessoa(s) na fila"), "Espaço Kids lotado mostra a fila sem identificar ninguém", t.slice(0, 1200))
ok(!t.includes("Helena") && !t.includes("Miguel"), "o sócio não vê os dados das crianças dos outros")
await noTurno("Tarde", "Entrar na fila")
ok(await esperaToast("posição 2"), "entrar na fila Kids", await toast())
await espera(300)

await cdp("Page.navigate", { url: BASE + "#/minha-area" }); await espera(800)
t = await texto()
ok(t.includes("Espaço Kids"), "Minha Área mostra o agendamento do Espaço Kids", t.slice(0, 300))
ok(t.includes("Avisos de prazo") && t.includes("Lembrete: devolução de"), "US15: João vê na Minha Área o lembrete gerado pelo servidor", t.slice(0, 1500))
ok(!t.includes("e-mail"), "US15: a Minha Área não fala em e-mail")

await irMesas()
await abaKids()
await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await espera(300)
const largMesas = await js("[document.documentElement.scrollWidth, window.innerWidth]")
ok(largMesas[0] <= largMesas[1], "Mesas sem rolagem horizontal em 390 px", largMesas)
await cdp("Emulation.clearDeviceMetricsOverride")
await sair()

// ================= sócio de 17 anos =================
ok(await entrar("861.904.237-87", "123456"), "sócio de 17 anos entra")
await fecharAlerta()
await irMesas()
await abaKids()
t = await texto()
ok(t.includes("a partir dos 18 anos") && !t.includes("Nome completo da criança"), "sócio de 17 anos vê o motivo e não recebe o formulário da criança", t.slice(0, 900))
await sair()

// ================= administrador =================
ok(await entrar("admin", "admin123"), "admin entra pela API")
const token = (await sessao()).token
await fecharAlerta()
await irMesas()
await abaKids()
await preencher("Data", dia(1)); await espera(400)
t = await texto()
ok(t.includes("Criança: Sofia Alves Santos"), "admin vê os dados da criança", t.slice(-900))
await js(`(() => { const l = [...document.querySelectorAll('p')].find(p => p.innerText.includes('Criança: Sofia Alves Santos')); [...l.closest('.flex.flex-col').querySelectorAll('button')].find(b => b.innerText.includes('Cancelar')).click() })()`)
await espera(300)
await js(`[...document.querySelectorAll('[role=dialog] button')].find(x => x.innerText.trim() === 'Cancelar agendamento')?.click()`)
ok(await esperaToast("repassada ao primeiro"), "cancelar repassa a mesa Kids ao primeiro da fila", await toast())
await espera(300)
const mesas = await (await fetch(`${API}/mesas`, { headers: { Authorization: `Bearer ${token}` } })).json()
ok(mesas.agendamentos.some((a) => a.crianca?.nome === "Helena Costa Ramos" && a.origem === "fila"), "a criança da fila foi contemplada no banco", mesas.agendamentos)
t = await texto()
ok(t.includes("Criança: Helena Costa Ramos") && t.includes("contemplado pela fila"), "o contemplado aparece na tela", t.slice(-900))

// ================= avisos de prazo (US15) =================
await cdp("Page.navigate", { url: BASE + "#/notificacoes" }); await espera(1200)
t = await texto()
ok(t.includes("Avisos de prazo") && t.includes("João") && t.includes("Lembrete de prazo"), "US15: admin vê os avisos vindos do banco", t.slice(0, 1500))
ok(!t.includes("Reenviar"), "US15: sem reenvio de e-mail")
await clicar("Executar rotina agora")
ok(await ate(async () => (await toast()).includes("Nenhum aviso pendente") || (await toast()).includes("aviso(s) gerado(s)")), "US15: botão de rotina responde pelo servidor", await toast())

// ================= reservas do sócio (US27 c2) =================
const circ = await (await fetch(`${API}/circulacao`, { headers: { Authorization: `Bearer ${token}` } })).json()
const joao = circ.socios.find((s) => s.cpf === "15350946056")
await cdp("Page.navigate", { url: BASE + "#/socios/" + joao.id }); await espera(1200)
t = await texto()
ok(t.includes("Livros reservados") && t.includes("Reinações de Narizinho"), "US27: admin vê os livros reservados pelo sócio", t.slice(0, 1500))

// ================= parcerias =================
await cdp("Page.navigate", { url: BASE + "#/parcerias" }); await espera(800)
t = await texto()
ok(t.includes("Escola Estadual Exemplo") && t.includes("Instituto Cultural Exemplo"), "instituições vêm do banco", t.slice(0, 500))
await clicar("Novo cadastro"); await espera(300)
await preencher("Nome", "Biblioteca Comunitária Teste")
await preencher("CNPJ", "11.444.777/0001-61")
await preencher("Endereço", "Rua da Leitura, 50")
await preencher("Contato", "82988880000")
await clicar("Salvar", "document.querySelector('[role=dialog]')")
ok(await esperaToast("Receptor cadastrado"), "cadastrar instituição pela tela", await toast())
const parc = await (await fetch(`${API}/parcerias`, { headers: { Authorization: `Bearer ${token}` } })).json()
const nova = parc.instituicoes.find((i) => i.nome === "Biblioteca Comunitária Teste")
ok(!!nova && nova.documento === "11444777000161", "instituição gravada no banco", nova)

const acervo = await (await fetch(`${API}/acervo`, { headers: { Authorization: `Bearer ${token}` } })).json()
const livro = acervo.livros.find((l) => acervo.exemplares.some((x) => x.livroId === l.id && x.status === "disponivel" && !x.baixa))
const exemplar = acervo.exemplares.find((x) => x.livroId === livro.id && x.status === "disponivel" && !x.baixa)
await espera(300)
await clicar("Registrar doação"); await espera(300)
await js(`(() => { const s = document.querySelectorAll('[role=dialog] select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s[0], ${JSON.stringify(nova.id)}); s[0].dispatchEvent(new Event('change', { bubbles: true })); })()`)
await espera(200)
await js(`(() => { const s = document.querySelectorAll('[role=dialog] select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s[1], ${JSON.stringify(livro.id)}); s[1].dispatchEvent(new Event('change', { bubbles: true })); })()`)
await espera(300)
await js(`[...document.querySelectorAll('[role=dialog] label')].find(l => l.innerText.includes(${JSON.stringify(exemplar.tombamento)}))?.querySelector('input').click()`)
await espera(200)
await clicar("Registrar", "document.querySelector('[role=dialog]')")
ok(await esperaToast("Doação registrada"), "registrar doação pela tela", await toast())
await espera(300)
const depois = await (await fetch(`${API}/acervo`, { headers: { Authorization: `Bearer ${token}` } })).json()
ok(depois.exemplares.find((x) => x.id === exemplar.id)?.baixa?.motivo === "doacao", "exemplar baixado no banco")

await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await espera(300)
const largParc = await js("[document.documentElement.scrollWidth, window.innerWidth]")
ok(largParc[0] <= largParc[1], "Parcerias sem rolagem horizontal em 390 px", largParc)
await cdp("Emulation.clearDeviceMetricsOverride")

await cdp("Page.navigate", { url: BASE + "#/acervo" }); await espera(800)
await js(`[...document.querySelectorAll('button')].find(b => b.innerText.includes(${JSON.stringify(livro.titulo)}))?.click()`)
await espera(400)
t = await texto()
ok(t.includes("Doações e aquisições") && t.includes("Biblioteca Comunitária Teste") && t.includes("Doação"), "a obra mostra o receptor e a data da doação", t.slice(0, 900))

// recarregar mantém os dados do banco
await cdp("Page.reload"); await espera(2500)
await cdp("Page.navigate", { url: BASE + "#/parcerias" }); await espera(800)
t = await texto()
ok(t.includes("Biblioteca Comunitária Teste"), "os dados continuam depois de recarregar")
ok(erros.length === 0, "nenhum erro no console", erros.slice(0, 5))

console.log(falhas ? `\n${falhas} falharam` : "\nTodos passaram")
ws.close(); chrome.kill(); await espera(300); process.exit(falhas ? 1 : 0)
