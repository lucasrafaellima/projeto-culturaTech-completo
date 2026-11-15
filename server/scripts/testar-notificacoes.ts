// Testa os avisos de prazo dentro do sistema (RF05 / US15): lembrete, vencimento e atraso,
// um aviso por prazo, acesso por perfil e o botão de rotina.
// Uso: com a API rodando (npm run dev), execute npm run testar-notificacoes
// Atenção: grava no banco (sócios, obra e empréstimos de teste) e ajusta datas direto no banco
// (variáveis PG* do .env). Rode contra um banco de testes, nunca contra o de produção.
import { pool } from "../src/db.ts"

const BASE = process.env.API_URL ?? "http://localhost:3333"
const FUSO = process.env.FUSO_HORARIO?.trim() || "America/Maceio"

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

const digitos = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10))
function cpfAleatorio(): string {
  const n = digitos(9)
  const dv = (base: number[]) => {
    const r = (base.reduce((a, d, i) => a + d * (base.length + 1 - i), 0) * 10) % 11
    return r === 10 ? 0 : r
  }
  n.push(dv(n))
  n.push(dv(n))
  return n.join("")
}
function isbnAleatorio(): string {
  const base = "978" + digitos(9).join("")
  const soma = [...base].reduce((acc, n, i) => acc + Number(n) * (i % 2 === 0 ? 1 : 3), 0)
  return base + ((10 - (soma % 10)) % 10)
}

const sufixo = Date.now().toString(36).toUpperCase()
const admin = await entrar("admin", "admin123")
const criados: string[] = []

async function novoSocio(apelido: string) {
  const cpf = cpfAleatorio()
  const r = await chamar(
    "POST",
    "/socios",
    {
      nome: `${apelido} Aviso ${sufixo}`,
      cpf,
      rg: "",
      telefone: "82999990000",
      email: `${apelido.toLowerCase()}.aviso.${sufixo.toLowerCase()}@example.com`,
      endereco: { rua: "Rua do Teste", numero: "1", bairro: "Centro", cep: "57300000" },
      senha: "senha-teste",
      consentimentoLgpd: true,
      dataNascimento: "1990-05-20",
    },
    admin,
  )
  if (r.status !== 201) throw new Error(`Cadastro de ${apelido} falhou: ${JSON.stringify(r.corpo)}`)
  criados.push(r.corpo.socio.id)
  return { id: r.corpo.socio.id as string, token: await entrar(cpf, "senha-teste") }
}

// data prevista relativa ao dia local da API
const prever = (emprestimoId: string, dias: number) =>
  pool.query(
    `UPDATE culturatech.emprestimo SET data_prevista = (now() AT TIME ZONE '${FUSO}')::date + $2::int,
                                       data_emprestimo = (now() AT TIME ZONE '${FUSO}')::date - 20
      WHERE id = $1`,
    [emprestimoId, dias],
  )

type Aviso = { id: string; socioId: string; emprestimoId: string; tipo: string; assunto: string; destinatario: string; status: string }
const avisosDe = (lista: Aviso[], emprestimoId: string) => lista.filter((n) => n.emprestimoId === emprestimoId)

// ---------- preparação ----------
const leitora = await novoSocio("Leitora")
const outro = await novoSocio("Outro")
const obra = await chamar(
  "POST",
  "/livros",
  {
    titulo: `Obra dos Avisos ${sufixo}`,
    autores: ["Graciliano Ramos"],
    editora: "Editora Teste",
    edicao: "1ª",
    ano: 2020,
    categoria: "literatura",
    secao: "T",
    isbn: isbnAleatorio(),
  },
  admin,
)
const livroId = obra.corpo.livro.id as string
const exs = await chamar("POST", `/livros/${livroId}/exemplares`, { tombamentos: [1, 2, 3].map((n) => `AVI-${sufixo}-${n}`) }, admin)
const ex = (exs.corpo.exemplares as { id: string }[]).map((e) => e.id)
const emp1 = (await chamar("POST", "/emprestimos", { socioId: leitora.id, exemplarId: ex[0] }, admin)).corpo.emprestimo.id as string
const emp2 = (await chamar("POST", "/emprestimos", { socioId: leitora.id, exemplarId: ex[1] }, admin)).corpo.emprestimo.id as string

// ---------- acesso ----------
conferir("sem token: 401", (await chamar("GET", "/notificacoes")).status === 401)
conferir("sócio na lista geral: 403", (await chamar("GET", "/notificacoes", undefined, leitora.token)).status === 403)
conferir("sócio no botão de rotina: 403", (await chamar("POST", "/notificacoes/rotina", {}, leitora.token)).status === 403)
conferir("admin na lista do sócio: 403", (await chamar("GET", "/eu/notificacoes", undefined, admin)).status === 403)

// ---------- prazo longe: nada ----------
let minhas = (await chamar("GET", "/eu/notificacoes", undefined, leitora.token)).corpo.notificacoes as Aviso[]
conferir("empréstimo com 14 dias de prazo ainda não tem aviso", avisosDe(minhas, emp1).length === 0, minhas)

