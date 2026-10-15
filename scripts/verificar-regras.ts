// Verificação das regras puras. Uso: npm run verificar
import { createHash } from "node:crypto"
import { criarEstadoInicial } from "../src/lib/mock-data"
import { sha256, hashSenha } from "../src/lib/seguranca"
import { catalogar, formaCatalografica, validarAutores } from "../src/lib/catalogacao"
import { lerObras, lerSocios, MODELOS } from "../src/lib/csv"
import { cpfValido, cnpjValido, isbnValido, diasAtraso, addDays, hojeISO, normalizar } from "../src/lib/utils"
import {
  aplicarRotinas,
  debitos,
  filaDoTurno,
  gerarNotificacoes,
  processarFila,
  socioBloqueado,
} from "../src/lib/regras"
import { statusVisivel, categoriaEmprestavel, imagemValida, csvValido } from "../src/lib/constants"

let falhas = 0
function ok(cond: boolean, nome: string) {
  console.log(`${cond ? "ok  " : "FALHOU"} ${nome}`)
  if (!cond) falhas++
}

const hoje = hojeISO()
const agora = new Date().toISOString()
const e = criarEstadoInicial()

// Segurança
ok(sha256("abc") === createHash("sha256").update("abc").digest("hex"), "SHA-256 igual ao do Node")
ok(sha256("") === createHash("sha256").update("").digest("hex"), "SHA-256 de texto vazio")
ok(sha256("é ç ã".repeat(40)) === createHash("sha256").update("é ç ã".repeat(40)).digest("hex"), "SHA-256 com UTF-8 e vários blocos")
ok(e.socios[0].senha === hashSenha("123456") && e.socios[0].senha !== "123456", "senha guardada como hash (RNF06)")

// Validações
ok(e.socios.filter((s) => s.cpf).every((s) => cpfValido(s.cpf)), "CPFs de demonstração válidos")
ok(e.instituicoes.every((i) => (i.tipo === "instituicao" ? cnpjValido(i.documento) : cpfValido(i.documento))), "CNPJ/CPF dos receptores válidos")
ok(!cpfValido("111.111.111-11") && !cpfValido("123.456.789-00"), "CPF inválido recusado")
ok(e.livros.every((l) => isbnValido(l.isbn)), "ISBNs de demonstração válidos")
ok(isbnValido("85-359-0277-5") && !isbnValido("978-85-01-00001-0"), "ISBN-10 aceito e dígito errado recusado")
ok(normalizar("  Assaré ") === "assare", "normalização remove acentos")

// RN30 / RN04 / RNF12 / RN21
ok(statusVisivel("em_restauro", "publico") === "indisponivel" && statusVisivel("ocioso", "socio") === "indisponivel", "RN30 mascara status internos")
ok(statusVisivel("extraviado", "admin") === "extraviado", "RN30 admin vê status real")
ok(!categoriaEmprestavel("cordel") && !categoriaEmprestavel("raro") && !categoriaEmprestavel("exemplar_unico"), "RN04 restritos")
ok(imagemValida({ name: "a.webp", type: "image/webp" }) && !imagemValida({ name: "a.gif", type: "image/gif" }), "RNF12 formatos de imagem")
ok(!imagemValida({ name: "foto.png", type: "application/pdf" }), "RNF12 confere o tipo real além da extensão")
ok(csvValido({ name: "x.CSV" }) && !csvValido({ name: "x.xlsx" }), "RN21 somente CSV")

// Catalogação (RN18 / RN19)
ok(formaCatalografica("Graciliano Ramos") === "RAMOS, Graciliano", "forma catalográfica simples")
ok(formaCatalografica("Antônio Carlos Ferreira Filho") === "FERREIRA FILHO, Antônio Carlos", "Filho acompanha o sobrenome")
ok(catalogar(["A B", "C D", "E F", "G H"]).principal === null, "mais de 3 autores: entrada pelo título")
ok(validarAutores(["Jorge Amado", "jorge amado"]) !== null, "autor duplicado recusado")

