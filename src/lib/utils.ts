import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

// ------------------------------------------------------------
// Datas — sempre no fuso local, no formato AAAA-MM-DD, para que
// "hoje" não mude de dia por causa de conversão para UTC.
// ------------------------------------------------------------
function paraISO(d: Date): string {
  const a = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dia = String(d.getDate()).padStart(2, "0")
  return `${a}-${m}-${dia}`
}

function deISO(iso: string): Date {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number)
  return new Date(a, m - 1, d)
}

export function hojeISO(): string {
  return paraISO(new Date())
}

export function agoraISO(): string {
  return new Date().toISOString()
}

export function addDays(iso: string, dias: number): string {
  const d = deISO(iso)
  d.setDate(d.getDate() + dias)
  return paraISO(d)
}

/** Quantidade de dias de `de` até `ate` (positivo se `ate` for depois). */
export function diffDias(de: string, ate: string): number {
  const a = deISO(de)
  const b = deISO(ate)
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((utcB - utcA) / 86_400_000)
}

/** Dias de atraso em relação a uma data prevista. Positivo = atrasado. */
export function diasAtraso(dataPrevista: string, ref: string = hojeISO()): number {
  return Math.max(0, diffDias(dataPrevista, ref))
}

export function formatDate(valor: string): string {
  if (!valor) return "-"
  if (valor.length > 10) {
    return new Date(valor).toLocaleDateString("pt-BR")
  }
  const [a, m, d] = valor.split("-")
  return `${d}/${m}/${a}`
}

export function formatDateTime(valor: string): string {
  return new Date(valor).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  })
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** RN20: identificador único universal. */
export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome
}

// ------------------------------------------------------------
// Documentos e validações
// ------------------------------------------------------------
export function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, "")
}

export function cpfValido(valor: string): boolean {
  const cpf = somenteDigitos(valor)
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false
  const calc = (base: string, pesoInicial: number) => {
    let soma = 0
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i)
    const resto = (soma * 10) % 11
    return resto === 10 ? 0 : resto
  }
  const d1 = calc(cpf.slice(0, 9), 10)
  const d2 = calc(cpf.slice(0, 10), 11)
  return d1 === Number(cpf[9]) && d2 === Number(cpf[10])
}

export function cnpjValido(valor: string): boolean {
  const cnpj = somenteDigitos(valor)
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false
  const calc = (base: string) => {
    const pesos = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const soma = base.split("").reduce((acc, n, i) => acc + Number(n) * pesos[i], 0)
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }
  return calc(cnpj.slice(0, 12)) === Number(cnpj[12]) && calc(cnpj.slice(0, 13)) === Number(cnpj[13])
}

export function emailValido(valor: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valor.trim())
}

export function cepValido(valor: string): boolean {
  return somenteDigitos(valor).length === 8
}

export function telefoneValido(valor: string): boolean {
  const d = somenteDigitos(valor)
  return d.length === 10 || d.length === 11
}

/** ISBN-10 ou ISBN-13 com dígito verificador. */
export function isbnValido(valor: string): boolean {
  const isbn = valor.replace(/[-\s]/g, "").toUpperCase()
  if (/^\d{13}$/.test(isbn)) {
    const soma = isbn
      .slice(0, 12)
      .split("")
      .reduce((acc, n, i) => acc + Number(n) * (i % 2 === 0 ? 1 : 3), 0)
    return (10 - (soma % 10)) % 10 === Number(isbn[12])
  }
  if (/^\d{9}[\dX]$/.test(isbn)) {
    const soma = isbn
      .split("")
      .reduce((acc, c, i) => acc + (c === "X" ? 10 : Number(c)) * (10 - i), 0)
    return soma % 11 === 0
  }
  return false
}

/** Completa um prefixo de 12 dígitos com o dígito verificador do ISBN-13. */
export function isbn13(prefixo12: string): string {
  const soma = prefixo12
    .split("")
    .reduce((acc, n, i) => acc + Number(n) * (i % 2 === 0 ? 1 : 3), 0)
  const dv = (10 - (soma % 10)) % 10
  const p = prefixo12
  return `${p.slice(0, 3)}-${p.slice(3, 5)}-${p.slice(5, 9)}-${p.slice(9, 12)}-${dv}`
}

export function formatCpf(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 11)
  return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2")
}

export function formatCnpj(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 14)
  return d
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2")
}

export function formatCep(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 8)
  return d.replace(/(\d{5})(\d)/, "$1-$2")
}

export function formatTelefone(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 11)
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2")
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2")
}

/** RNF06 (LGPD): exibe apenas o miolo do CPF. */
export function mascararCpf(valor: string): string {
  const d = somenteDigitos(valor)
  if (d.length !== 11) return "***"
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`
}

export function mascararDocumento(valor: string): string {
  const d = somenteDigitos(valor)
  if (d.length === 11) return mascararCpf(d)
  if (d.length === 14) return `${d.slice(0, 2)}.***.***/${d.slice(8, 12)}-**`
  return "***"
}