// ---------- lembrete ----------
await prever(emp1, 2)
minhas = (await chamar("GET", "/eu/notificacoes", undefined, leitora.token)).corpo.notificacoes as Aviso[]
const lembrete = avisosDe(minhas, emp1)
conferir(
  "lembrete 2 dias antes, entregue na Minha Área",
  lembrete.length === 1 && lembrete[0].tipo === "lembrete" && lembrete[0].destinatario === "Minha Área" && lembrete[0].status === "enviado",
  lembrete,
)
conferir("o aviso cita a obra", lembrete[0]?.assunto.includes(`Obra dos Avisos ${sufixo}`), lembrete[0])
minhas = (await chamar("GET", "/eu/notificacoes", undefined, leitora.token)).corpo.notificacoes as Aviso[]
conferir("ler de novo não duplica o aviso", avisosDe(minhas, emp1).length === 1, avisosDe(minhas, emp1))

// ---------- prazo mudou: aviso volta a valer ----------
const renovado = await chamar("POST", `/emprestimos/${emp1}/renovar`, {}, admin)
conferir("renovação aceita", renovado.status === 200, renovado.corpo)
minhas = (await chamar("GET", "/eu/notificacoes", undefined, leitora.token)).corpo.notificacoes as Aviso[]
conferir("depois da renovação, prazo longe: nenhum aviso novo", avisosDe(minhas, emp1).length === 1)
await prever(emp1, 1)
minhas = (await chamar("GET", "/eu/notificacoes", undefined, leitora.token)).corpo.notificacoes as Aviso[]
conferir("novo prazo gera novo lembrete", avisosDe(minhas, emp1).filter((n) => n.tipo === "lembrete").length === 2, avisosDe(minhas, emp1))

// ---------- vencimento e atraso ----------
await prever(emp1, 0)
minhas = (await chamar("GET", "/eu/notificacoes", undefined, leitora.token)).corpo.notificacoes as Aviso[]
conferir("aviso no dia do vencimento", avisosDe(minhas, emp1).some((n) => n.tipo === "vencimento"), avisosDe(minhas, emp1))
await prever(emp1, -2)
minhas = (await chamar("GET", "/eu/notificacoes", undefined, leitora.token)).corpo.notificacoes as Aviso[]
conferir("aviso de atraso", avisosDe(minhas, emp1).some((n) => n.tipo === "atraso"), avisosDe(minhas, emp1))

// ---------- devolvido não gera aviso ----------
const devolvido = await chamar("POST", `/emprestimos/${emp2}/devolver`, {}, admin)
conferir("devolução no prazo", devolvido.status === 200, devolvido.corpo)
await prever(emp2, 0)
minhas = (await chamar("GET", "/eu/notificacoes", undefined, leitora.token)).corpo.notificacoes as Aviso[]
conferir("empréstimo devolvido não gera aviso", avisosDe(minhas, emp2).length === 0, avisosDe(minhas, emp2))

// ---------- privacidade e visão do administrador ----------
const doOutro = (await chamar("GET", "/eu/notificacoes", undefined, outro.token)).corpo.notificacoes as Aviso[]
conferir("outro sócio não vê os avisos da leitora", doOutro.every((n) => n.socioId === outro.id), doOutro)
const todas = (await chamar("GET", "/notificacoes", undefined, admin)).corpo.notificacoes as Aviso[]
conferir("admin vê os avisos de todos", avisosDe(todas, emp1).length === 4, avisosDe(todas, emp1))

// ---------- botão de rotina ----------
const emp3 = (await chamar("POST", "/emprestimos", { socioId: outro.id, exemplarId: ex[2] }, admin)).corpo.emprestimo.id as string
await prever(emp3, 3)
const rotina = await chamar("POST", "/notificacoes/rotina", {}, admin)
conferir(
  "rotina gera o aviso pendente e informa quantos",
  rotina.status === 200 && rotina.corpo.geradas >= 1 && avisosDe(rotina.corpo.notificacoes, emp3).length === 1,
  rotina.corpo,
)
const deNovo = await chamar("POST", "/notificacoes/rotina", {}, admin)
conferir("rotina de novo não gera nada", deNovo.status === 200 && deNovo.corpo.geradas === 0, deNovo.corpo)

// ---------- limpeza ----------
await pool.query("DELETE FROM culturatech.notificacao WHERE socio_id = ANY($1::uuid[])", [criados])
await pool.query("DELETE FROM culturatech.multa WHERE socio_id = ANY($1::uuid[])", [criados])
await pool.query("DELETE FROM culturatech.emprestimo WHERE socio_id = ANY($1::uuid[])", [criados])
await pool.query("DELETE FROM culturatech.socio_leitor WHERE id = ANY($1::uuid[])", [criados])
await pool.end()

console.log(falhas ? `\n${falhas} verificação(ões) falharam` : "\nTodas as verificações passaram")
process.exit(falhas ? 1 : 0)
