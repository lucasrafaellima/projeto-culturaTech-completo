// Testa só o armazenamento (S3 ou disco, conforme o .env): grava, lê e apaga um objeto de teste.
// Uso: npm run testar-s3   (não usa o banco)
import { randomUUID } from "node:crypto"
import { armazenamento, chaveDoArquivo } from "../src/armazenamento.ts"
import { config } from "../src/config.ts"

const a = config.armazenamento
console.log(a.modo === "s3" ? `Modo S3: bucket ${a.bucket}, região ${a.regiao}` : `Modo disco: ${a.pasta}`)

// grava na pasta "documentos/", como um documento de pasta histórica
const chave = chaveDoArquivo("documentos", `teste-${randomUUID()}`, "application/pdf")
const conteudo = Buffer.from(`%PDF-1.4\n% teste do armazenamento ${new Date().toISOString()}\n%%EOF\n`)

try {
  await armazenamento.gravar(chave, conteudo, "application/pdf")
  console.log("ok    gravou o objeto", chave)

  const partes: Buffer[] = []
  for await (const p of await armazenamento.ler(chave)) partes.push(Buffer.from(p))
  const igual = Buffer.concat(partes).equals(conteudo)
  console.log(`${igual ? "ok  " : "FALHOU"}  leu o objeto de volta com o mesmo conteúdo`)

  await armazenamento.apagar(chave)
  console.log("ok    apagou o objeto de teste")
  console.log(igual ? "\nArmazenamento funcionando" : "\nConteúdo diferente")
  process.exit(igual ? 0 : 1)
} catch (erro) {
  const e = erro as Error & { name: string; $metadata?: { httpStatusCode?: number } }
  console.log(`FALHOU  ${e.name}: ${e.message} (HTTP ${e.$metadata?.httpStatusCode ?? "-"})`)
  if (e.name === "AccessDenied") {
    console.log("        Confira se a política IAM permite as pastas mural/, acervo/, documentos/, socios/ e danos/.")
  }
  process.exit(1)
}
