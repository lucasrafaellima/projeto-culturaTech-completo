// Verificação das regras puras. Uso: npm run verificar
import { createHash } from "node:crypto"
import { criarEstadoInicial } from "../src/lib/mock-data"
import { sha256, hashSenha } from "../src/lib/seguranca"
import { catalogar, formaCatalografica, validarAutores } from "../src/lib/catalogacao"
import { lerObras, lerSocios, MODELOS } from "../src/lib/csv"
import { cpfValido, cnpjValido, isbnValido, diasAtraso, addDays, hojeISO, normalizar } from "../src/lib/utils"
import {
  anonimizarCriancasDoSocio,
  aplicarRotinas,
  conflitoAgendamento,
  debitos,
  erroDaCrianca,
  erroDoResponsavel,
  filaDoTurno,
  gerarNotificacoes,
  idadeEm,
  liberarMesasDoSocio,
  mesasLivres,
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

// US28: espaço infantil
ok(mesasLivres(e, hoje, "manha").length === 0, "mesas de estudo lotadas de manhã")
ok(mesasLivres(e, hoje, "manha", "infantil").length === 2, "lotar o estudo não ocupa o espaço infantil")
ok(idadeEm("2010-05-20", "2026-05-19") === 15 && idadeEm("2010-05-20", "2026-05-20") === 16, "idade completa na data")
ok(erroDoResponsavel({ dataNascimento: undefined }, hoje)?.includes("data de nascimento") === true, "US28 cadastro sem data não agenda para criança")
ok(erroDoResponsavel({ dataNascimento: addDays(hoje, -365 * 14) }, hoje)?.includes("16 anos") === true, "US28 menor de 16 não agenda para criança")
ok(erroDoResponsavel({ dataNascimento: "1990-01-01" }, hoje) === null, "US28 adulto agenda para criança")
ok(erroDaCrianca({ nome: "Bia", idade: 12 }) !== null && erroDaCrianca({ nome: "Bia", idade: Number.NaN }) !== null, "US28 idade da criança validada")
ok(erroDaCrianca({ nome: "Bia", idade: 11 }) === null && erroDaCrianca({ nome: " ", idade: 5 }) !== null, "US28 nome da criança validado")
const D1 = addDays(hoje, 5)
const proprio = { id: "x1", mesaId: "mesa1", socioId: "s4", data: D1, turno: "manha" as const, status: "confirmado" as const, origem: "direto" as const, criadoEm: agora }
const comProprio = { ...e, agendamentos: [...e.agendamentos, proprio] }
ok(conflitoAgendamento(comProprio, "s4", D1, "tarde")?.includes("RN05") === true, "RN05 segundo turno próprio no dia")
ok(conflitoAgendamento(comProprio, "s4", D1, "tarde", { nome: "Bia", idade: 5 }) === null, "US28 criança não conta na RN05")
ok(conflitoAgendamento(comProprio, "s4", D1, "manha", { nome: "Bia", idade: 5 })?.includes("mesa de estudo") === true, "US28 responsável não fica em dois lugares")
const comCrianca = { ...comProprio, agendamentos: [...comProprio.agendamentos, { ...proprio, id: "x2", mesaId: "mesa5", turno: "tarde" as const, crianca: { nome: "Bia", idade: 5 } }] }
ok(conflitoAgendamento(comCrianca, "s4", D1, "noite", { nome: "bia", idade: 5 })?.includes("já tem") === true, "US28 uma vez por dia para cada criança")
const noLimite = {
  ...comProprio,
  agendamentos: [
    ...comProprio.agendamentos,
    ...["A", "B", "C"].map((n, i) => ({ ...proprio, id: `y${i}`, mesaId: "mesa5", turno: "tarde" as const, crianca: { nome: n, idade: 5 } })),
  ],
}
ok(conflitoAgendamento(noLimite, "s4", D1, "noite", { nome: "D", idade: 5 })?.includes("limite") === true, "US28 limite de crianças por dia")
const filaInfantil = { id: "f9", socioId: "s-sem-agendamento", data: hoje, turno: "manha" as const, criadoEm: agora, status: "aguardando" as const, espaco: "infantil" as const, crianca: { nome: "Nina", idade: 4 } }
const lotadoEstudo = { ...e, mesas: e.mesas.filter((m) => m.espaco === "estudo"), fila: [...e.fila, filaInfantil] }
const liberouEstudo = processarFila({ ...lotadoEstudo, agendamentos: lotadoEstudo.agendamentos.map((a) => (a.id === "ag1" ? { ...a, status: "cancelado" as const } : a)) }, hoje, "manha", agora)
ok(liberouEstudo.fila.find((f) => f.id === "f9")?.status === "aguardando", "US28 mesa de estudo liberada não contempla a fila infantil")
ok(filaDoTurno(e, hoje, "manha", "infantil").length === 0 && filaDoTurno(e, hoje, "manha").length === 1, "filas separadas por espaço")
const rotinaApi = aplicarRotinas({ ...e, agendamentos: e.agendamentos.filter((a) => a.id !== "ag1") }, hoje, agora, 9, { cuidarDaFila: false })
ok(rotinaApi.relatorio.contemplados === 0 && rotinaApi.estado.fila.find((f) => f.id === "f1")?.status === "aguardando", "com o banco, a rotina do navegador não mexe na fila")
const inativado = liberarMesasDoSocio(e, "s2", hoje, 9, agora)
ok(
  inativado.agendamentos.find((a) => a.id === "ag1")?.status === "cancelado" &&
    inativado.agendamentos.some((a) => a.socioId === "s1" && a.origem === "fila" && a.data === hoje),
  "inativar libera as mesas e contempla a fila",
)
const semDados = anonimizarCriancasDoSocio(e, "s2").agendamentos.find((a) => a.id === "ag6")
ok(semDados?.crianca?.idade === undefined && !semDados?.crianca?.nome.includes("Clara"), "anonimizar apaga os dados da criança")

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
