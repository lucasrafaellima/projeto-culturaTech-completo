// Verificação das regras puras. Uso: npm run verificar
import { createHash } from "node:crypto"
import { criarEstadoInicial } from "../src/lib/mock-data"
import { sha256, hashSenha } from "../src/lib/seguranca"
import { catalogar, formaCatalografica, validarAutores } from "../src/lib/catalogacao"
import { lerObras, lerSocios, MODELOS } from "../src/lib/csv"
import { cpfValido, cnpjValido, isbnValido, diasAtraso, addDays, hojeISO, normalizar, idade, dataValida } from "../src/lib/utils"
import {
  agendamentoKidsNoDia,
  agendamentoNoDia,
  aplicarRotinas,
  confirmarUsoNoEstado,
  debitos,
  destinoDaVaga,
  filaDoTurno,
  gerarNotificacoes,
  espacoDaFila,
  liberarMesasDoSocio,
  liberarVagasSemUso,
  mesasDoEspaco,
  mesasLivres,
  movimentacoesDoTurno,
  prazoConfirmacaoUso,
  processarFila,
  registrarNaoComparecimentoNoEstado,
  situacaoAgendamento,
  socioBloqueado,
  transferenciaDaVaga,
  turnoDoMomento,
  validarCrianca,
  validarResponsavelKids,
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

// US29: Espaço Kids
const amanha = addDays(hoje, 1)
const nascidaHa = (anos: number, dias = 0) => addDays(`${Number(hoje.slice(0, 4)) - anos}${hoje.slice(4)}`, dias)
const crianca = { nome: "Sofia Alves Pereira", cpf: "715.304.928-23", dataNascimento: nascidaHa(8) }
ok(idade(nascidaHa(12), hoje) === 12 && idade(nascidaHa(12, 1), hoje) === 11, "idade conta o aniversário do próprio dia")
ok(dataValida("2016-02-29") && !dataValida("2015-02-29") && !dataValida("2020-13-01"), "data de nascimento inexistente recusada")
ok(mesasDoEspaco(e, "kids").length === 2 && mesasDoEspaco(e, "estudo").length === 4, "mesas do Espaço Kids separadas das de estudo")
ok(validarCrianca(e, crianca, hoje, amanha) === null, "criança de 8 anos aceita")
ok(validarCrianca(e, { ...crianca, nome: "Sofia" }, hoje, amanha)?.campo === "nome", "nome completo da criança exigido")
ok(validarCrianca(e, { ...crianca, cpf: "123.456.789-00" }, hoje, amanha)?.campo === "cpf", "CPF inválido da criança aponta o campo")
ok(validarCrianca(e, { ...crianca, cpf: "153.509.460-56" }, hoje, amanha)?.campo === "cpf", "CPF de sócio-leitor cadastrado recusado")
ok(validarCrianca(e, { ...crianca, dataNascimento: "" }, hoje, amanha)?.campo === "dataNascimento", "data de nascimento da criança exigida")
const doze = validarCrianca(e, { ...crianca, dataNascimento: nascidaHa(12) }, hoje, hoje)
ok(doze?.campo === "dataNascimento" && doze.mensagem.includes("própria conta"), "12 anos ou mais: recusa e orienta a criar a conta")
ok(!!doze?.mensagem.includes("responsável e agendar o Espaço Kids para uma criança a partir dos 18 anos"), "recusa informa que só aos 18 anos pode ser responsável")

// Responsável pelo Espaço Kids: só a partir dos 18 anos (na data do agendamento)
const joao = e.socios.find((s) => s.id === "s2")!
ok(validarResponsavelKids(joao, amanha) === null, "sócio adulto pode ser responsável no Espaço Kids")
ok(validarResponsavelKids({ ...joao, dataNascimento: nascidaHa(18) }, hoje) === null, "responsável que faz 18 anos hoje é aceito")
const dezessete = validarResponsavelKids({ ...joao, dataNascimento: nascidaHa(18, 1) }, hoje)
ok(!!dezessete?.includes("a partir dos 18 anos"), "17 anos (18 amanhã): não pode ser responsável")
ok(validarResponsavelKids({ ...joao, dataNascimento: nascidaHa(18, 1) }, addDays(hoje, 1)) === null, "idade do responsável vale na data do agendamento")
ok(validarResponsavelKids({ ...joao, dataNascimento: nascidaHa(12) }, hoje) !== null, "sócio de 12 anos tem conta, mas não agenda o Espaço Kids")
ok(!!validarResponsavelKids({ ...joao, dataNascimento: undefined }, hoje)?.includes("sem data de nascimento"), "cadastro sem data de nascimento não comprova a idade do responsável")
ok(validarResponsavelKids(e.socios.find((s) => s.id === "s5")!, hoje) !== null, "sócio de 17 anos dos dados de demonstração recusado como responsável")
ok(validarCrianca(e, { ...crianca, dataNascimento: nascidaHa(12, 1) }, hoje, hoje) === null, "11 anos (12 amanhã) ainda usa o Espaço Kids")
ok(validarCrianca(e, { ...crianca, dataNascimento: nascidaHa(12, 1) }, hoje, addDays(hoje, 2)) !== null, "idade vale na data do agendamento")
ok(!agendamentoNoDia(e, "s2", amanha), "agendamento Kids não conta no limite do responsável (RN05)")
ok(!!agendamentoKidsNoDia(e, "48219365773", amanha), "RN05 aplicada à criança no Espaço Kids")

// Fila do Espaço Kids: separada da fila das mesas de estudo
const lotadoKids = {
  ...e,
  agendamentos: [
    ...e.agendamentos,
    { id: "k2", mesaId: "kids2", socioId: "s3", data: amanha, turno: "tarde" as const, status: "confirmado" as const, origem: "direto" as const, criadoEm: agora, crianca: { ...crianca, cpf: "26081739422" } },
  ],
  fila: [
    ...e.fila,
    { id: "fk1", socioId: "s5", data: amanha, turno: "tarde" as const, criadoEm: agora, status: "aguardando" as const, crianca },
    { id: "fk2", socioId: "s1", data: amanha, turno: "tarde" as const, criadoEm: agora + "1", status: "aguardando" as const, crianca: { ...crianca, cpf: "90412658305" } },
  ],
}
ok(filaDoTurno(lotadoKids, amanha, "tarde", "kids").length === 2 && filaDoTurno(lotadoKids, amanha, "tarde").length === 0, "fila Kids separada da fila de estudo")
const kidsLiberado = processarFila(
  { ...lotadoKids, agendamentos: lotadoKids.agendamentos.map((a) => (a.id === "k2" ? { ...a, status: "cancelado" as const } : a)) },
  amanha,
  "tarde",
  agora,
  "kids",
)
const contemplado = kidsLiberado.agendamentos.find((a) => a.origem === "fila" && a.data === amanha && a.turno === "tarde")
ok(contemplado?.mesaId === "kids2" && contemplado.crianca?.nome === crianca.nome, "vaga Kids liberada contempla a criança da fila")
const confirmado = confirmarUsoNoEstado(lotadoKids, "ag6", agora)
ok(!!confirmado.estado.agendamentos.find((a) => a.id === "ag6")?.usoConfirmadoEm, "US30 confirmação de uso registrada")
ok(confirmado.retirados === 2 && filaDoTurno(confirmado.estado, amanha, "tarde", "kids").length === 0, "uso Kids confirmado retira os demais da fila do turno")
ok(confirmarUsoNoEstado(e, "ag1", agora).retirados === 0 && filaDoTurno(confirmarUsoNoEstado(e, "ag1", agora).estado, hoje, "manha").length === 1, "confirmação em mesa de estudo não mexe na fila")

// US30: tolerância de 15 minutos para confirmar o uso
const inicioTarde = new Date(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)) - 1, Number(hoje.slice(8, 10)), 13)
const em = (min: number) => new Date(inicioTarde.getTime() + min * 60_000).toISOString()
const semUso = {
  ...e,
  agendamentos: [{ id: "t1", mesaId: "mesa2", socioId: "s5", data: hoje, turno: "tarde" as const, status: "confirmado" as const, origem: "direto" as const, criadoEm: em(-300) }],
  fila: [{ id: "t2", socioId: "s1", data: hoje, turno: "tarde" as const, criadoEm: em(-200), status: "aguardando" as const }],
  mesas: e.mesas.filter((m) => m.id === "mesa2"),
}
ok(prazoConfirmacaoUso(semUso.agendamentos[0]).toISOString() === em(15), "prazo de confirmação: início do turno + 15 min")
ok(liberarVagasSemUso(semUso, hoje, em(14)).liberadas === 0, "dentro da tolerância a vaga é mantida")
const vencido = liberarVagasSemUso(semUso, hoje, em(15))
ok(vencido.liberadas === 1 && vencido.estado.agendamentos.find((a) => a.id === "t1")?.status === "nao_compareceu", "sem confirmação em 15 min: não compareceu")
const novoDaFila = vencido.estado.agendamentos.find((a) => a.socioId === "s1" && a.origem === "fila")
ok(!!novoDaFila && prazoConfirmacaoUso(novoDaFila).toISOString() === new Date(new Date(em(15)).getTime() + 15 * 60_000).toISOString(), "vaga vai para a fila, com nova tolerância a partir da contemplação")
ok(liberarVagasSemUso({ ...semUso, agendamentos: [{ ...semUso.agendamentos[0], usoConfirmadoEm: em(5) }] }, hoje, em(30)).liberadas === 0, "uso confirmado não é liberado")
ok(aplicarRotinas(e, hoje, agora, 9).relatorio.vagasLiberadas === 0, "mesas de hoje com uso confirmado continuam ocupadas")

