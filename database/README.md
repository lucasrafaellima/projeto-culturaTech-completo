# Banco de dados — CulturaTech

Modelo relacional para **PostgreSQL 16** no **Amazon RDS**, derivado de `src/lib/types.ts`, das regras em
`src/lib/regras.ts`/`constants.ts` e do diagrama de classes (`modelo de classes/`).

| Arquivo                       | Conteúdo                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| `01_schema.sql`               | Tabelas, restrições, índices, triggers de regras de negócio e visões (schema `culturatech`)             |
| `02_dados_exemplo.sql`        | Dados de demonstração com as mesmas contas e cenários do README do app                                  |
| `03_ajuste_search_path.sql`   | Só para bancos criados antes de as funções fixarem o próprio `search_path`; rode uma vez                |
| `04_localizacao_exemplar.sql` | Só para bancos criados antes da coluna `exemplar.localizacao`; rode uma vez (pode repetir sem problema) |
| `05_indice_mural.sql`         | Só para bancos criados antes do índice `ix_publicacao_tipo_data` (filtro do mural); pode repetir         |
| `06_data_nascimento.sql`      | Só para bancos criados antes da coluna `socio_leitor.data_nascimento` (US29); pode repetir               |
| `07_mesas_espaco_kids.sql`    | Só para bancos criados antes do Espaço Kids (US29) e da confirmação de uso (US30) no banco: colunas, índices e dados fictícios de mesas e instituições; pode repetir |
| `modelo_dados.png`            | Diagrama com todas as tabelas, colunas, tipos e chaves, gerado a partir de `01_schema.sql`               |

> Banco novo: rode apenas `01_schema.sql` (e, se quiser os dados de demonstração, `02_dados_exemplo.sql`). Os arquivos
> `03` a `07` são ajustes para bancos já existentes; num banco novo eles são desnecessários, mas inofensivos.
>
> Os PDFs de exemplo do repositório não cabem num `.sql` (os bytes ficam no S3): depois do `02`, com a API no ar, rode
> `npm run dados-pdf` em `server/`.

## Diagrama entidade-relacionamento

O modelo completo, com as colunas, os tipos e as chaves de cada tabela, está em [`modelo_dados.png`](modelo_dados.png):

![Modelo de dados do CulturaTech](modelo_dados.png)

Resumo das relações:

```mermaid
erDiagram
    LIVRO ||--o{ LIVRO_AUTOR : tem
    AUTOR ||--o{ LIVRO_AUTOR : escreve
    LIVRO ||--|{ EXEMPLAR : possui
    EXEMPLAR ||--o| DESBASTE : "baixa (RN31)"
    SOCIO_LEITOR ||--o{ EMPRESTIMO : faz
    EXEMPLAR ||--o{ EMPRESTIMO : circula
    EMPRESTIMO ||--o{ EMPRESTIMO_EVENTO : historico
    EMPRESTIMO ||--o{ MULTA : gera
    MULTA ||--o{ PARECER_MULTA : julgada
    ADMINISTRADOR ||--o{ PARECER_MULTA : emite
    EMPRESTIMO ||--o| OCORRENCIA_DANO : registra
    OCORRENCIA_DANO ||--|| MULTA : "multa por dano"
    SOCIO_LEITOR ||--o{ RESERVA : faz
    EXEMPLAR ||--o{ RESERVA : reservado
    EMPRESTIMO ||--o{ NOTIFICACAO : avisa
    MESA_ESTUDO ||--o{ AGENDAMENTO : ocupada
    SOCIO_LEITOR ||--o{ AGENDAMENTO : agenda
    SOCIO_LEITOR ||--o{ FILA_ESPERA : aguarda
    FILA_ESPERA |o--o| AGENDAMENTO : contemplado
    INSTITUICAO ||--o{ MOVIMENTACAO : "doa/recebe"
    LIVRO ||--o{ MOVIMENTACAO : envolve
    MOVIMENTACAO ||--|{ MOVIMENTACAO_EXEMPLAR : inclui
    LIVRO ||--o{ DOCUMENTO_DIGITAL : anexos
    PASTA_HISTORICA ||--o{ DOCUMENTO_DIGITAL : contem
    ARQUIVO ||--o| DOCUMENTO_DIGITAL : bytes
    PUBLICACAO ||--o{ PUBLICACAO_IMAGEM : imagens
    OCORRENCIA_DANO ||--o{ OCORRENCIA_DANO_IMAGEM : fotos
```

