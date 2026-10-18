import express, { type NextFunction, type Request, type Response } from "express"
import { config } from "./config.ts"
import { pool } from "./db.ts"
import { autenticar, usuarioDoToken } from "./auth.ts"
import { cadastrarSocio } from "./cadastro.ts"
import { rotasAcervo } from "./acervo.ts"
import { rotasArquivos } from "./arquivos.ts"
import { rotasRepositorio } from "./repositorio.ts"
import { rotasCirculacao } from "./circulacao.ts"
import { rotasSocios } from "./socios.ts"
import { rotasMural } from "./mural.ts"
import { limparFalhas, registrarFalha, segundosBloqueado } from "./limitador.ts"

const app = express()
app.disable("x-powered-by")
// Corpo pequeno por padrão; a importação em lote de obras tem o próprio limite
// (aplicado na rota, depois de conferir que é administrador)
const jsonPadrao = express.json({ limit: "10kb" })
app.use((req, res, next) => (req.path === "/api/livros/importar" ? next() : jsonPadrao(req, res, next)))

// Verifica se a API alcança o banco
app.get("/api/saude", async (_req, res) => {
  try {
    await pool.query("SELECT 1")
    res.json({ ok: true, banco: "conectado" })
  } catch (erro) {
    console.error("Banco indisponível:", (erro as Error).message)
    res.status(503).json({ ok: false, banco: "indisponível" })
  }
})

// POST /api/auth/login  { "usuario": "admin" | CPF | e-mail, "senha": "..." }
app.post("/api/auth/login", async (req, res) => {
  const { usuario, senha } = req.body ?? {}
  const ip = req.ip ?? "desconhecido"
  const login = typeof usuario === "string" ? usuario : ""

  const espera = segundosBloqueado(ip, login)
  if (espera > 0) {
    res.set("Retry-After", String(espera))
    res.status(429).json({
      ok: false,
      mensagem: `Muitas tentativas. Tente de novo em ${Math.ceil(espera / 60)} minuto(s).`,
    })
    return
  }

  const r = await autenticar(usuario, senha)
  if (!r.ok) {
    if (r.status === 401) registrarFalha(ip, login)
    res.status(r.status).json({ ok: false, mensagem: r.mensagem })
    return
  }
  limparFalhas(ip, login)
  res.json(r)
})

// POST /api/auth/cadastro  (mesmos campos de DadosSocio no front-end)
// Conta cadastros e CPFs/e-mails repetidos por IP no mesmo limitador do login,
// para frear contas em massa e a sondagem de quais CPFs estão cadastrados
app.post("/api/auth/cadastro", async (req, res) => {
  const ip = req.ip ?? "desconhecido"
  const espera = segundosBloqueado(ip, "#cadastro")
  if (espera > 0) {
    res.set("Retry-After", String(espera))
    res.status(429).json({
      ok: false,
      mensagem: `Muitos cadastros a partir desta rede. Tente de novo em ${Math.ceil(espera / 60)} minuto(s).`,
    })
    return
  }

  const r = await cadastrarSocio(req.body)
  if (!r.ok) {
    if (r.status === 409) registrarFalha(ip, "#cadastro")
    res.status(r.status).json({ ok: false, mensagem: r.mensagem })
    return
  }
  registrarFalha(ip, "#cadastro")
  res.status(201).json(r)
})

// GET /api/auth/me  (cabeçalho Authorization: Bearer <token>)
app.get("/api/auth/me", async (req, res) => {
  const [tipo, token] = (req.headers.authorization ?? "").split(" ")
  const usuario = tipo === "Bearer" && token ? await usuarioDoToken(token) : null
  if (!usuario) {
    res.status(401).json({ ok: false, mensagem: "Sessão inválida ou expirada. Entre novamente." })
    return
  }
  res.json({ ok: true, usuario })
})

// Acervo: livros, exemplares e desbaste (só administradores) e a consulta pública
app.use("/api", rotasAcervo)
// Arquivos (S3 ou disco), repositório digital, circulação e sócios
app.use("/api", rotasArquivos)
app.use("/api", rotasRepositorio)
app.use("/api", rotasCirculacao)
app.use("/api", rotasSocios)
app.use("/api", rotasMural)

app.use("/api", (_req, res) => {
  res.status(404).json({ ok: false, mensagem: "Rota não encontrada." })
})

// JSON malformado ou erro inesperado (ex.: banco fora do ar)
app.use((erro: Error & { type?: string }, _req: Request, res: Response, _next: NextFunction) => {
  if (erro.type === "entity.parse.failed") {
    res.status(400).json({ ok: false, mensagem: "Corpo da requisição inválido." })
    return
  }
  if (erro.type === "entity.too.large") {
    res.status(413).json({ ok: false, mensagem: "Corpo da requisição grande demais." })
    return
  }
  console.error(erro)
  res.status(500).json({ ok: false, mensagem: "Erro interno. Tente novamente em instantes." })
})

app.listen(config.porta, () => {
  console.log(`API CulturaTech em http://localhost:${config.porta}`)
})
