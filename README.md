# CulturaTech — Front-end

Front-end do **Portal Cultural de Arapiraca** (Biblioteca Municipal Prof. Pedro de França Reis), construído a partir do
*Documento de Requisitos v3.2* e das *Histórias de Usuário* (US01–US27), seguindo o modelo visual e a arquitetura do
protótipo `Atividades_IFAL/Cultura-tech/cultura-tech-portal-cultural`.

## Como rodar

```bash
npm install
npm run dev        # desenvolvimento em http://localhost:5173
npm run build      # checagem de tipos + build de produção em dist/
npm run preview    # serve o build em http://localhost:4173
```

### Contas de demonstração

| Perfil | Usuário | Senha | Cenário |
|---|---|---|---|
| Administrador | `admin` | `admin123` | Acesso completo |
| Sócio-leitor | `529.982.247-25` (Maria Joana) | `123456` | Devolução atrasada + multa: bloqueada, alerta no login |
| Sócio-leitor | `153.509.460-56` (João Pedro) | `123456` | Regular, com reserva e empréstimo vencendo em 2 dias |
| Sócio-leitor | `714.602.380-01` (Ana Beatriz) | `123456` | Multa com justificativa aguardando julgamento |
| Sócio-leitor | `385.613.920-61` (Pedro Henrique) | `123456` | Cadastro sem e-mail: falha de notificação |
| Sócio-leitor | `020.112.940-02` (Lúcia Ferreira) | `123456` | Só no banco (`02_dados_exemplo.sql`): dois exemplares atrasados, multa corrente somada |

Visitantes não precisam de login para o mural, a consulta pública e o repositório digital.
Os dados de demonstração têm datas relativas ao dia do primeiro acesso. Em **Backups** é possível restaurá-los.

### Verificações

```bash
npm run verificar          # 41 verificações das regras puras (CSV, catalogação, multas, fila, notificações...)
npm run testar-navegador   # 34 testes de ponta a ponta no Chrome headless (exige `npm run preview` rodando)
```

O teste de navegador usa o Chrome instalado (caminho padrão do Windows ou variável `CHROME`) e salva as telas em
`.verificar/telas/`.

> **Rode o teste de navegador com a API desligada.** Ele usa os dados de demonstração do navegador. Com a API ligada,
> o acervo, a circulação, os sócios e o repositório passam a vir do banco (veja `server/README.md`): os cenários de
> demonstração deixam de existir e o teste chega a gravar empréstimos e desbastes de verdade no banco.

## Stack (a mesma do modelo)

React 19 · Vite 8 · TypeScript 5.7 (strict) · Tailwind CSS 4 · lucide-react · clsx + tailwind-merge. Nenhuma dependência
nova foi adicionada.

## Arquitetura

```
src/
├── App.tsx                 # shell, roteamento por hash, controle de acesso, alerta de login (RN11)
├── components/
│   ├── ui.tsx              # Button, Card, Modal (foco preso + Esc), Campo, Abas, Aviso, Toast (aria-live)...
│   ├── header.tsx          # login/logout e usuário atual
│   ├── sidebar.tsx         # menu por perfil, recolhível no celular
│   ├── status-badge.tsx    # máscara de status (RN30)
│   ├── arquivos.tsx        # imagens, visualizador de PDF, seletor de imagens
│   ├── historico.tsx       # histórico de leitura e badges
│   └── multas.tsx          # linha do tempo de justificativas/pareceres
├── lib/
│   ├── types.ts            # modelo de domínio
│   ├── constants.ts        # constantes das regras e rótulos em PT-BR
│   ├── regras.ts           # regras puras: débitos, fila, notificações, rotina diária
│   ├── store.tsx           # estado global e TODAS as ações de negócio (com checagem de perfil)
│   ├── persistencia.ts     # localStorage + backups automáticos (RNF05)
│   ├── arquivos.ts         # IndexedDB + compressão WEBP/gzip (RNF12/RNF13)
│   ├── csv.ts              # leitura e validação de CSV (RN21/RNF03)
│   ├── catalogacao.ts      # entradas principal/secundárias de autores (RN18/RN19)
│   ├── seguranca.ts        # SHA-256 para senhas (RNF06)
│   ├── mock-data.ts        # dados de demonstração
│   ├── demo-arquivos.ts    # gera PDFs e imagens de exemplo no primeiro acesso
│   ├── navigation.ts       # matriz rota × perfil (RNF02) e rotas por hash (#/acervo)
│   └── utils.ts            # datas, formatação, CPF/CNPJ/ISBN
└── pages/                  # 13 telas
```