## Decisões de modelagem

- **Usuários**: `administrador` e `socio_leitor` são tabelas separadas (o diagrama usa a superclasse `Usuario`),
  porque os dados e o login diferem — administrador entra pelo usuário; sócio, por CPF ou e-mail.
  Senhas são guardadas como hash **bcrypt**, gerado pelo back-end (não SHA-256 como no protótipo).
- **Obra × exemplar**: `livro` é o título; `exemplar` é o item físico com UUID (RN20) e tombamento único.
  Exemplares baixados (desbaste/doação) recebem `baixa_data`/`baixa_motivo` e nunca são apagados, para manter o histórico.
- **Localização do exemplar**: `exemplar.localizacao` (`VARCHAR(80)`, opcional) diz onde a cópia fica, por exemplo
  "Estante 3, prateleira B". Quando é nula, vale a `secao` (A–Z) da obra. É informação interna da equipe: a visão
  `vw_consulta_publica` não a expõe.
- **Espaço Kids (US29)**: `mesa_estudo.espaco` separa as mesas de `estudo` e `kids`. A criança de até 11 anos não tem
  cadastro: quando o agendamento ou a entrada na fila é para ela, `crianca_nome`, `crianca_cpf` e `crianca_nascimento`
  ficam preenchidos, `socio_id` é o sócio responsável e a fila dessa entrada é a do Espaço Kids. A RN05 vale para cada
  criança, pelo CPF (`ux_agendamento_crianca_dia`). `socio_leitor.data_nascimento` confere os 12 anos da conta própria;
  é nula em cadastros migrados. Na anonimização do responsável, a data dele é apagada, o nome da criança vira um código
  e o CPF e o nascimento dela ficam nulos.
- **Confirmação de uso (US30)**: `agendamento.uso_confirmado_em` registra quando o funcionário confirmou que o espaço
  está em uso. Sem a confirmação em até 15 minutos do início do turno (ou do agendamento, se feito depois), o
  agendamento passa a `nao_compareceu` e a vaga vai para o primeiro da fila. Quando o uso de uma mesa Kids é confirmado,
  quem aguardava na fila daquele turno do Espaço Kids sai dela com o status `retirada`.
- **Arquivos**: imagens e PDFs ficam no **Amazon S3**; a tabela `arquivo` guarda só metadados e a chave do objeto
  (`chave_storage`, no formato `<pasta>/<uuid>.<extensão>`, com as pastas `mural`, `acervo`, `documentos`, `socios` e
  `danos`). Banco relacional não é bom lugar para binários grandes.
- **Listas do front-end viraram tabelas**: `autorIds` → `livro_autor` (com ordem — RN19), `historico` do empréstimo →
  `emprestimo_evento`, `pareceres` → `parecer_multa`, `tombamentos` → `movimentacao_exemplar`, `imagemIds` → tabelas de imagem.
- **Backups**: a tela de backups do protótipo é substituída pelos backups automáticos e snapshots do RDS.
- **Domínios** (status, categorias, turnos) usam `VARCHAR + CHECK` com os mesmos valores do `types.ts`,
  então o back-end pode trafegar os valores sem conversão.

### Regras garantidas pelo próprio banco

