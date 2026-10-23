// Testa as rotas de circulação (US08–US11), multas, reservas e sócios.
// Uso: com a API rodando (npm run dev), execute npm run testar-circulacao
// Atenção: grava no banco (sócios, obras e empréstimos "de teste" com CPF e tombamentos
// aleatórios) e, para simular atraso, ajusta datas de empréstimos criados pelo próprio teste.
// Usa as mesmas variáveis PG* da API (server/.env) para esse ajuste.
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
  const corpoJson = await r.json()
  // Intl formata moeda com espaço não separável ("R$ 5,00")
  if (typeof corpoJson.mensagem === "string") corpoJson.mensagem = corpoJson.mensagem.replace(/ /g, " ")
  return { status: r.status, corpo: corpoJson }
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

function isbnAleatorio(): string {
  const base = "978" + Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join("")
  const soma = base.split("").reduce((acc, n, i) => acc + Number(n) * (i % 2 === 0 ? 1 : 3), 0)
  return base + ((10 - (soma % 10)) % 10)
}

const hojeMais = (dias: number) => {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

const sufixo = Date.now().toString(36).toUpperCase()
const admin = await entrar("admin", "admin123")
const get = (rota: string, t = admin) => chamar("GET", rota, undefined, t)
const post = (rota: string, corpo: unknown = {}, t = admin) => chamar("POST", rota, corpo, t)
const put = (rota: string, corpo: unknown, t = admin) => chamar("PUT", rota, corpo, t)
const patch = (rota: string, corpo: unknown, t = admin) => chamar("PATCH", rota, corpo, t)

const MARIA = "50000000-0000-0000-0000-000000000001" // bloqueada nos dados de exemplo (RN08)
const CORDEL = "e0000000-0000-0000-0000-000000000009" // RN04

// ---------- acesso ----------
const joao = await entrar("153.509.460-56", "123456")
conferir("GET /circulacao sem token: 401", (await chamar("GET", "/circulacao")).status === 401)
conferir("GET /circulacao com token de sócio: 403", (await get("/circulacao", joao)).status === 403)

// ---------- preparação: sócios e obra do teste ----------
function dadosSocio(nome: string, cpf: string) {
  return {
    nome,
    cpf,
    rg: "",
    telefone: "82999990000",
    email: `${nome.split(" ")[0].toLowerCase()}.${sufixo.toLowerCase()}@example.com`,
    endereco: { rua: "Rua do Teste", numero: "1", bairro: "Centro", cep: "57300000" },
    senha: "senha-teste",
    consentimentoLgpd: true,
  }
}
const cpfA = cpfAleatorio()
const cpfB = cpfAleatorio()
const criarA = await post("/socios", dadosSocio(`Alice Teste ${sufixo}`, cpfA))
conferir("cadastrar sócio pelo admin: 201", criarA.status === 201 && criarA.corpo.socio?.senha === "", criarA.corpo)
const criarB = await post("/socios", dadosSocio(`Bruno Teste ${sufixo}`, cpfB))
const socioA = criarA.corpo.socio.id as string
const socioB = criarB.corpo.socio.id as string
const dup = await post("/socios", dadosSocio(`Outro Nome ${sufixo}`, cpfA))
conferir("CPF repetido: 409", dup.status === 409 && dup.corpo.mensagem.includes("CPF"), dup.corpo)
const semSenha = await post("/socios", { ...dadosSocio(`Sem Senha ${sufixo}`, cpfAleatorio()), senha: "123" })
conferir("senha inicial curta: 400", semSenha.status === 400 && semSenha.corpo.mensagem.includes("senha inicial"), semSenha.corpo)
const tA = await entrar(cpfA, "senha-teste")
const tB = await entrar(cpfB, "senha-teste")

const obra = await post("/livros", {
  titulo: `Obra da Circulação ${sufixo}`,
  autores: ["Graciliano Ramos"],
  editora: "Editora Teste",
  edicao: "1ª",
  ano: 2020,
  categoria: "literatura",
  secao: "T",
  isbn: isbnAleatorio(),
})
const livroId = obra.corpo.livro.id as string
const exs = await post(`/livros/${livroId}/exemplares`, { tombamentos: [1, 2, 3, 4, 5, 6].map((n) => `CIR-${sufixo}-${n}`) })
const ex = (exs.corpo.exemplares as { id: string }[]).map((e) => e.id)
const statusDe = async (id: string) =>
  ((await get(`/livros/${livroId}`)).corpo.livro.exemplares as { id: string; status: string }[]).find((e) => e.id === id)
    ?.status

// ---------- US08: registrar empréstimo ----------
const e1 = await post("/emprestimos", { socioId: socioA, exemplarId: ex[0] })
conferir("empréstimo registrado: 201", e1.status === 201, e1.corpo)
const emp1 = e1.corpo.emprestimo
conferir(
  "US10: data de saída hoje e devolução prevista em 14 dias (RN02)",
  emp1.dataEmprestimo === hojeMais(0) && emp1.dataPrevista === hojeMais(14),
  emp1,
)
conferir("histórico com 'Empréstimo registrado.'", emp1.historico?.[0]?.texto === "Empréstimo registrado.", emp1.historico)
conferir("exemplar emprestado fica indisponível", (await statusDe(ex[0])) === "indisponivel")
const rn14 = await post("/emprestimos", { socioId: socioB, exemplarId: ex[0] })
conferir("RN14: exemplar já emprestado é recusado", rn14.status === 409 && rn14.corpo.mensagem.includes("RN14"), rn14.corpo)
const rn08 = await post("/emprestimos", { socioId: MARIA, exemplarId: ex[1] })
conferir("RN08: sócia com atraso e multa é bloqueada", rn08.status === 409 && rn08.corpo.mensagem.includes("RN08"), rn08.corpo)
const rn04 = await post("/emprestimos", { socioId: socioB, exemplarId: CORDEL })
conferir("RN04: cordel não pode ser emprestado", rn04.status === 409 && rn04.corpo.mensagem.includes("RN04"), rn04.corpo)
const naoExiste = await post("/emprestimos", { socioId: socioB, exemplarId: "00000000-0000-0000-0000-000000000000" })
conferir("exemplar inexistente: 404", naoExiste.status === 404, naoExiste.corpo)

// ---------- US09: renovar ----------
let prevista = emp1.dataPrevista
for (let i = 1; i <= 3; i++) {
  const r = await post(`/emprestimos/${emp1.id}/renovar`)
  const esperado = hojeMais(14 * (i + 1))
  conferir(`renovação ${i}: +14 dias (${esperado})`, r.status === 200 && r.corpo.emprestimo.dataPrevista === esperado, r.corpo)
  prevista = r.corpo.emprestimo?.dataPrevista ?? prevista
}
const r4 = await post(`/emprestimos/${emp1.id}/renovar`)
conferir("RN17: 4ª renovação recusada", r4.status === 409 && r4.corpo.mensagem.includes("RN17"), r4.corpo)

// ---------- US10: alterar prazo ----------
const antes = await patch(`/emprestimos/${emp1.id}`, { dataPrevista: hojeMais(-1), motivo: "Ajuste de teste do prazo." })
conferir("prazo anterior à saída: 400", antes.status === 400, antes.corpo)
const curto = await patch(`/emprestimos/${emp1.id}`, { dataPrevista: hojeMais(10), motivo: "curto" })
conferir("motivo curto: 400", curto.status === 400, curto.corpo)
const alt = await patch(`/emprestimos/${emp1.id}`, { dataPrevista: hojeMais(10), motivo: "Acordo com o sócio no balcão." })
conferir(
  "prazo alterado e registrado no histórico",
  alt.status === 200 &&
    alt.corpo.emprestimo.dataPrevista === hojeMais(10) &&
    alt.corpo.emprestimo.historico.some((h: { texto: string }) => h.texto.startsWith(`Prazo alterado de ${prevista}`)),
  alt.corpo,
)

// ---------- RN01 e cancelamento ----------
const e2 = await post("/emprestimos", { socioId: socioA, exemplarId: ex[1] })
const e3 = await post("/emprestimos", { socioId: socioA, exemplarId: ex[2] })
conferir("2º e 3º empréstimos do mesmo sócio", e2.status === 201 && e3.status === 201, [e2.corpo, e3.corpo])
const rn01 = await post("/emprestimos", { socioId: socioA, exemplarId: ex[3] })
conferir("RN01: 4º exemplar simultâneo recusado", rn01.status === 409 && rn01.corpo.mensagem.includes("RN01"), rn01.corpo)
const cancCurto = await post(`/emprestimos/${e3.corpo.emprestimo.id}/cancelar`, { motivo: "erro" })
conferir("cancelar sem motivo suficiente: 400", cancCurto.status === 400, cancCurto.corpo)
const canc = await post(`/emprestimos/${e3.corpo.emprestimo.id}/cancelar`, { motivo: "Registrado no sócio errado." })
conferir(
  "cancelado: status, motivo e exemplar disponível",
  canc.status === 200 &&
    canc.corpo.emprestimo.status === "cancelado" &&
    canc.corpo.emprestimo.motivoCancelamento === "Registrado no sócio errado." &&
    (await statusDe(ex[2])) === "disponivel",
  canc.corpo,
)
const renCanc = await post(`/emprestimos/${e3.corpo.emprestimo.id}/renovar`)
conferir("empréstimo cancelado não renova", renCanc.status === 409, renCanc.corpo)

// ---------- US11: devolução e multa por atraso ----------
const dev2 = await post(`/emprestimos/${e2.corpo.emprestimo.id}/devolver`)
conferir(
  "devolução no prazo: sem multa, data de devolução hoje (RF07)",
  dev2.status === 200 && dev2.corpo.multas.length === 0 && dev2.corpo.emprestimo.dataDevolucao === hojeMais(0),
  dev2.corpo,
)
conferir("exemplar devolvido volta a ficar disponível", (await statusDe(ex[1])) === "disponivel")
const devDeNovo = await post(`/emprestimos/${e2.corpo.emprestimo.id}/devolver`)
conferir("devolver duas vezes: 409", devDeNovo.status === 409, devDeNovo.corpo)

// ---------- situação do sócio no balcão (US08 / US11) ----------
const sitA = await get(`/socios/${socioA}/situacao`)
conferir(
  "situação: 1 empréstimo ativo de 3, regular",
  sitA.status === 200 &&
    sitA.corpo.situacao.emprestimosAtivos === 1 &&
    sitA.corpo.situacao.limite === 3 &&
    sitA.corpo.situacao.bloqueado === false &&
    sitA.corpo.situacao.multaCorrente === 0,
  sitA.corpo,
)
conferir("situação de sócio inexistente: 404", (await get("/socios/00000000-0000-0000-0000-000000000000/situacao")).status === 404)
conferir("sócio não consulta a situação de outro: 403", (await get(`/socios/${socioA}/situacao`, joao)).status === 403)
const sitMaria = await get(`/socios/${MARIA}/situacao`)
conferir(
  "situação da sócia bloqueada traz o motivo (RN08)",
  sitMaria.corpo.situacao?.bloqueado === true && /atraso/.test(sitMaria.corpo.situacao.motivo),
  sitMaria.corpo,
)

// US11: multa corrente soma os exemplares atrasados (R$ 1,00 por dia e por exemplar)
const extra = await post("/emprestimos", { socioId: socioA, exemplarId: ex[4] })
await pool.query(
  "UPDATE emprestimo SET data_emprestimo = CURRENT_DATE - 19, data_prevista = CURRENT_DATE - 5, renovacoes = 0 WHERE id = $1",
  [emp1.id],
)
await pool.query("UPDATE emprestimo SET data_emprestimo = CURRENT_DATE - 17, data_prevista = CURRENT_DATE - 3 WHERE id = $1", [
  extra.corpo.emprestimo.id,
])
const sitAtraso = await get(`/socios/${socioA}/situacao`)
conferir(
  "multa corrente: 5 dias + 3 dias = R$ 8,00 em 2 exemplares",
  sitAtraso.corpo.situacao?.emprestimosAtrasados === 2 && sitAtraso.corpo.situacao.multaCorrente === 8 && sitAtraso.corpo.situacao.bloqueado,
  sitAtraso.corpo,
)
const euA = await get("/eu/circulacao", tA)
conferir("sócio vê a própria situação em /eu/circulacao", euA.corpo.situacao?.multaCorrente === 8, euA.corpo.situacao)
const devExtra = await post(`/emprestimos/${extra.corpo.emprestimo.id}/devolver`)
conferir(
  "cada exemplar gera a própria multa na devolução (3 × R$ 1,00)",
  devExtra.corpo.multas?.[0]?.valor === 3 && devExtra.corpo.multas[0].dias === 3,
  devExtra.corpo,
)
// a multa do exemplar extra não faz parte do roteiro abaixo
await post(`/multas/${devExtra.corpo.multas[0].id}/quitar`)

const renAtraso = await post(`/emprestimos/${emp1.id}/renovar`)
conferir("empréstimo atrasado não renova", renAtraso.status === 409 && renAtraso.corpo.mensagem.includes("atraso"), renAtraso.corpo)
const bloqueado = await post("/emprestimos", { socioId: socioA, exemplarId: ex[3] })
conferir("RN08: devolução atrasada bloqueia novo empréstimo", bloqueado.status === 409, bloqueado.corpo)
const dev1 = await post(`/emprestimos/${emp1.id}/devolver`)
const multaAtraso = dev1.corpo.multas?.[0]
conferir(
  "US11: multa de 5 dias × R$ 1,00 = R$ 5,00",
  dev1.status === 200 &&
    multaAtraso?.motivo === "atraso" &&
    multaAtraso.valor === 5 &&
    multaAtraso.dias === 5 &&
    multaAtraso.status === "pendente" &&
    dev1.corpo.mensagem.includes("R$ 5,00"),
  dev1.corpo,
)

// ---------- RN07: justificativa e julgamento ----------
const deOutro = await post(`/multas/${multaAtraso.id}/justificativa`, { texto: "x".repeat(30) }, tB)
conferir("outro sócio não justifica a multa: 403", deOutro.status === 403, deOutro.corpo)
const justCurta = await post(`/multas/${multaAtraso.id}/justificativa`, { texto: "curta" }, tA)
conferir("justificativa curta: 400", justCurta.status === 400, justCurta.corpo)
const just = await post(`/multas/${multaAtraso.id}/justificativa`, { texto: "Estive viajando a trabalho e não consegui devolver." }, tA)
conferir("sócio justifica a própria multa: em análise", just.status === 200 && just.corpo.multa.status === "em_analise", just.corpo)
conferir("sócio não julga: 403", (await post(`/multas/${multaAtraso.id}/julgar`, { decisao: "deferido", texto: "x".repeat(20) }, tA)).status === 403)
const indef = await post(`/multas/${multaAtraso.id}/julgar`, { decisao: "indeferido", texto: "Sem comprovante da viagem." })
conferir(
  "indeferida: volta a pendente e guarda o parecer",
  indef.status === 200 && indef.corpo.multa.status === "pendente" && indef.corpo.multa.pareceres.length === 1 && !indef.corpo.multa.justificativa,
  indef.corpo,
)
await post(`/multas/${multaAtraso.id}/justificativa`, { texto: "Segue o comprovante da viagem em anexo no balcão." }, tA)
const defer = await post(`/multas/${multaAtraso.id}/julgar`, { decisao: "deferido", texto: "Comprovante apresentado no balcão." })
conferir("deferida: multa abonada", defer.status === 200 && defer.corpo.multa.status === "abonada" && defer.corpo.multa.dataQuitacao, defer.corpo)

// ---------- devolução com dano (RF15 / RN13) ----------
const png = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
)
const up = await fetch(`${BASE}/api/arquivos`, {
  method: "POST",
  headers: { Authorization: `Bearer ${admin}`, "Content-Type": "image/png", "X-Nome-Arquivo": "dano.png", "X-Destino": "danos" },
  body: new Uint8Array(png),
})
const imagem = (await up.json()).arquivo?.id
conferir("upload da imagem do dano: 201", up.status === 201 && !!imagem)
const e4 = await post("/emprestimos", { socioId: socioA, exemplarId: ex[3] })
conferir("após o abono o sócio volta a pegar emprestado", e4.status === 201, e4.corpo)
const danoCurto = await post(`/emprestimos/${e4.corpo.emprestimo.id}/devolver`, { dano: { relatorio: "rasgado", valor: 25, imagemIds: [] } })
conferir("relatório de dano curto: 400", danoCurto.status === 400, danoCurto.corpo)
const semValor = await post(`/emprestimos/${e4.corpo.emprestimo.id}/devolver`, { dano: { relatorio: "Capa rasgada e páginas soltas.", valor: 0, imagemIds: [] } })
conferir("dano sem valor: 400", semValor.status === 400, semValor.corpo)
const devDano = await post(`/emprestimos/${e4.corpo.emprestimo.id}/devolver`, {
  dano: { relatorio: "Capa rasgada e páginas soltas.", valor: 25, imagemIds: [imagem] },
})
const multaDano = devDano.corpo.multas?.find((m: { motivo: string }) => m.motivo === "dano")
conferir(
  "devolução com dano: multa, ocorrência com a imagem e exemplar danificado",
  devDano.status === 200 &&
    multaDano?.valor === 25 &&
    devDano.corpo.ocorrencia?.imagemIds?.[0] === imagem &&
    devDano.corpo.emprestimo.devolvidoDanificado === true &&
    (await statusDe(ex[3])) === "danificado",
  devDano.corpo,
)
const quit = await post(`/multas/${multaDano.id}/quitar`)
conferir("quitar multa: paga", quit.status === 200 && quit.corpo.multa.status === "paga" && quit.corpo.mensagem.includes("R$ 25,00"), quit.corpo)
conferir("quitar de novo: 409", (await post(`/multas/${multaDano.id}/quitar`)).status === 409)

