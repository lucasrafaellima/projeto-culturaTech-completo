// ============================================================
// Dados de demonstração (seed). As datas são relativas ao dia em
// que o sistema é aberto pela primeira vez, para que os cenários
// das regras de negócio funcionem em qualquer data:
//  - Maria Joana: empréstimo atrasado + multa pendente -> bloqueada (RN08) e
//    alerta ao entrar (RN11)
//  - João Pedro: empréstimo vencendo em 2 dias (lembrete RF05) e 1 reserva (RF14)
//  - Ana Beatriz: multa com justificativa aguardando julgamento (RN07)
//  - Pedro Henrique: cadastro migrado sem e-mail -> falha de notificação (RF05)
//  - Mesas: todas ocupadas hoje de manhã, com fila de espera (RF11)
// ============================================================
import type { Estado, Exemplar, Livro } from "./types"
import { addDays, hojeISO, isbn13 } from "./utils"
import { hashSenha } from "./seguranca"

export const VERSAO_ESTADO = 1

// Arquivos de demonstração gerados no navegador no primeiro acesso
export const ARQUIVOS_DEMO = {
  pdfFundacao: "demo-pdf-fundacao",
  pdfCordel: "demo-pdf-cordel",
  imgRecorte: "demo-img-recorte-1962",
  imgFestival: "demo-img-festival-cordel",
} as const

function exemplar(n: number, livroId: string, status: Exemplar["status"] = "disponivel"): Exemplar {
  const seq = String(n).padStart(4, "0")
  return {
    id: `7c1e4a2b-5d3f-4e8a-9b6c-00000000${seq}`,
    livroId,
    tombamento: `BMA-${String(1000 + n)}`,
    status,
  }
}

