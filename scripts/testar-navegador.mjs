// Teste de ponta a ponta com Chrome headless via DevTools Protocol (sem dependências).
// Uso: npm run build, depois npm run preview em outro terminal, depois npm run testar-navegador
import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe"
const BASE = "http://localhost:4173/"
const SAIDA = new URL("../.verificar/telas/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")
mkdirSync(SAIDA, { recursive: true })
const perfil = join(tmpdir(), "ct-chrome-" + Date.now())

const chrome = spawn(CHROME, [
  "--headless=new",
  "--remote-debugging-port=9333",
  `--user-data-dir=${perfil}`,
  "--no-first-run",
  "--window-size=1366,900",
  "about:blank",
])

const espera = (ms) => new Promise((r) => setTimeout(r, ms))
let wsUrl
for (let i = 0; i < 50 && !wsUrl; i++) {
  await espera(200)
  try {
    const alvos = await (await fetch("http://127.0.0.1:9333/json")).json()
    wsUrl = alvos.find((t) => t.type === "page")?.webSocketDebuggerUrl
  } catch {}
}
const ws = new WebSocket(wsUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pendentes = new Map()
const erros = []
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pendentes.has(msg.id)) {
    pendentes.get(msg.id)(msg)
    pendentes.delete(msg.id)
  }
  if (msg.method === "Runtime.exceptionThrown") erros.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text)
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error")
    erros.push(msg.params.args.map((a) => a.value ?? a.description).join(" "))
}
const cdp = (method, params = {}) =>
  new Promise((r) => {
    const n = ++id
    pendentes.set(n, r)
    ws.send(JSON.stringify({ id: n, method, params }))
  })
const js = async (expr) => {
  const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "erro JS")
  return r.result?.result?.value
}
const foto = async (nome) => {
  const r = await cdp("Page.captureScreenshot", { format: "png" })
  writeFileSync(join(SAIDA, nome + ".png"), Buffer.from(r.result.data, "base64"))
}
const ir = async (hash) => {
  await js(`location.hash = ${JSON.stringify(hash)}`)
  await espera(500)
}
const texto = () => js("document.body.innerText.replace(/\\u00a0/g, ' ')")
const clicar = (rotulo) =>
  js(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim().includes(${JSON.stringify(rotulo)}) && !x.disabled); if (!b) return false; b.click(); return true })()`)
const digitar = (seletor, valor) =>
  js(`(() => { const el = document.querySelector(${JSON.stringify(seletor)}); const set = Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(valor)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true })()`)
const toast = () => js(`[...document.querySelectorAll('[role=status] span')].map(s => s.innerText).join(' | ')`)
// preenche o campo cujo <label> tem exatamente o texto informado
const preencher = async (rotulo, valor) => {
  const id = await js(
    `[...document.querySelectorAll('label')].find(x => x.innerText.trim() === ${JSON.stringify(rotulo)})?.htmlFor ?? null`,
  )
  if (!id) throw new Error("campo não encontrado: " + rotulo)
  return digitar(`[id="${id}"]`, valor)
}
const slideAtual = () =>
  js(`document.querySelector('[aria-roledescription=slide][aria-hidden=false]')?.getAttribute('aria-label') ?? ''`)
const opacidadeLerMais = () =>
  js(`(() => { const s = document.querySelector('[aria-roledescription=slide][aria-hidden=false]'); const b = [...s.querySelectorAll('button')].find(x => x.innerText.includes('Ler mais')); return getComputedStyle(b.parentElement.parentElement.parentElement).opacity })()`)

let falhas = 0
const ok = (c, nome) => {
  console.log(`${c ? "ok  " : "FALHOU"} ${nome}`)
  if (!c) falhas++
}

await cdp("Runtime.enable")
await cdp("Page.enable")
await cdp("Page.navigate", { url: BASE })
await espera(2500)

// ---------------- Visitante ----------------
let t = await texto()
ok(t.includes("Mural Cultural") && t.includes("Festival de Cordel"), "visitante vê o mural (RF12)")
ok(!t.includes("Circulação") && !t.includes("Sócios-leitores"), "visitante não vê menu administrativo (RNF02)")
await foto("01-mural-visitante")

// Mural em slides
ok(await js("!!document.querySelector('[aria-roledescription=carrossel]')"), "mural exibe as publicações em slides")
const primeiro = await slideAtual()
await js(`document.querySelector('[aria-label="Próximo slide"]').click()`)
await espera(900)
ok((await slideAtual()) !== primeiro, "botão de próximo slide troca a publicação")
await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1300, y: 880 })
await espera(400)
ok((await opacidadeLerMais()) === "0", "'Ler mais' fica oculto sem o cursor")
const caixa = await js(
  `(() => { const r = document.querySelector('[aria-roledescription=slide][aria-hidden=false]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
)
await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: caixa.x, y: caixa.y })
await espera(500)
ok((await opacidadeLerMais()) === "1", "'Ler mais' aparece ao passar o cursor no slide")
const parado = await slideAtual()
await espera(6800)
ok((await slideAtual()) === parado, "slide não troca enquanto o cursor está sobre ele")
await foto("01b-mural-slide-cursor")
await js(`[...document.querySelector('[aria-roledescription=slide][aria-hidden=false]').querySelectorAll('button')].find(x => x.innerText.includes('Ler mais')).click()`)
await espera(400)
t = await texto()
ok((await js("!!document.querySelector('[role=dialog]')")) && t.includes(parado.split(": ").slice(1).join(": ")), "'Ler mais' abre a publicação completa")
await js("document.querySelector('[aria-label=Fechar]')?.click()")
await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1300, y: 880 })
await espera(300)