// US30: situação dos agendamentos no acompanhamento
const agT = semUso.agendamentos[0]
const usado = { ...agT, usoConfirmadoEm: em(5) }
const situacao = (a: typeof agT, min: number) => situacaoAgendamento(a, new Date(em(min)))
ok(situacao(agT, -10) === "agendado", "antes do turno: agendado")
ok(situacao(agT, 10) === "aguardando_uso", "dentro da tolerância: aguardando confirmação")
ok(situacao(agT, 15) === "prazo_esgotado", "15 min sem confirmação: tolerância esgotada")
ok(situacao(usado, 20) === "em_uso" && liberarVagasSemUso({ ...semUso, agendamentos: [usado] }, hoje, em(200)).liberadas === 0, "uso confirmado: em uso, com a vaga garantida até o fim do turno")
ok(situacao(usado, 4 * 60) === "utilizado" && situacao(agT, 4 * 60) === "encerrado", "turno encerrado: utilizado ou encerrado sem confirmação")
ok(situacao({ ...agT, status: "nao_compareceu" }, 20) === "nao_compareceu", "não compareceu")
const kidsEmUso = confirmado.estado.agendamentos.find((a) => a.id === "ag6")!
ok(situacaoAgendamento(kidsEmUso, new Date()) === "em_uso" && !!kidsEmUso.crianca, "Espaço Kids: uso da criança confirmado fica em uso")
const tardio = { ...agT, criadoEm: em(60) }
ok(situacao(tardio, 70) === "aguardando_uso" && prazoConfirmacaoUso(tardio).toISOString() === em(75), "agendado com o turno em andamento: tolerância conta do agendamento")
ok(
  liberarVagasSemUso({ ...semUso, agendamentos: [tardio] }, hoje, em(74)).liberadas === 0 &&
    liberarVagasSemUso({ ...semUso, agendamentos: [tardio] }, hoje, em(75)).liberadas === 1,
  "não comparecimento identificado 15 min depois do agendamento feito no turno",
)
ok(turnoDoMomento(7) === "manha" && turnoDoMomento(12) === "tarde" && turnoDoMomento(17) === "noite", "turno exibido por padrão conforme a hora")