// ---------- reservas ----------
const res1 = await post("/reservas", { livroId }, tB)
conferir("sócio reserva a obra: 201", res1.status === 201, res1.corpo)
const reservado = res1.corpo.reserva.exemplarId as string
conferir("exemplar reservado", (await statusDe(reservado)) === "reservado")
conferir("reserva repetida da mesma obra: 409", (await post("/reservas", { livroId }, tB)).status === 409)
const outroSocio = await post("/emprestimos", { socioId: socioA, exemplarId: reservado })
conferir("exemplar reservado não sai para outro sócio", outroSocio.status === 409, outroSocio.corpo)
const retirada = await post("/emprestimos", { socioId: socioB, exemplarId: reservado })
conferir("o próprio sócio retira a reserva", retirada.status === 201, retirada.corpo)
const euB = await get("/eu/circulacao", tB)
conferir(
  "GET /eu/circulacao: reserva retirada e empréstimo do sócio",
  euB.status === 200 &&
    euB.corpo.reservas.find((r: { id: string }) => r.id === res1.corpo.reserva.id)?.status === "retirada" &&
    euB.corpo.emprestimos.every((e: { socioId: string }) => e.socioId === socioB) &&
    euB.corpo.emprestimos.length === 1,
  euB.corpo,
)
const res2 = await post("/reservas", { livroId }, tB)
conferir("nova reserva", res2.status === 201, res2.corpo)
conferir("outro sócio não cancela a reserva: 403", (await post(`/reservas/${res2.corpo.reserva.id}/cancelar`, {}, tA)).status === 403)
const cancRes = await post(`/reservas/${res2.corpo.reserva.id}/cancelar`, {}, tB)
conferir(
  "sócio cancela a própria reserva e o exemplar é liberado",
  cancRes.status === 200 && cancRes.corpo.reserva.status === "cancelada" && (await statusDe(res2.corpo.reserva.exemplarId)) === "disponivel",
  cancRes.corpo,
)
const resCordel = await post("/reservas", { livroId: "b0000000-0000-0000-0000-000000000005" }, tB)
conferir("RN04: cordel não pode ser reservado", resCordel.status === 409, resCordel.corpo)
const resAdmin = await post("/reservas", { livroId, socioId: socioA })
conferir("admin reserva em nome do sócio", resAdmin.status === 201 && resAdmin.corpo.reserva.socioId === socioA, resAdmin.corpo)

