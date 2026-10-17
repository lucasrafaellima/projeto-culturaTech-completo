// ============================================================
// Cliente da API (server/). Em desenvolvimento e no preview, o Vite
// repassa /api para a porta 3333 (vite.config.ts).
// ============================================================

import type { Endereco } from "./types"
import type { DadosSocio } from "./store"

export type RespostaApi<T> =
  | { tipo: "ok"; dados: T }
  | { tipo: "erro"; status: number; mensagem: string }
  // a API não respondeu (servidor desligado, sem rede, proxy sem destino)
  | { tipo: "indisponivel" }

const TEMPO_LIMITE_MS = 10_000

async function chamar<T>(rota: string, init: RequestInit): Promise<RespostaApi<T>> {
  let resposta: Response
  try {
    resposta = await fetch(`/api${rota}`, { ...init, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) })
  } catch {
    return { tipo: "indisponivel" }
  }

  // Toda resposta da API é JSON com "ok"; qualquer outra coisa (ex.: erro
  // do proxy do Vite com a API desligada) conta como indisponível
  let corpo: unknown
  try {
    corpo = await resposta.json()
  } catch {
    return { tipo: "indisponivel" }
  }
  if (typeof corpo !== "object" || corpo === null || typeof (corpo as { ok?: unknown }).ok !== "boolean") {
    return { tipo: "indisponivel" }
  }

  const dados = corpo as { ok: boolean; mensagem?: string }
  if (!resposta.ok || !dados.ok) {
    return { tipo: "erro", status: resposta.status, mensagem: dados.mensagem ?? "Erro inesperado no servidor." }
  }
  return { tipo: "ok", dados: corpo as T }
}

// ---------- autenticação ----------

export interface UsuarioApi {
  id: string
  nome: string
  perfil: "admin" | "socio"
  pendencias?: boolean // RN11
}

export type CadastroApi =
  | { usuario: string }
  | {
      cpf: string
      rg: string
      telefone: string
      email: string
      endereco: Endereco
      dataCadastro: string
      consentimentoLgpd: string
    }

export interface LoginApi {
  token: string
  usuario: UsuarioApi
  cadastro: CadastroApi
  mensagem: string
}

export function loginNaApi(usuario: string, senha: string) {
  return chamar<LoginApi>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario, senha }),
  })
}

// Cadastro feito pelo próprio visitante; a resposta tem o mesmo formato do login
export function cadastroNaApi(d: DadosSocio) {
  return chamar<LoginApi>("/auth/cadastro", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nome: d.nome,
      cpf: d.cpf,
      rg: d.rg,
      telefone: d.telefone,
      email: d.email,
      endereco: d.endereco,
      senha: d.senha ?? "",
      consentimentoLgpd: d.consentimentoLgpd,
    }),
  })
}

export function usuarioDoToken(token: string) {
  return chamar<{ usuario: UsuarioApi }>("/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  })
}
