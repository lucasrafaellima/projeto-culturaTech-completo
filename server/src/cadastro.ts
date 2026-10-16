import bcrypt from "bcryptjs"
import pg from "pg"
import { pool } from "./db.ts"
import { gerarToken, type UsuarioLogado } from "./auth.ts"

// Mesmas regras de validarSocio (src/lib/store.tsx) e de src/lib/utils.ts,
// mais os limites de tamanho das colunas de socio_leitor
const somenteDigitos = (v: string) => v.replace(/\D/g, "")

function cpfValido(valor: string): boolean {
  const cpf = somenteDigitos(valor)
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false
  const calc = (base: string, pesoInicial: number) => {
    let soma = 0
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i)
    const resto = (soma * 10) % 11
    return resto === 10 ? 0 : resto
  }
  return calc(cpf.slice(0, 9), 10) === Number(cpf[9]) && calc(cpf.slice(0, 10), 11) === Number(cpf[10])
}

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "")

interface DadosCadastro {
  nome: string
  cpf: string
  rg: string
  telefone: string
  email: string
  rua: string
  numero: string
  bairro: string
  cep: string
  senha: string
}

function validar(corpo: Record<string, unknown>): { erro: string } | { dados: DadosCadastro } {
  const endereco = (typeof corpo.endereco === "object" && corpo.endereco ? corpo.endereco : {}) as Record<string, unknown>
  const senha = typeof corpo.senha === "string" ? corpo.senha : ""
  const d: DadosCadastro = {
    nome: texto(corpo.nome).replace(/\s+/g, " "),
    cpf: somenteDigitos(texto(corpo.cpf)),
    rg: texto(corpo.rg),
    telefone: somenteDigitos(texto(corpo.telefone)),
    email: texto(corpo.email).toLowerCase(),
    rua: texto(endereco.rua),
    numero: texto(endereco.numero),
    bairro: texto(endereco.bairro),
    cep: somenteDigitos(texto(endereco.cep)),
    senha,
  }

  if (d.nome.split(" ").length < 2) return { erro: "Informe o nome completo." }
  if (d.nome.length > 150) return { erro: "Nome muito longo (máximo de 150 caracteres)." }
  if (!cpfValido(d.cpf)) return { erro: "CPF inválido." }
  if (!d.rg) return { erro: "Informe o RG." }
  if (d.rg.length > 20) return { erro: "RG muito longo (máximo de 20 caracteres)." }
  if (d.telefone.length !== 10 && d.telefone.length !== 11) return { erro: "Telefone inválido. Use DDD + número." }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email) || d.email.length > 254) return { erro: "E-mail inválido." }
  if (!d.rua || !d.numero || !d.bairro) return { erro: "Preencha rua, número e bairro." }
  if (d.rua.length > 150 || d.numero.length > 10 || d.bairro.length > 80) {
    return { erro: "Endereço muito longo (rua até 150, número até 10 e bairro até 80 caracteres)." }
  }
  if (d.cep.length !== 8) return { erro: "CEP inválido." }
  if (senha.length < 6) return { erro: "A senha deve ter ao menos 6 caracteres." }
  if (Buffer.byteLength(senha) > 72) return { erro: "A senha deve ter no máximo 72 caracteres." }
  if (senha !== senha.trim()) return { erro: "A senha não pode começar nem terminar com espaço." }
  if (corpo.consentimentoLgpd !== true) {
    return { erro: "É necessário registrar o consentimento do titular para o tratamento dos dados (LGPD)." }
  }
  return { dados: d }
}

export type ResultadoCadastro =
  | { ok: true; token: string; usuario: UsuarioLogado; mensagem: string }
  | { ok: false; status: 400 | 409; mensagem: string }

// Cadastro feito pelo próprio visitante: cria o sócio-leitor e já devolve o token
export async function cadastrarSocio(corpo: unknown): Promise<ResultadoCadastro> {
  if (typeof corpo !== "object" || !corpo) return { ok: false, status: 400, mensagem: "Corpo da requisição inválido." }
  const r = validar(corpo as Record<string, unknown>)
  if ("erro" in r) return { ok: false, status: 400, mensagem: r.erro }
  const d = r.dados

  const senhaHash = await bcrypt.hash(d.senha, 10)
  try {
    const { rows } = await pool.query<{ id: string; nome: string }>(
      `INSERT INTO socio_leitor (nome, cpf, rg, telefone, email, endereco_rua, endereco_numero,
                                 endereco_bairro, endereco_cep, senha_hash, consentimento_lgpd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_DATE)
       RETURNING id, nome`,
      [d.nome, d.cpf, d.rg, d.telefone, d.email, d.rua, d.numero, d.bairro, d.cep, senhaHash],
    )
    const usuario: UsuarioLogado = { id: rows[0].id, nome: rows[0].nome, perfil: "socio", pendencias: false }
    return {
      ok: true,
      token: gerarToken(usuario),
      usuario,
      mensagem: `Conta criada. Bem-vindo(a), ${usuario.nome.split(" ")[0]}!`,
    }
  } catch (erro) {
    // violação de índice único: CPF ou e-mail já cadastrados
    if (erro instanceof pg.DatabaseError && erro.code === "23505") {
      const mensagem =
        erro.constraint === "ux_socio_email"
          ? "Este e-mail já está em uso por outro sócio-leitor."
          : "Já existe um sócio-leitor com este CPF."
      return { ok: false, status: 409, mensagem }
    }
    throw erro
  }
}