Como no modelo, **as regras ficam no store**: as páginas chamam a ação e exibem `{ ok, mensagem }` num toast.
Diferente do modelo, cada ação também confere o perfil da sessão, então uma chamada indevida é recusada mesmo que a tela
seja contornada.

## Rastreabilidade: histórias de usuário → telas

| História | Onde está | Regras aplicadas |
|---|---|---|
| **US01** Cadastrar e manter livros | Acervo → Nova obra / Editar / Excluir | RF01, RN15, RN16, RN18, RN19, RN20; ISBN com dígito verificador, ISBN único |
| **US02** Gerenciar exemplares | Acervo → Adicionar exemplares | RF16, RN16, RN20 (UUID), tombamento único |
| **US03** Controlar status do exemplar | Acervo → Status | RN12 (7 status), RN30 (máscara para não-admin) |
| **US04** Desbastamento | Acervo → Aptos a desbaste / Relatórios | RN24 (relatório obrigatório), RN31 (só ocioso/danificado) |
| **US05** Migrar via CSV | Importação CSV | RN21, RNF03 (pré-visualização, erros por linha, nada é gravado se houver erro) |
| **US06** Cadastrar sócio-leitor | Sócios-leitores → Novo | RF02 (todos os campos + foto 3x4), RN29, RNF12, RNF06 (consentimento, CPF mascarado, eliminação de dados) |
| **US07** Histórico de qualquer sócio | Sócios-leitores → Histórico | RF04, RN23 |
| **US08** Registrar empréstimo | Circulação → Novo empréstimo | RN01, RN04, RN06, RN08, RN14, RN27 |
| **US09** Renovar empréstimo | Circulação → Renovar | RN02 (+14 dias), RN17 (máx. 3); não aparece para devolvidos/cancelados |
| **US10** Datas de saída e devolução | Circulação → registro do empréstimo | RF07, RN02 |
| **US11** Multa automática | Devolução + multa corrente exibida enquanto o livro não volta | RN03 (R$ 1,00/dia por exemplar), RN08 |
| **US12** Justificar e julgar abono | Minha Área → Justificar / Circulação → Multas → Julgar | RN07 (deferir abona, indeferir mantém; parecer e histórico registrados) |
| **US13** Registrar dano | Circulação → Devolver → danificado / aba Danos | RF15 (relatório + imagens), RN13, RN12 (status “Danificado”), RNF12 |
| **US14** Notificação de prazo | Notificações (caixa de saída) / Minha Área | RF05 (lembrete 3 dias antes, vencimento, atraso; falha registrada e reenvio) |
| **US15** Alerta de pendências no login | Janela exibida após o login | RN11 |
| **US16** Consulta pública | Consulta Pública (OPAC) | RF06, RN22 (seções A–Z), RN30, RNF07 (índice em memória), RNF11 |
| **US17** Anexar digitalizações | Repositório Digital → Anexar | RF08 (vínculo com obra ou pasta), RNF13 (compressão) |
| **US18** Visualizar PDFs | Repositório Digital → Visualizar / link na ficha da obra | RF17, RN04 (obra rara lida online) |
| **US19** Agendar mesa | Mesas de Estudo | RF10, RN05, RN06, RN09, RN10 |
| **US20** Fila de espera | Mesas de Estudo → Entrar na fila / Desistir | RF11 (posição visível, contemplação automática, reordenação) |
| **US21** Publicar no mural | Mural → Publicar / Editar / Excluir | RF12, RNF12, RNF13 |
| **US22** Mural sem login | Mural Cultural | RF12, RNF11 |
| **US23** Cadastrar instituições | Parcerias e Doações → Novo cadastro | RF13 (nome, CNPJ, endereço, contato) |
| **US24** Doação / aquisição | Parcerias e Doações → Registrar doação / aquisição | RN25, RN26, histórico por receptor |
| **US25** Meu histórico | Minha Área → Meu histórico de leitura | RF04, RN23 |
| **US26** Meus reservados | Minha Área / Consulta → Reservar | RF14, RN28 |
| **US27** Login por perfil | Entrar / menu por perfil | RNF02, RNF01 |
| **US28** (W) | Fora do escopo, como definido no backlog | — |

