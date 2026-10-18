# API — CulturaTech

API em Node.js + Express sobre o PostgreSQL (`database/01_schema.sql`): login e cadastro, acervo, circulação
(empréstimos, renovações, devoluções, multas, reservas), sócios-leitores e repositório digital, com os arquivos no
**Amazon S3**. As senhas são conferidas contra o hash **bcrypt** da coluna `senha_hash` (o mesmo formato gerado por
`crypt(..., gen_salt('bf'))` nos dados de exemplo).

## Como rodar

Requer **Node 22.18+** (roda TypeScript direto, sem build).

```bash
cd server
npm install
cp .env.example .env     # preencha o endpoint do RDS, a senha e o JWT_SECRET
npm run dev              # http://localhost:3333
```

Com a API e o front (`npm run dev` na raiz) rodando, o Vite repassa `/api/*` para a porta 3333,
então o front chama `fetch("/api/auth/login")` sem se preocupar com CORS.

```bash
npm run testar-login        # 22 verificações de login e cadastro (API precisa estar rodando)
npm run testar-acervo       # 48 verificações das rotas de acervo
npm run testar-circulacao   # 66 verificações de empréstimos, renovações, multas, reservas e sócios
npm run testar-repositorio  # 41 verificações de arquivos, repositório digital e consulta pública
npm run testar-mural        # 21 verificações do mural (publicações e imagens)
npm run testar-s3           # grava, lê e apaga um objeto no armazenamento (não usa o banco)
npm run tipos               # checagem de tipos
```

> Os scripts gravam no banco: sócios, obras, empréstimos e arquivos "de teste" (CPF, ISBN e tombamentos aleatórios a
> cada execução). O `testar-circulacao` também ajusta direto no banco as datas de um empréstimo que ele mesmo criou,
> para simular atraso (usa as variáveis `PG*` do `.env`). Rode contra um banco de testes.

### Arquivos no Amazon S3

Digitalizações do repositório, imagens do mural, fotos 3x4 e imagens de dano ficam fora do banco; a tabela `arquivo`
guarda só a chave (`chave_storage`), no formato `<pasta>/<uuid>.<extensão>`:

| Pasta | O que guarda | Exemplo |
|---|---|---|
| `mural/` | imagens das publicações do mural | `mural/3f9c…e2.webp` |
| `acervo/` | digitalizações ligadas a uma obra | `acervo/8a1d…07.pdf` |
| `documentos/` | documentos das pastas históricas | `documentos/c42b…9f.pdf` |
| `socios/` | fotos 3x4 | `socios/71e0…aa.jpeg` |
| `danos/` | fotos de exemplares devolvidos com dano | `danos/0b5f…13.png` |

A extensão vem do formato (`pdf`, `jpeg`, `png` ou `webp`); como o site converte as imagens para WEBP quando isso
reduz o tamanho (RNF13), a maioria das imagens fica `.webp`. O nome original do arquivo fica em `arquivo.nome_arquivo`.
PDFs comprimidos são gravados com `Content-Encoding: gzip`, então abrem normalmente quando baixados pelo console da AWS.
O front informa a pasta no upload (`X-Destino`) e a API confere a pasta ao ligar o arquivo a um documento, publicação,
sócio ou dano. Arquivos enviados antes desta organização continuam em `arquivos/` e seguem funcionando.

O destino é escolhido no `.env`:

| `ARMAZENAMENTO` | Onde | Variáveis |
|---|---|---|
| `s3` | bucket do Amazon S3 | `S3_BUCKET`, `S3_REGIAO`; `S3_ENDPOINT` opcional (MinIO ou outro serviço compatível) |
| `disco` (padrão) | pasta `server/uploads` (fora do git) | `PASTA_UPLOADS` opcional |