// US30: transferência da vaga e regras da fila
const comFila = {
  ...semUso,
  agendamentos: [
    agT,
    // o primeiro da fila já tem agendamento à noite no mesmo dia
    { id: "t3", mesaId: "mesa1", socioId: "s1", data: hoje, turno: "noite" as const, status: "confirmado" as const, origem: "direto" as const, criadoEm: em(-250) },
  ],
  fila: [
    { id: "q1", socioId: "s1", data: hoje, turno: "tarde" as const, criadoEm: em(-200), status: "aguardando" as const },
    { id: "q2", socioId: "s3", data: hoje, turno: "tarde" as const, criadoEm: em(-150), status: "aguardando" as const },
    { id: "q3", socioId: "s4", data: hoje, turno: "tarde" as const, criadoEm: em(-140), status: "aguardando" as const },
  ],
}
const ausencia = registrarNaoComparecimentoNoEstado(comFila, "t1", em(16))
const t1 = ausencia.estado.agendamentos.find((a) => a.id === "t1")!
ok(t1.status === "nao_compareceu", "não comparecimento registrado")
ok(
  ausencia.contemplado?.socioId === "s3" && ausencia.contemplado.mesaId === "mesa2" && ausencia.contemplado.origem === "fila",
  "primeiro da fila com agendamento no dia é ignorado e a vaga vai para o próximo",
)
ok(ausencia.ignorados === 1 && ausencia.estado.fila.find((f) => f.id === "q1")?.status === "desistiu", "quem foi ignorado sai da fila")
const q2 = ausencia.estado.fila.find((f) => f.id === "q2")
ok(q2?.status === "contemplado" && q2.agendamentoId === ausencia.contemplado?.id, "contemplado: agendamento em nome dele e saída da fila")
ok(filaDoTurno(ausencia.estado, hoje, "tarde").map((f) => f.id).join() === "q3", "o restante da fila continua aguardando")
const destino = destinoDaVaga(ausencia.estado, t1)
ok(destino.tipo === "fila" && destino.agendamento.socioId === "s3", "destino da vaga: transferida para o contemplado")
const movimentos = movimentacoesDoTurno(ausencia.estado, hoje, "tarde")
ok(
  movimentos[0].tipo === "contemplado" && movimentos.some((m) => m.tipo === "nao_compareceu" && m.destino?.tipo === "fila"),
  "movimentações mostram a ausência e a transferência",
)
// a API devolve só a fila que ainda aguarda: a comparação acha o contemplado e os ignorados
const respostaApi = { ...ausencia.estado, fila: ausencia.estado.fila.filter((f) => f.status === "aguardando") }
const viaApi = transferenciaDaVaga(comFila, respostaApi, agT)
ok(viaApi.contemplado?.socioId === "s3" && viaApi.ignorados === 1, "transferência identificada na resposta da API")
const automatico = liberarVagasSemUso(comFila, hoje, em(15)).estado
ok(
  automatico.agendamentos.some((a) => a.socioId === "s3" && a.origem === "fila") && automatico.fila.find((f) => f.id === "q1")?.status === "desistiu",
  "rotina automática aplica as mesmas regras de fila",
)

