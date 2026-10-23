// Envia os PDFs de exemplo do repositório digital (T26): a digitalização da
// obra rara e um recorte histórico, pelas mesmas rotas que a tela usa.
// Uso: depois de carregar database/02_dados_exemplo.sql e com a API rodando
// (npm run dev), execute npm run dados-pdf. Pode repetir: o que já existe é pulado.
import { gzipSync } from "node:zlib"

const BASE = process.env.API_URL ?? "http://localhost:3333"
const OBRA_RARA = "b0000000-0000-0000-0000-000000000007" // Memórias da Fundação de Arapiraca
const PASTA = "70000000-0000-0000-0000-000000000001" // História de Arapiraca

async function chamar(metodo: string, rota: string, corpo?: unknown, token?: string) {
  const r = await fetch(`${BASE}/api${rota}`, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  return { status: r.status, corpo: await r.json() }
}

// PDF de uma página com título e parágrafos (fonte padrão, texto em Latin-1)
function gerarPdf(titulo: string, linhas: string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
  const conteudo = [
    "BT",
    "/F2 20 Tf",
    "60 770 Td",
    `(${esc(titulo)}) Tj`,
    "/F1 12 Tf",
    "0 -34 Td",
    "16 TL",
    ...linhas.map((l) => `(${esc(l)}) '`),
    "ET",
  ].join("\n")
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(conteudo, "latin1")} >>\nstream\n${conteudo}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>",
  ]
  let pdf = "%PDF-1.4\n"
  const offsets: number[] = []
  objetos.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"))
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf, "latin1")
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) pdf += `${String(o).padStart(10, "0")} 00000 n \n`
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf, "latin1")
}

const documentos = [
  {
    titulo: "Memórias da Fundação de Arapiraca (digitalização)",
    nome: "memorias-da-fundacao.pdf",
    descricao: "Digitalização da obra rara, para consulta sem manuseio do original.",
    vinculo: { tipo: "livro", livroId: OBRA_RARA },
    destino: "acervo",
    pdf: gerarPdf("Memórias da Fundação de Arapiraca", [
      "Digitalização do exemplar raro do acervo da Biblioteca Municipal",
      "Prof. Pedro de França Reis. Documento para consulta digital.",
      "",
      "O povoado que deu origem a Arapiraca formou-se no início do século XIX,",
      "à sombra de uma árvore de arapiraca, onde tropeiros e agricultores",
      "descansavam no caminho entre o sertão e o litoral.",
      "",
      "Este arquivo substitui o manuseio físico da obra original (RN04).",
    ]),
  },
  {
    titulo: "Jornal de Arapiraca - inauguração da Biblioteca (1962)",
    nome: "recorte-inauguracao-1962.pdf",
    descricao: "Recorte de jornal sobre a inauguração da Biblioteca Municipal.",
    vinculo: { tipo: "pasta", pastaId: PASTA },
    destino: "documentos",
    pdf: gerarPdf("Inaugurada a Biblioteca Municipal", [
      "Jornal de Arapiraca, 14 de junho de 1962.",
      "",
      "Em cerimônia concorrida, foi inaugurada ontem a Biblioteca Municipal,",
      "que abre as portas com cerca de dois mil volumes doados pela comunidade.",
      "Estudantes e professores lotaram o salão.",
    ]),
  },
]

const login = await chamar("POST", "/auth/login", { usuario: "admin", senha: "admin123" })
if (login.status !== 200) throw new Error(`Login do admin falhou: ${JSON.stringify(login.corpo)}`)
const token = login.corpo.token as string

const existentes = (await chamar("GET", "/repositorio")).corpo.documentos as { titulo: string }[]
for (const d of documentos) {
  if (existentes.some((e) => e.titulo === d.titulo)) {
    console.log(`já existe  ${d.titulo}`)
    continue
  }
  // mesmo formato da tela: PDF comprimido em gzip (RNF13)
  const gz = gzipSync(d.pdf)
  const up = await fetch(`${BASE}/api/arquivos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/pdf",
      "X-Nome-Arquivo": encodeURIComponent(d.nome),
      "X-Compressao": "gzip",
      "X-Tamanho-Original": String(d.pdf.length),
      "X-Destino": d.destino,
    },
    body: new Uint8Array(gz),
  })
  const arquivo = (await up.json()) as { ok: boolean; mensagem?: string; arquivo?: { id: string } }
  if (!arquivo.ok || !arquivo.arquivo) throw new Error(`Upload de ${d.nome} falhou: ${arquivo.mensagem}`)
  const doc = await chamar(
    "POST",
    "/documentos",
    { arquivoId: arquivo.arquivo.id, titulo: d.titulo, formato: "pdf", descricao: d.descricao, vinculo: d.vinculo },
    token,
  )
  if (doc.status !== 201) {
    await chamar("DELETE", `/arquivos/${arquivo.arquivo.id}`, undefined, token)
    throw new Error(`Anexar ${d.titulo} falhou: ${doc.corpo.mensagem}`)
  }
  console.log(`anexado   ${d.titulo}`)
}
