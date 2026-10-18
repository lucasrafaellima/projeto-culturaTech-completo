// ============================================================
// Importação de planilhas em CSV (RN21) com validação de
// integridade dos campos (RNF03). Se qualquer linha tiver erro,
// nada é importado e os erros são listados por linha.
// ============================================================
import type { Categoria } from "./types"
import { LETRAS_SECAO, TODAS_CATEGORIAS, labelCategoria } from "./constants"
import {
  cepValido,
  cpfValido,
  emailValido,
  isbnValido,
  normalizar,
  somenteDigitos,
  telefoneValido,
} from "./utils"
import { validarAutores } from "./catalogacao"

export type TipoImportacao = "obras" | "socios"

export interface ErroLinha {
  linha: number
  mensagem: string
}

export interface LinhaObra {
  linha: number
  titulo: string
  autores: string[]
  editora: string
  edicao: string
  ano: number
  categoria: Categoria
  secao: string
  isbn: string
  tombamentos: string[]
}

export interface LinhaSocio {
  linha: number
  nome: string
  cpf: string
  rg: string
  telefone: string
  email: string
  rua: string
  numero: string
  bairro: string
  cep: string
}

export interface ResultadoLeitura<T> {
  linhas: T[]
  erros: ErroLinha[]
}

export const COLUNAS: Record<TipoImportacao, string[]> = {
  obras: ["titulo", "autores", "editora", "edicao", "ano", "categoria", "secao", "isbn", "tombamentos"],
  socios: ["nome", "cpf", "rg", "telefone", "email", "rua", "numero", "bairro", "cep"],
}

export const MODELOS: Record<TipoImportacao, string> = {
  obras: [
    COLUNAS.obras.join(";"),
    "São Bernardo;Graciliano Ramos;Record;90ª;1934;Literatura;S;978-85-01-00013-2;BMA-2001|BMA-2002",
    "Os Sertões;Euclides da Cunha;Ubu;1ª;1902;História;S;978-85-01-00014-9;BMA-2003",
  ].join("\n"),
  socios: [
    COLUNAS.socios.join(";"),
    "Beatriz Nunes Rocha;111.444.777-35;3004567;(82) 99912-3456;beatriz@email.com;Rua do Sol;15;Centro;57300-100",
  ].join("\n"),
}

/** Divide o texto CSV em linhas e campos, respeitando aspas. */
export function parseCsv(texto: string): string[][] {
  const limpo = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto // remove o BOM do Excel
  const primeiraLinha = limpo.split(/\r?\n/)[0] ?? ""
  const sep = (primeiraLinha.match(/;/g)?.length ?? 0) >= (primeiraLinha.match(/,/g)?.length ?? 0) ? ";" : ","

  const linhas: string[][] = []
  let campo = ""
  let linha: string[] = []
  let aspas = false
  for (let i = 0; i < limpo.length; i++) {
    const c = limpo[i]
    if (aspas) {
      if (c === '"' && limpo[i + 1] === '"') {
        campo += '"'
        i++
      } else if (c === '"') {
        aspas = false
      } else {
        campo += c
      }
    } else if (c === '"') {
      aspas = true
    } else if (c === sep) {
      linha.push(campo)
      campo = ""
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && limpo[i + 1] === "\n") i++
      linha.push(campo)
      linhas.push(linha)
      linha = []
      campo = ""
    } else {
      campo += c
    }
  }
  if (campo !== "" || linha.length > 0) {
    linha.push(campo)
    linhas.push(linha)
  }
  return linhas.filter((l) => l.some((v) => v.trim() !== ""))
}

function validarCabecalho(cabecalho: string[], tipo: TipoImportacao): string | null {
  const recebido = cabecalho.map((c) => normalizar(c))
  const esperado = COLUNAS[tipo]
  const faltando = esperado.filter((c) => !recebido.includes(c))
  if (faltando.length > 0) {
    return `Cabeçalho inválido. Colunas ausentes: ${faltando.join(", ")}. Esperado: ${esperado.join(";")}`
  }
  return null
}

function categoriaDe(valor: string): Categoria | null {
  const v = normalizar(valor).replace(/\s+/g, "_")
  const porChave = TODAS_CATEGORIAS.find((c) => c === v)
  if (porChave) return porChave
  return TODAS_CATEGORIAS.find((c) => normalizar(labelCategoria[c]).replace(/\s+/g, "_") === v) ?? null
}

function mapear(linhas: string[][], tipo: TipoImportacao) {
  const cab = linhas[0].map((c) => normalizar(c))
  return linhas.slice(1).map((l, i) => {
    const obj: Record<string, string> = {}
    COLUNAS[tipo].forEach((col) => {
      obj[col] = (l[cab.indexOf(col)] ?? "").trim()
    })
    return { numero: i + 2, obj, colunas: l.length, esperadas: cab.length }
  })
}

