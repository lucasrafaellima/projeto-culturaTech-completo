# API de login — CulturaTech

API em Node.js + Express que valida administradores e sócios-leitores cadastrados no PostgreSQL
(`database/01_schema.sql`). As senhas são conferidas contra o hash **bcrypt** da coluna `senha_hash`
(o mesmo formato gerado por `crypt(..., gen_salt('bf'))` nos dados de exemplo).

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
npm run testar-login     # 20 verificações de login e cadastro (API precisa estar rodando)
npm run tipos            # checagem de tipos
```

> O `testar-login` cria um sócio "Teste Automático da Silva" (CPF e e-mail aleatórios) a cada execução.
> Rode contra um banco de testes, ou apague esses registros depois.

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
| `200` | `{ ok, token, usuario: { id, nome, perfil, pendencias? }, mensagem }` |
| `400` | usuário ou senha vazios, JSON inválido |
| `401` | usuário ou senha incorretos (mesma mensagem nos dois casos) |
| `403` | senha correta, mas cadastro inativo |
| `429` | 5 tentativas erradas para o mesmo login e IP em 15 minutos |

`pendencias` (só para sócios) vem de `fn_socio_bloqueado`: `true` quando há multa em aberto ou devolução
atrasada, para o front exibir o alerta da RN11.

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

Aplica as mesmas validações do front (`validarSocio`): nome completo, CPF com dígito verificador, RG, telefone com DDD,
e-mail, endereço, CEP, senha de 6 a 72 caracteres sem espaço nas pontas e consentimento LGPD.
CPF, telefone e CEP são gravados só com dígitos; o e-mail, em minúsculas; `consentimento_lgpd` recebe a data do dia.

| Status | Quando |
|---|---|
| `201` | conta criada; mesmo formato da resposta do login (`token`, `usuario`), então o sócio já entra |
| `400` | algum campo inválido (a `mensagem` diz qual) |
| `409` | CPF ou e-mail já cadastrados |
| `429` | 5 cadastros (ou CPF/e-mail repetidos) a partir do mesmo IP em 15 minutos |

### `GET /api/auth/me`

Cabeçalho `Authorization: Bearer <token>`. Devolve `{ ok, usuario }` ou `401`.
Relê o usuário no banco, então um cadastro desativado perde o acesso mesmo com token válido.

### `GET /api/saude`

`200` se a API alcança o banco, `503` se não.

## Segurança

- Token **JWT** (HS256) assinado com `JWT_SECRET`, validade em `JWT_EXPIRA_EM` (padrão 8h).
- Usuário inexistente também passa pelo bcrypt, para o tempo de resposta não revelar quem está cadastrado.
- Senhas acima de 72 bytes são recusadas (limite do bcrypt).
- Consultas parametrizadas (`$1`), sem concatenar entrada do usuário no SQL.
- O limitador de tentativas fica em memória: reiniciar a API zera a contagem.
- `DB_SSL=require` cifra a conexão com o RDS, mas não confere o certificado. Para conferir, baixe o
  [bundle de CA da AWS](https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem) e use `DB_SSL=verify`
  com `DB_SSL_CA=./global-bundle.pem`.
