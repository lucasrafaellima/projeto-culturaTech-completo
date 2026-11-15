# Testes de aceite — CulturaTech

Este documento liga cada critério de aceite das 31 histórias da planilha de acompanhamento ("Gestão de Projetos -
PROIN") ao teste que o comprova. Um critério está atendido quando o teste indicado passa; os poucos itens marcados como
**manual** precisam de conferência por uma pessoa. O aceite final é da responsável pelo aceite (Suzana).

## Como rodar tudo

Requisitos: Node 22.18+, PostgreSQL 17 instalado (só os programas; o script cria e apaga o próprio banco), Google
Chrome, e as portas 3333, 4173 e 55432 livres.

```bash
npm install && (cd server && npm install)
npm run testar-tudo
```

O `scripts/testar-tudo.ps1` cria um banco descartável, carrega `database/01_schema.sql` e `02_dados_exemplo.sql`, sobe a
API e o front e roda todas as suítes abaixo. No fim mostra um resumo por suíte e apaga o banco. Ele recusa rodar se o
banco não for local: **nenhuma suíte que grava dados deve rodar no banco de produção (Neon)**. Se o PostgreSQL estiver
em outra pasta, use `powershell -File scripts/testar-tudo.ps1 -PgBin "<pasta bin>"`.

| Sigla | Suíte | O que testa |
|---|---|---|
| V | `npm run verificar` | regras puras (cálculos, validações, rotinas) |
| N | `npm run testar-navegador` | telas no Chrome, modo demonstração (API desligada) |
| C | `npm run testar-celular` | todas as telas em 390 px e 768 px |
| T | `npm run testar-telas-api` | telas no Chrome com a API e o banco |
| D | `cd server && npm run testar-desempenho` | consulta pública com 5.000 livros |
| A:x | `cd server && npm run testar-x` | rotas da API (`login`, `acervo`, `circulacao`, `repositorio`, `mural`, `mesas`, `parcerias`, `notificacoes`, `s3`) |

O nome entre aspas é o texto que a verificação imprime ao passar.

**Falha conhecida:** 2 verificações do `testar-login` ("data de nascimento futura" e "data inexistente") batem no
limitador de 5 cadastros a cada 15 minutos por IP, porque a suíte faz mais cadastros do que isso. O resumo as mostra como
"conhecidas"; não é defeito de regra.

**Verificações da US30 (confirmação de uso) com a API** só rodam com um turno aberto. O `testar-tudo` usa um fuso em que
o turno da manhã está aberto, para que rodem a qualquer hora.

## Matriz: critério → teste

### 1. Tela de login
1. Botão "Entrar" visível → N (fluxo de login do visitante)
2. Redirecionamento correto após o login → N "Minha Área com situação e histórico (RF04)"; A:login "perfil do administrador é admin"
3. Mensagem de erro em caso de falha → N "senha errada recusada"; A:login "senha errada é recusada com 401"

### 2. Cadastrar e manter livros
1. Título, autores, editora, edição, ano, categoria e ISBN → A:acervo "cadastrar obra: 201", "ISBN inválido: 400", "ano futuro: 400"
2. Mais de um autor, com catalogação → A:acervo "autores na ordem informada", "autor repetido: 400 (RN19)"; V (catalogação AACR2)
3. Acesso ao exemplar vinculado depois do cadastro → A:acervo "adicionar 3 exemplares: 201"

### 3. Gerenciar exemplares
1. Identificação, tombamento e status → A:acervo "exemplares em maiúsculas, disponíveis, com UUID"
2. Recusa de exemplar em livro inexistente → A:acervo "exemplar sem obra: 404 (RN16)"
3. Associação por UUID → A:acervo "exemplares em maiúsculas, disponíveis, com UUID"

### 4. Controlar o status do exemplar
1. Administrador altera o status → A:acervo "alterar status para ocioso: 200", "status inexistente: 400"
2. Restauro, extraviado e ocioso aparecem como indisponíveis → A:acervo "consulta pública sem login mostra ocioso, em restauro e extraviado como indisponível"; N "RN30 visitante vê 'Indisponível' no lugar de 'Em restauro'"

### 5. Registrar desbastamento
1. Justificativa para ocioso ou danificado → A:acervo "desbaste válido: 201"
2. Recusa em outros status → A:acervo "desbaste de exemplar disponível: 409 (RN31)"
3. Recusa sem justificativa → A:acervo "relatório curto: 400 (RN24)"

### 6. Importação CSV
1. Só CSV → V "RN21 somente CSV"
2. Linhas corrompidas não são gravadas → V "RNF03 linhas corrompidas apontadas por número"; A:acervo "lote com erro não grava nada (tudo ou nada)"
3. Importação válida fica disponível → V "modelo de obras é válido"; A:acervo (importação)

### 7. Cadastrar sócio-leitor
1. Dados pessoais, foto, endereço e nascimento → A:circulacao "cadastrar sócio pelo admin: 201"; A:login "cadastro válido retorna 201 com token"
2. Foto só WEBP, JPG ou PNG → A:repositorio "formato não suportado: 400", "sócio cadastrado com foto"
3. Só o administrador gerencia sócios → N "sócio não acessa gestão de sócios (RN29)"
4. LGPD → A:login "sem consentimento LGPD retorna 400"; A:circulacao "sócio anonimizado não entra"

### 8. Histórico de qualquer sócio
1. Empréstimos passados e em andamento → A:circulacao "US8: admin vê os empréstimos passados e em andamento do sócio, com as datas"

### 9. Controle de circulação
1. Com menos de 3 empréstimos, aceita → A:circulacao "2º e 3º empréstimos do mesmo sócio"; "RN01: 4º exemplar simultâneo recusado"
2. Recusa único, raro ou cordel → A:circulacao "RN04: cordel não pode ser emprestado"; N "consulta local (RN04)"
3. Exemplar já emprestado → A:circulacao "RN14: exemplar já emprestado é recusado"
4. Bloqueio por multa ou atraso → A:circulacao "RN08: sócia com atraso e multa é bloqueada"

### 10. Renovar empréstimo
1. Mais 14 dias → A:circulacao "renovação N: +14 dias"
2. No máximo 3 renovações → A:circulacao "RN17: 4ª renovação recusada"
3. Cancelado ou devolvido não renova → A:circulacao "empréstimo cancelado não renova"

### 11. Datas de saída e devolução
1. Saída e data prevista → A:circulacao "empréstimo registrado: 201" (prazo de 14 dias)
2. Data de devolução e exemplar disponível → A:circulacao "devolução no prazo: sem multa, data de devolução hoje (RF07)", "exemplar devolvido volta a ficar disponível"

### 12. Multa por atraso
1. R$ 1,00 por dia → A:circulacao (devolução atrasada); N "Multa por atraso"
2. Vários exemplares atrasados → A:circulacao "sócio vê a própria situação em /eu/circulacao" (multa corrente somada)
3. Bloqueio com multa em aberto → A:circulacao "RN08: devolução atrasada bloqueia novo empréstimo"

### 13. Abono de multa
1. Justificativa fica em análise → A:circulacao "sócio justifica a própria multa: em análise"
2. Deferida: multa abonada → A:circulacao "deferida: multa abonada"; N "abonada"
3. Indeferida: dívida mantida → A:circulacao "indeferida: volta a pendente e guarda o parecer"

### 14. Dano e multa
1. Relatório e imagens → A:circulacao "upload da imagem do dano: 201", "relatório de dano curto: 400"
2. Multa e exemplar danificado → A:circulacao (devolução com dano: multa e status "danificado")
3. Recusa fora de WEBP/JPG/PNG → A:repositorio "formato não suportado: 400"

### 15. Notificação de prazo
1. Prazo se aproximando → A:notificacoes "o aviso cita a obra" (lembrete), "aviso no dia do vencimento"; T "US15: João vê na Minha Área o lembrete gerado pelo servidor"
2. Prazo ultrapassado → A:notificacoes "aviso de atraso"

> Divergência: o critério da planilha fala em e-mail, mas a equipe decidiu que o aviso fica dentro do sistema (Minha
> Área). A planilha precisa ser atualizada.

### 16. Alerta de pendências no login
1. Com pendência, alerta → N "RN11 alerta de pendências ao entrar"; A:login "sócio com multa/atraso vem com pendencias = true"
2. Sem pendência, nenhum alerta → N "RN11 sócio sem atraso nem multa entra sem alerta de pendências"

### 17. Consulta sem login
1. Busca por título, autor, categoria ou seção → N "busca ignora acentos (autor Assaré)", "US16 busca só por autor", "US16 filtro por categoria", "filtro por seção (RN22)"
2. 5.000 livros em até 5 s → D (API e navegador abaixo de 5 s)
3. Status internos mascarados → A:acervo "consulta pública sem login mostra … como indisponível"; N "RN30 …"
4. Filtro por seção A–Z → N "filtro por seção (RN22)"
5. Celular e tablet → C

### 18. Anexar digitalizações
1. PDF vinculado à obra ou pasta → A:repositorio "PDF comprimido vinculado à pasta: 201", "RF08: obra inexistente: 404"
2. Compressão → A:repositorio "upload de PDF comprimido (gzip, RNF13): 201"
3. Só administrador anexa → A:repositorio "sócio não anexa: 403", "upload com token de sócio: 403"

### 19. Visualizar PDFs
1. Exibido no navegador → N "PDF descomprimido e exibido no navegador (RF17)"; A:repositorio "visitante abre o PDF do repositório"
2. Obra rara lida digitalmente → N "obra rara: aviso de somente consulta digital (US18)"
3. Tempo de resposta reduzido → A:repositorio "PDF guardado em gzip chega descomprimido (Content-Encoding)" (o arquivo trafega comprimido)

### 20. Agendar mesa por turno
1. Agendamento registrado → A:mesas "agendar mesa escolhida: 201"; T (agendamento pela tela)
2. Espaço ocupado → A:mesas "mesa ocupada: 409 (RN09)"
3. Segundo turno no dia → A:mesas "segundo turno no dia: 409 (RN05)"
4. Quem não é sócio → A:mesas "POST /agendamentos sem token: 401"

### 21. Fila de espera
1. Entrada com posição visível → A:mesas "entrar na fila: posição 1", "sócio se reconhece na fila"
2. Mesa liberada contempla o primeiro → A:mesas "cancelar repassa a mesa", "primeiro contemplado com origem fila"
3. Desistência reordena → A:mesas "desistir da fila", "fila reordenada: Dani passa a ser o 2º"

### 22. Cadastrar notícia no mural
1. Título, descrição e/ou imagem → A:mural "só imagem, sem descrição: 201 (RF12)", "sem descrição nem imagem: 400 (RF12)"
2. Imagem fora de WEBP/JPG/PNG recusada → A:repositorio "formato não suportado: 400"; V (validação de imagem)
3. Aparece no mural → A:mural "GET /mural sem login"

### 23. Mural sem login
1. Visitante vê as notícias → A:mural "GET /mural sem login"; N "visitante vê o mural (RF12)"
2. Celular → C

### 24. Instituições parceiras
1. Nome, CNPJ, endereço e contato → A:parcerias "cadastrar instituição com máscara: 201", "CNPJ inválido: 400"; T "cadastrar instituição pela tela"
2. Quem não é administrador → A:parcerias "POST /instituicoes de sócio: 403"

### 25. Doação ou aquisição
1. Receptor não cadastrado → A:parcerias "doação sem receptor cadastrado: 409 (RN25)", "aquisição sem origem cadastrada: 409 (RN25)"
2. Pessoa física com segundo livro → A:parcerias "pessoa física com segundo livro: 409 (RN26)"
3. Receptor e data no histórico da obra → A:parcerias "histórico da obra com receptor e data"; T "a obra mostra o receptor e a data da doação"

### 26. Meu histórico de leitura
1. Empréstimos passados e ativos → N "Minha Área com situação e histórico (RF04)"; A:circulacao "sócio vê a própria situação em /eu/circulacao"
2. Histórico de outro usuário → A:circulacao "sócio não consulta a situação de outro: 403"

### 27. Meus livros reservados
1. Só as próprias reservas → A:circulacao "sócio reserva a obra: 201", "outro sócio não cancela a reserva: 403"
2. Administrador vê as reservas do sócio → T "US27: admin vê os livros reservados pelo sócio"

### 28. Autenticar-se e operar conforme o perfil
1. Login com o perfil certo → A:login "perfil do administrador é admin", "novo sócio vem com perfil socio"
2. Sócio sem acesso administrativo → N "sócio não acessa gestão de sócios (RN29)"; A:circulacao "GET /circulacao com token de sócio: 403"
3. Visitante só com as páginas públicas → N "visitante não vê menu administrativo (RNF02)", "visitante redirecionado ao tentar abrir o acervo (RNF02)"
4. Sem instalação local → **manual**: abrir pelo navegador, sem instalar nada

> Divergência: o critério 3 diz "só a consulta pública e o mural", mas o Repositório Digital também é público
> (histórias 18 e 19). A planilha precisa ser ajustada.

### 29. Espaço Kids
1. Nome completo, CPF e nascimento obrigatórios → A:mesas "nome incompleto da criança: 400"; N "criança sem nome: campo apontado"
2. CPF inválido indicado no campo → A:mesas "CPF inválido da criança: 400"; N "CPF inválido da criança recusado e indicado no campo"
3. Criança vinculada ao responsável, sem conta → T "a lista identifica a criança"; N "Espaço Kids agendado e criança vinculada à responsável"
4. 12 anos ou mais: recusa e explicação (responsável só com 18) → A:mesas "criança com 12 anos: 409", "sócio de 17 anos não agenda o Espaço Kids: 409"; T "sócio de 17 anos vê o motivo…"
5. Menor de 12 não cria conta → A:login "menor de 12 anos (faz 12 amanhã) retorna 400"
6. Com 12 anos pega livro emprestado → A:circulacao "sócio de 12 anos pega livro emprestado"
7. Espaço Kids lotado: fila → A:mesas "fila Kids: posição 1"; T "entrar na fila Kids"
8. Uso confirmado retira a fila do turno → A:mesas "uso Kids confirmado retira a fila do turno (US29)"; V "uso Kids confirmado retira os demais da fila do turno"

### 30. Acessar o espaço pelo celular
Sem critério escrito na planilha. Proposta usada nos testes: todas as telas sem rolagem horizontal em 390 px e 768 px e
menu recolhível → C. Também conferir **manualmente** num celular de verdade.

### 31. Confirmar que o sócio está usando o espaço
1. Lista do turno com sócio, mesa, criança e situação → N (Acompanhamento de Mesas, "Criança: …", "Aguardando confirmação")
2. Confirmar uso: "em uso" até o fim do turno → A:mesas "admin confirma o uso"; N "Em uso"
3. Sem confirmação em 15 min: "não compareceu" e vaga para a fila → A:mesas "sem confirmação em 15 minutos a vaga vai para a fila (US30)"; V "prazo de confirmação: início do turno + 15 min"
4. Primeiro da fila já agendado no dia é pulado → A:mesas "US31 c4: o primeiro da fila, já agendado no dia, é pulado e sai da fila"
5. Sem fila, a vaga fica livre → A:mesas "US31 c5: sem fila, a vaga liberada fica disponível para novo agendamento"; N "Sem fila de espera: a Mesa 3 está livre"
6. Contemplado recebe a vaga e sai da fila → A:mesas "US31 c6: a vaga vai ao próximo, em nome dele, e ele sai da fila"
7. Quem não é administrador → A:mesas "sócio não confirma uso: 403"; N "US30 sócio-leitor sem as ações de confirmar uso e registrar não comparecimento"

## Conferências manuais

- **Sem instalação (história 28 c4):** abrir o site num computador sem nada instalado além do navegador.
- **Celular de verdade (histórias 17, 23 e 30):** navegar pelas telas principais num celular.
- **Produção (Neon), só leitura:** com o `server/.env` de produção, rodar `npm run testar-s3` (grava e apaga um arquivo de
  teste), abrir `/api/saude` e entrar como administrador. Não rodar as outras suítes no banco de produção.
