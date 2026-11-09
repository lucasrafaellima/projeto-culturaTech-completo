// Testa as rotas de instituições, doações e aquisições (RF13 / RN25 / RN26).
// Uso: com a API rodando (npm run dev), execute npm run testar-parcerias
// Atenção: grava no banco (cadastros, obras e exemplares "de teste"). As movimentações
// ficam no banco de propósito, pois a rastreabilidade não permite apagá-las pela API.
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

const digitos = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10))

function cpfAleatorio(): string {
  const n = digitos(9)
  const dv = (base: number[]) => {
    const soma = base.reduce((a, d, i) => a + d * (base.length + 1 - i), 0)
    const r = (soma * 10) % 11
    return r === 10 ? 0 : r
  }
  n.push(dv(n))
  n.push(dv(n))
  return n.join("")
}

function cnpjAleatorio(): string {
  const n = [...digitos(8), 0, 0, 0, 1]
  const dv = (base: number[]) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const resto = base.reduce((a, d, i) => a + d * pesos[i], 0) % 11
    return resto < 2 ? 0 : 11 - resto
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
const joao = await entrar("153.509.460-56", "123456")
const post = (rota: string, corpo: unknown = {}, t = admin) => chamar("POST", rota, corpo, t)
const SEM_CADASTRO = "00000000-0000-4000-8000-000000000000"

// ---------- acesso ----------
conferir("GET /parcerias sem token: 401", (await chamar("GET", "/parcerias")).status === 401)
conferir("GET /parcerias de sócio: 403", (await chamar("GET", "/parcerias", undefined, joao)).status === 403)
conferir("POST /instituicoes de sócio: 403", (await post("/instituicoes", {}, joao)).status === 403)
conferir("POST /movimentacoes/doacao de sócio: 403", (await post("/movimentacoes/doacao", {}, joao)).status === 403)
const inicial = await chamar("GET", "/parcerias", undefined, admin)
conferir("GET /parcerias de admin", inicial.status === 200 && Array.isArray(inicial.corpo.instituicoes), inicial.corpo)

// ---------- cadastro (US23) ----------
const dados = (extra: object) => ({
  tipo: "instituicao",
  nome: `Escola Teste ${sufixo}`,
  documento: cnpjAleatorio(),
  endereco: "Rua do Teste, 10",
  contato: "82999990000",
  ...extra,
})
const cnpjRuim = await post("/instituicoes", dados({ documento: "11111111111111" }))
conferir("CNPJ inválido: 400", cnpjRuim.status === 400 && cnpjRuim.corpo.mensagem === "CNPJ inválido.", cnpjRuim.corpo)
const cpfRuim = await post("/instituicoes", dados({ tipo: "pessoa_fisica", documento: "12345678900" }))
conferir("CPF inválido: 400", cpfRuim.status === 400 && cpfRuim.corpo.mensagem === "CPF inválido.", cpfRuim.corpo)
conferir("sem endereço: 400", (await post("/instituicoes", dados({ endereco: "" }))).status === 400)
conferir("sem contato: 400", (await post("/instituicoes", dados({ contato: "" }))).status === 400)
conferir("nome curto: 400", (await post("/instituicoes", dados({ nome: "A" }))).status === 400)

const cnpj = cnpjAleatorio()
const escola = await post("/instituicoes", dados({ documento: cnpj.replace(/^(\d{2})(\d{3})/, "$1.$2.") }))
conferir("cadastrar instituição com máscara: 201", escola.status === 201 && escola.corpo.instituicao.documento === cnpj, escola.corpo)
const instId = escola.corpo.instituicao.id as string
const repetida = await post("/instituicoes", dados({ documento: cnpj }))
conferir("documento repetido: 409", repetida.status === 409 && repetida.corpo.mensagem.includes("documento"), repetida.corpo)
const editada = await chamar("PUT", `/instituicoes/${instId}`, dados({ documento: cnpj, nome: `Escola Editada ${sufixo}` }), admin)
conferir("editar instituição", editada.status === 200 && editada.corpo.instituicao.nome.includes("Editada"), editada.corpo)
conferir("editar inexistente: 404", (await chamar("PUT", `/instituicoes/${SEM_CADASTRO}`, dados({}), admin)).status === 404)

const cpf = cpfAleatorio()
const pessoa = await post("/instituicoes", dados({ tipo: "pessoa_fisica", nome: `Pessoa Teste ${sufixo}`, documento: cpf }))
conferir("cadastrar pessoa física: 201", pessoa.status === 201, pessoa.corpo)
const pessoaId = pessoa.corpo.instituicao.id as string
const avulsa = await post("/instituicoes", dados({ nome: `Avulsa ${sufixo}` }))
conferir("excluir sem movimentação", (await chamar("DELETE", `/instituicoes/${avulsa.corpo.instituicao.id}`, undefined, admin)).status === 200)

// ---------- obra e exemplares do teste ----------
const autor = await post("/livros", {
  titulo: `Obra Parceria ${sufixo}`,
  autores: ["Autora Teste"],
  editora: "Editora",
  edicao: "1",
  ano: 2020,
  categoria: "literatura",
  secao: "A",
  isbn: isbnAleatorio(),
  sinopse: "Obra de teste",
})
conferir("obra de teste", autor.status === 201, autor.corpo)
const livroId = autor.corpo.livro.id as string
const obra2 = await post("/livros", {
  titulo: `Obra Parceria B ${sufixo}`,
  autores: ["Autora Teste"],
  editora: "Editora",
  edicao: "1",
  ano: 2020,
  categoria: "literatura",
  secao: "A",
  isbn: isbnAleatorio(),
  sinopse: "Obra de teste",
})
const livro2 = obra2.corpo.livro.id as string

// ---------- aquisição (US24) ----------
const t = (n: number) => `P${sufixo}-${n}`
const aqSem = await post("/movimentacoes/aquisicao", { receptorId: SEM_CADASTRO, livroId, tombamentos: [t(1)] })
conferir("aquisição sem origem cadastrada: 409 (RN25)", aqSem.status === 409 && aqSem.corpo.mensagem.includes("RN25"), aqSem.corpo)
const aq = await post("/movimentacoes/aquisicao", {
  receptorId: instId,
  livroId,
  tombamentos: [t(1), t(2), t(3), t(4), t(5)],
  observacao: "Compra de teste",
})
conferir("registrar aquisição: 201", aq.status === 201 && aq.corpo.exemplares.length === 5, aq.corpo)
conferir("aquisição guarda os tombamentos", aq.corpo.movimentacao?.tombamentos?.length === 5 && aq.corpo.movimentacao.observacao === "Compra de teste", aq.corpo.movimentacao)
const ex = aq.corpo.exemplares as { id: string; tombamento: string }[]
const novosEx2 = await post(`/livros/${livro2}/exemplares`, { tombamentos: [t(6)] })
const exOutraObra = novosEx2.corpo.exemplares[0].id as string

const tombRepetido = await post("/movimentacoes/aquisicao", { receptorId: instId, livroId, tombamentos: [`N${sufixo}`, t(1)] })
conferir("tombamento repetido: 409", tombRepetido.status === 409 && tombRepetido.corpo.mensagem.includes("já pertence"), tombRepetido.corpo)
const acervo = await chamar("GET", "/acervo", undefined, admin)
conferir(
  "aquisição recusada não grava nada",
  !acervo.corpo.exemplares.some((e: { tombamento: string }) => e.tombamento === `N${sufixo}`),
)
conferir("aquisição sem tombamentos: 400", (await post("/movimentacoes/aquisicao", { receptorId: instId, livroId, tombamentos: [] })).status === 400)
conferir("aquisição de obra inexistente: 404", (await post("/movimentacoes/aquisicao", { receptorId: instId, livroId: SEM_CADASTRO, tombamentos: [`M${sufixo}`] })).status === 404)

// ---------- doação (US24) ----------
const semReceptor = await post("/movimentacoes/doacao", { receptorId: SEM_CADASTRO, exemplarIds: [ex[0].id] })
conferir("doação sem receptor cadastrado: 409 (RN25)", semReceptor.status === 409 && semReceptor.corpo.mensagem.includes("RN25"), semReceptor.corpo)
conferir("doação sem exemplar: 400", (await post("/movimentacoes/doacao", { receptorId: instId, exemplarIds: [] })).status === 400)
const duasObras = await post("/movimentacoes/doacao", { receptorId: instId, exemplarIds: [ex[0].id, exOutraObra] })
conferir("doação de duas obras: 400", duasObras.status === 400 && duasObras.corpo.mensagem.includes("uma doação por obra"), duasObras.corpo)

await chamar("PATCH", `/exemplares/${ex[4].id}`, { status: "em_restauro" }, admin)
const indisponivel = await post("/movimentacoes/doacao", { receptorId: instId, exemplarIds: [ex[4].id] })
conferir("exemplar indisponível: 409", indisponivel.status === 409 && indisponivel.corpo.mensagem.includes("não pode ser doado"), indisponivel.corpo)

const doisDeUmaVez = await post("/movimentacoes/doacao", { receptorId: pessoaId, exemplarIds: [ex[0].id, ex[1].id] })
conferir("pessoa física com dois de uma vez: 409 (RN26)", doisDeUmaVez.status === 409 && doisDeUmaVez.corpo.mensagem.includes("RN26"), doisDeUmaVez.corpo)
const primeiraPF = await post("/movimentacoes/doacao", { receptorId: pessoaId, exemplarIds: [ex[0].id] })
conferir("pessoa física recebe 1 livro", primeiraPF.status === 201 && primeiraPF.corpo.movimentacao.tombamentos[0] === ex[0].tombamento, primeiraPF.corpo)
const segundaPF = await post("/movimentacoes/doacao", { receptorId: pessoaId, exemplarIds: [ex[1].id] })
conferir("pessoa física com segundo livro: 409 (RN26)", segundaPF.status === 409 && segundaPF.corpo.mensagem.includes("RN26"), segundaPF.corpo)

const paraEscola = await post("/movimentacoes/doacao", { receptorId: instId, exemplarIds: [ex[1].id, ex[2].id], observacao: "Reforço" })
conferir("instituição recebe vários", paraEscola.status === 201 && paraEscola.corpo.movimentacao.tombamentos.length === 2, paraEscola.corpo)

const depois = await chamar("GET", "/acervo", undefined, admin)
const baixado = depois.corpo.exemplares.find((e: { id: string }) => e.id === ex[1].id)
conferir("a baixa acontece com motivo doacao", baixado?.baixa?.motivo === "doacao", baixado)
const deNovo = await post("/movimentacoes/doacao", { receptorId: instId, exemplarIds: [ex[1].id] })
conferir("exemplar já doado: 409", deNovo.status === 409 && deNovo.corpo.mensagem.includes("não encontrado"), deNovo.corpo)
const publico = await chamar("GET", "/acervo/publico")
conferir("exemplar doado sai da consulta pública", !publico.corpo.exemplares.some((e: { id: string }) => e.id === ex[1].id))

// ---------- exemplar emprestado ----------
const socio = await post("/socios", {
  nome: `Leitor Parceria ${sufixo}`,
  cpf: cpfAleatorio(),
  rg: "",
  telefone: "82999990000",
  email: `leitor.${sufixo.toLowerCase()}@example.com`,
  endereco: { rua: "Rua do Teste", numero: "1", bairro: "Centro", cep: "57300000" },
  senha: "senha-teste",
  consentimentoLgpd: true,
  dataNascimento: "1990-01-01",
})
const emprestimo = await post("/emprestimos", { socioId: socio.corpo.socio.id, exemplarId: ex[3].id })
conferir("empréstimo do teste", emprestimo.status === 201, emprestimo.corpo)
const emprestado = await post("/movimentacoes/doacao", { receptorId: instId, exemplarIds: [ex[3].id] })
conferir("exemplar emprestado não é doado: 409", emprestado.status === 409 && emprestado.corpo.mensagem.includes("não pode ser doado"), emprestado.corpo)
await post(`/emprestimos/${emprestimo.corpo.emprestimo.id}/cancelar`, { motivo: "Cancelado pelo teste de parcerias." })

// ---------- rastreabilidade ----------
const excluirComMov = await chamar("DELETE", `/instituicoes/${instId}`, undefined, admin)
conferir("excluir com movimentação: 409", excluirComMov.status === 409 && excluirComMov.corpo.mensagem.includes("rastreabilidade"), excluirComMov.corpo)
const excluirObra = await chamar("DELETE", `/livros/${livroId}`, undefined, admin)
conferir("excluir obra com movimentação: 409", excluirObra.status === 409, excluirObra.corpo)
const excluirEx = await chamar("DELETE", `/exemplares/${ex[4].id}`, undefined, admin)
conferir("excluir exemplar com movimentação: 409", excluirEx.status === 409, excluirEx.corpo)

const historico = (await chamar("GET", "/parcerias", undefined, admin)).corpo
const daObra = historico.movimentacoes.filter((m: { livroId: string }) => m.livroId === livroId)
conferir(
  "histórico da obra com receptor e data",
  daObra.length === 3 &&
    daObra.some((m: { tipo: string; receptorId: string; data: string }) => m.tipo === "doacao" && m.receptorId === pessoaId && /^\d{4}-\d{2}-\d{2}$/.test(m.data)),
  daObra,
)

console.log(falhas ? `\n${falhas} verificação(ões) falharam` : "\nTodas as verificações passaram")
process.exit(falhas ? 1 : 0)