// US30: fila vazia, a vaga volta a ficar disponível
const semFila = registrarNaoComparecimentoNoEstado({ ...semUso, fila: [] }, "t1", em(16))
ok(!semFila.contemplado && mesasLivres(semFila.estado, hoje, "tarde").some((m) => m.id === "mesa2"), "fila vazia: vaga disponível para novo agendamento")
ok(destinoDaVaga(semFila.estado, semFila.estado.agendamentos[0]).tipo === "livre", "destino da vaga: livre")
const reagendada = {
  ...semFila.estado,
  agendamentos: [
    ...semFila.estado.agendamentos,
    { id: "t4", mesaId: "mesa2", socioId: "s4", data: hoje, turno: "tarde" as const, status: "confirmado" as const, origem: "direto" as const, criadoEm: em(20) },
  ],
}
ok(destinoDaVaga(reagendada, reagendada.agendamentos[0]).tipo === "direto", "vaga livre agendada de novo aparece como reagendada")

// Com os dados no banco, a fila e as vagas sem uso ficam com o servidor
const semAg1 = { ...e, agendamentos: e.agendamentos.filter((a) => a.id !== "ag1") }
const rotinaApi = aplicarRotinas(semAg1, hoje, agora, 9, { cuidarDaFila: false })
ok(rotinaApi.relatorio.contemplados === 0 && rotinaApi.estado.fila.find((f) => f.id === "f1")?.status === "aguardando", "com o banco, a rotina do navegador não mexe na fila")
ok(espacoDaFila({ ...e.fila[0], crianca: undefined, espaco: "kids" }) === "kids", "a fila vinda da API sem dados da criança continua no Espaço Kids")
const inativado = liberarMesasDoSocio(e, "s2", hoje, 9, agora)
ok(
  inativado.agendamentos.find((a) => a.id === "ag1")?.status === "cancelado" &&
    inativado.agendamentos.some((a) => a.socioId === "s1" && a.origem === "fila" && a.data === hoje),
  "inativar libera as mesas do sócio e contempla a fila",
)

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