export function criarEstadoInicial(): Estado {
  const hoje = hojeISO()
  const d = (n: number) => addDays(hoje, n)
  const agora = new Date()
  const ts = (minutosAtras: number) =>
    new Date(agora.getTime() - minutosAtras * 60_000).toISOString()

  const autores = [
    { id: "a1", nome: "Graciliano Ramos" },
    { id: "a2", nome: "Patativa do Assaré" },
    { id: "a3", nome: "Jorge Amado" },
    { id: "a4", nome: "Ariano Suassuna" },
    { id: "a5", nome: "Rachel de Queiroz" },
    { id: "a6", nome: "Clarice Lispector" },
    { id: "a7", nome: "Manoel de Barros" },
    { id: "a8", nome: "José Lins do Rego" },
    { id: "a9", nome: "Ziraldo Alves Pinto" },
    { id: "a10", nome: "Lêdo Ivo" },
    { id: "a11", nome: "Maria das Graças Lima" },
    { id: "a12", nome: "Antônio Carlos Ferreira Filho" },
  ]

  const livro = (
    id: string,
    n: number,
    dados: Omit<Livro, "id" | "isbn">,
  ): Livro => ({ id, isbn: isbn13(`97885010${String(n).padStart(4, "0")}`), ...dados })

  const livros: Livro[] = [
    livro("l1", 1, {
      titulo: "Vidas Secas",
      autorIds: ["a1"],
      editora: "Record",
      edicao: "130ª",
      ano: 1938,
      categoria: "literatura",
      secao: "V",
      sinopse: "Retrato da seca no sertão nordestino e da luta de uma família de retirantes.",
    }),
    livro("l2", 2, {
      titulo: "Cante lá que eu canto cá",
      autorIds: ["a2"],
      editora: "Vozes",
      edicao: "1ª",
      ano: 1978,
      categoria: "cordel",
      secao: "C",
      sinopse: "Poemas e cordéis do poeta cearense, marco da poesia popular nordestina.",
    }),
    livro("l3", 3, {
      titulo: "Capitães da Areia",
      autorIds: ["a3"],
      editora: "Companhia das Letras",
      edicao: "3ª",
      ano: 1937,
      categoria: "literatura",
      secao: "C",
      sinopse: "A história de um grupo de meninos de rua em Salvador.",
    }),
    livro("l4", 4, {
      titulo: "Auto da Compadecida",
      autorIds: ["a4"],
      editora: "Agir",
      edicao: "35ª",
      ano: 1955,
      categoria: "literatura",
      secao: "A",
      sinopse: "Comédia que mistura o humor popular nordestino com crítica social.",
    }),
    livro("l5", 5, {
      titulo: "Memórias da Fundação de Arapiraca",
      autorIds: ["a10", "a11"],
      editora: "Edição histórica",
      edicao: "Única",
      ano: 1924,
      categoria: "raro",
      secao: "M",
      sinopse: "Documento raro sobre a formação do povoado que deu origem à cidade.",
    }),
    livro("l6", 6, {
      titulo: "A Hora da Estrela",
      autorIds: ["a6"],
      editora: "Rocco",
      edicao: "4ª",
      ano: 1977,
      categoria: "literatura",
      secao: "H",
      sinopse: "A trajetória de Macabéa, uma retirante alagoana no Rio de Janeiro.",
    }),
    livro("l7", 7, {
      titulo: "O Quinze",
      autorIds: ["a5"],
      editora: "José Olympio",
      edicao: "110ª",
      ano: 1930,
      categoria: "literatura",
      secao: "Q",
      sinopse: "A grande seca de 1915 no Ceará vista por Conceição e Chico Bento.",
    }),
    livro("l8", 8, {
      titulo: "Menino de Engenho",
      autorIds: ["a8"],
      editora: "José Olympio",
      edicao: "95ª",
      ano: 1932,
      categoria: "literatura",
      secao: "M",
      sinopse: "Memórias da infância de Carlinhos num engenho de cana da Paraíba.",
    }),
    livro("l9", 9, {
      titulo: "O Menino Maluquinho",
      autorIds: ["a9"],
      editora: "Melhoramentos",
      edicao: "120ª",
      ano: 1980,
      categoria: "infantil",
      secao: "M",
      sinopse: "As aventuras do menino com uma panela na cabeça.",
    }),
    livro("l10", 10, {
      titulo: "Ciências da Natureza para o Ensino Fundamental",
      autorIds: ["a11", "a12"],
      editora: "Moderna",
      edicao: "2ª",
      ano: 2021,
      categoria: "didatico",
      secao: "D",
      sinopse: "Livro didático de ciências para os anos finais do ensino fundamental.",
    }),
    livro("l11", 11, {
      titulo: "Folhetos do Agreste Alagoano",
      autorIds: ["a2"],
      editora: "Edição do autor",
      edicao: "1ª",
      ano: 1965,
      categoria: "exemplar_unico",
      secao: "F",
      sinopse: "Coletânea encadernada de folhetos, exemplar único doado à biblioteca.",
    }),
    livro("l12", 12, {
      titulo: "Memórias Inventadas",
      autorIds: ["a7"],
      editora: "Planeta",
      edicao: "1ª",
      ano: 2008,
      categoria: "literatura",
      secao: "M",
      sinopse: "Prosa poética de Manoel de Barros sobre a infância.",
    }),
  ]

  const exemplares: Exemplar[] = [
    exemplar(1, "l1"),
    exemplar(2, "l1", "indisponivel"), // emprestado (atrasado) — Maria Joana
    exemplar(3, "l1"),
    exemplar(4, "l2"), // cordel: consulta local (RN04)
    exemplar(5, "l3", "indisponivel"), // emprestado — João Pedro
    exemplar(6, "l3", "reservado"), // reservado — João Pedro
    exemplar(7, "l4"),
    exemplar(8, "l4", "ocioso"), // mascarado para o público (RN30), apto a desbaste (RN31)
    exemplar(9, "l5"), // raro: consulta local
    exemplar(10, "l6"),
    exemplar(11, "l6", "em_restauro"), // mascarado para o público (RN30)
    exemplar(12, "l7", "indisponivel"), // emprestado — Pedro Henrique (vence hoje)
    exemplar(13, "l7"),
    exemplar(14, "l8", "danificado"), // devolvido com dano (RF15)
    exemplar(15, "l8"),
    exemplar(16, "l9"),
    exemplar(17, "l9", "extraviado"), // mascarado para o público (RN30)
    exemplar(18, "l10"),
    exemplar(19, "l10"),
    exemplar(20, "l11"), // exemplar único: consulta local
    exemplar(21, "l12"),
    { ...exemplar(22, "l1"), baixa: { data: d(-25), motivo: "doacao" } }, // doado (RN26)
  ]

  const senhaPadrao = hashSenha("123456")
  const enderecoPadrao = (rua: string, numero: string, bairro: string, cep: string) => ({
    rua,
    numero,
    bairro,
    cep,
  })

  return {
    versao: VERSAO_ESTADO,
    autores,
    livros,
    exemplares,
    desbastes: [],
    administradores: [
      { id: "adm1", nome: "Suzana de Souza", usuario: "admin", senha: hashSenha("admin123") },
    ],
    socios: [
      {
        id: "s1",
        nome: "Maria Joana da Silva",
        cpf: "52998224725",
        rg: "2001234",
        telefone: "82999110001",
        email: "maria.joana@email.com",
        endereco: enderecoPadrao("Rua Expedicionários Brasileiros", "120", "Centro", "57300010"),
        senha: senhaPadrao,
        ativo: true,
        dataCadastro: d(-200),
        consentimentoLgpd: d(-200),
      },
      {
        id: "s2",
        nome: "João Pedro Alves",
        cpf: "15350946056",
        rg: "2001235",
        telefone: "82999110002",
        email: "joao.pedro@email.com",
        endereco: enderecoPadrao("Rua São Francisco", "45", "Baixa Grande", "57307120"),
        senha: senhaPadrao,
        ativo: true,
        dataCadastro: d(-150),
        consentimentoLgpd: d(-150),
      },
      {
        id: "s3",
        nome: "Ana Beatriz Costa",
        cpf: "71460238001",
        rg: "2001236",
        telefone: "82999110003",
        email: "ana.costa@email.com",
        endereco: enderecoPadrao("Avenida Ceci Cunha", "880", "Brasília", "57305200"),
        senha: senhaPadrao,
        ativo: true,
        dataCadastro: d(-120),
        consentimentoLgpd: d(-120),
      },
      {
        id: "s4",
        nome: "Pedro Henrique Santos",
        cpf: "38561392061",
        rg: "2001237",
        telefone: "82999110004",
        email: "", // cadastro migrado da planilha antiga, sem e-mail
        endereco: enderecoPadrao("Rua Santa Luzia", "12", "Primavera", "57304050"),
        senha: senhaPadrao,
        ativo: true,
        dataCadastro: d(-90),
        consentimentoLgpd: d(-90),
      },
      {
        id: "s5",
        nome: "Lucas Ferreira Lima",
        cpf: "86190423787",
        rg: "2001238",
        telefone: "82999110005",
        email: "lucas.lima@email.com",
        endereco: enderecoPadrao("Rua Boa Vista", "300", "Cacimbas", "57309010"),
        senha: senhaPadrao,
        ativo: true,
        dataCadastro: d(-40),
        consentimentoLgpd: d(-40),
      },
    ],
    emprestimos: [
      {
        id: "emp1",
        socioId: "s1",
        exemplarId: exemplares[1].id,
        dataEmprestimo: d(-19),
        dataPrevista: d(-5), // venceu há 5 dias
        renovacoes: 0,
        status: "ativo",
        historico: [],
      },
      {
        id: "emp2",
        socioId: "s2",
        exemplarId: exemplares[4].id,
        dataEmprestimo: d(-12),
        dataPrevista: d(2), // vence em 2 dias -> lembrete (RF05)
        renovacoes: 0,
        status: "ativo",
        historico: [],
      },
      {
        id: "emp3",
        socioId: "s3",
        exemplarId: exemplares[6].id,
        dataEmprestimo: d(-60),
        dataPrevista: d(-46),
        dataDevolucao: d(-40), // 6 dias de atraso
        renovacoes: 0,
        status: "devolvido",
        historico: [],
      },
      {
        id: "emp4",
        socioId: "s3",
        exemplarId: exemplares[9].id,
        dataEmprestimo: d(-35),
        dataPrevista: d(-21),
        dataDevolucao: d(-22),
        renovacoes: 0,
        status: "devolvido",
        historico: [],
      },
      {
        id: "emp5",
        socioId: "s1",
        exemplarId: exemplares[20].id,
        dataEmprestimo: d(-80),
        dataPrevista: d(-52),
        dataDevolucao: d(-49), // 3 dias de atraso
        renovacoes: 1,
        status: "devolvido",
        historico: [],
      },
      {
        id: "emp6",
        socioId: "s4",
        exemplarId: exemplares[11].id,
        dataEmprestimo: d(-14),
        dataPrevista: hoje, // vence hoje
        renovacoes: 0,
        status: "ativo",
        historico: [],
      },
      {
        id: "emp7",
        socioId: "s2",
        exemplarId: exemplares[13].id,
        dataEmprestimo: d(-45),
        dataPrevista: d(-31),
        dataDevolucao: d(-31),
        renovacoes: 0,
        status: "devolvido",
        historico: [],
        devolvidoDanificado: true,
      },
      {
        id: "emp8",
        socioId: "s5",
        exemplarId: exemplares[15].id,
        dataEmprestimo: d(-30),
        dataPrevista: d(-2),
        dataDevolucao: d(-3),
        renovacoes: 1,
        status: "devolvido",
        historico: [],
      },
    ],
    multas: [
      {
        id: "m1",
        socioId: "s1",
        emprestimoId: "emp5",
        valor: 3,
        motivo: "atraso",
        status: "pendente",
        dias: 3,
        data: d(-49),
        pareceres: [],
      },
      {
        id: "m2",
        socioId: "s3",
        emprestimoId: "emp3",
        valor: 6,
        motivo: "atraso",
        status: "em_analise",
        dias: 6,
        data: d(-40),
        justificativa: {
          texto:
            "Estive internada no Hospital Regional de Arapiraca entre os dias do vencimento e só consegui devolver após a alta. Posso apresentar o atestado no balcão.",
          data: d(-38),
        },
        pareceres: [],
      },
      {
        id: "m3",
        socioId: "s2",
        emprestimoId: "emp7",
        valor: 25,
        motivo: "dano",
        status: "paga",
        data: d(-31),
        pareceres: [],
        dataQuitacao: d(-28),
      },
    ],
    ocorrencias: [
      {
        id: "oc1",
        emprestimoId: "emp7",
        exemplarId: exemplares[13].id,
        socioId: "s2",
        multaId: "m3",
        relatorio:
          "Exemplar devolvido com a capa rasgada e páginas 40 a 52 manchadas por líquido. Encadernação comprometida.",
        imagemIds: [],
        valorMulta: 25,
        data: d(-31),
      },
    ],
    reservas: [
      {
        id: "r1",
        socioId: "s2",
        exemplarId: exemplares[5].id,
        dataReserva: d(-1),
        expiraEm: d(2),
        status: "ativa",
      },
    ],
    notificacoes: [],
    mesas: [
      { id: "mesa1", nome: "Mesa 1", local: "Sala silenciosa" },
      { id: "mesa2", nome: "Mesa 2", local: "Sala silenciosa" },
      { id: "mesa3", nome: "Mesa 3", local: "Acervo histórico" },
      { id: "mesa4", nome: "Mesa 4", local: "Acervo histórico" },
    ],
    agendamentos: [
      { id: "ag1", mesaId: "mesa1", socioId: "s2", data: hoje, turno: "manha", status: "confirmado", origem: "direto", criadoEm: ts(600) },
      { id: "ag2", mesaId: "mesa2", socioId: "s3", data: hoje, turno: "manha", status: "confirmado", origem: "direto", criadoEm: ts(590) },
      { id: "ag3", mesaId: "mesa3", socioId: "s4", data: hoje, turno: "manha", status: "confirmado", origem: "direto", criadoEm: ts(580) },
      { id: "ag4", mesaId: "mesa4", socioId: "s5", data: hoje, turno: "manha", status: "confirmado", origem: "direto", criadoEm: ts(570) },
      { id: "ag5", mesaId: "mesa1", socioId: "s3", data: d(1), turno: "tarde", status: "confirmado", origem: "direto", criadoEm: ts(300) },
    ],
    fila: [
      { id: "f1", socioId: "s1", data: hoje, turno: "manha", criadoEm: ts(120), status: "aguardando" },
    ],
    instituicoes: [
      {
        id: "inst1",
        tipo: "instituicao",
        nome: "Escola Municipal José de Alencar",
        documento: "12345678000195",
        endereco: "Rua Domingos Correia, 250 - Centro, Arapiraca/AL",
        contato: "(82) 3521-0001",
      },
      {
        id: "inst2",
        tipo: "instituicao",
        nome: "Instituto Federal de Alagoas - Campus Arapiraca",
        documento: "76543210000198",
        endereco: "Av. Sergipe, 1477 - Caititus, Arapiraca/AL",
        contato: "biblioteca.arapiraca@ifal.edu.br",
      },
      {
        id: "inst3",
        tipo: "pessoa_fisica",
        nome: "Carlos Henrique Melo",
        documento: "30241895642",
        endereco: "Rua Pio XII, 88 - Alto do Cruzeiro, Arapiraca/AL",
        contato: "carlos.h@email.com",
      },
    ],
    movimentacoes: [
      {
        id: "mov1",
        tipo: "aquisicao",
        livroId: "l10",
        receptorId: "inst2",
        tombamentos: ["BMA-1018", "BMA-1019"],
        data: d(-60),
        observacao: "Doação de livros didáticos recebida do IFAL.",
      },
      {
        id: "mov2",
        tipo: "doacao",
        livroId: "l1",
        receptorId: "inst3",
        tombamentos: ["BMA-1022"],
        data: d(-25),
        observacao: "Exemplar excedente doado a leitor da comunidade.",
      },
    ],
    pastas: [
      {
        id: "p1",
        nome: "Recortes de jornal - Arapiraca (1950-1970)",
        descricao: "Recortes de jornais locais sobre a vida cultural e política da cidade.",
      },
      {
        id: "p2",
        nome: "Folhetos de cordel digitalizados",
        descricao: "Folhetos frágeis do acervo, digitalizados para consulta sem manuseio.",
      },
    ],
    arquivos: [
      {
        id: ARQUIVOS_DEMO.pdfFundacao,
        titulo: "Memórias da Fundação de Arapiraca (digitalização)",
        formato: "pdf",
        nomeArquivo: "memorias-fundacao-arapiraca.pdf",
        descricao: "Digitalização da obra rara, para consulta sem manuseio do original.",
        vinculo: { tipo: "livro", livroId: "l5" },
        tamanhoOriginal: 0,
        tamanhoArmazenado: 0,
        compressao: "gzip",
        dataUpload: d(-30),
      },
      {
        id: ARQUIVOS_DEMO.pdfCordel,
        titulo: "Folhetos do Agreste Alagoano (digitalização)",
        formato: "pdf",
        nomeArquivo: "folhetos-agreste.pdf",
        descricao: "Versão digital do exemplar único.",
        vinculo: { tipo: "pasta", pastaId: "p2" },
        tamanhoOriginal: 0,
        tamanhoArmazenado: 0,
        compressao: "gzip",
        dataUpload: d(-20),
      },
      {
        id: ARQUIVOS_DEMO.imgRecorte,
        titulo: "Recorte do Jornal de Arapiraca - 1962",
        formato: "imagem",
        nomeArquivo: "jornal-1962.png",
        descricao: "Matéria sobre a inauguração da biblioteca municipal.",
        vinculo: { tipo: "pasta", pastaId: "p1" },
        tamanhoOriginal: 0,
        tamanhoArmazenado: 0,
        compressao: "nenhuma",
        dataUpload: d(-10),
      },
    ],
    publicacoes: [
      {
        id: "pub1",
        tipo: "evento",
        titulo: "Festival de Cordel de Arapiraca",
        descricao:
          "Encontro de cordelistas e xilogravuristas no pátio da biblioteca, com oficina aberta para crianças. Entrada gratuita.",
        data: d(7),
        imagemIds: [ARQUIVOS_DEMO.imgFestival],
      },
      {
        id: "pub2",
        tipo: "novidade",
        titulo: "Novos exemplares de literatura nordestina",
        descricao:
          "Chegaram novos exemplares de Rachel de Queiroz e José Lins do Rego. Consulte a disponibilidade no catálogo público.",
        data: d(-2),
        imagemIds: [],
      },
      {
        id: "pub3",
        tipo: "noticia",
        titulo: "Biblioteca amplia horário de atendimento",
        descricao: "A partir deste mês a biblioteca funciona também aos sábados, das 8h às 12h.",
        data: d(-5),
        imagemIds: [],
      },
      {
        id: "pub4",
        tipo: "evento",
        titulo: "Sarau literário: vozes do agreste",
        descricao: "Leitura de poemas e contos de autores alagoanos. Inscrições para leitores no balcão.",
        data: d(14),
        imagemIds: [],
      },
    ],
    ultimaRotina: undefined,
  }
}
