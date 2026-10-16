import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { config } from "./config.ts"
import { pool } from "./db.ts"

export type Perfil = "admin" | "socio"

export interface UsuarioLogado {
  id: string
  nome: string
  perfil: Perfil
  // RN11: sócio com multa em aberto ou devolução atrasada recebe alerta no login
  pendencias?: boolean
}

interface Registro {
  id: string
  nome: string
  senha_hash: string | null
  ativo: boolean
  pendencias?: boolean
}

export type ResultadoLogin =
  | { ok: true; token: string; usuario: UsuarioLogado; mensagem: string }
  | { ok: false; status: 400 | 401 | 403; mensagem: string }

// Hash usado quando o usuário não existe, para a resposta levar o mesmo
// tempo e não revelar quais logins estão cadastrados
const HASH_FALSO = bcrypt.hashSync("senha-inexistente", 10)

const SQL_ADMIN = `
  SELECT id, nome, senha_hash, ativo
    FROM administrador
   WHERE lower(usuario) = lower($1)`

const SQL_SOCIO = (campo: "cpf" | "email") => `
  SELECT id, nome, senha_hash, ativo, fn_socio_bloqueado(id) AS pendencias
    FROM socio_leitor
   WHERE ${campo === "cpf" ? "cpf = $1" : "lower(email) = lower($1)"}
     AND NOT anonimizado`

// Sócio entra por CPF (com ou sem máscara) ou e-mail; administrador, pelo usuário
function identificar(login: string): { perfil: Perfil; sql: string; valor: string } {
  if (login.includes("@")) return { perfil: "socio", sql: SQL_SOCIO("email"), valor: login }
  const digitos = login.replace(/\D/g, "")
  if (/^[\d.\-\s]+$/.test(login) && digitos.length === 11) {
    return { perfil: "socio", sql: SQL_SOCIO("cpf"), valor: digitos }
  }
  return { perfil: "admin", sql: SQL_ADMIN, valor: login }
}

export async function autenticar(loginBruto: unknown, senha: unknown): Promise<ResultadoLogin> {
  const login = typeof loginBruto === "string" ? loginBruto.trim() : ""
  if (!login || typeof senha !== "string" || !senha) {
    return { ok: false, status: 400, mensagem: "Informe usuário e senha." }
  }
  // bcrypt só considera os primeiros 72 bytes; acima disso é recusado
  if (login.length > 254 || Buffer.byteLength(senha) > 72) {
    return { ok: false, status: 401, mensagem: "Usuário ou senha incorretos." }
  }

  const { perfil, sql, valor } = identificar(login)
  const { rows } = await pool.query<Registro>(sql, [valor])
  const registro = rows[0]

  const senhaConfere = await bcrypt.compare(senha, registro?.senha_hash ?? HASH_FALSO)
  if (!registro || !registro.senha_hash || !senhaConfere) {
    return { ok: false, status: 401, mensagem: "Usuário ou senha incorretos." }
  }
  if (!registro.ativo) {
    return { ok: false, status: 403, mensagem: "Cadastro inativo. Procure a biblioteca para reativá-lo." }
  }

  const usuario: UsuarioLogado = { id: registro.id, nome: registro.nome, perfil }
  if (perfil === "socio") usuario.pendencias = Boolean(registro.pendencias)

  const nome = perfil === "socio" ? registro.nome.split(" ")[0] : registro.nome
  return { ok: true, token: gerarToken(usuario), usuario, mensagem: `Bem-vindo(a), ${nome}.` }
}

export function gerarToken(usuario: UsuarioLogado): string {
  return jwt.sign({ perfil: usuario.perfil }, config.jwtSecret, {
    subject: usuario.id,
    expiresIn: config.jwtExpiraEm,
  })
}

// Confere o token e relê o usuário no banco, para que um cadastro
// desativado depois do login perca o acesso
export async function usuarioDoToken(token: string): Promise<UsuarioLogado | null> {
  let sub: string
  let perfil: Perfil
  try {
    const dados = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] })
    if (typeof dados === "string" || !dados.sub) return null
    if (dados.perfil !== "admin" && dados.perfil !== "socio") return null
    sub = dados.sub
    perfil = dados.perfil
  } catch {
    return null
  }

  const sql =
    perfil === "admin"
      ? "SELECT id, nome, ativo FROM administrador WHERE id = $1"
      : `SELECT id, nome, ativo, fn_socio_bloqueado(id) AS pendencias
           FROM socio_leitor WHERE id = $1 AND NOT anonimizado`
  const { rows } = await pool.query<Registro>(sql, [sub])
  const registro = rows[0]
  if (!registro || !registro.ativo) return null

  const usuario: UsuarioLogado = { id: registro.id, nome: registro.nome, perfil }
  if (perfil === "socio") usuario.pendencias = Boolean(registro.pendencias)
  return usuario
}
