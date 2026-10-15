// ============================================================
// Catalogação de autores (RN18 / RN19)
// Segue a convenção do AACR2 para nomes em português:
//  - entrada pelo último sobrenome, em maiúsculas, seguido dos prenomes
//    ("RAMOS, Graciliano"); partículas ficam com o prenome ("QUEIROZ, Rachel de");
//  - Filho, Júnior, Neto e Sobrinho acompanham o sobrenome ("LIMA FILHO, José");
//  - até 3 autores: entrada principal pelo primeiro, secundárias para os demais;
//  - mais de 3 autores: entrada principal pelo título e secundária para o
//    primeiro autor (AACR2 21.6C2).
// ============================================================
import { normalizar } from "./utils"

const PARENTESCO = ["filho", "junior", "jr", "jr.", "neto", "sobrinho"]

export function formaCatalografica(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (partes.length <= 1) return nome.trim().toUpperCase()
  let i = partes.length - 1
  let sobrenome = partes[i]
  if (PARENTESCO.includes(normalizar(sobrenome)) && i > 1) {
    i -= 1
    sobrenome = `${partes[i]} ${sobrenome}`
  }
  const prenomes = partes.slice(0, i).join(" ")
  return `${sobrenome.toUpperCase()}, ${prenomes}`
}

export interface Catalogacao {
  principal: string | null // null = entrada pelo título
  secundarias: string[]
  regra: string
}

export function catalogar(nomes: string[]): Catalogacao {
  const validos = nomes.map((n) => n.trim()).filter(Boolean)
  if (validos.length === 0) {
    return { principal: null, secundarias: [], regra: "Obra sem autoria: entrada pelo título." }
  }
  if (validos.length > 3) {
    return {
      principal: null,
      secundarias: [formaCatalografica(validos[0])],
      regra:
        "Mais de 3 autores: entrada principal pelo título e secundária para o primeiro autor (AACR2 21.6C2).",
    }
  }
  return {
    principal: formaCatalografica(validos[0]),
    secundarias: validos.slice(1).map(formaCatalografica),
    regra:
      validos.length === 1
        ? "Autoria única: entrada principal pelo autor."
        : "Até 3 autores: entrada principal pelo primeiro autor e secundárias para os demais.",
  }
}

/** Valida a lista de autores de uma obra. Retorna a mensagem de erro ou null. */
export function validarAutores(nomes: string[]): string | null {
  const validos = nomes.map((n) => n.trim()).filter(Boolean)
  if (validos.length === 0) return "Informe ao menos um autor."
  if (validos.some((n) => n.length < 3)) return "Cada autor deve ter o nome completo (mínimo 3 caracteres)."
  const chaves = validos.map(normalizar)
  if (new Set(chaves).size !== chaves.length) {
    return "O mesmo autor foi informado mais de uma vez para a obra (RN19)."
  }
  return null
}
