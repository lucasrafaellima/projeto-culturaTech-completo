// Testa os arquivos (upload/leitura no S3 ou disco), o repositório digital
// (US17 / US18) e a consulta pública do acervo.
// Uso: com a API rodando (npm run dev), execute npm run testar-repositorio
// Atenção: grava documentos, pastas, um sócio e arquivos de teste de verdade.
// Usa as variáveis PG* da API (server/.env) para conferir as chaves gravadas.
import { gzipSync } from "node:zlib"
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

async function enviar(bytes: Buffer, mime: string, token?: string, extra: Record<string, string> = {}) {
  const r = await fetch(`${BASE}/api/arquivos`, {
    method: "POST",
    headers: {
      "Content-Type": mime,
      "X-Nome-Arquivo": encodeURIComponent("Ata de fundação nº 1.pdf"),
      "X-Destino": "acervo",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    body: new Uint8Array(bytes),
  })
  return { status: r.status, corpo: await r.json() }
}

async function baixar(id: string, token?: string) {
  const r = await fetch(`${BASE}/api/arquivos/${id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  return { status: r.status, tipo: r.headers.get("content-type"), bytes: Buffer.from(await r.arrayBuffer()) }
}

const sufixo = Date.now().toString(36).toUpperCase()
const admin = await entrar("admin", "admin123")
const joao = await entrar("153.509.460-56", "123456")
const VIDAS_SECAS = "b0000000-0000-0000-0000-000000000001"
const PASTA = "70000000-0000-0000-0000-000000000001"
const pdf = Buffer.from(`%PDF-1.4\n% documento de teste ${sufixo}\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n`)
const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex")

// ---------- upload ----------
conferir("upload sem token: 401", (await enviar(pdf, "application/pdf")).status === 401)
conferir("upload com token de sócio: 403", (await enviar(pdf, "application/pdf", joao)).status === 403)
const txt = await enviar(Buffer.from("olá"), "text/plain", admin)
conferir("formato não suportado: 400", txt.status === 400 && txt.corpo.mensagem.includes("RNF12"), txt.corpo)
const falso = await enviar(Buffer.from("<html>não é pdf</html>"), "application/pdf", admin)
conferir("conteúdo que não é PDF: 400", falso.status === 400, falso.corpo)
const compErrada = await enviar(png, "image/png", admin, { "X-Compressao": "gzip" })
conferir("compressão incompatível: 400", compErrada.status === 400, compErrada.corpo)
const vazio = await enviar(Buffer.alloc(0), "application/pdf", admin)
conferir("arquivo vazio: 400", vazio.status === 400, vazio.corpo)

const upPdf = await enviar(pdf, "application/pdf", admin)
conferir(
  "upload de PDF: 201 com nome e tamanho",
  upPdf.status === 201 && upPdf.corpo.arquivo.nomeArquivo === "Ata de fundação nº 1.pdf" && upPdf.corpo.arquivo.tamanhoArmazenado === pdf.length,
  upPdf.corpo,
)
const gz = gzipSync(pdf)
const upGz = await enviar(gz, "application/pdf", admin, {
  "X-Compressao": "gzip",
  "X-Tamanho-Original": String(pdf.length),
  "X-Destino": "documentos",
})
conferir("upload de PDF comprimido (gzip, RNF13): 201", upGz.status === 201 && upGz.corpo.arquivo.compressao === "gzip", upGz.corpo)
const upPng = await enviar(png, "image/png", admin, { "X-Destino": "documentos" })
conferir("upload de imagem: 201", upPng.status === 201, upPng.corpo)
const idPdf = upPdf.corpo.arquivo.id as string
const idGz = upGz.corpo.arquivo.id as string
const idPng = upPng.corpo.arquivo.id as string

// ---------- pastas do bucket e extensão no nome ----------
const destinoRuim = await enviar(pdf, "application/pdf", admin, { "X-Destino": "outra" })
conferir("destino inexistente: 400", destinoRuim.status === 400 && /Destino/.test(destinoRuim.corpo.mensagem), destinoRuim.corpo)
const semDestino = await enviar(pdf, "application/pdf", admin, { "X-Destino": "" })
conferir("sem destino: 400", semDestino.status === 400, semDestino.corpo)
const pdfNoMural = await enviar(pdf, "application/pdf", admin, { "X-Destino": "mural" })
conferir("PDF na pasta do mural: 400 (só imagens)", pdfNoMural.status === 400, pdfNoMural.corpo)
const chaveDe = async (id: string) =>
  (await pool.query<{ chave_storage: string }>("SELECT chave_storage FROM culturatech.arquivo WHERE id = $1", [id])).rows[0]
    ?.chave_storage
conferir("PDF do acervo gravado como acervo/<id>.pdf", (await chaveDe(idPdf)) === `acervo/${idPdf}.pdf`, await chaveDe(idPdf))
conferir("PDF comprimido gravado como documentos/<id>.pdf", (await chaveDe(idGz)) === `documentos/${idGz}.pdf`, await chaveDe(idGz))
conferir("imagem gravada como documentos/<id>.png", (await chaveDe(idPng)) === `documentos/${idPng}.png`, await chaveDe(idPng))
const doAcervo = await enviar(pdf, "application/pdf", admin)
const pastaErrada = await chamar("POST", "/documentos", {
  arquivoId: doAcervo.corpo.arquivo.id, titulo: "Na pasta errada", formato: "pdf", vinculo: { tipo: "pasta", pastaId: PASTA },
}, admin)
conferir("arquivo da pasta acervo/ ligado a uma pasta histórica: 400", pastaErrada.status === 400 && /outra pasta/.test(pastaErrada.corpo.mensagem), pastaErrada.corpo)
await chamar("DELETE", `/arquivos/${doAcervo.corpo.arquivo.id}`, undefined, admin)

// arquivo ainda sem vínculo não é público
conferir("arquivo sem vínculo, sem token: 401", (await baixar(idPdf)).status === 401)
conferir("arquivo sem vínculo, sócio: 404", (await baixar(idPdf, joao)).status === 404)
const lidoAdmin = await baixar(idPdf, admin)
conferir("admin lê o arquivo com o mesmo conteúdo", lidoAdmin.status === 200 && lidoAdmin.bytes.equals(pdf), lidoAdmin.status)

// ---------- US17: anexar digitalizações ----------
const docCurto = await chamar("POST", "/documentos", { arquivoId: idPdf, titulo: "ab", formato: "pdf", vinculo: { tipo: "livro", livroId: VIDAS_SECAS } }, admin)
conferir("título curto: 400", docCurto.status === 400, docCurto.corpo)
const semObra = await chamar("POST", "/documentos", {
  arquivoId: idPdf, titulo: "Ata", formato: "pdf", vinculo: { tipo: "livro", livroId: "00000000-0000-0000-0000-000000000000" },
}, admin)
conferir("RF08: obra inexistente: 404", semObra.status === 404 && semObra.corpo.mensagem.includes("RF08"), semObra.corpo)
const formatoErrado = await chamar("POST", "/documentos", { arquivoId: idPdf, titulo: "Ata", formato: "imagem", vinculo: { tipo: "livro", livroId: VIDAS_SECAS } }, admin)
conferir("formato diferente do arquivo: 400", formatoErrado.status === 400, formatoErrado.corpo)
const comoSocio = await chamar("POST", "/documentos", { arquivoId: idPdf, titulo: "Ata", formato: "pdf", vinculo: { tipo: "livro", livroId: VIDAS_SECAS } }, joao)
conferir("sócio não anexa: 403", comoSocio.status === 403)

const doc1 = await chamar("POST", "/documentos", {
  arquivoId: idPdf, titulo: `Edição digitalizada ${sufixo}`, formato: "pdf", descricao: "Teste", vinculo: { tipo: "livro", livroId: VIDAS_SECAS },
}, admin)
conferir(
  "PDF vinculado à obra: 201 no formato do front",
  doc1.status === 201 && doc1.corpo.documento.id === idPdf && doc1.corpo.documento.vinculo.livroId === VIDAS_SECAS,
  doc1.corpo,
)
const doc2 = await chamar("POST", "/documentos", { arquivoId: idGz, titulo: `Recorte de jornal ${sufixo}`, formato: "pdf", vinculo: { tipo: "pasta", pastaId: PASTA } }, admin)
conferir("PDF comprimido vinculado à pasta: 201", doc2.status === 201 && doc2.corpo.documento.vinculo.pastaId === PASTA, doc2.corpo)
const doc3 = await chamar("POST", "/documentos", { arquivoId: idPng, titulo: `Fotografia ${sufixo}`, formato: "imagem", vinculo: { tipo: "pasta", pastaId: PASTA } }, admin)
conferir("imagem vinculada à pasta: 201", doc3.status === 201, doc3.corpo)
const repetido = await chamar("POST", "/documentos", { arquivoId: idPdf, titulo: "De novo", formato: "pdf", vinculo: { tipo: "pasta", pastaId: PASTA } }, admin)
conferir("mesmo arquivo em outro documento: 409", repetido.status === 409, repetido.corpo)

// ---------- US18: visualizar PDFs (público) ----------
const repo = await chamar("GET", "/repositorio")
conferir(
  "GET /repositorio sem login lista pastas e documentos",
  repo.status === 200 && repo.corpo.pastas.some((p: { id: string }) => p.id === PASTA) && [idPdf, idGz, idPng].every((i) => repo.corpo.documentos.some((d: { id: string }) => d.id === i)),
  repo.corpo,
)
const publico = await baixar(idPdf)
conferir("visitante abre o PDF do repositório", publico.status === 200 && publico.tipo === "application/pdf" && publico.bytes.equals(pdf), publico.status)
const publicoGz = await baixar(idGz)
conferir("PDF guardado em gzip chega descomprimido (Content-Encoding)", publicoGz.status === 200 && publicoGz.bytes.equals(pdf), publicoGz.bytes.subarray(0, 8).toString())

// ---------- pastas ----------
const nomePasta = `Pasta de Teste ${sufixo}`
const pasta = await chamar("POST", "/pastas", { nome: nomePasta, descricao: "Criada pelo teste" }, admin)
conferir("cadastrar pasta: 201", pasta.status === 201, pasta.corpo)
conferir("nome de pasta repetido: 409", (await chamar("POST", "/pastas", { nome: nomePasta }, admin)).status === 409)
conferir("nome curto: 400", (await chamar("POST", "/pastas", { nome: "ab" }, admin)).status === 400)
const pastaEd = await chamar("PUT", `/pastas/${pasta.corpo.pasta.id}`, { nome: `${nomePasta} (editada)`, descricao: "x" }, admin)
conferir("editar pasta", pastaEd.status === 200 && pastaEd.corpo.pasta.nome.endsWith("(editada)"), pastaEd.corpo)
const comDocs = await chamar("DELETE", `/pastas/${PASTA}`, undefined, admin)
conferir("pasta com documentos não é excluída", comDocs.status === 409, comDocs.corpo)
conferir("excluir pasta vazia", (await chamar("DELETE", `/pastas/${pasta.corpo.pasta.id}`, undefined, admin)).status === 200)

// ---------- exclusão ----------
for (const id of [idPdf, idGz, idPng]) {
  const r = await chamar("DELETE", `/documentos/${id}`, undefined, admin)
  conferir(`remover documento ${id.slice(0, 8)}`, r.status === 200, r.corpo)
}
conferir("arquivo removido não é mais servido", (await baixar(idPdf, admin)).status === 404)
conferir("remover de novo: 404", (await chamar("DELETE", `/documentos/${idPdf}`, undefined, admin)).status === 404)

// upload órfão (cadastro que não chegou a ser feito) pode ser apagado
const orfao = await enviar(pdf, "application/pdf", admin)
conferir("apagar upload sem uso", (await chamar("DELETE", `/arquivos/${orfao.corpo.arquivo.id}`, undefined, admin)).status === 200)

// ---------- foto do sócio: só ele e o admin ----------
const foto = await enviar(png, "image/png", admin, { "X-Destino": "socios" })
const cpf = (() => {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10))
  const dv = (b: number[]) => { const r = (b.reduce((a, d, i) => a + d * (b.length + 1 - i), 0) * 10) % 11; return r === 10 ? 0 : r }
  n.push(dv(n)); n.push(dv(n))
  return n.join("")
})()
const socio = await chamar("POST", "/socios", {
  nome: `Foto Teste ${sufixo}`, cpf, rg: "", telefone: "82999990000", email: `foto.${sufixo.toLowerCase()}@example.com`,
  endereco: { rua: "Rua A", numero: "1", bairro: "Centro", cep: "57300000" }, senha: "senha-teste", consentimentoLgpd: true,
  fotoId: foto.corpo.arquivo.id,
}, admin)
conferir("sócio cadastrado com foto", socio.status === 201 && socio.corpo.socio.fotoId === foto.corpo.arquivo.id, socio.corpo)
const tSocio = await entrar(cpf, "senha-teste")
conferir("foto sem token: 401", (await baixar(foto.corpo.arquivo.id)).status === 401)
conferir("foto vista por outro sócio: 404", (await baixar(foto.corpo.arquivo.id, joao)).status === 404)
conferir("foto vista pelo próprio sócio", (await baixar(foto.corpo.arquivo.id, tSocio)).status === 200)
conferir("foto em uso não é apagada", (await chamar("DELETE", `/arquivos/${foto.corpo.arquivo.id}`, undefined, admin)).status === 409)
conferir("foto gravada na pasta socios/", (await chaveDe(foto.corpo.arquivo.id))?.startsWith("socios/") === true, await chaveDe(foto.corpo.arquivo.id))
const fotoDoMural = await enviar(png, "image/png", admin, { "X-Destino": "mural" })
const comFotoErrada = await chamar("PUT", `/socios/${socio.corpo.socio.id}`, {
  nome: `Foto Teste ${sufixo}`, cpf, rg: "", telefone: "82999990000", email: `foto.${sufixo.toLowerCase()}@example.com`,
  endereco: { rua: "Rua A", numero: "1", bairro: "Centro", cep: "57300000" }, consentimentoLgpd: true,
  fotoId: fotoDoMural.corpo.arquivo.id,
}, admin)
conferir("imagem da pasta mural/ como foto de sócio: 400", comFotoErrada.status === 400, comFotoErrada.corpo)
await chamar("DELETE", `/arquivos/${fotoDoMural.corpo.arquivo.id}`, undefined, admin)

// ---------- consulta pública do acervo (RN30) ----------
const pub = await chamar("GET", "/acervo/publico")
const exPub = pub.corpo.exemplares as { id: string; status: string }[]
conferir(
  "acervo público sem login: exemplar baixado oculto e em restauro mascarado",
  pub.status === 200 &&
    !exPub.some((e) => e.id === "e0000000-0000-0000-0000-000000000006") &&
    exPub.find((e) => e.id === "e0000000-0000-0000-0000-000000000004")?.status === "indisponivel" &&
    pub.corpo.desbastes.length === 0,
  exPub,
)

await pool.end()
console.log(falhas ? `\n${falhas} verificação(ões) falharam` : "\nTodas as verificações passaram")
process.exit(falhas ? 1 : 0)
