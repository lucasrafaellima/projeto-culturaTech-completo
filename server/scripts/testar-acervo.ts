// Testa as rotas de acervo (livros, exemplares, status e desbaste).
// Uso: com a API rodando (npm run dev), execute npm run testar-acervo
// Atenção: cria e desbasta registros de verdade no banco (ISBN e tombamentos aleatórios).
const BASE = process.env.API_URL ?? "http://localhost:3333"

let falhas = 0
function conferir(descricao: string, condicao: boolean, detalhe?: unknown) {
  console.log(`${condicao ? "ok  " : "FALHOU"}  ${descricao}`)
  if (!condicao) {
    falhas++
    if (detalhe !== undefined) console.log("        ", detalhe)
  }
}

async function chamar(metodo: string, rota: string, corpo?: unknown, token?: string) {
  const r = await fetch(`${BASE}/api${rota}`, {
    method: metodo,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  return { status: r.status, corpo: await r.json() }
}

async function entrar(usuario: string, senha: string): Promise<string> {
  const r = await chamar("POST", "/auth/login", { usuario, senha })
  if (r.status !== 200) throw new Error(`Login de ${usuario} falhou: ${JSON.stringify(r.corpo)}`)
  return r.corpo.token
}

// ISBN-13 válido e aleatório (prefixo 978)
function isbnAleatorio(): string {
  const base = "978" + Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join("")
  const soma = base.split("").reduce((acc, n, i) => acc + Number(n) * (i % 2 === 0 ? 1 : 3), 0)
  return base + ((10 - (soma % 10)) % 10)
}

const sufixo = Date.now().toString(36).toUpperCase()
const admin = await entrar("admin", "admin123")
const socio = await entrar("153.509.460-56", "123456")
const get = (rota: string, t = admin) => chamar("GET", rota, undefined, t)
const post = (rota: string, corpo: unknown, t = admin) => chamar("POST", rota, corpo, t)
const put = (rota: string, corpo: unknown, t = admin) => chamar("PUT", rota, corpo, t)
const patch = (rota: string, corpo: unknown, t = admin) => chamar("PATCH", rota, corpo, t)
const del = (rota: string, t = admin) => chamar("DELETE", rota, undefined, t)

// ---------- acesso ----------
const semToken = await chamar("GET", "/livros")
conferir("sem token: 401", semToken.status === 401, semToken.corpo)
const comoSocio = await get("/livros", socio)
conferir("token de sócio: 403", comoSocio.status === 403, comoSocio.corpo)

// ---------- obra ----------
const isbn = isbnAleatorio()
const obra = {
  titulo: `Obra de Teste ${sufixo}`,
  autores: ["Autora Nova de Teste " + sufixo, "graciliano ramos"],
  editora: "Editora Teste",
  edicao: "1ª",
  ano: 2020,
  categoria: "literatura",
  secao: "t",
  isbn,
  sinopse: "Criada pelo testar-acervo.",
}
const criada = await post("/livros", obra)
conferir("cadastrar obra: 201", criada.status === 201, criada.corpo)
const livro = criada.corpo.livro
conferir("seção gravada em maiúscula", livro?.secao === "T", livro)
conferir("autores na ordem informada", livro?.autores?.[0]?.nome === obra.autores[0] && livro?.autores?.length === 2, livro?.autores)
conferir(
  "autor já cadastrado é reaproveitado (sem diferenciar maiúsculas)",
  livro?.autores?.[1]?.id === "c0000000-0000-0000-0000-000000000001",
  livro?.autores?.[1],
)

const isbnRepetido = await post("/livros", { ...obra, isbn: `${isbn.slice(0, 3)}-${isbn.slice(3)}` })
conferir("ISBN repetido (com hífen): 409", isbnRepetido.status === 409 && /ISBN/.test(isbnRepetido.corpo.mensagem), isbnRepetido.corpo)
const isbnInvalido = await post("/livros", { ...obra, isbn: "9781234567890" })
conferir("ISBN inválido: 400", isbnInvalido.status === 400, isbnInvalido.corpo)
const secaoInvalida = await post("/livros", { ...obra, isbn: isbnAleatorio(), secao: "AB" })
conferir("seção inválida: 400 (RN22)", secaoInvalida.status === 400 && /RN22/.test(secaoInvalida.corpo.mensagem), secaoInvalida.corpo)
const anoFuturo = await post("/livros", { ...obra, isbn: isbnAleatorio(), ano: new Date().getFullYear() + 1 })
conferir("ano futuro: 400", anoFuturo.status === 400, anoFuturo.corpo)
const autorRepetido = await post("/livros", { ...obra, isbn: isbnAleatorio(), autores: ["Jorge Amado", "JORGE AMADO"] })
conferir("autor repetido: 400 (RN19)", autorRepetido.status === 400 && /RN19/.test(autorRepetido.corpo.mensagem), autorRepetido.corpo)

const editada = await put(`/livros/${livro.id}`, { ...obra, titulo: `Obra Editada ${sufixo}`, autores: ["Jorge Amado"] })
conferir("editar obra: 200", editada.status === 200 && editada.corpo.livro?.titulo === `Obra Editada ${sufixo}`, editada.corpo)
conferir("autores trocados na edição", editada.corpo.livro?.autores?.length === 1 && editada.corpo.livro.autores[0].nome === "Jorge Amado")

const busca = await get(`/livros?busca=${encodeURIComponent("editada " + sufixo)}`)
conferir("listar com busca encontra a obra", busca.status === 200 && busca.corpo.livros?.some((l: { id: string }) => l.id === livro.id), busca.corpo)
const naoExiste = await get("/livros/00000000-0000-0000-0000-000000000000")
conferir("obra inexistente: 404", naoExiste.status === 404)
const idInvalido = await get("/livros/abc")
conferir("id malformado: 404 (sem erro 500)", idInvalido.status === 404)

// ---------- exemplares ----------
const t1 = `TST-${sufixo}-1`
const t2 = `TST-${sufixo}-2`
const t3 = `TST-${sufixo}-3`
const adicionados = await post(`/livros/${livro.id}/exemplares`, { tombamentos: [t1.toLowerCase(), t2, t3] })
conferir("adicionar 3 exemplares: 201", adicionados.status === 201 && adicionados.corpo.exemplares?.length === 3, adicionados.corpo)
conferir(
  "exemplares em maiúsculas, disponíveis, com UUID",
  adicionados.corpo.exemplares?.[0]?.tombamento === t1 &&
    adicionados.corpo.exemplares.every((e: { status: string; id: string }) => e.status === "disponivel" && e.id.length === 36),
  adicionados.corpo.exemplares,
)
const [ex1, ex2, ex3] = adicionados.corpo.exemplares
const tombRepetido = await post(`/livros/${livro.id}/exemplares`, { tombamentos: [t1.toLowerCase()] })
conferir("tombamento já usado (outra caixa): 409", tombRepetido.status === 409, tombRepetido.corpo)
const listaRepetida = await post(`/livros/${livro.id}/exemplares`, { tombamentos: ["X-1", "x-1"] })
conferir("tombamento repetido na lista: 400", listaRepetida.status === 400, listaRepetida.corpo)
// US03: localização física de cada cópia
const tLocal = `TST-${sufixo}-L`
const comLocal = await post(`/livros/${livro.id}/exemplares`, { tombamentos: [tLocal], localizacao: "Estante 3, prateleira B" })
conferir(
  "exemplar com localização: 201",
  comLocal.status === 201 && comLocal.corpo.exemplares?.[0]?.localizacao === "Estante 3, prateleira B",
  comLocal.corpo,
)
const exLocal = comLocal.corpo.exemplares?.[0]
const novaLocal = await patch(`/exemplares/${exLocal?.id}`, { localizacao: "Estante 5" })
conferir(
  "alterar só a localização mantém o status",
  novaLocal.status === 200 && novaLocal.corpo.exemplar?.localizacao === "Estante 5" && novaLocal.corpo.exemplar?.status === "disponivel",
  novaLocal.corpo,
)
const semLocal = await patch(`/exemplares/${exLocal?.id}`, { localizacao: "" })
conferir("localização vazia volta a valer a seção da obra", semLocal.status === 200 && semLocal.corpo.exemplar?.localizacao === undefined, semLocal.corpo)
const localLonga = await patch(`/exemplares/${exLocal?.id}`, { localizacao: "x".repeat(81) })
conferir("localização com mais de 80 caracteres: 400", localLonga.status === 400, localLonga.corpo)
await del(`/exemplares/${exLocal?.id}`)
const semObra = await post("/livros/00000000-0000-0000-0000-000000000000/exemplares", { tombamentos: ["Y-1"] })
conferir("exemplar sem obra: 404 (RN16)", semObra.status === 404 && /RN16/.test(semObra.corpo.mensagem), semObra.corpo)

// ---------- status ----------
const ocioso = await patch(`/exemplares/${ex1.id}`, { status: "ocioso" })
conferir("alterar status para ocioso: 200", ocioso.status === 200 && ocioso.corpo.exemplar?.status === "ocioso", ocioso.corpo)
const reservado = await patch(`/exemplares/${ex2.id}`, { status: "reservado" })
conferir("status reservado manual: 400", reservado.status === 400, reservado.corpo)
const statusInvalido = await patch(`/exemplares/${ex2.id}`, { status: "emprestado" })
conferir("status inexistente: 400", statusInvalido.status === 400, statusInvalido.corpo)
const emprestado = await patch("/exemplares/e0000000-0000-0000-0000-000000000001", { status: "em_restauro" })
conferir("exemplar com empréstimo ativo (dados de exemplo): 409", emprestado.status === 409 && /emprestado/.test(emprestado.corpo.mensagem), emprestado.corpo)

// ---------- desbaste ----------
const desbDisponivel = await post(`/exemplares/${ex2.id}/desbaste`, { relatorio: "Relatório suficiente para o teste." })
conferir("desbaste de exemplar disponível: 409 (RN31)", desbDisponivel.status === 409 && /RN31/.test(desbDisponivel.corpo.mensagem), desbDisponivel.corpo)
const relatorioCurto = await post(`/exemplares/${ex1.id}/desbaste`, { relatorio: "curto" })
conferir("relatório curto: 400 (RN24)", relatorioCurto.status === 400 && /RN24/.test(relatorioCurto.corpo.mensagem), relatorioCurto.corpo)
const relatorio = "Exemplar sem empréstimos há mais de cinco anos; teste automático."
const desbastado = await post(`/exemplares/${ex1.id}/desbaste`, { relatorio })
conferir("desbaste válido: 201", desbastado.status === 201 && desbastado.corpo.desbaste?.statusAnterior === "ocioso", desbastado.corpo)
conferir("US05: o desbaste devolve o administrador que o registrou", typeof desbastado.corpo.desbaste?.admin === "string" && desbastado.corpo.desbaste.admin.length > 0, desbastado.corpo)
const deNovo = await post(`/exemplares/${ex1.id}/desbaste`, { relatorio })
conferir("desbastar de novo: 404", deNovo.status === 404, deNovo.corpo)
const editarBaixado = await patch(`/exemplares/${ex1.id}`, { status: "disponivel" })
conferir("editar exemplar baixado: 409", editarBaixado.status === 409, editarBaixado.corpo)
const relatorioGeral = await get("/desbastes")
conferir(
  "desbaste aparece no relatório com o administrador",
  relatorioGeral.corpo.desbastes?.some((d: { exemplarId: string; admin: string }) => d.exemplarId === ex1.id && d.admin),
  relatorioGeral.corpo.desbastes?.[0],
)
const detalhe = await get(`/livros/${livro.id}`)
conferir(
  "detalhe mostra o exemplar baixado e conta 2 no acervo",
  detalhe.corpo.livro?.exemplaresNoAcervo === 2 &&
    detalhe.corpo.livro.exemplares.find((e: { id: string }) => e.id === ex1.id)?.baixa?.motivo === "desbaste",
  detalhe.corpo.livro,
)

// ---------- exclusões ----------
const comAcervo = await del(`/livros/${livro.id}`)
conferir("excluir obra com exemplares no acervo: 409", comAcervo.status === 409, comAcervo.corpo)
const delEx2 = await del(`/exemplares/${ex2.id}`)
const delEx3 = await del(`/exemplares/${ex3.id}`)
conferir("excluir exemplares sem histórico: 200", delEx2.status === 200 && delEx3.status === 200, [delEx2.corpo, delEx3.corpo])
const delBaixado = await del(`/exemplares/${ex1.id}`)
conferir("excluir exemplar desbastado: 409 (histórico)", delBaixado.status === 409, delBaixado.corpo)
const comHistorico = await del(`/livros/${livro.id}`)
conferir("excluir obra com exemplar baixado: 409", comHistorico.status === 409 && /histórico/.test(comHistorico.corpo.mensagem), comHistorico.corpo)

const vazia = await post("/livros", { ...obra, titulo: `Obra Vazia ${sufixo}`, isbn: isbnAleatorio() })
const delVazia = await del(`/livros/${vazia.corpo.livro?.id}`)
conferir("excluir obra sem exemplares: 200", delVazia.status === 200, delVazia.corpo)
const sumiu = await get(`/livros/${vazia.corpo.livro?.id}`)
conferir("obra excluída não é mais encontrada", sumiu.status === 404)

// ---------- snapshot do acervo ----------
const snapshot = await get("/acervo")
conferir("snapshot sem token: 401", (await chamar("GET", "/acervo")).status === 401)
conferir(
  "snapshot traz obras, autores, exemplares e desbastes",
  snapshot.status === 200 &&
    ["autores", "livros", "exemplares", "desbastes"].every((k) => Array.isArray(snapshot.corpo[k])) &&
    snapshot.corpo.livros.length >= 5,
  Object.keys(snapshot.corpo),
)
conferir(
  "snapshot: desbaste traz o nome do administrador",
  snapshot.corpo.desbastes?.find((d: { exemplarId: string }) => d.exemplarId === ex1.id)?.admin?.length > 0,
  snapshot.corpo.desbastes?.slice(0, 2),
)
const livroSeed = snapshot.corpo.livros.find((l: { id: string }) => l.id === "b0000000-0000-0000-0000-000000000001")
conferir(
  "snapshot: obra com autorIds e exemplar baixado com 'baixa'",
  Array.isArray(livroSeed?.autorIds) &&
    livroSeed.autorIds.length >= 1 &&
    snapshot.corpo.exemplares.some((e: { id: string; baixa?: { motivo: string } }) => e.id === ex1.id && e.baixa?.motivo === "desbaste") &&
    snapshot.corpo.desbastes.some((d: { exemplarId: string; tombamento: string }) => d.exemplarId === ex1.id && d.tombamento === t1),
  livroSeed,
)

// ---------- importação em lote ----------
const lote = (n: number) => ({
  titulo: `Importada ${n} ${sufixo}`,
  autores: [`Autor Importado ${n} ${sufixo}`],
  editora: "Editora Lote",
  edicao: "1ª",
  ano: 2019,
  categoria: "historia",
  secao: "I",
  isbn: isbnAleatorio(),
  tombamentos: [`IMP-${sufixo}-${n}A`, `IMP-${sufixo}-${n}B`],
  linha: n + 1,
})
const antes = (await get("/livros")).corpo.livros.length
const importadas = await post("/livros/importar", { obras: [lote(1), lote(2)] })
conferir(
  "importar 2 obras com 4 exemplares: 201",
  importadas.status === 201 && importadas.corpo.livros?.length === 2 && importadas.corpo.exemplares?.length === 4,
  importadas.corpo,
)
const comErro = lote(3)
const importarRuim = await post("/livros/importar", { obras: [lote(4), { ...comErro, isbn: "123" }] })
conferir(
  "lote com uma linha inválida: erro cita a linha",
  importarRuim.status === 400 && /^Linha 4:/.test(importarRuim.corpo.mensagem),
  importarRuim.corpo,
)
const depois = (await get("/livros")).corpo.livros.length
conferir("lote com erro não grava nada (tudo ou nada)", depois === antes + 2, { antes, depois })
const tombDup = await post("/livros/importar", { obras: [{ ...lote(5), tombamentos: [`IMP-${sufixo}-1A`] }] })
conferir("importar tombamento já existente: 409", tombDup.status === 409 && /Linha 6/.test(tombDup.corpo.mensagem), tombDup.corpo)
const grande = await post("/livros/importar", { obras: Array.from({ length: 1001 }, (_, i) => lote(i)) })
conferir("lote acima do limite de obras: 400", grande.status === 400, grande.corpo)
const importarSocio = await post("/livros/importar", { obras: [lote(7)] }, socio)
conferir("importar como sócio: 403", importarSocio.status === 403)
const semTokenImport = await chamar("POST", "/livros/importar", { obras: [lote(8)] })
conferir("importar sem token: 401", semTokenImport.status === 401)

console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : "\nTodas as verificações passaram.")
process.exit(falhas ? 1 : 0)
