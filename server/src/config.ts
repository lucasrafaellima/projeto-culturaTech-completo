import { readFileSync } from "node:fs"

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

export const config = {
  porta: Number(process.env.PORT ?? 3333),
  ssl: lerSsl(),
  jwtSecret,
  jwtExpiraEm: (process.env.JWT_EXPIRA_EM ?? "8h") as `${number}h`,
}
