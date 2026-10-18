import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// Carrega server/.env quando existir (em produção as variáveis vêm do ambiente)
try {
  process.loadEnvFile(new URL("../.env", import.meta.url))
} catch {
  // sem .env: segue com as variáveis do ambiente
}

function obrigatoria(nome: string): string {
  const valor = process.env[nome]?.trim()
  if (!valor) throw new Error(`Variável de ambiente ${nome} não definida (veja server/.env.example).`)
  return valor
}

function lerSsl() {
  const modo = (process.env.DB_SSL ?? "require").toLowerCase()
  if (modo === "disable") return false
  if (modo === "verify") {
    const ca = obrigatoria("DB_SSL_CA")
    return { rejectUnauthorized: true, ca: readFileSync(ca, "utf8") }
  }
  // "require": conexão cifrada sem conferir a cadeia do certificado
  return { rejectUnauthorized: false }
}

const jwtSecret = obrigatoria("JWT_SECRET")
if (jwtSecret.length < 32) throw new Error("JWT_SECRET muito curto: use pelo menos 32 caracteres.")

for (const nome of ["PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD"]) obrigatoria(nome)

// Onde ficam os arquivos (digitalizações, fotos, imagens de dano):
// "s3" no Amazon S3 (produção) ou "disco" em server/uploads (desenvolvimento e testes)
function lerArmazenamento() {
  const modo = (process.env.ARMAZENAMENTO ?? "disco").toLowerCase()
  if (modo === "s3") {
    return {
      modo: "s3" as const,
      bucket: obrigatoria("S3_BUCKET"),
      regiao: obrigatoria("S3_REGIAO"),
      // opcional: MinIO ou outro serviço compatível com S3
      endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
    }
  }
  if (modo !== "disco") throw new Error('ARMAZENAMENTO deve ser "s3" ou "disco".')
  return {
    modo: "disco" as const,
    pasta: process.env.PASTA_UPLOADS?.trim() || fileURLToPath(new URL("../uploads", import.meta.url)),
  }
}

export const config = {
  porta: Number(process.env.PORT ?? 3333),
  ssl: lerSsl(),
  jwtSecret,
  jwtExpiraEm: (process.env.JWT_EXPIRA_EM ?? "8h") as `${number}h`,
  armazenamento: lerArmazenamento(),
}
