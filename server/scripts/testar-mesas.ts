// Testa as rotas de mesas de estudo, fila de espera e espaço infantil (RF10 / RF11 / US28).
// Uso: com a API rodando (npm run dev), execute npm run testar-mesas
// Atenção: grava no banco. Cria sócios de teste e os apaga ao final, com seus agendamentos.
// Usa as mesmas variáveis PG* da API (server/.env).
import { pool } from "../src/db.ts"

const BASE = process.env.API_URL ?? "http://localhost:3333"

let falhas = 0
function conferir(descricao: string, condicao: boolean, detalhe?: unknown) {
  console.log(`${condicao ? "ok  " : "FALHOU"}  ${descricao}`)
  if (!condicao) {
    falhas++
    if (detalhe !== undefined) console.log("        ", JSON.stringify(detalhe).slice(0, 600))
  }
}

async function chamar(metodo: string, rota: string, corpo?: unknown, token?: string) {
  const r = await fetch(`${BASE}/api${rota}`, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  return { status: r.status, corpo: await r.json() }
}

async function entrar(usuario: string, senha: string): Promise<string> {
  const r = await chamar("POST", "/auth/login", { usuario, senha })
  if (r.status !== 200) throw new Error(`Login de ${usuario} falhou: ${JSON.stringify(r.corpo)}`)
  return r.corpo.token
}

function cpfAleatorio(): string {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10))
  const dv = (base: number[]) => {
    const soma = base.reduce((a, d, i) => a + d * (base.length + 1 - i), 0)
    const r = (soma * 10) % 11
    return r === 10 ? 0 : r
  }
  n.push(dv(n))
  n.push(dv(n))
  return n.join("")
}