As credenciais da AWS vêm da cadeia padrão do SDK: papel IAM da instância (recomendado no EC2/ECS), perfil em
`~/.aws` ou `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`. O usuário/papel precisa só de `s3:PutObject`, `s3:GetObject`
e `s3:DeleteObject` nas pastas acima:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": [
        "arn:aws:s3:::<bucket>/mural/*",
        "arn:aws:s3:::<bucket>/acervo/*",
        "arn:aws:s3:::<bucket>/documentos/*",
        "arn:aws:s3:::<bucket>/socios/*",
        "arn:aws:s3:::<bucket>/danos/*",
        "arn:aws:s3:::<bucket>/arquivos/*"
      ]
    }
  ]
}
```

(`arquivos/*` só é necessário enquanto houver arquivos enviados antes da organização em pastas.) Mantenha o bucket
**privado** (Block Public Access ligado): quem entrega os arquivos é a API, que confere a permissão de cada um.

## Rotas

### `POST /api/auth/login`

```json
{ "usuario": "529.982.247-25", "senha": "123456" }
```

O campo `usuario` aceita:

| Formato | Quem | Busca |
|---|---|---|
| contém `@` | sócio-leitor | `lower(email)` |
| 11 dígitos (com ou sem `.` e `-`) | sócio-leitor | `cpf` |
| qualquer outro texto | administrador | `lower(usuario)` |

Sócios anonimizados (LGPD) não entram.

| Status | Quando |
|---|---|
| `200` | `{ ok, token, usuario: { id, nome, perfil, pendencias? }, cadastro, mensagem }` |
| `400` | usuário ou senha vazios, JSON inválido |
| `401` | usuário ou senha incorretos (mesma mensagem nos dois casos) |
| `403` | senha correta, mas cadastro inativo |
| `429` | 5 tentativas erradas para o mesmo login e IP em 15 minutos |

`pendencias` (só para sócios) vem de `fn_socio_bloqueado`: `true` quando há multa em aberto ou devolução
atrasada, para o front exibir o alerta da RN11.

`cadastro` traz os dados do próprio usuário, com os nomes de `src/lib/types.ts`: `{ usuario }` para administrador;
`{ cpf, rg, telefone, email, endereco, dataCadastro, consentimentoLgpd }` para sócio.

### Como o front usa o login e o cadastro

As telas Entrar e Criar conta ([src/lib/api.ts](../src/lib/api.ts) e as ações `entrar` e `cadastrarConta` de
[src/lib/store.tsx](../src/lib/store.tsx)):

1. Entrar envia usuário e senha para `POST /api/auth/login`; Criar conta envia o formulário para
   `POST /api/auth/cadastro`. Quando a API responde, **é ela que decide**: senha errada, cadastro inativo, CPF ou
   e-mail já cadastrados no banco recusam a operação, e a mensagem da API aparece na tela.
2. O resto do app ainda trabalha com os dados do navegador. Por isso, no login ou cadastro aceito, o cadastro vindo do
   banco é copiado para o registro local equivalente (mesmo CPF para sócio, mesmo usuário para administrador), ou um
   registro novo é criado. Alterações feitas só no navegador nesses campos são sobrescritas pelo banco no próximo login.
3. O token fica na sessão (`localStorage`). Ao abrir o app, ele é conferido em `GET /api/auth/me`; se for recusado
   (expirado, adulterado, cadastro desativado), a sessão é encerrada.
4. Se a API **não responder** (desligada, sem rede), login e cadastro usam só os dados do navegador, como antes, e a
   mensagem informa que o servidor está indisponível. É o que mantém `npm run testar-navegador` funcionando sem a API.

> Em desenvolvimento, as chamadas passam pelo proxy do Vite e chegam à API com o mesmo IP (127.0.0.1). Por isso o
> limite de tentativas de login e de cadastro vale para todos os usuários juntos. Reinicie a API para zerar a contagem.

### `POST /api/auth/cadastro`

Cadastro feito pelo próprio visitante (tela "Criar conta"). Recebe os mesmos campos de `DadosSocio` do front-end:

```json
{
  "nome": "Maria da Silva", "cpf": "111.444.777-35", "rg": "1234567",
  "telefone": "(82) 99999-0000", "email": "maria@example.com",
  "endereco": { "rua": "Rua A", "numero": "10", "bairro": "Centro", "cep": "57300-000" },
  "senha": "minha-senha", "consentimentoLgpd": true
}
```

Aplica as mesmas validações do front (`validarSocio`): nome completo, CPF com dígito verificador, telefone com DDD,
e-mail, endereço, CEP, senha de 6 a 72 caracteres sem espaço nas pontas e consentimento LGPD. O RG é opcional
(até 20 caracteres; vazio vira `NULL` no banco).
CPF, telefone e CEP são gravados só com dígitos; o e-mail, em minúsculas; `consentimento_lgpd` recebe a data do dia.

| Status | Quando |
|---|---|
| `201` | conta criada; mesmo formato da resposta do login (`token`, `usuario`, `cadastro`), então o sócio já entra |
| `400` | algum campo inválido (a `mensagem` diz qual) |
| `409` | CPF ou e-mail já cadastrados |
| `429` | 5 cadastros (ou CPF/e-mail repetidos) a partir do mesmo IP em 15 minutos |

### `GET /api/auth/me`

Cabeçalho `Authorization: Bearer <token>`. Devolve `{ ok, usuario }` ou `401`.
Relê o usuário no banco, então um cadastro desativado perde o acesso mesmo com token válido.

### `GET /api/saude`

`200` se a API alcança o banco, `503` se não.

## Acervo (somente administradores)

Código em [src/acervo.ts](src/acervo.ts). Todas as rotas exigem `Authorization: Bearer <token>` de um administrador
ativo: sem token ou com token inválido, `401`; com token de sócio, `403`. As regras e mensagens são as mesmas das ações
do front-end em `src/lib/store.tsx` (`salvarLivro`, `adicionarExemplares`, `editarExemplar`, `desbastarExemplar`...).

| Método | Rota | Corpo | O que faz |
|---|---|---|---|
| GET | `/api/livros?busca=&categoria=` | | lista obras (busca por título, autor ou ISBN), com `exemplaresNoAcervo` |
| GET | `/api/livros/:id` | | obra com `exemplares`, incluindo os baixados (campo `baixa`) |
| POST | `/api/livros` | obra | cadastra (`201`) |
| PUT | `/api/livros/:id` | obra | altera |
| DELETE | `/api/livros/:id` | | exclui obra sem exemplares e sem histórico |
| POST | `/api/livros/:id/exemplares` | `{ "tombamentos": ["BM-0001"], "localizacao"?: "Estante 3" }` | adiciona até 100 exemplares, `disponivel` (`201`) |
| PATCH | `/api/exemplares/:id` | `{ "tombamento"?, "status"?, "localizacao"? }` | corrige tombamento, altera status e/ou a localização |
| DELETE | `/api/exemplares/:id` | | exclui exemplar cadastrado por engano (sem histórico) |
| POST | `/api/exemplares/:id/desbaste` | `{ "relatorio": "..." }` | desbasta (`201`) |
| GET | `/api/desbastes` | | relatório dos desbastes, com o nome do administrador |
| GET | `/api/acervo` | | o acervo inteiro (`autores`, `livros` com `autorIds`, `exemplares`, `desbastes` com o nome do administrador em `admin`) no formato do estado do front |
| POST | `/api/livros/importar` | `{ "obras": [{ ...obra, "tombamentos": [...], "linha": 2 }] }` | importação em lote (até 1000 obras), **tudo ou nada** numa transação; o erro cita a linha (`Linha 4: ...`) |

A importação em lote aceita corpo de até 2 MB (as demais rotas, 10 KB) e só lê o corpo depois de conferir que o
usuário é administrador.

Corpo da obra:

```json
{
  "titulo": "Vidas Secas", "autores": ["Graciliano Ramos"], "editora": "Record", "edicao": "1ª",
  "ano": 1938, "categoria": "literatura", "secao": "V", "isbn": "978-85-01-00013-2", "sinopse": "opcional"
}
```

Regras principais:

- **Obra**: título, editora, edição, ano entre 1400 e o ano atual, uma das 8 categorias, seção de A a Z (RN22) e ISBN-10
  ou ISBN-13 válido e **não repetido** (comparado sem hífens). Um ou mais autores, sem repetir (RN19), gravados na ordem
  informada; autores já cadastrados são reaproveitados pelo nome, sem diferenciar maiúsculas (acentos diferentes
  contam como outro nome).
- **Exemplares**: a obra precisa existir (RN16); tombamentos ficam em maiúsculas e não podem se repetir; o id é um UUID
  gerado pelo banco (RN20). A **localização** (até 80 caracteres, ex.: "Estante 3, prateleira B") diz onde cada cópia
  fica; vazia, vale a seção da obra. Bancos criados antes dessa coluna precisam rodar `database/04_localizacao_exemplar.sql`.
- **Status** (RN12): não muda se o exemplar estiver emprestado ou reservado; `reservado` só pela reserva de um sócio;
  exemplar baixado não pode ser alterado.
- **Desbaste**: só exemplares `ocioso` ou `danificado` (RN31) e com relatório de no mínimo 20 caracteres (RN24). O
  exemplar não é apagado: recebe `baixa_data`/`baixa_motivo` e o registro vai para `desbaste` com o administrador.
- **Exclusões**: exemplar só sem empréstimos, reservas, desbaste ou doação (senão, use o desbaste). Obra só sem
  exemplares (nem baixados), sem doações e sem digitalizações vinculadas — a tabela `documento_digital` apaga em cascata,
  então a API confere antes para não perder arquivos.

| Status | Quando |
|---|---|
| `400` | campo inválido |
| `404` | obra ou exemplar não encontrado (ou id malformado) |
| `409` | ISBN/tombamento repetido, exemplar emprestado/reservado/baixado, desbaste fora da RN31, histórico que impede exclusão |
| `413` | corpo grande demais |

### `GET /api/acervo/publico` (sem login)

Consulta pública no formato do `/api/acervo`, com a regra da `vw_consulta_publica`: exemplares baixados não aparecem e
os status internos (em restauro, extraviado, ocioso) saem como `indisponivel` (RN30). Não traz desbastes.

## Circulação (US08–US11)

Código em [src/circulacao.ts](src/circulacao.ts). Regras e mensagens iguais às das ações do front-end
(`realizarEmprestimo`, `renovarEmprestimo`, `devolverEmprestimo`...). As regras que envolvem vários registros também
são conferidas pelos triggers do banco (`fn_validar_emprestimo`, `fn_validar_reserva`); a mensagem de um trigger
(`RAISE EXCEPTION`) volta como `409` com o mesmo texto. "Hoje" é a data do servidor do banco (`CURRENT_DATE`).

| Método | Rota | Quem | O que faz |
|---|---|---|---|
| GET | `/api/circulacao` | admin | `{ socios, emprestimos, multas, ocorrencias, reservas }` no formato de `src/lib/types.ts`; antes, expira as reservas vencidas |
| GET | `/api/eu/circulacao` | sócio | o próprio cadastro, empréstimos, multas e reservas |
| POST | `/api/emprestimos` | admin | `{ socioId, exemplarId }`: RN06 (sócio ativo), RN08 (pendências), RN04 (obra restrita), RN14 (exemplar já emprestado), RN01 (até 3 itens), reserva de outro sócio; prazo de 14 dias (RN02) |
| POST | `/api/emprestimos/:id/renovar` | admin | +14 dias, até 3 vezes (RN17); empréstimo atrasado não renova |
| PATCH | `/api/emprestimos/:id` | admin | `{ dataPrevista, motivo }`: altera o prazo (não antes da saída; motivo ≥ 10 caracteres) |
| POST | `/api/emprestimos/:id/cancelar` | admin | `{ motivo }`: registro feito por engano, sem multa; libera o exemplar |
| POST | `/api/emprestimos/:id/devolver` | admin | `{ dano?: { relatorio, valor, imagemIds } }`: grava a data de devolução (RF07); **atraso gera multa de R$ 1,00 por dia** (RN03); dano gera multa, ocorrência com as imagens e deixa o exemplar "danificado" (RN13) |
| POST | `/api/multas/:id/quitar` | admin | registra o pagamento |
| POST | `/api/multas/:id/justificativa` | admin ou o próprio sócio | `{ texto }` ≥ 20 caracteres; a multa fica "em análise" (RN07) |
| POST | `/api/multas/:id/julgar` | admin | `{ decisao: "deferido" \| "indeferido", texto }`: deferida abona; indeferida volta a pendente; o parecer fica registrado |
| POST | `/api/reservas` | sócio (ou admin com `socioId`) | `{ livroId }`: reserva um exemplar disponível por 3 dias |
| POST | `/api/reservas/:id/cancelar` | admin ou o próprio sócio | cancela e libera o exemplar |

Cada empréstimo devolve o `historico` (tabela `emprestimo_evento`): registro, renovações, alterações de prazo,
cancelamento e devolução.

## Sócios-leitores (administrador)

Código em [src/socios.ts](src/socios.ts). Mesmas validações do cadastro (`validarDadosSocio` em `src/cadastro.ts`).

| Método | Rota | O que faz |
|---|---|---|
| POST | `/api/socios` | cadastra (campos de `DadosSocio` + `senha` inicial + `fotoId` opcional) |
| PUT | `/api/socios/:id` | altera o cadastro (a senha não muda aqui); a foto antiga é apagada |
| POST | `/api/socios/:id/ativo` | alterna ativo/inativo (não inativa com empréstimo em andamento) |
| POST | `/api/socios/:id/senha` | `{ senha }`: redefine |
| POST | `/api/socios/:id/anonimizar` | LGPD: apaga os dados pessoais e a foto, mantém o histórico sem identificação |

## Arquivos e repositório digital (US17 / US18)

Código em [src/arquivos.ts](src/arquivos.ts) e [src/repositorio.ts](src/repositorio.ts). O envio é em duas etapas: o
arquivo sobe por `POST /api/arquivos` e depois é ligado a um documento, a uma foto de sócio ou a uma ocorrência de dano.

| Método | Rota | Quem | O que faz |
|---|---|---|---|
| POST | `/api/arquivos` | admin | corpo binário (até 15 MB); `Content-Type` (PDF, JPG, PNG ou WEBP), `X-Nome-Arquivo` (com `encodeURIComponent`), `X-Compressao` (`webp`, `gzip` ou `nenhuma`) e `X-Tamanho-Original`. Confere a assinatura do conteúdo e grava no S3 |
| GET | `/api/arquivos/:id` | depende | digitalização do repositório: **pública**; foto: o próprio sócio e admin; demais: admin. PDF guardado em gzip sai com `Content-Encoding: gzip` (o navegador descomprime) |
| DELETE | `/api/arquivos/:id` | admin | apaga upload que nada usa (cadastro desistido) |
| GET | `/api/repositorio` | público | `{ pastas, documentos }` (o `id` do documento é o do arquivo) |
| POST | `/api/documentos` | admin | `{ arquivoId, titulo, formato, descricao?, vinculo: { tipo: "livro", livroId } \| { tipo: "pasta", pastaId } }` (RF08) |
| DELETE | `/api/documentos/:arquivoId` | admin | remove o documento, a linha de `arquivo` e o objeto no S3 |
| POST / PUT / DELETE | `/api/pastas`, `/api/pastas/:id` | admin | pastas de recortes; só exclui pasta sem documentos |

O front-end comprime antes de enviar (imagens em WEBP, PDFs em gzip, RNF13), como já fazia no navegador.

## Mural (RF12)

Código em [src/mural.ts](src/mural.ts). Notícias, eventos e novidades literárias, com as imagens no S3
(tabela `publicacao_imagem`, na ordem enviada). Mesmas regras de `salvarPublicacao` e `excluirPublicacao` do front.

| Método | Rota | Quem | O que faz |
|---|---|---|---|
| GET | `/api/mural` | público | `{ publicacoes }` no formato de `Publicacao` (`imagemIds` em ordem) |
| POST | `/api/publicacoes` | admin | `{ tipo: "noticia" \| "evento" \| "novidade", titulo, descricao, data, imagemIds }`: título ≥ 3 caracteres, descrição e/ou imagem, data obrigatória, até 10 imagens já enviadas por `POST /api/arquivos` |
| PUT | `/api/publicacoes/:id` | admin | altera; as imagens retiradas da publicação são apagadas do banco e do S3 |
| DELETE | `/api/publicacoes/:id` | admin | remove a publicação e as imagens dela |

As imagens ligadas a uma publicação são **públicas** em `GET /api/arquivos/:id`, como as digitalizações do repositório.

## Como o front-end usa a API

Com a API no ar, o **banco é a fonte** do acervo, da circulação, dos sócios e do repositório
(`src/lib/store.tsx`, `src/lib/api.ts`, `src/lib/arquivos.ts`):

| Quem | O que vem do banco (no login e ao reabrir o app) |
|---|---|
| Administrador conectado pela API | acervo completo, circulação (empréstimos, multas, danos, reservas), sócios, repositório e mural |
| Sócio conectado pela API | acervo público, o próprio cadastro e a própria circulação, repositório e mural |
| Visitante | acervo público, repositório e mural |

1. Os dados do navegador são **substituídos** pelos do banco. Se o carregamento falhar no login, o login é recusado,
   para a tela nunca mostrar um dado e gravar em outro.
2. As ações dessas áreas passam pelas rotas acima e a resposta é copiada para o estado local. No acervo, o front aplica
   antes as validações locais; na circulação, quem decide é o servidor (as mensagens são as mesmas).
3. Imagens e PDFs enviados com a sessão pela API vão para o S3; os componentes de exibição (`VisualizadorPdf`,
   `ImagemArmazenada`) leem do navegador e, se não acharem o arquivo, buscam em `GET /api/arquivos/:id`.
4. Com a API **fora do ar** no meio da sessão, as ações são recusadas com "Servidor indisponível", em vez de gravar só
   no navegador. Sem a API no login (modo de demonstração), tudo continua local, como antes, e o cabeçalho mostra o
   aviso **"Modo demonstração"**. Se o app for reaberto com a API no ar e a sessão estiver nesse modo, ela é encerrada,
   para o próximo login usar o banco.
5. Token expirado ou recusado (`401`) encerra a sessão. Com a circulação no banco, a rotina diária do navegador não
   expira reservas (quem faz isso é o servidor); os avisos de prazo (RF05) continuam sendo gerados no navegador.

Limitações conhecidas desse modo:

- **Continuam locais:** mesas de estudo e fila, doações (recusadas com a sessão pela API), notificações e backups. Agendamentos de mesa feitos com os sócios de demonstração aparecem sem o nome do sócio.
- **Importação de sócios por planilha** é recusada com a sessão pela API (a planilha não traz o consentimento LGPD que
  o banco exige); cadastre pela tela Sócios-leitores.
- **Dados de demonstração:** os PDFs de exemplo do navegador não existem no banco; o repositório começa só com a pasta
  dos dados de exemplo.
- **Modo offline:** um sócio cadastrado pelo administrador no banco só entra com a API no ar (não há senha local para ele).
- Restaurar um backup ou a demonstração (tela Backups) troca os dados locais por uma cópia antiga; os do banco voltam
  no próximo login.

## Segurança

- Token **JWT** (HS256) assinado com `JWT_SECRET`, validade em `JWT_EXPIRA_EM` (padrão 8h).
- Usuário inexistente também passa pelo bcrypt, para o tempo de resposta não revelar quem está cadastrado.
- Senhas acima de 72 bytes são recusadas (limite do bcrypt).
- Consultas parametrizadas (`$1`), sem concatenar entrada do usuário no SQL.
- O limitador de tentativas fica em memória: reiniciar a API zera a contagem.
- `DB_SSL=require` cifra a conexão com o RDS, mas não confere o certificado. Para conferir, baixe o
  [bundle de CA da AWS](https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem) e use `DB_SSL=verify`
  com `DB_SSL_CA=./global-bundle.pem`.
