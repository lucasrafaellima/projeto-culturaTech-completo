// Testa as rotas de mesas de estudo, fila de espera, Espaço Kids e confirmação de uso (RF10 / RF11 / US29 / US30).
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

// mesmo fuso da API (FUSO_HORARIO); para testar a US30 fora do horário dos turnos, rode a API e este
// script com um fuso em que algum turno esteja aberto agora
const FUSO = process.env.FUSO_HORARIO?.trim() || "America/Maceio"
const hojeLocal = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(new Date())
const horaLocal = Number(new Intl.DateTimeFormat("en-GB", { timeZone: FUSO, hour: "numeric", hourCycle: "h23" }).format(new Date()))
const hojeMais = (dias: number) => {
  const d = new Date(`${hojeLocal}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

const sufixo = Date.now().toString(36).toUpperCase()
const admin = await entrar("admin", "admin123")
const criados: string[] = []

async function novoSocio(apelido: string, dataNascimento = "1990-05-20") {
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
      dataNascimento,
    },
    admin,
  )
  if (r.status !== 201) throw new Error(`Cadastro de ${apelido} falhou: ${JSON.stringify(r.corpo)}`)
  const id = r.corpo.socio.id as string
  criados.push(id)
  return { id, token: await entrar(cpf, "senha-teste") }
}

const ana = await novoSocio("Ana")
const beto = await novoSocio("Beto")
const caio = await novoSocio("Caio")
const dani = await novoSocio("Dani")
const eva = await novoSocio("Eva")

const agendar = (corpo: unknown, t: string) => chamar("POST", "/agendamentos", corpo, t)
const naFila = (corpo: unknown, t: string) => chamar("POST", "/fila", corpo, t)

// ---------- acesso e leitura ----------
conferir("GET /mesas sem token: 401", (await chamar("GET", "/mesas")).status === 401)
conferir("POST /agendamentos sem token: 401", (await chamar("POST", "/agendamentos", {})).status === 401)
const mesas = await chamar("GET", "/mesas", undefined, ana.token)
conferir("GET /mesas de sócio", mesas.status === 200 && Array.isArray(mesas.corpo.mesas), mesas.corpo)
const estudo = (mesas.corpo.mesas as { id: string; espaco: string }[]).filter((m) => m.espaco === "estudo")
const kids = (mesas.corpo.mesas as { id: string; espaco: string }[]).filter((m) => m.espaco === "kids")
conferir("há mesas de estudo e do Espaço Kids", estudo.length > 0 && kids.length > 0, mesas.corpo.mesas)

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

// ---------- US29: Espaço Kids ----------
const I = hojeMais(15)
let cpfsCriancas = 0
const crianca = (nome: string, anos = 6) => {
  cpfsCriancas++
  return { nome, cpf: cpfAleatorio(), dataNascimento: hojeMais(-365 * anos - 30) }
}
const bia = crianca("Bia Souza")

// Quem pode ser responsável: só a partir dos 18 anos, na data do agendamento
const anosAntes = (data: string, anos: number) => `${Number(data.slice(0, 4)) - anos}${data.slice(4)}`
const dozeAnos = await novoSocio("Doze", anosAntes(hojeLocal, 12))
const dezessete = await novoSocio("Dezessete", anosAntes(hojeMais(16), 18))
const faz18 = await novoSocio("Faz18", anosAntes(I, 18))
const semNascimento = await novoSocio("Semnasc")
await pool.query("UPDATE culturatech.socio_leitor SET data_nascimento = NULL WHERE id = $1", [semNascimento.id])

const respDoze = await agendar({ data: I, turno: "tarde", crianca: crianca("Rui Moura") }, dozeAnos.token)
conferir("sócio de 12 anos não agenda o Espaço Kids: 409", respDoze.status === 409 && respDoze.corpo.mensagem.includes("18 anos"), respDoze.corpo)
conferir("sócio de 12 anos agenda mesa de estudo para si", (await agendar({ data: I, turno: "tarde" }, dozeAnos.token)).status === 201)
const resp17 = await agendar({ data: I, turno: "tarde", crianca: crianca("Rui Moura") }, dezessete.token)
conferir("sócio de 17 anos não agenda o Espaço Kids: 409", resp17.status === 409 && resp17.corpo.mensagem.includes("18 anos"), resp17.corpo)
const filaDe17 = await naFila({ data: I, turno: "tarde", crianca: crianca("Rui Moura") }, dezessete.token)
conferir("sócio de 17 anos não entra na fila Kids: 409", filaDe17.status === 409 && filaDe17.corpo.mensagem.includes("18 anos"), filaDe17.corpo)
const adminPara17 = await agendar({ socioId: dezessete.id, data: I, turno: "tarde", crianca: crianca("Rui Moura") }, admin)
conferir("admin não agenda Kids para responsável de 17 anos: 409", adminPara17.status === 409 && adminPara17.corpo.mensagem.includes("18 anos"), adminPara17.corpo)
const semData = await agendar({ data: I, turno: "tarde", crianca: crianca("Rui Moura") }, semNascimento.token)
conferir("cadastro sem nascimento não agenda o Espaço Kids: 409", semData.status === 409 && semData.corpo.mensagem.includes("sem data de nascimento"), semData.corpo)
const vespera18 = await agendar({ data: hojeMais(14), turno: "noite", crianca: crianca("Ivo Moura") }, faz18.token)
conferir("na véspera dos 18 anos ainda é recusado", vespera18.status === 409 && vespera18.corpo.mensagem.includes("18 anos"), vespera18.corpo)
const dia18 = await agendar({ data: I, turno: "noite", crianca: crianca("Ivo Moura") }, faz18.token)
conferir("quem faz 18 anos na data do agendamento é aceito", dia18.status === 201, dia18.corpo)
await chamar("POST", `/agendamentos/${dia18.corpo.agendamentos.find((x: { socioId: string; data: string }) => x.socioId === faz18.id && x.data === I).id}/cancelar`, {}, faz18.token)

const nomeCurto = await agendar({ data: I, turno: "manha", crianca: { ...bia, nome: "Bia" } }, eva.token)
conferir("nome incompleto da criança: 400", nomeCurto.status === 400 && nomeCurto.corpo.campo === "nome", nomeCurto.corpo)
const cpfRuim = await agendar({ data: I, turno: "manha", crianca: { ...bia, cpf: "12345678900" } }, eva.token)
conferir("CPF inválido da criança: 400", cpfRuim.status === 400 && cpfRuim.corpo.campo === "cpf", cpfRuim.corpo)
const cpfDeSocio = await agendar({ data: I, turno: "manha", crianca: { ...bia, cpf: "15350946056" } }, eva.token)
conferir("CPF de sócio cadastrado: 409", cpfDeSocio.status === 409 && cpfDeSocio.corpo.mensagem.includes("sócio-leitor cadastrado"), cpfDeSocio.corpo)
const futura = await agendar({ data: I, turno: "manha", crianca: { ...bia, dataNascimento: hojeMais(10) } }, eva.token)
conferir("nascimento no futuro: 400", futura.status === 400 && futura.corpo.campo === "dataNascimento", futura.corpo)
const doze = await agendar({ data: I, turno: "manha", crianca: crianca("Caio Grande", 12) }, eva.token)
conferir("criança com 12 anos: 409", doze.status === 409 && doze.corpo.mensagem.includes("até 11 anos"), doze.corpo)
const criancaEmEstudo = await agendar({ data: I, turno: "tarde", mesaId: estudo[0].id, crianca: bia }, eva.token)
conferir("criança em mesa de estudo: 409", criancaEmEstudo.status === 409 && criancaEmEstudo.corpo.mensagem.includes("não é do Espaço Kids"), criancaEmEstudo.corpo)
const adultoEmKids = await agendar({ data: I, turno: "tarde", mesaId: kids[0].id }, eva.token)
conferir("adulto em mesa Kids: 409", adultoEmKids.status === 409 && adultoEmKids.corpo.mensagem.includes("dados da criança"), adultoEmKids.corpo)

const proprio = await agendar({ data: I, turno: "manha" }, eva.token)
conferir("agendamento próprio de manhã", proprio.status === 201 && proprio.corpo.mensagem.includes("15 minutos"), proprio.corpo)
const kidsMesmoTurno = await agendar({ data: I, turno: "manha", crianca: bia }, eva.token)
conferir("criança no mesmo dia do responsável não conta na RN05", kidsMesmoTurno.status === 201, kidsMesmoTurno.corpo)
const minhaCrianca = kidsMesmoTurno.corpo.agendamentos.find((x: { socioId: string; crianca?: { cpf: string } }) => x.socioId === eva.id && x.crianca)
conferir(
  "responsável vê os dados da criança",
  minhaCrianca?.crianca?.cpf === bia.cpf && minhaCrianca?.crianca?.dataNascimento === bia.dataNascimento,
  minhaCrianca,
)
const mesmaCrianca = await agendar({ data: I, turno: "noite", crianca: bia }, beto.token)
conferir("mesma criança duas vezes no dia, mesmo por outro sócio: 409 (RN05)", mesmaCrianca.status === 409 && mesmaCrianca.corpo.mensagem.includes("RN05"), mesmaCrianca.corpo)
const segundaCrianca = await agendar({ data: I, turno: "noite", crianca: crianca("Duda Souza", 4) }, eva.token)
conferir("o sócio agenda para mais de uma criança", segundaCrianca.status === 201, segundaCrianca.corpo)

// filas separadas por espaço
const S = hojeMais(18)
const lotadores: Awaited<ReturnType<typeof novoSocio>>[] = []
for (const [i] of kids.entries()) {
  const s = await novoSocio(`Kid${i}`)
  lotadores.push(s)
  await agendar({ data: S, turno: "manha", crianca: crianca(`Filho Numero${i}`) }, s.token)
}
for (let i = 0; i < estudo.length; i++) {
  const s = await novoSocio(`Est${i}`)
  lotadores.push(s)
  await agendar({ data: S, turno: "manha" }, s.token)
}
const nina = crianca("Nina Alves", 4)
const filaKids = await naFila({ data: S, turno: "manha", crianca: nina }, ana.token)
conferir("fila Kids: posição 1", filaKids.status === 201 && filaKids.corpo.mensagem.includes("posição 1"), filaKids.corpo)
const ninaDeNovo = await naFila({ data: S, turno: "manha", crianca: nina }, beto.token)
conferir("criança só entra em uma fila Kids por dia", ninaDeNovo.status === 409 && ninaDeNovo.corpo.mensagem.includes("já está na fila"), ninaDeNovo.corpo)
const filaEstudo = await naFila({ data: S, turno: "manha" }, beto.token)
conferir("fila de estudo é separada: posição 1", filaEstudo.status === 201 && filaEstudo.corpo.mensagem.includes("posição 1"), filaEstudo.corpo)
const agEstudo = (await chamar("GET", "/mesas", undefined, lotadores[kids.length].token)).corpo.agendamentos.find(
  (x: { socioId: string; data: string }) => x.socioId === lotadores[kids.length].id && x.data === S,
)
await chamar("POST", `/agendamentos/${agEstudo.id}/cancelar`, {}, lotadores[kids.length].token)
const aposEstudo = await pool.query("SELECT status FROM culturatech.fila_espera WHERE socio_id = $1 AND data = $2", [ana.id, S])
conferir("liberar mesa de estudo não mexe na fila Kids", aposEstudo.rows[0]?.status === "aguardando", aposEstudo.rows)
const betoNaFila = await pool.query("SELECT status FROM culturatech.fila_espera WHERE socio_id = $1 AND data = $2", [beto.id, S])
conferir("liberar mesa de estudo contempla a fila de estudo", betoNaFila.rows[0]?.status === "contemplado", betoNaFila.rows)
const agKids = (await chamar("GET", "/mesas", undefined, lotadores[0].token)).corpo.agendamentos.find(
  (x: { socioId: string; data: string }) => x.socioId === lotadores[0].id && x.data === S,
)
await chamar("POST", `/agendamentos/${agKids.id}/cancelar`, {}, lotadores[0].token)
const ninaContemplada = await pool.query(
  `SELECT a.crianca_cpf, a.origem FROM culturatech.fila_espera f JOIN culturatech.agendamento a ON a.id = f.agendamento_id
    WHERE f.socio_id = $1 AND f.data = $2`,
  [ana.id, S],
)
conferir("vaga Kids liberada contempla a criança da fila", ninaContemplada.rows[0]?.crianca_cpf === nina.cpf && ninaContemplada.rows[0]?.origem === "fila", ninaContemplada.rows)

const visaoAdmin = (await chamar("GET", "/mesas", undefined, admin)).corpo
conferir("admin vê os dados da criança", visaoAdmin.agendamentos.some((x: { crianca?: { nome: string } }) => x.crianca?.nome === "Nina Alves"))
const visaoOutro = (await chamar("GET", "/mesas", undefined, caio.token)).corpo
conferir(
  "outro sócio não recebe dados de criança",
  !JSON.stringify(visaoOutro).includes("Nina") && !JSON.stringify(visaoOutro).includes(nina.cpf),
)

// fila Kids de outro sócio continua identificada pelo espaço
const R = hojeMais(21)
for (const [i] of kids.entries()) await agendar({ data: R, turno: "tarde", crianca: crianca(`Lota Kids${i}`) }, lotadores[i].token)
await naFila({ data: R, turno: "tarde", crianca: crianca("Teo Lima", 5) }, dani.token)
const visaoFilaKids = (await chamar("GET", "/mesas", undefined, caio.token)).corpo
conferir(
  "a fila Kids dos outros chega com o espaço",
  visaoFilaKids.fila.some((x: { data: string; espaco: string; socioId: string }) => x.data === R && x.espaco === "kids" && x.socioId === ""),
  visaoFilaKids.fila,
)

// ---------- US30: confirmação de uso ----------
const amanha = (await chamar("GET", "/mesas", undefined, eva.token)).corpo.agendamentos.find(
  (x: { socioId: string; data: string; crianca?: unknown }) => x.socioId === eva.id && x.data === I && !x.crianca,
)
conferir("sócio não confirma uso: 403", (await chamar("POST", `/agendamentos/${amanha.id}/uso`, {}, eva.token)).status === 403)
const foraDoDia = await chamar("POST", `/agendamentos/${amanha.id}/uso`, {}, admin)
conferir("confirmar uso fora do dia: 409", foraDoDia.status === 409 && foraDoDia.corpo.mensagem.includes("no dia do agendamento"), foraDoDia.corpo)

const minutoLocal = Number(new Intl.DateTimeFormat("en-GB", { timeZone: FUSO, minute: "numeric" }).format(new Date()))
const turnoAberto = ([["manha", 8, 12], ["tarde", 13, 17], ["noite", 18, 21]] as const).find(
  ([, inicio, fim]) => horaLocal < fim && (horaLocal > inicio || (horaLocal === inicio && minutoLocal >= 15)),
)
if (turnoAberto) {
  const [turno] = turnoAberto
  // espaço de estudo lotado hoje: um sem confirmação há mais de 15 minutos e um na fila
  const ausente = await novoSocio("Ausente")
  const espera = await novoSocio("Espera30")
  const presentes = await Promise.all(Array.from({ length: estudo.length - 1 }, (_, i) => novoSocio(`Pres${i}`)))
  for (const [i, s] of [ausente, ...presentes].entries()) {
    await pool.query(
      `INSERT INTO culturatech.agendamento (mesa_id, socio_id, data, turno, criado_em, uso_confirmado_em)
       VALUES ($1, $2, $3, $4, now() - interval '3 hours', $5)`,
      [estudo[i].id, s.id, hojeLocal, turno, s === ausente ? null : new Date()],
    )
  }
  await pool.query("INSERT INTO culturatech.fila_espera (socio_id, data, turno) VALUES ($1, $2, $3)", [espera.id, hojeLocal, turno])
  await chamar("GET", "/mesas", undefined, admin)
  const depoisUso = await pool.query(
    "SELECT socio_id, status, origem FROM culturatech.agendamento WHERE data = $1 AND socio_id = ANY($2::uuid[])",
    [hojeLocal, [ausente.id, espera.id]],
  )
  conferir(
    "sem confirmação em 15 minutos a vaga vai para a fila (US30)",
    depoisUso.rows.some((r) => r.socio_id === ausente.id && r.status === "nao_compareceu") &&
      depoisUso.rows.some((r) => r.socio_id === espera.id && r.status === "confirmado" && r.origem === "fila"),
    depoisUso.rows,
  )
  const novo = (await chamar("GET", "/mesas", undefined, admin)).corpo.agendamentos.find(
    (x: { socioId: string; data: string; status: string }) => x.socioId === espera.id && x.data === hojeLocal,
  )
  conferir("quem veio da fila ganha a própria tolerância", novo?.status === "confirmado", novo)
  const confirmou = await chamar("POST", `/agendamentos/${novo.id}/uso`, {}, admin)
  conferir("admin confirma o uso", confirmou.status === 200 && confirmou.corpo.mensagem.includes("Uso confirmado"), confirmou.corpo)
  const deNovo = await chamar("POST", `/agendamentos/${novo.id}/uso`, {}, admin)
  conferir("confirmar duas vezes: 409", deNovo.status === 409 && deNovo.corpo.mensagem.includes("já foi confirmado"), deNovo.corpo)

  // Espaço Kids lotado hoje: confirmar o uso encerra a fila daquele turno
  const pais = await Promise.all(kids.map((_, i) => novoSocio(`Pai${i}`)))
  for (const [i, s] of pais.entries()) {
    const c = crianca(`Hoje Kids${i}`)
    await pool.query(
      `INSERT INTO culturatech.agendamento (mesa_id, socio_id, data, turno, crianca_nome, crianca_cpf, crianca_nascimento)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [kids[i].id, s.id, hojeLocal, turno, c.nome, c.cpf, c.dataNascimento],
    )
  }
  const aguardando = await novoSocio("AguardaKids")
  const naFilaKids = await naFila({ data: hojeLocal, turno, crianca: crianca("Lia Rocha", 3) }, aguardando.token)
  conferir("fila Kids de hoje", naFilaKids.status === 201, naFilaKids.corpo)
  const kidsHoje = (await chamar("GET", "/mesas", undefined, admin)).corpo.agendamentos.find(
    (x: { socioId: string; data: string }) => x.socioId === pais[0].id && x.data === hojeLocal,
  )
  const usoKids = await chamar("POST", `/agendamentos/${kidsHoje.id}/uso`, {}, admin)
  const retirada = await pool.query("SELECT status FROM culturatech.fila_espera WHERE socio_id = $1 AND data = $2", [aguardando.id, hojeLocal])
  conferir(
    "uso Kids confirmado retira a fila do turno (US29)",
    usoKids.status === 200 && usoKids.corpo.mensagem.includes("retirados da fila") && retirada.rows[0]?.status === "retirada",
    { resposta: usoKids.corpo, fila: retirada.rows },
  )
} else {
  console.log("--    confirmação de uso e vaga sem uso não testadas: nenhum turno aberto há 15 minutos agora")
}

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
const zeca = crianca("Zeca Prado")
await agendar({ data: A, turno: "manha" }, anon.token)
await agendar({ data: A, turno: "tarde", crianca: zeca }, anon.token)
await agendar({ data: A, turno: "noite", crianca: crianca("Zuza Prado") }, anon.token)
const anonimizar = await chamar("POST", `/socios/${anon.id}/anonimizar`, {}, admin)
conferir("anonimizar", anonimizar.status === 200, anonimizar.corpo)
const restos = await pool.query(
  `SELECT a.status, a.crianca_nome, a.crianca_cpf, a.crianca_nascimento, s.data_nascimento
     FROM culturatech.agendamento a JOIN culturatech.socio_leitor s ON s.id = a.socio_id WHERE a.socio_id = $1`,
  [anon.id],
)
conferir(
  "anonimizar cancela as mesas e apaga os dados das crianças e o nascimento",
  restos.rows.length === 3 &&
    restos.rows.every((r) => r.status === "cancelado" && r.crianca_cpf === null && r.crianca_nascimento === null && r.data_nascimento === null) &&
    !JSON.stringify(restos.rows).includes("Zeca") &&
    restos.rows.filter((r) => r.crianca_nome).length === 2,
  restos.rows,
)

// ---------- limpeza ----------
const limpar = await pool.query("SELECT id FROM culturatech.socio_leitor WHERE nome LIKE $1", [`%${sufixo}%`])
const ids = [...new Set([...criados, ...limpar.rows.map((r) => r.id as string)])]
await pool.query("DELETE FROM culturatech.fila_espera WHERE socio_id = ANY($1::uuid[])", [ids])
await pool.query("DELETE FROM culturatech.agendamento WHERE socio_id = ANY($1::uuid[])", [ids])
await pool.query("DELETE FROM culturatech.socio_leitor WHERE id = ANY($1::uuid[])", [ids])
await pool.end()

console.log(falhas ? `\n${falhas} verificação(ões) falharam` : "\nTodas as verificações passaram")
process.exit(falhas ? 1 : 0)