export function lerObras(texto: string): ResultadoLeitura<LinhaObra> {
  const linhas = parseCsv(texto)
  if (linhas.length < 2) return { linhas: [], erros: [{ linha: 1, mensagem: "Arquivo vazio ou sem registros." }] }
  const erroCab = validarCabecalho(linhas[0], "obras")
  if (erroCab) return { linhas: [], erros: [{ linha: 1, mensagem: erroCab }] }

  const erros: ErroLinha[] = []
  const saida: LinhaObra[] = []
  const anoAtual = new Date().getFullYear()
  const isbnsNoArquivo = new Set<string>()
  const tombNoArquivo = new Set<string>()

  for (const { numero, obj, colunas, esperadas } of mapear(linhas, "obras")) {
    const problemas: string[] = []
    if (colunas !== esperadas) problemas.push(`quantidade de colunas (${colunas}) diferente do cabeçalho (${esperadas})`)
    if (!obj.titulo) problemas.push("título vazio")
    const autores = obj.autores.split("|").map((a) => a.trim()).filter(Boolean)
    const erroAutor = validarAutores(autores)
    if (erroAutor) problemas.push(erroAutor.toLowerCase())
    if (!obj.editora) problemas.push("editora vazia")
    const ano = Number(obj.ano)
    if (!/^\d{3,4}$/.test(obj.ano) || ano < 1400 || ano > anoAtual) problemas.push(`ano inválido ("${obj.ano}")`)
    const categoria = categoriaDe(obj.categoria)
    if (!categoria) problemas.push(`categoria desconhecida ("${obj.categoria}")`)
    const secao = obj.secao.toUpperCase()
    if (!LETRAS_SECAO.includes(secao)) problemas.push(`seção deve ser uma letra de A a Z ("${obj.secao}")`)
    if (!isbnValido(obj.isbn)) problemas.push(`ISBN inválido ("${obj.isbn}")`)
    const isbnChave = obj.isbn.replace(/[-\s]/g, "")
    if (isbnsNoArquivo.has(isbnChave)) problemas.push("ISBN repetido no arquivo")
    isbnsNoArquivo.add(isbnChave)
    const tombamentos = obj.tombamentos.split("|").map((t) => t.trim()).filter(Boolean)
    for (const t of tombamentos) {
      if (tombNoArquivo.has(t.toUpperCase())) problemas.push(`tombamento ${t} repetido no arquivo`)
      tombNoArquivo.add(t.toUpperCase())
    }

    if (problemas.length > 0) {
      erros.push({ linha: numero, mensagem: problemas.join("; ") })
    } else {
      saida.push({
        linha: numero,
        titulo: obj.titulo,
        autores,
        editora: obj.editora,
        edicao: obj.edicao || "1ª",
        ano,
        categoria: categoria!,
        secao,
        isbn: obj.isbn,
        tombamentos,
      })
    }
  }
  return { linhas: saida, erros }
}

export function lerSocios(texto: string): ResultadoLeitura<LinhaSocio> {
  const linhas = parseCsv(texto)
  if (linhas.length < 2) return { linhas: [], erros: [{ linha: 1, mensagem: "Arquivo vazio ou sem registros." }] }
  const erroCab = validarCabecalho(linhas[0], "socios")
  if (erroCab) return { linhas: [], erros: [{ linha: 1, mensagem: erroCab }] }

  const erros: ErroLinha[] = []
  const saida: LinhaSocio[] = []
  const cpfs = new Set<string>()

  for (const { numero, obj, colunas, esperadas } of mapear(linhas, "socios")) {
    const problemas: string[] = []
    if (colunas !== esperadas) problemas.push(`quantidade de colunas (${colunas}) diferente do cabeçalho (${esperadas})`)
    if (obj.nome.split(/\s+/).length < 2) problemas.push("nome completo obrigatório")
    if (!cpfValido(obj.cpf)) problemas.push(`CPF inválido ("${obj.cpf}")`)
    const cpf = somenteDigitos(obj.cpf)
    if (cpfs.has(cpf)) problemas.push("CPF repetido no arquivo")
    cpfs.add(cpf)
    // RG é opcional
    if (!telefoneValido(obj.telefone)) problemas.push(`telefone inválido ("${obj.telefone}")`)
    // e-mail pode faltar em cadastros antigos; se informado, precisa ser válido
    if (obj.email && !emailValido(obj.email)) problemas.push(`e-mail inválido ("${obj.email}")`)
    if (!obj.rua || !obj.numero || !obj.bairro) problemas.push("endereço incompleto")
    if (!cepValido(obj.cep)) problemas.push(`CEP inválido ("${obj.cep}")`)

    if (problemas.length > 0) {
      erros.push({ linha: numero, mensagem: problemas.join("; ") })
    } else {
      saida.push({
        linha: numero,
        nome: obj.nome,
        cpf,
        rg: obj.rg,
        telefone: somenteDigitos(obj.telefone),
        email: obj.email,
        rua: obj.rua,
        numero: obj.numero,
        bairro: obj.bairro,
        cep: somenteDigitos(obj.cep),
      })
    }
  }
  return { linhas: saida, erros }
}