| Regra                                                  | Como                                                            |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| RN01 — até 3 itens (empréstimos + reservas)            | trigger `tg_validar_emprestimo` / `tg_validar_reserva`          |
| RN04 — raro, cordel e exemplar único não saem          | triggers acima                                                  |
| RN05 — um agendamento próprio por sócio por dia        | índice único parcial `ux_agendamento_socio_dia`                 |
| RN05 no Espaço Kids — um turno por dia por criança     | índice único parcial `ux_agendamento_crianca_dia` (pelo CPF)     |
| RN08 — multa em aberto ou atraso bloqueia              | função `fn_socio_bloqueado` nos triggers                        |
| RN17 — até 3 renovações                                | `CHECK (renovacoes BETWEEN 0 AND 3)`                            |
| RN22 — seção de A a Z                                  | `CHECK (secao ~ '^[A-Z]$')`                                     |
| RN26 — pessoa física recebe 1 doação                   | trigger `tg_validar_doacao`                                     |
| RN30 — mascarar status internos                        | visão `vw_consulta_publica`                                     |
| RN31 — desbaste só de ocioso/danificado, com relatório | `CHECK` em `desbaste`                                           |
| Um empréstimo/reserva ativo por exemplar               | índices únicos parciais                                         |
| Uma mesa por turno                                     | `ux_agendamento_mesa_turno`                                     |
| Aviso de e-mail enviado uma vez por prazo              | `UNIQUE (emprestimo_id, tipo, referencia)`                      |
| Status do exemplar acompanha a circulação              | triggers `tg_sincronizar_emprestimo` / `tg_sincronizar_reserva` |

Cálculos dependentes da data (multa de R$ 1,00/dia, expiração de reservas e da fila, envio de e-mails) continuam na
rotina diária do back-end; a visão `vw_situacao_socio` já entrega o débito corrente de cada sócio.

## Como criar no Amazon RDS

1. **Console AWS → RDS → Criar banco de dados**
   - Método: _Criação padrão_ · Mecanismo: **PostgreSQL 16**
   - Modelo: **Nível gratuito** (db.t3.micro / db.t4g.micro, 20 GB gp3)
   - Identificador: `culturatech-db` · usuário mestre: `postgres` · defina uma senha forte
   - Nome do banco inicial (em _Configuração adicional_): `culturatech`
   - Backups automáticos: manter ligado (7 dias)
2. **Conectividade**
   - Para testes da equipe: _Acesso público = Sim_ e, no **Security Group**, liberar a porta **5432** apenas para os
     IPs de vocês (`Meu IP`). Nunca libere `0.0.0.0/0`.
   - Em produção, o ideal é acesso público = Não, com só o back-end (na mesma VPC) acessando o banco.
3. Aguarde o status **Disponível** e copie o **endpoint** (ex.: `culturatech-db.xxxx.us-east-1.rds.amazonaws.com`).
4. **Execute os scripts** (pelo `psql`, DBeaver, pgAdmin ou Azure Data Studio com extensão PostgreSQL):

   ```bash
   psql "host=<endpoint> port=5432 dbname=culturatech user=postgres sslmode=require" -f 01_schema.sql
   psql "host=<endpoint> port=5432 dbname=culturatech user=postgres sslmode=require" -f 02_dados_exemplo.sql
   ```

   Se o banco já existia de antes, rode também os ajustes que faltarem: `03_ajuste_search_path.sql`,
   `04_localizacao_exemplar.sql`, `05_indice_mural.sql`, `06_data_nascimento.sql` e `07_mesas_espaco_kids.sql`, nessa
   ordem. Sem o `07`, o login pela API é recusado, porque as rotas de mesas não encontram as colunas novas.

5. **Crie um usuário próprio para a aplicação** (não use o `postgres` no back-end):

   ```sql
   CREATE ROLE app_culturatech LOGIN PASSWORD '<senha forte>';
   GRANT USAGE ON SCHEMA culturatech TO app_culturatech;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA culturatech TO app_culturatech;
   GRANT USAGE ON ALL SEQUENCES IN SCHEMA culturatech TO app_culturatech;
   ALTER ROLE app_culturatech SET search_path = culturatech, public;
   ```

6. Teste rápido:

   ```sql
   SET search_path TO culturatech;
   SELECT nome, bloqueado, total_multas, multa_corrente FROM vw_situacao_socio;
   ```

> ⚠️ Custos: fora do nível gratuito, uma instância parada ainda cobra armazenamento e o RDS religa sozinho após 7 dias
> parado. Apague a instância (ou crie um snapshot) quando terminar o semestre.

## Observação

O front-end (React) não acessa o banco diretamente — e não deve: navegador nunca conecta no RDS. Quem usa estas tabelas
é a API em [`server/`](../server/README.md), que cobre login e cadastro, acervo, circulação, sócios, repositório
digital, mural, mesas de estudo e parcerias. Notificações e backups ainda ficam no navegador; a tabela `notificacao`
existe aqui, mas ainda não tem rotas na API.