Além das histórias: backups automáticos diários com restauração (RNF05), textos em português com acentuação (RNF04) e
layout responsivo com menu recolhível (RNF11).

## Decisões tomadas onde os documentos não definem

Os itens abaixo aparecem em “Pontos a validar com a equipe” nas histórias de usuário, ou não têm regra escrita. Foram
resolvidos assim e podem ser ajustados:

1. **Reserva de livro** (não existe RF que a crie): o sócio-leitor reserva pela consulta pública um exemplar disponível; a
   reserva fica guardada por **3 dias** e expira sozinha. Reservas contam no limite de 3 da RN01 e são bloqueadas pela RN08.
2. **Valor da multa por dano** (RN13 não define): o administrador informa o valor na devolução; o sistema sugere R$ 25,00.
3. **Renovação de empréstimo atrasado**: não é permitida — a devolução é registrada e a multa é calculada.
4. **Multa em análise** continua bloqueando novos empréstimos (RN08) até ser julgada.
5. **Cancelar empréstimo** (RF03) serve para desfazer registro feito por engano: não gera multa e libera o exemplar.
6. **Doação** retira o exemplar do acervo; **aquisição** cria novos exemplares vinculados à origem cadastrada.
7. **Catalogação (RN19)**: segue o AACR2 — entrada pelo último sobrenome (“RAMOS, Graciliano”), com Filho/Júnior/Neto junto
   do sobrenome; até 3 autores, entrada principal pelo primeiro; mais de 3, entrada pelo título.
8. **Turnos**: manhã 8h–12h, tarde 13h–17h, noite 18h–21h; agendamento com até 30 dias de antecedência.

## Limites desta entrega

Com a API (`server/`) no ar, login, cadastro, acervo, circulação (US08–US11: empréstimo, renovação, datas e multa por
atraso), sócios-leitores, repositório digital (US17–US18) e mural ficam no PostgreSQL, com os arquivos e imagens no
Amazon S3; veja `server/README.md`. Mesas, doações, notificações e backups continuam no navegador. Sem a API, o front-end
funciona sozinho, no modo de demonstração descrito abaixo:

- **Os dados ficam no navegador** (localStorage para registros, IndexedDB para arquivos). Cada computador tem seus próprios
  dados; não há sincronização entre máquinas. O backup em JSON permite levar os dados de um navegador para outro.
- **O login é local**: as senhas são guardadas como hash SHA-256, e cada ação confere o perfil, mas quem tem acesso às
  ferramentas de desenvolvedor do navegador pode alterar os dados. Segurança real exige back-end.
- **E-mails (RF05) não saem de fato**: a rotina gera as mensagens e as registra na caixa de saída. O envio precisa de um
  serviço de e-mail no servidor.
- **Backups (RNF05)** ficam no próprio navegador; baixe as cópias e guarde fora da máquina.
- **RNF07** (20.000 livros em até 5 s): a busca é feita em memória e é instantânea no volume de demonstração; com 20.000
  registros o gargalo passa a ser o limite de ~5 MB do localStorage, outro motivo para o back-end.

Próximo passo natural: uma API (ex.: Node + PostgreSQL) que receba exatamente as ações do `store.tsx`, que já estão
isoladas e com as mesmas assinaturas `{ ok, mensagem }`.