// Criar conta (cadastro de usuário)
await ir("#/entrar")
ok(await clicar("Criar conta"), "tela de login oferece 'Criar conta'")
await espera(400)
await js("document.querySelector('form').requestSubmit()")
await espera(300)
ok((await texto()).includes("nome completo"), "cadastro valida campos obrigatórios")
await preencher("Nome completo", "Carla Mendes Rocha")
await preencher("CPF", "390.533.447-05")
ok((await texto()).includes("RG (opcional)"), "RG aparece marcado como (opcional) no cadastro")
// RG não é preenchido de propósito: o campo é opcional
await preencher("Telefone", "(82) 99876-5432")
await preencher("E-mail", "carla.rocha@email.com")
await preencher("Rua", "Rua Nova")
await preencher("Número", "10")
await preencher("Bairro", "Centro")
await preencher("CEP", "57300-100")
await preencher("Senha", "segredo1")
await preencher("Confirmar senha", "outra")
await js("document.querySelector('form input[type=checkbox]').click()")
await js("document.querySelector('form').requestSubmit()")
await espera(300)
ok((await texto()).includes("As senhas não conferem"), "cadastro confere a confirmação da senha")
await preencher("Confirmar senha", "segredo1")
await js("document.querySelector('form').requestSubmit()")
await espera(600)
ok((await toast()).includes("Conta criada") && (await texto()).includes("Carla"), "conta criada e usuário já entra no sistema")
await clicar("Sair")
await espera(400)
await ir("#/entrar")
await digitar("input[autocomplete=username]", "390.533.447-05")
await digitar("input[autocomplete=current-password]", "segredo1")
await js("document.querySelector('form').requestSubmit()")
await espera(600)
ok((await texto()).includes("Carla"), "nova conta entra com CPF e senha")
await clicar("Sair")
await espera(400)
await ir("#/mural")

await ir("#/consulta")
t = await texto()
ok(t.includes("obra(s) encontrada(s)"), "consulta pública sem login (RF06)")
await digitar('input[aria-label="Termo de busca"]', "assare")
await espera(300)
t = await texto()
ok(t.includes("Cante lá que eu canto cá") && t.includes("1 obra(s)") === false, "busca ignora acentos (autor Assaré)")
ok(t.includes("Consulta local"), "RN04 obra de cordel marcada como consulta local")
await digitar('input[aria-label="Termo de busca"]', "")
await digitar('select[aria-label="Filtrar por seção"]', "M")
await espera(300)
t = await texto()
ok(t.includes("Menino de Engenho") && !t.includes("Vidas Secas"), "filtro por seção (RN22)")
await foto("02-consulta")

await ir("#/consulta/l6")
await espera(400)
t = await texto()
ok(t.includes("A Hora da Estrela") && t.includes("Indisponível") && !t.includes("Em restauro"), "RN30 visitante vê 'Indisponível' no lugar de 'Em restauro'")
await foto("03-detalhe-obra-rn30")

await ir("#/acervo")
t = await texto()
ok(!t.includes("Nova obra"), "visitante redirecionado ao tentar abrir o acervo (RNF02)")

await ir("#/repositorio/demo-pdf-fundacao")
await espera(1500)
const iframe = await js("!!document.querySelector('iframe[src^=\"blob:\"]')")
ok(iframe, "PDF descomprimido e exibido no navegador (RF17)")
ok((await texto()).includes("somente consulta digital"), "obra rara: aviso de somente consulta digital (US18)")
await foto("04-visualizador-pdf")