// RN08 / RN11
ok(socioBloqueado(e, "s1", hoje), "RN08 Maria Joana bloqueada (atraso + multa)")
ok(debitos(e, "s1", hoje).totalCorrente === 5, "RN03 multa corrente de 5 dias = R$ 5,00")
ok(!socioBloqueado(e, "s2", hoje), "João Pedro regular")
ok(socioBloqueado(e, "s3", hoje), "multa em análise ainda bloqueia (RN08)")
ok(diasAtraso(addDays(hoje, -3), hoje) === 3 && diasAtraso(addDays(hoje, 2), hoje) === 0, "cálculo de dias de atraso")

// RF05: notificações
const notifs = gerarNotificacoes(e, hoje, agora)
ok(notifs.some((n) => n.socioId === "s2" && n.tipo === "lembrete"), "RF05 lembrete para quem vence em 2 dias")
ok(notifs.some((n) => n.socioId === "s1" && n.tipo === "atraso"), "RF05 aviso de atraso")
ok(notifs.some((n) => n.socioId === "s4" && n.status === "falha"), "RF05 falha registrada para cadastro sem e-mail")
const r1 = aplicarRotinas(e, hoje, agora, 9)
ok(gerarNotificacoes(r1.estado, hoje, agora).length === 0, "RF05 não reenvia o mesmo aviso")

// RF11: fila
ok(filaDoTurno(e, hoje, "manha").length === 1, "fila da manhã tem 1 pessoa")
const liberado = {
  ...e,
  agendamentos: e.agendamentos.map((a) => (a.id === "ag1" ? { ...a, status: "cancelado" as const } : a)),
}
const depois = processarFila(liberado, hoje, "manha", agora)
ok(depois.agendamentos.some((a) => a.socioId === "s1" && a.data === hoje && a.turno === "manha" && a.origem === "fila"), "RF11 mesa liberada contempla o primeiro da fila")
ok(filaDoTurno(depois, hoje, "manha").length === 0, "RF11 contemplado sai da fila")
const r2 = aplicarRotinas(e, hoje, agora, 13)
ok(r2.estado.fila.find((f) => f.id === "f1")?.status === "expirada", "fila de turno encerrado expira")

// CSV (RN21 / RNF03)
const obras = lerObras(MODELOS.obras)
ok(obras.erros.length === 0 && obras.linhas.length === 2, "modelo de obras é válido")
ok(obras.linhas[0]?.tombamentos.length === 2, "vários tombamentos na mesma célula")
const socios = lerSocios(MODELOS.socios)
ok(socios.erros.length === 0 && socios.linhas.length === 1, "modelo de sócios é válido")
const ruim = lerObras(
  "titulo;autores;editora;edicao;ano;categoria;secao;isbn;tombamentos\n" +
    "Livro;Autor Um;Ed;1ª;3000;Poesia;AA;123;X\n" +
    '"Com; ponto e vírgula";Autor Dois;Ed;1ª;1990;Literatura;B;978-85-01-00001-9;Y\n' +
    "Incompleto;Autor Tres\n",
)
ok(ruim.erros.length === 2 && ruim.erros[0].linha === 2, "RNF03 linhas corrompidas apontadas por número")
ok(ruim.erros[0].mensagem.includes("ano") && ruim.erros[0].mensagem.includes("categoria") && ruim.erros[0].mensagem.includes("ISBN"), "RNF03 lista todos os problemas da linha")
ok(ruim.linhas.length === 1 && ruim.linhas[0].titulo === "Com; ponto e vírgula", "campo entre aspas com separador")
ok(lerObras(String.fromCharCode(0xfeff) + MODELOS.obras).erros.length === 0, "BOM do Excel é ignorado")
ok(lerObras("nome;cpf\nx;y").erros[0].mensagem.startsWith("Cabeçalho inválido"), "cabeçalho errado recusado")

console.log(falhas === 0 ? "\nTodas as verificações passaram." : `\n${falhas} verificação(ões) falharam.`)
process.exit(falhas === 0 ? 0 : 1)
