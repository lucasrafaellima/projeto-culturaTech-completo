// Testa as rotas do mural (RF12): leitura pública, cadastro, edição e exclusão
// pelo administrador, com as imagens no armazenamento (S3 ou disco).
// Uso: com a API rodando (npm run dev), execute npm run testar-mural
// Atenção: grava publicações e imagens de teste (removidas ao final).
const BASE = process.env.API_URL ?? "http://localhost:3333"

let falhas = 0
function conferir(descricao: string, condicao: boolean, detalhe?: unknown) {
  console.log(`${condicao ? "ok  " : "FALHOU"}  ${descricao}`)
  if (!condicao) {
    falhas++
    if (detalhe !== undefined) console.log("        ", JSON.stringify(detalhe).slice(0, 500))
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

const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex")
async function enviarImagem(token: string): Promise<string> {
  const r = await fetch(`${BASE}/api/arquivos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/png", "X-Nome-Arquivo": "mural.png", "X-Destino": "mural" },
    body: new Uint8Array(png),
  })
  return (await r.json()).arquivo.id
}
const lerImagem = async (id: string, token?: string) =>
  (await fetch(`${BASE}/api/arquivos/${id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })).status

const sufixo = Date.now().toString(36).toUpperCase()
const admin = await entrar("admin", "admin123")
const joao = await entrar("153.509.460-56", "123456")
const hoje = new Date().toISOString().slice(0, 10)

// ---------- leitura pública ----------
const mural = await chamar("GET", "/mural")
conferir("GET /mural sem login", mural.status === 200 && Array.isArray(mural.corpo.publicacoes), mural.corpo)

// ---------- acesso ----------
const base = { tipo: "evento", titulo: `Sarau de Teste ${sufixo}`, descricao: "Leitura de poemas.", data: hoje, imagemIds: [] }
conferir("publicar sem token: 401", (await chamar("POST", "/publicacoes", base)).status === 401)
conferir("publicar com token de sócio: 403", (await chamar("POST", "/publicacoes", base, joao)).status === 403)

// ---------- validações (mesmas do front) ----------
const curto = await chamar("POST", "/publicacoes", { ...base, titulo: "ab" }, admin)
conferir("título curto: 400", curto.status === 400 && curto.corpo.mensagem === "Informe o título da publicação.", curto.corpo)
const vazia = await chamar("POST", "/publicacoes", { ...base, descricao: "" }, admin)
conferir("sem descrição nem imagem: 400 (RF12)", vazia.status === 400 && /descrição e\/ou/.test(vazia.corpo.mensagem), vazia.corpo)
const semData = await chamar("POST", "/publicacoes", { ...base, data: "" }, admin)
conferir("sem data: 400", semData.status === 400, semData.corpo)
const tipoRuim = await chamar("POST", "/publicacoes", { ...base, tipo: "aviso" }, admin)
conferir("tipo inválido: 400", tipoRuim.status === 400, tipoRuim.corpo)
const imgInexistente = await chamar("POST", "/publicacoes", { ...base, imagemIds: ["00000000-0000-0000-0000-000000000000"] }, admin)
conferir("imagem inexistente: 400", imgInexistente.status === 400, imgInexistente.corpo)

// ---------- cadastro com imagens ----------
const img1 = await enviarImagem(admin)
const img2 = await enviarImagem(admin)
conferir("imagem enviada, ainda sem publicação, não é pública", (await lerImagem(img1)) === 401)
const criada = await chamar("POST", "/publicacoes", { ...base, imagemIds: [img1, img2] }, admin)
const pub = criada.corpo.publicacao
conferir(
  "publicação com 2 imagens, na ordem enviada: 201",
  criada.status === 201 && pub?.imagemIds?.[0] === img1 && pub.imagemIds[1] === img2 && pub.tipo === "evento",
  criada.corpo,
)
conferir("visitante vê a imagem da publicação", (await lerImagem(img1)) === 200)
conferir(
  "publicação aparece em GET /mural",
  (await chamar("GET", "/mural")).corpo.publicacoes.some((p: { id: string }) => p.id === pub.id),
)
const somenteImagem = await chamar("POST", "/publicacoes", { ...base, titulo: `Só imagem ${sufixo}`, descricao: "", imagemIds: [await enviarImagem(admin)] }, admin)
conferir("só imagem, sem descrição: 201 (RF12)", somenteImagem.status === 201, somenteImagem.corpo)
const reaproveitada = await chamar("POST", "/publicacoes", { ...base, titulo: `Outra ${sufixo}`, imagemIds: [img1] }, admin)
conferir("imagem de outra publicação: 400", reaproveitada.status === 400, reaproveitada.corpo)

// ---------- edição: tira img2 e põe img3 ----------
const img3 = await enviarImagem(admin)
const editada = await chamar("PUT", `/publicacoes/${pub.id}`, { ...base, titulo: `Sarau editado ${sufixo}`, imagemIds: [img3, img1] }, admin)
conferir(
  "editar: título e imagens trocados",
  editada.status === 200 && editada.corpo.publicacao.titulo === `Sarau editado ${sufixo}` &&
    editada.corpo.publicacao.imagemIds.join() === [img3, img1].join(),
  editada.corpo,
)
conferir("imagem retirada da publicação é apagada", (await lerImagem(img2, admin)) === 404)
conferir("imagem mantida continua pública", (await lerImagem(img1)) === 200)
conferir("editar publicação inexistente: 404", (await chamar("PUT", "/publicacoes/00000000-0000-0000-0000-000000000000", base, admin)).status === 404)

// ---------- filtros e ordenação da consulta pública (T11) ----------
const ids = (r: { corpo: { publicacoes: { id: string }[] } }) => r.corpo.publicacoes.map((p) => p.id)
const soEventos = await chamar("GET", "/mural?tipo=evento")
conferir(
  "filtro por tipo: só eventos",
  soEventos.status === 200 && soEventos.corpo.publicacoes.every((p: { tipo: string }) => p.tipo === "evento") &&
    ids(soEventos).includes(pub.id),
  soEventos.corpo,
)
conferir("filtro por tipo exclui os demais", !ids(await chamar("GET", "/mural?tipo=noticia")).includes(pub.id))
conferir("tipo inválido no filtro: 400", (await chamar("GET", "/mural?tipo=aviso")).status === 400)
const porBusca = await chamar("GET", `/mural?busca=${encodeURIComponent(`SARAU EDITADO ${sufixo}`)}`)
conferir("busca ignora maiúsculas", ids(porBusca).length === 1 && ids(porBusca)[0] === pub.id, porBusca.corpo)
conferir("busca sem resultado: lista vazia", ids(await chamar("GET", `/mural?busca=nada-${sufixo}`)).length === 0)
conferir("busca com % não vira curinga", ids(await chamar("GET", "/mural?busca=%25")).length === 0)
conferir("período que inclui a data", ids(await chamar("GET", `/mural?de=${hoje}&ate=${hoje}`)).includes(pub.id))
conferir("período sem a data", !ids(await chamar("GET", "/mural?ate=2000-01-01")).includes(pub.id))
conferir("data de filtro inválida: 400", (await chamar("GET", "/mural?de=ontem")).status === 400)
const recentes = (await chamar("GET", "/mural?ordem=recentes")).corpo.publicacoes as { data: string }[]
conferir("ordem recentes: data decrescente", recentes.every((p, i) => i === 0 || recentes[i - 1].data >= p.data))
const antigas = (await chamar("GET", "/mural?ordem=antigas")).corpo.publicacoes as { data: string }[]
conferir("ordem antigas: data crescente", antigas.every((p, i) => i === 0 || antigas[i - 1].data <= p.data))
const destaque = (await chamar("GET", "/mural")).corpo.publicacoes as { tipo: string; data: string }[]
const futuro = (p: { tipo: string; data: string }) => p.tipo === "evento" && p.data >= hoje
const nFuturos = destaque.filter(futuro).length
conferir("ordem padrão: eventos futuros primeiro", destaque.slice(0, nFuturos).every(futuro), destaque)
conferir("ordenação inválida: 400", (await chamar("GET", "/mural?ordem=aleatoria")).status === 400)

// ---------- exclusão ----------
const excluida = await chamar("DELETE", `/publicacoes/${pub.id}`, undefined, admin)
conferir("excluir publicação: 200", excluida.status === 200, excluida.corpo)
conferir("imagens da publicação excluída são apagadas", (await lerImagem(img1, admin)) === 404 && (await lerImagem(img3, admin)) === 404)
conferir("excluir de novo: 404", (await chamar("DELETE", `/publicacoes/${pub.id}`, undefined, admin)).status === 404)
await chamar("DELETE", `/publicacoes/${somenteImagem.corpo.publicacao.id}`, undefined, admin)

console.log(falhas ? `\n${falhas} verificação(ões) falharam` : "\nTodas as verificações passaram")
process.exit(falhas ? 1 : 0)