const hojeLocal = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Maceio" }).format(new Date())
const horaLocal = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Maceio", hour: "numeric", hourCycle: "h23" }).format(new Date()))
const hojeMais = (dias: number) => {
  const d = new Date(`${hojeLocal}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

const sufixo = Date.now().toString(36).toUpperCase()
const admin = await entrar("admin", "admin123")
const criados: string[] = []

async function novoSocio(apelido: string, dataNascimento: string | null = "1990-05-20") {
  const cpf = cpfAleatorio()
  const r = await chamar(
    "POST",
    "/socios",
    {
      nome: `${apelido} Mesa ${sufixo}`,
      cpf,
      rg: "",
      telefone: "82999990000",
      email: `${apelido.toLowerCase()}.${sufixo.toLowerCase()}@example.com`,
      endereco: { rua: "Rua do Teste", numero: "1", bairro: "Centro", cep: "57300000" },
      senha: "senha-teste",
      consentimentoLgpd: true,
      dataNascimento: dataNascimento ?? "1990-05-20",
    },
    admin,
  )
  if (r.status !== 201) throw new Error(`Cadastro de ${apelido} falhou: ${JSON.stringify(r.corpo)}`)
  const id = r.corpo.socio.id as string
  criados.push(id)
  if (dataNascimento === null) await pool.query("UPDATE culturatech.socio_leitor SET data_nascimento = NULL WHERE id = $1", [id])
  return { id, token: await entrar(cpf, "senha-teste") }
}

const ana = await novoSocio("Ana")
const beto = await novoSocio("Beto")
const caio = await novoSocio("Caio")
const dani = await novoSocio("Dani")
const eva = await novoSocio("Eva")
const menor = await novoSocio("Menor", hojeMais(-365 * 15))
const semData = await novoSocio("Semdata", null)

const agendar = (corpo: unknown, t: string) => chamar("POST", "/agendamentos", corpo, t)
const naFila = (corpo: unknown, t: string) => chamar("POST", "/fila", corpo, t)

// ---------- acesso e leitura ----------
conferir("GET /mesas sem token: 401", (await chamar("GET", "/mesas")).status === 401)
conferir("POST /agendamentos sem token: 401", (await chamar("POST", "/agendamentos", {})).status === 401)
const mesas = await chamar("GET", "/mesas", undefined, ana.token)
conferir("GET /mesas de sócio", mesas.status === 200 && Array.isArray(mesas.corpo.mesas), mesas.corpo)
const estudo = (mesas.corpo.mesas as { id: string; espaco: string }[]).filter((m) => m.espaco === "estudo")
const infantil = (mesas.corpo.mesas as { id: string; espaco: string }[]).filter((m) => m.espaco === "infantil")
conferir("há mesas de estudo e infantis", estudo.length > 0 && infantil.length > 0, mesas.corpo.mesas)

// ---------- datas e turnos ----------
const D = hojeMais(10)
const passada = await agendar({ data: hojeMais(-1), turno: "manha" }, ana.token)
conferir("data passada: 409", passada.status === 409 && passada.corpo.mensagem.includes("passada"), passada.corpo)
const longe = await agendar({ data: hojeMais(31), turno: "manha" }, ana.token)
conferir("mais de 30 dias: 409", longe.status === 409 && longe.corpo.mensagem.includes("30 dias"), longe.corpo)
conferir("turno inválido: 400", (await agendar({ data: D, turno: "madrugada" }, ana.token)).status === 400)
if (horaLocal >= 12) {
  const encerrado = await agendar({ data: hojeLocal, turno: "manha" }, ana.token)
  conferir("turno encerrado: 409", encerrado.status === 409 && encerrado.corpo.mensagem.includes("encerrado"), encerrado.corpo)
} else {
  console.log("--    turno encerrado não testado antes do meio-dia")
}

// ---------- agendar (US19 / RN09 / RN05) ----------
const a1 = await agendar({ data: D, turno: "manha", mesaId: estudo[0].id }, ana.token)
conferir("agendar mesa escolhida: 201", a1.status === 201 && a1.corpo.mensagem.includes("agendada"), a1.corpo)
const ocupada = await agendar({ data: D, turno: "manha", mesaId: estudo[0].id }, beto.token)
conferir("mesa ocupada: 409 (RN09)", ocupada.status === 409 && ocupada.corpo.mensagem.includes("RN09"), ocupada.corpo)
const outroTurno = await agendar({ data: D, turno: "tarde" }, ana.token)
conferir("segundo turno no dia: 409 (RN05)", outroTurno.status === 409 && outroTurno.corpo.mensagem.includes("RN05"), outroTurno.corpo)
const ignoraSocio = await agendar({ data: hojeMais(11), turno: "manha", socioId: beto.id }, ana.token)
conferir(
  "sócio não agenda em nome de outro: vale o token",
  ignoraSocio.status === 201 &&
    ignoraSocio.corpo.agendamentos.some((x: { socioId: string; data: string }) => x.socioId === ana.id && x.data === hojeMais(11)),
  ignoraSocio.corpo,
)
const paraBeto = await agendar({ socioId: beto.id, data: hojeMais(12), turno: "tarde" }, admin)
conferir("admin agenda para o sócio", paraBeto.status === 201, paraBeto.corpo)
conferir("admin sem socioId: 400", (await agendar({ data: D, turno: "tarde" }, admin)).status === 400)

// ---------- concorrência: última mesa ----------
const C = hojeMais(13)
for (let i = 0; i < estudo.length - 1; i++) {
  const s = await novoSocio(`Lota${i}`)
  await agendar({ data: C, turno: "noite" }, s.token)
}
const corrida = await Promise.all([agendar({ data: C, turno: "noite" }, beto.token), agendar({ data: C, turno: "noite" }, caio.token)])
const ganhou = corrida.filter((r) => r.status === 201).length
conferir("duas pessoas pela última mesa: só uma passa", ganhou === 1 && corrida.some((r) => r.corpo.ofereceFila === true), corrida.map((r) => r.corpo.mensagem))

// ---------- fila (US20 / RF11) ----------
const F = hojeMais(14)
const direto = await naFila({ data: F, turno: "manha" }, ana.token)
conferir("fila com mesa livre: 409", direto.status === 409 && direto.corpo.mensagem.includes("mesas livres"), direto.corpo)

let primeiroAg = ""
const ocupantes = [ana, ...(await Promise.all(Array.from({ length: estudo.length - 1 }, (_, i) => novoSocio(`Ocu${i}`))))]
for (const s of ocupantes) {
  const r = await agendar({ data: F, turno: "manha" }, s.token)
  if (s === ana) primeiroAg = r.corpo.agendamentos.find((x: { socioId: string; data: string }) => x.socioId === ana.id && x.data === F).id
}
const lotado = await agendar({ data: F, turno: "manha" }, beto.token)
conferir("espaço lotado oferece a fila", lotado.status === 409 && lotado.corpo.ofereceFila === true, lotado.corpo)
const f1 = await naFila({ data: F, turno: "manha" }, beto.token)
conferir("entrar na fila: posição 1", f1.status === 201 && f1.corpo.mensagem.includes("posição 1"), f1.corpo)
const repetida = await naFila({ data: F, turno: "manha" }, beto.token)
conferir("fila repetida: 409", repetida.status === 409 && repetida.corpo.mensagem.includes("já está na fila"), repetida.corpo)
const f2 = await naFila({ data: F, turno: "manha" }, caio.token)
conferir("segundo da fila: posição 2", f2.status === 201 && f2.corpo.mensagem.includes("posição 2"), f2.corpo)
const f3 = await naFila({ data: F, turno: "manha" }, dani.token)
conferir("terceiro da fila: posição 3", f3.status === 201 && f3.corpo.mensagem.includes("posição 3"), f3.corpo)

// privacidade
const visaoEva = (await chamar("GET", "/mesas", undefined, eva.token)).corpo
const filaF = (visao: { fila: { data: string; turno: string; socioId: string; espaco: string }[] }) =>
  visao.fila.filter((x) => x.data === F && x.turno === "manha" && x.espaco === "estudo")
conferir("outro sócio vê a fila sem identificação", filaF(visaoEva).length === 3 && filaF(visaoEva).every((x) => x.socioId === ""), filaF(visaoEva))
conferir(
  "outro sócio vê a ocupação sem identificação",
  visaoEva.agendamentos.filter((x: { data: string }) => x.data === F).every((x: { socioId: string }) => x.socioId === ""),
)
const visaoCaio = (await chamar("GET", "/mesas", undefined, caio.token)).corpo
conferir("sócio se reconhece na fila", filaF(visaoCaio).findIndex((x) => x.socioId === caio.id) === 1, filaF(visaoCaio))

// desistir reordena
const entradaCaio = f2.corpo.fila.find((x: { socioId: string }) => x.socioId === caio.id).id
conferir("outro sócio não desiste por mim: 403", (await chamar("POST", `/fila/${entradaCaio}/desistir`, {}, eva.token)).status === 403)
const desistiu = await chamar("POST", `/fila/${entradaCaio}/desistir`, {}, caio.token)
conferir("desistir da fila", desistiu.status === 200 && desistiu.corpo.mensagem.includes("reordenadas"), desistiu.corpo)
const visaoDani = (await chamar("GET", "/mesas", undefined, dani.token)).corpo
conferir("fila reordenada: Dani passa a ser o 2º", filaF(visaoDani).findIndex((x) => x.socioId === dani.id) === 1, filaF(visaoDani))

// mesa liberada contempla o primeiro
conferir("outro sócio não cancela: 403", (await chamar("POST", `/agendamentos/${primeiroAg}/cancelar`, {}, eva.token)).status === 403)
const cancelou = await chamar("POST", `/agendamentos/${primeiroAg}/cancelar`, {}, ana.token)
conferir("cancelar repassa a mesa", cancelou.status === 200 && cancelou.corpo.mensagem.includes("primeiro da fila"), cancelou.corpo)
const contemplado = await pool.query(
  `SELECT a.origem, f.status FROM culturatech.fila_espera f JOIN culturatech.agendamento a ON a.id = f.agendamento_id
    WHERE f.socio_id = $1 AND f.data = $2`,
  [beto.id, F],
)
conferir("primeiro contemplado com origem fila", contemplado.rows[0]?.origem === "fila" && contemplado.rows[0]?.status === "contemplado", contemplado.rows)
conferir("cancelar de novo: 404", (await chamar("POST", `/agendamentos/${primeiroAg}/cancelar`, {}, ana.token)).status === 404)

// fila expira
await pool.query(
  "UPDATE culturatech.fila_espera SET data = $3 WHERE socio_id = $1 AND data = $2 AND status = 'aguardando'",
  [dani.id, F, hojeMais(-1)],
)
await chamar("GET", "/mesas", undefined, admin)
const expirada = await pool.query("SELECT status FROM culturatech.fila_espera WHERE socio_id = $1 AND data = $2", [dani.id, hojeMais(-1)])
conferir("fila de turno encerrado expira", expirada.rows[0]?.status === "expirada", expirada.rows)

// ---------- US28: espaço infantil ----------
const I = hojeMais(15)
const crianca = (nome: string, idade = 6) => ({ nome, idade })
const semNascimento = await agendar({ data: I, turno: "manha", crianca: crianca("Bia") }, semData.token)
conferir("sem data de nascimento: 409", semNascimento.status === 409 && semNascimento.corpo.mensagem.includes("data de nascimento"), semNascimento.corpo)
const menorDe16 = await agendar({ data: I, turno: "manha", crianca: crianca("Bia") }, menor.token)
conferir("menor de 16: 409", menorDe16.status === 409 && menorDe16.corpo.mensagem.includes("16 anos"), menorDe16.corpo)
conferir("menor de 16 agenda para si", (await agendar({ data: I, turno: "manha" }, menor.token)).status === 201)
conferir("idade inválida da criança: 400", (await agendar({ data: I, turno: "tarde", crianca: crianca("Bia", 12) }, eva.token)).status === 400)
conferir("criança sem nome: 400", (await agendar({ data: I, turno: "tarde", crianca: { nome: " ", idade: 5 } }, eva.token)).status === 400)
const criancaEmEstudo = await agendar({ data: I, turno: "tarde", mesaId: estudo[0].id, crianca: crianca("Bia") }, eva.token)
conferir("criança em mesa de estudo: 409", criancaEmEstudo.status === 409 && criancaEmEstudo.corpo.mensagem.includes("espaço infantil"), criancaEmEstudo.corpo)
const adultoEmInfantil = await agendar({ data: I, turno: "tarde", mesaId: infantil[0].id }, eva.token)
conferir("adulto em mesa infantil: 409", adultoEmInfantil.status === 409 && adultoEmInfantil.corpo.mensagem.includes("espaço infantil"), adultoEmInfantil.corpo)

const proprio = await agendar({ data: I, turno: "manha" }, eva.token)
conferir("agendamento próprio de manhã", proprio.status === 201, proprio.corpo)
const mesmoTurno = await agendar({ data: I, turno: "manha", crianca: crianca("Bia") }, eva.token)
conferir("criança no mesmo turno do responsável: 409", mesmoTurno.status === 409 && mesmoTurno.corpo.mensagem.includes("mesa de estudo"), mesmoTurno.corpo)
const criancaTarde = await agendar({ data: I, turno: "tarde", crianca: crianca("Bia") }, eva.token)
conferir("criança em outro turno não conta na RN05", criancaTarde.status === 201, criancaTarde.corpo)
const minhaCrianca = criancaTarde.corpo.agendamentos.find((x: { socioId: string; crianca?: { nome: string } }) => x.socioId === eva.id && x.crianca)
conferir("responsável vê os dados da criança", minhaCrianca?.crianca?.nome === "Bia" && minhaCrianca?.crianca?.idade === 6, minhaCrianca)
const mesmaCrianca = await agendar({ data: I, turno: "noite", crianca: crianca("bia") }, eva.token)
conferir("mesma criança duas vezes no dia: 409", mesmaCrianca.status === 409 && mesmaCrianca.corpo.mensagem.includes("já tem um agendamento"), mesmaCrianca.corpo)
const proprioAposCrianca = await agendar({ data: hojeMais(16), turno: "tarde", crianca: crianca("Bia") }, eva.token)
const proprioMesmoTurno = await agendar({ data: hojeMais(16), turno: "tarde" }, eva.token)
conferir(
  "responsável não agenda para si no turno da criança: 409",
  proprioAposCrianca.status === 201 && proprioMesmoTurno.status === 409 && proprioMesmoTurno.corpo.mensagem.includes("criança agendada"),
  proprioMesmoTurno.corpo,
)

const L = hojeMais(17)
await pool.query("INSERT INTO culturatech.mesa_estudo (nome, local, espaco) VALUES ($1, 'Teste', 'infantil'), ($2, 'Teste', 'infantil')", [
  `Extra A ${sufixo}`,
  `Extra B ${sufixo}`,
])
for (const n of ["Um", "Dois", "Tres"]) await agendar({ data: L, turno: "manha", crianca: crianca(n) }, eva.token)
const quarta = await agendar({ data: L, turno: "tarde", crianca: crianca("Quatro") }, eva.token)
conferir("quarta criança no dia: 409", quarta.status === 409 && quarta.corpo.mensagem.includes("limite"), quarta.corpo)
await pool.query("DELETE FROM culturatech.agendamento WHERE data = $1", [L])
await pool.query("DELETE FROM culturatech.mesa_estudo WHERE nome LIKE $1", [`Extra % ${sufixo}`])

// filas separadas por espaço
const S = hojeMais(18)
const lotadores: Awaited<ReturnType<typeof novoSocio>>[] = []
for (const [i] of infantil.entries()) {
  const s = await novoSocio(`Inf${i}`)
  lotadores.push(s)
  await agendar({ data: S, turno: "manha", crianca: crianca(`Filho ${i}`) }, s.token)
}
for (let i = 0; i < estudo.length; i++) {
  const s = await novoSocio(`Est${i}`)
  lotadores.push(s)
  await agendar({ data: S, turno: "manha" }, s.token)
}
const filaInfantil = await naFila({ data: S, turno: "manha", crianca: crianca("Nina", 4) }, ana.token)
conferir("fila infantil: posição 1", filaInfantil.status === 201 && filaInfantil.corpo.mensagem.includes("posição 1"), filaInfantil.corpo)
const filaEstudo = await naFila({ data: S, turno: "manha" }, beto.token)
conferir("fila de estudo é separada: posição 1", filaEstudo.status === 201 && filaEstudo.corpo.mensagem.includes("posição 1"), filaEstudo.corpo)
const agEstudo = (await chamar("GET", "/mesas", undefined, lotadores[infantil.length].token)).corpo.agendamentos.find(
  (x: { socioId: string; data: string }) => x.socioId === lotadores[infantil.length].id && x.data === S,
)
await chamar("POST", `/agendamentos/${agEstudo.id}/cancelar`, {}, lotadores[infantil.length].token)
const aposEstudo = await pool.query("SELECT status FROM culturatech.fila_espera WHERE socio_id = $1 AND data = $2", [ana.id, S])
conferir("liberar mesa de estudo não mexe na fila infantil", aposEstudo.rows[0]?.status === "aguardando", aposEstudo.rows)
const betoNaFila = await pool.query("SELECT status FROM culturatech.fila_espera WHERE socio_id = $1 AND data = $2", [beto.id, S])
conferir("liberar mesa de estudo contempla a fila de estudo", betoNaFila.rows[0]?.status === "contemplado", betoNaFila.rows)

const visaoAdmin = (await chamar("GET", "/mesas", undefined, admin)).corpo
conferir(
  "admin vê os dados da criança",
  visaoAdmin.fila.some((x: { crianca?: { nome: string } }) => x.crianca?.nome === "Nina"),
)
const visaoOutro = (await chamar("GET", "/mesas", undefined, caio.token)).corpo
conferir(
  "outro sócio não recebe dados de criança",
  !JSON.stringify(visaoOutro).includes("Nina") && !JSON.stringify(visaoOutro).includes("Filho 0"),
)
conferir(
  "a fila infantil segue identificada pelo espaço",
  visaoOutro.fila.some((x: { data: string; espaco: string }) => x.data === S && x.espaco === "infantil"),
  visaoOutro.fila,
)

// ---------- inativar e anonimizar ----------
const T = hojeMais(19)
const dono = await novoSocio("Dono")
const naEspera = await novoSocio("Espera")
const outros = await Promise.all(Array.from({ length: estudo.length - 1 }, (_, i) => novoSocio(`Tmp${i}`)))
await agendar({ data: T, turno: "manha" }, dono.token)
for (const s of outros) await agendar({ data: T, turno: "manha" }, s.token)
await naFila({ data: T, turno: "manha" }, naEspera.token)
const inativar = await chamar("POST", `/socios/${dono.id}/ativo`, {}, admin)
conferir("inativar devolve o estado das mesas", inativar.status === 200 && Array.isArray(inativar.corpo.agendamentos), inativar.corpo)
const situacao = await pool.query(
  "SELECT socio_id, status, origem FROM culturatech.agendamento WHERE data = $1 AND socio_id = ANY($2::uuid[])",
  [T, [dono.id, naEspera.id]],
)
conferir(
  "inativar cancela o agendamento futuro e contempla a fila",
  situacao.rows.some((r) => r.socio_id === dono.id && r.status === "cancelado") &&
    situacao.rows.some((r) => r.socio_id === naEspera.id && r.status === "confirmado" && r.origem === "fila"),
  situacao.rows,
)
const inativo = await agendar({ socioId: dono.id, data: T, turno: "tarde" }, admin)
conferir("sócio inativo não agenda (RN06)", inativo.status === 409 && inativo.corpo.mensagem.includes("RN06"), inativo.corpo)
await chamar("POST", `/socios/${dono.id}/ativo`, {}, admin)

const anon = await novoSocio("Anon")
const A = hojeMais(20)
await agendar({ data: A, turno: "manha" }, anon.token)
await agendar({ data: A, turno: "tarde", crianca: crianca("Zeca") }, anon.token)
await agendar({ data: A, turno: "noite", crianca: crianca("Zuza") }, anon.token)
const anonimizar = await chamar("POST", `/socios/${anon.id}/anonimizar`, {}, admin)
conferir("anonimizar", anonimizar.status === 200, anonimizar.corpo)
const restos = await pool.query(
  `SELECT a.status, a.crianca_nome, a.crianca_idade, s.data_nascimento
     FROM culturatech.agendamento a JOIN culturatech.socio_leitor s ON s.id = a.socio_id WHERE a.socio_id = $1`,
  [anon.id],
)
conferir(
  "anonimizar cancela as mesas e apaga os dados de criança e o nascimento",
  restos.rows.length === 3 &&
    restos.rows.every((r) => r.status === "cancelado" && r.crianca_idade === null && r.data_nascimento === null) &&
    !JSON.stringify(restos.rows).includes("Zeca"),
  restos.rows,
)

// ---------- cadastro: data de nascimento ----------
const dadosBase = (extra: object) => ({
  nome: `Nasc Teste ${sufixo}`,
  cpf: cpfAleatorio(),
  rg: "",
  telefone: "82999990000",
  email: `nasc.${Math.random().toString(36).slice(2)}@example.com`,
  endereco: { rua: "Rua do Teste", numero: "1", bairro: "Centro", cep: "57300000" },
  senha: "senha-teste",
  consentimentoLgpd: true,
  ...extra,
})
const semNasc = await chamar("POST", "/socios", dadosBase({}), admin)
conferir("cadastro novo sem nascimento: 400", semNasc.status === 400 && semNasc.corpo.mensagem.includes("nascimento"), semNasc.corpo)
const futuro = await chamar("POST", "/socios", dadosBase({ dataNascimento: hojeMais(30) }), admin)
conferir("nascimento no futuro: 400", futuro.status === 400 && futuro.corpo.mensagem.includes("nascimento"), futuro.corpo)
const editarAntigo = await chamar(
  "PUT",
  `/socios/${semData.id}`,
  {
    nome: `Semdata Mesa ${sufixo}`,
    cpf: cpfAleatorio(),
    telefone: "82999990000",
    email: `semdata2.${sufixo.toLowerCase()}@example.com`,
    endereco: { rua: "Rua do Teste", numero: "1", bairro: "Centro", cep: "57300000" },
    consentimentoLgpd: true,
  },
  admin,
)
conferir("editar cadastro antigo sem nascimento: 200", editarAntigo.status === 200, editarAntigo.corpo)

// ---------- limpeza ----------
const limpar = await pool.query("SELECT id FROM culturatech.socio_leitor WHERE nome LIKE $1", [`%${sufixo}%`])
const ids = [...new Set([...criados, ...limpar.rows.map((r) => r.id as string)])]
await pool.query("DELETE FROM culturatech.fila_espera WHERE socio_id = ANY($1::uuid[])", [ids])
await pool.query("DELETE FROM culturatech.agendamento WHERE socio_id = ANY($1::uuid[])", [ids])
await pool.query("DELETE FROM culturatech.socio_leitor WHERE id = ANY($1::uuid[])", [ids])
await pool.end()

console.log(falhas ? `\n${falhas} verificação(ões) falharam` : "\nTodas as verificações passaram")
process.exit(falhas ? 1 : 0)