// ---------------- Sócio com pendências ----------------
await ir("#/entrar")
await digitar("#" + (await js("document.querySelector('input[autocomplete=username]').id")), "529.982.247-25")
await digitar("input[autocomplete=current-password]", "senha-errada")
await js("document.querySelector('form').requestSubmit()")
await espera(300)
t = await texto()
ok(t.includes("Usuário ou senha incorretos"), "senha errada recusada")
await digitar("input[autocomplete=current-password]", "123456")
await js("document.querySelector('form').requestSubmit()")
await espera(800)
t = await texto()
ok(t.includes("Você possui pendências"), "RN11 alerta de pendências ao entrar")
await foto("05-alerta-pendencias")
await clicar("Ver minhas pendências")
await espera(500)
t = await texto()
ok(t.includes("Bloqueado") && t.includes("Meu histórico de leitura"), "Minha Área com situação e histórico (RF04)")
await foto("06-minha-area")

await ir("#/socios")
t = await texto()
ok(!t.includes("Novo sócio-leitor"), "sócio não acessa gestão de sócios (RN29)")

await ir("#/consulta/l7")
await espera(400)
await clicar("Reservar para retirada")
await espera(300)
ok((await toast()).includes("RN08"), "RN08 sócio bloqueado não consegue reservar")
await js("document.querySelector('[aria-label=Fechar]')?.click()")

await ir("#/mesas")
await espera(300)
t = await texto()
ok(t.includes("Manhã") && t.includes("Tarde") && t.includes("Noite"), "grade de mesas por turno (RN10)")
await foto("07-mesas")

await clicar("Sair")
await espera(400)

// ---------------- Administrador ----------------
await ir("#/entrar")
await digitar("input[autocomplete=username]", "admin")
await digitar("input[autocomplete=current-password]", "admin123")
await js("document.querySelector('form').requestSubmit()")
await espera(800)
t = await texto()
ok(t.includes("Circulação") && t.includes("Empréstimos em andamento"), "admin entra na Circulação")
await foto("08-circulacao")

// RN08: Maria Joana bloqueada (sócio localizado pela busca por nome ou CPF, T05)
const escolherSocio = async (busca, nome) => {
  await preencher("Sócio-leitor", busca)
  await espera(250)
  return js(`(() => { const o = [...document.querySelectorAll('[role=dialog] [role=option]')].find(x => x.innerText.includes(${JSON.stringify(nome)})); o?.click(); return !!o })()`)
}
await clicar("Novo empréstimo")
await espera(300)
ok(await escolherSocio("529.982", "Maria Joana"), "busca de sócio pelo CPF no empréstimo (T05)")
await espera(200)
t = await texto()
ok(t.includes("Novos empréstimos estão bloqueados (RN08)"), "RN08 aviso de bloqueio no empréstimo")
ok(
  t.includes("Data de saída") && t.includes("Devolução prevista") && (await js(`[...document.querySelectorAll('[role=dialog] button')].find(b => b.innerText.includes('Confirmar empréstimo'))?.disabled`)),
  "datas exibidas e confirmação travada para sócio bloqueado (US10)",
)
// João Pedro: empréstimo de um exemplar de cordel deve ser recusado na lista
await clicar("Trocar")
await espera(200)
ok(await escolherSocio("joao", "João Pedro"), "busca de sócio pelo nome, sem acento")
await preencher("Exemplar", "Cante")
await espera(300)
t = await texto()
ok(t.includes("consulta local (RN04)"), "RN04 exemplar de cordel aparece como não emprestável")
await preencher("Exemplar", "Vidas")
await espera(300)
await js(`[...document.querySelectorAll('[role=dialog] [role=listbox][aria-label=Exemplares] [role=option]')].find(o => !o.disabled)?.click()`)
await clicar("Confirmar empréstimo")
await espera(400)
ok((await toast()).includes("Empréstimo registrado"), "empréstimo registrado com prazo de 14 dias (RN02)")

// Renovação: só aparece quando é permitida (T19)
ok(
  await js(`(() => { const tr = [...document.querySelectorAll('tbody tr')].find(r => r.innerText.includes('Maria Joana')); return !!tr && !tr.innerText.includes('Renovar') && tr.innerText.includes('Não renovável') })()`),
  "renovação oculta para empréstimo atrasado (T19)",
)
await clicar("Renovar")
await espera(300)
ok((await toast()).includes("renovado"), "renovação acrescenta 14 dias (RN02)")

// Devolução com atraso (Maria Joana, emp1)
const devolveu = await js(`(() => { const tr = [...document.querySelectorAll('tbody tr')].find(r => r.innerText.includes('Maria Joana')); const b = tr && [...tr.querySelectorAll('button')].find(x => x.innerText.includes('Devolver')); b?.click(); return !!b })()`)
await espera(300)
t = await texto()
ok(devolveu && t.includes("5 dia(s) de atraso") && t.includes("R$ 5,00"), "RN03 multa de R$ 1,00/dia calculada na devolução")
await foto("09-devolucao-atraso")
await clicar("Confirmar devolução")
await espera(400)
ok((await toast()).includes("Multa por atraso"), "multa de atraso gerada")