// ---------- leitura ----------
const circ = await get("/circulacao")
conferir(
  "GET /circulacao traz sócios, empréstimos, multas, ocorrências e reservas",
  circ.status === 200 &&
    circ.corpo.socios.some((s: { id: string }) => s.id === socioA) &&
    circ.corpo.emprestimos.some((e: { id: string }) => e.id === emp1.id) &&
    circ.corpo.multas.some((m: { id: string }) => m.id === multaAtraso.id) &&
    circ.corpo.ocorrencias.some((o: { multaId: string }) => o.multaId === multaDano.id) &&
    circ.corpo.reservas.some((r: { id: string }) => r.id === resAdmin.corpo.reserva.id),
)
conferir("sócio não lê /eu/circulacao de admin: 403", (await get("/eu/circulacao")).status === 403)

// ---------- sócios ----------
const inativarComEmprestimo = await post(`/socios/${socioB}/ativo`)
conferir("não inativa sócio com empréstimo ativo", inativarComEmprestimo.status === 409, inativarComEmprestimo.corpo)
const editado = await put(`/socios/${socioB}`, { ...dadosSocio(`Bruno Editado ${sufixo}`, cpfB), senha: undefined })
conferir("editar cadastro", editado.status === 200 && editado.corpo.socio.nome === `Bruno Editado ${sufixo}`, editado.corpo)
const senha = await post(`/socios/${socioB}/senha`, { senha: "nova-senha-1" })
conferir("redefinir senha", senha.status === 200, senha.corpo)
conferir("login com a nova senha", typeof (await entrar(cpfB, "nova-senha-1")) === "string")
await post(`/reservas/${resAdmin.corpo.reserva.id}/cancelar`)
const inativar = await post(`/socios/${socioA}/ativo`)
conferir("inativar sócio sem empréstimos", inativar.status === 200 && inativar.corpo.socio.ativo === false, inativar.corpo)
const rn06 = await post("/emprestimos", { socioId: socioA, exemplarId: ex[4] })
conferir("RN06: sócio inativo não pega emprestado", rn06.status === 409 && rn06.corpo.mensagem.includes("RN06"), rn06.corpo)
const anon = await post(`/socios/${socioA}/anonimizar`)
conferir(
  "anonimizar: dados pessoais apagados",
  anon.status === 200 && anon.corpo.socio.cpf === "" && anon.corpo.socio.anonimizado === true && anon.corpo.socio.nome.startsWith("Titular anonimizado"),
  anon.corpo,
)
const loginAnon = await chamar("POST", "/auth/login", { usuario: cpfA, senha: "senha-teste" })
conferir("sócio anonimizado não entra", loginAnon.status === 401, loginAnon.corpo)
conferir("cadastro anonimizado não reativa", (await post(`/socios/${socioA}/ativo`)).status === 409)

// devolve o que ficou emprestado, para não deixar o sócio B bloqueado
await post(`/emprestimos/${retirada.corpo.emprestimo.id}/devolver`)

await pool.end()
console.log(falhas ? `\n${falhas} verificação(ões) falharam` : "\nTodas as verificações passaram")
process.exit(falhas ? 1 : 0)
