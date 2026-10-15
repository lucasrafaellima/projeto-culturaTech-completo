// ============================================================
// Gera no navegador os arquivos dos dados de demonstração
// (PDFs de uma página e imagens PNG), para que o repositório e o
// mural tenham conteúdo real para visualizar no primeiro acesso.
// ============================================================
import { ARQUIVOS_DEMO } from "./mock-data"
import { armazenarComId, lerArquivo } from "./arquivos"

// Converte texto para WinAnsi (Latin-1) escapando caracteres especiais do PDF
function textoPdf(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
}

function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out[i] = c < 256 ? c : 63 // "?"
  }
  return out
}

/** Monta um PDF de uma página com título e parágrafos. */
function gerarPdf(titulo: string, linhas: string[]): Blob {
  const conteudo = [
    "BT",
    "/F2 20 Tf",
    "60 770 Td",
    `(${textoPdf(titulo)}) Tj`,
    "/F1 12 Tf",
    "0 -34 Td",
    "16 TL",
    ...linhas.map((l) => `(${textoPdf(l)}) '`),
    "ET",
    "0.29 0.55 0.5 RG 2 w 60 740 m 535 740 l S",
  ].join("\n")

  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    `<< /Length ${latin1(conteudo).length} >>\nstream\n${conteudo}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>",
  ]

  let pdf = "%PDF-1.4\n"
  const offsets: number[] = []
  objetos.forEach((obj, i) => {
    offsets.push(latin1(pdf).length)
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const inicioXref = latin1(pdf).length
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  offsets.forEach((o) => {
    pdf += `${String(o).padStart(10, "0")} 00000 n \n`
  })
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF`
  return new Blob([latin1(pdf)], { type: "application/pdf" })
}

function gerarImagem(
  largura: number,
  altura: number,
  desenhar: (ctx: CanvasRenderingContext2D) => void,
): Promise<Blob | null> {
  const canvas = document.createElement("canvas")
  canvas.width = largura
  canvas.height = altura
  const ctx = canvas.getContext("2d")
  if (!ctx) return Promise.resolve(null)
  desenhar(ctx)
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"))
}

async function imagemRecorte(): Promise<Blob | null> {
  return gerarImagem(900, 620, (ctx) => {
    ctx.fillStyle = "#efe6d2"
    ctx.fillRect(0, 0, 900, 620)
    ctx.fillStyle = "#2b2520"
    ctx.font = "bold 46px Georgia, serif"
    ctx.textAlign = "center"
    ctx.fillText("JORNAL DE ARAPIRACA", 450, 80)
    ctx.fillRect(60, 100, 780, 3)
    ctx.font = "18px Georgia, serif"
    ctx.fillText("Arapiraca, 14 de junho de 1962", 450, 132)
    ctx.font = "bold 32px Georgia, serif"
    ctx.fillText("Inaugurada a Biblioteca Municipal", 450, 196)
    ctx.textAlign = "left"
    ctx.font = "17px Georgia, serif"
    const texto =
      "Em cerimônia concorrida, foi inaugurada ontem a Biblioteca Municipal, que abre as portas com cerca de dois mil volumes doados pela comunidade. Estudantes e professores lotaram o salão."
    let y = 250
    let linha = ""
    for (const palavra of texto.split(" ")) {
      const teste = linha ? `${linha} ${palavra}` : palavra
      if (ctx.measureText(teste).width > 760) {
        ctx.fillText(linha, 70, y)
        y += 28
        linha = palavra
      } else {
        linha = teste
      }
    }
    ctx.fillText(linha, 70, y)
    ctx.fillStyle = "#c9bb9c"
    ctx.fillRect(70, y + 30, 360, 200)
    ctx.fillStyle = "#6f6454"
    ctx.font = "italic 15px Georgia, serif"
    ctx.fillText("[fotografia da fachada]", 170, y + 135)
  })
}

async function imagemFestival(): Promise<Blob | null> {
  return gerarImagem(1200, 630, (ctx) => {
    const grad = ctx.createLinearGradient(0, 0, 1200, 630)
    grad.addColorStop(0, "#1f6f65")
    grad.addColorStop(1, "#c96a2b")
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 1200, 630)
    ctx.strokeStyle = "rgba(255,255,255,0.18)"
    ctx.lineWidth = 3
    for (let i = 0; i < 14; i++) {
      ctx.beginPath()
      ctx.moveTo(0, 60 + i * 45)
      for (let x = 0; x <= 1200; x += 60) ctx.lineTo(x, 60 + i * 45 + (x % 120 === 0 ? 15 : -15))
      ctx.stroke()
    }
    ctx.fillStyle = "#fff"
    ctx.textAlign = "center"
    ctx.font = "bold 76px Georgia, serif"
    ctx.fillText("Festival de Cordel", 600, 280)
    ctx.font = "36px Georgia, serif"
    ctx.fillText("Biblioteca Municipal de Arapiraca", 600, 350)
    ctx.font = "28px sans-serif"
    ctx.fillText("Cordelistas • Xilogravura • Oficina infantil", 600, 420)
  })
}

export type TamanhosDemo = Record<string, { tamanhoOriginal: number; tamanhoArmazenado: number }>

/** Garante que os arquivos de demonstração existam no IndexedDB e devolve seus tamanhos. */
export async function garantirArquivosDemo(): Promise<TamanhosDemo> {
  const tamanhos: TamanhosDemo = {}
  const jaExiste = await lerArquivo(ARQUIVOS_DEMO.pdfFundacao).catch(() => null)
  if (jaExiste) return tamanhos

  const pdf1 = gerarPdf("Memórias da Fundação de Arapiraca", [
    "Digitalização do exemplar raro do acervo da Biblioteca Municipal",
    "Prof. Pedro de França Reis. Documento para consulta digital.",
    "",
    "O povoado que deu origem a Arapiraca formou-se no início do século XIX,",
    "à sombra de uma árvore de arapiraca, onde tropeiros e agricultores",
    "descansavam no caminho entre o sertão e o litoral.",
    "",
    "Com o cultivo do fumo, a localidade cresceu e tornou-se um dos",
    "principais centros econômicos do agreste alagoano.",
    "",
    "Este arquivo substitui o manuseio físico da obra original (RN04).",
  ])
  const pdf2 = gerarPdf("Folhetos do Agreste Alagoano", [
    "Versão digital do exemplar único, para preservação do original.",
    "",
    "Na feira de sábado o povo se ajunta,",
    "o cantador afina a viola e pergunta:",
    "quem quer ouvir a história do agreste,",
    "do fumo, da chuva e do cabra da peste?",
    "",
    "Coletânea de folhetos reunidos por leitores da comunidade.",
  ])
  tamanhos[ARQUIVOS_DEMO.pdfFundacao] = await armazenarComId(ARQUIVOS_DEMO.pdfFundacao, pdf1, "pdf")
  tamanhos[ARQUIVOS_DEMO.pdfCordel] = await armazenarComId(ARQUIVOS_DEMO.pdfCordel, pdf2, "pdf")

  const recorte = await imagemRecorte()
  if (recorte) {
    tamanhos[ARQUIVOS_DEMO.imgRecorte] = await armazenarComId(ARQUIVOS_DEMO.imgRecorte, recorte, "imagem")
  }
  const festival = await imagemFestival()
  if (festival) await armazenarComId(ARQUIVOS_DEMO.imgFestival, festival, "imagem")
  return tamanhos
}