// Julgar justificativa (Ana Beatriz)
await clicar("Multas")
await espera(300)
await clicar("Julgar justificativa")
await espera(300)
await digitar("[role=dialog] textarea", "curto")
await clicar("Deferir (abonar multa)")
await espera(300)
ok((await toast()).includes("parecer"), "RN07 parecer obrigatório")
await digitar("[role=dialog] textarea", "Atestado médico apresentado no balcão comprova a internação.")
await clicar("Deferir (abonar multa)")
await espera(300)
ok((await toast()).includes("abonada"), "RN07 multa abonada com justificativa registrada")
await foto("10-multas")

// Acervo: desbaste de exemplar disponível deve ser recusado; ocioso aceito
await ir("#/acervo")
await clicar("Aptos a desbaste")
await espera(300)
t = await js("document.querySelector('main').innerText") // sem os avisos (toasts) ainda na tela
ok(t.includes("BMA-1008") && t.includes("BMA-1014") && !t.includes("BMA-1001"), "RN31 somente ociosos/danificados aparecem para desbaste")
await clicar("Desbastar")
await espera(300)
await clicar("Confirmar desbaste")
await espera(300)
ok((await toast()).includes("RN24"), "RN24 relatório obrigatório no desbaste")
await digitar("[role=dialog] textarea", "Exemplar sem empréstimos há mais de 5 anos; a obra possui outro exemplar em bom estado.")
await clicar("Confirmar desbaste")
await espera(300)
ok((await toast()).includes("desbastado"), "desbaste com relatório concluído")
await clicar("Obras e exemplares")
await clicar("Nova obra")
await espera(300)
await foto("11-cadastro-obra")
await js("document.querySelector('[aria-label=Fechar]')?.click()")

// Parcerias: RN26
await ir("#/parcerias")
await clicar("Registrar doação")
await espera(300)
await digitar("[role=dialog] select", "inst3")
await espera(200)
t = await texto()
ok(t.includes("já recebeu 1 de 1"), "RN26 aviso de limite da pessoa física")
await js("document.querySelector('[aria-label=Fechar]')?.click()")
await foto("12-parcerias")

// Notificações
await ir("#/notificacoes")
t = await texto()
ok(t.includes("Falha") && t.includes("sem e-mail"), "RF05 falha de envio registrada para tratamento")
await foto("13-notificacoes")

// Sócios
await ir("#/socios")
await clicar("Novo sócio-leitor")
await espera(300)
await foto("14-cadastro-socio")
await clicar("Cadastrar")
await espera(300)
ok((await toast()).length > 0, "validação no cadastro de sócio")
await js("document.querySelector('[aria-label=Fechar]')?.click()")

await ir("#/importacao")
await foto("15-importacao")
await ir("#/backups")
t = await texto()
ok(t.includes("Automático"), "RNF05 backup automático do dia gerado")

// Persistência
await cdp("Page.reload")
await espera(2000)
await ir("#/circulacao")
t = await texto()
ok(t.includes("Empréstimos em andamento"), "sessão e dados persistem após recarregar")

// Celular (US30)
await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await ir("#/circulacao")
await espera(400)
const largCirc = await js("document.documentElement.scrollWidth")
ok(
  largCirc <= 390 && (await js("[...document.querySelectorAll('main li')].some(li => li.innerText.includes('Devolver'))")),
  `circulação em cartões, sem rolagem horizontal no celular (US30) [${largCirc}px]`,
)
await foto("15b-circulacao-celular")
await ir("#/mural")
await espera(400)
const larg = await js("document.documentElement.scrollWidth")
ok(larg <= 390, `layout sem rolagem horizontal no celular (RNF11) [${larg}px]`)
await digitar('input[aria-label="Buscar no mural"]', "cordel")
await espera(300)
ok(
  (await js("[...document.querySelectorAll('[aria-roledescription=slide]')].every(s => /cordel/i.test(s.innerText))")) &&
    (await js("document.querySelectorAll('[aria-roledescription=slide]').length")) > 0,
  "busca no mural filtra as publicações (US22)",
)
await digitar('input[aria-label="Buscar no mural"]', "")
await espera(300)
await foto("16-mural-celular")
await js("document.querySelector('[aria-label=\"Abrir menu\"]').click()")
await espera(400)
await foto("17-menu-celular")

ok(erros.length === 0, `nenhum erro no console${erros.length ? ": " + erros.slice(0, 3).join(" || ") : ""}`)

ws.close()
chrome.kill()
await espera(500)
try { rmSync(perfil, { recursive: true, force: true }) } catch {}
console.log(falhas === 0 ? "\nTodos os testes de navegador passaram." : `\n${falhas} teste(s) falharam.`)
process.exit(falhas ? 1 : 0)
