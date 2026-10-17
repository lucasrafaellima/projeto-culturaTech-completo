// Testa a API de login com as contas de demonstração de database/02_dados_exemplo.sql.
// Uso: com a API rodando (npm run dev), execute npm run testar-login
const BASE = process.env.API_URL ?? "http://localhost:3333"

let falhas = 0
function conferir(descricao: string, condicao: boolean, detalhe?: unknown) {
  console.log(`${condicao ? "ok  " : "FALHOU"}  ${descricao}`)
  if (!condicao) {
    falhas++
    if (detalhe !== undefined) console.log("        ", detalhe)
  }
}

async function login(usuario: unknown, senha: unknown) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario, senha }),
  })
  return { status: r.status, corpo: await r.json() }
}

const saude = await fetch(`${BASE}/api/saude`).then((r) => r.json())
conferir("API conectada ao banco", saude.ok === true, saude)

const admin = await login("ADMIN", "admin123")
conferir("administrador entra (usuário sem diferenciar maiúsculas)", admin.status === 200, admin.corpo)
conferir("perfil do administrador é admin", admin.corpo.usuario?.perfil === "admin")

const maria = await login("529.982.247-25", "123456")
conferir("sócio entra por CPF com máscara", maria.status === 200, maria.corpo)
conferir("sócio com multa/atraso vem com pendencias = true", maria.corpo.usuario?.pendencias === true)

const joao = await login("15350946056", "123456")
conferir("sócio entra por CPF só com dígitos", joao.status === 200, joao.corpo)

const ana = await login("Ana.Beatriz@example.com", "123456")
conferir("sócio entra por e-mail", ana.status === 200, ana.corpo)

const errada = await login("admin", "senha-errada")
conferir("senha errada é recusada com 401", errada.status === 401, errada.corpo)

const inexistente = await login("ninguem@example.com", "123456")
conferir("usuário inexistente recebe a mesma mensagem", inexistente.corpo.mensagem === errada.corpo.mensagem)

const vazio = await login("", "")
conferir("campos vazios retornam 400", vazio.status === 400, vazio.corpo)

const me = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${joao.corpo.token}` } })
const meCorpo = await me.json()
conferir("token válido devolve o usuário em /me", me.status === 200 && meCorpo.usuario?.nome === "João Pedro Santos", meCorpo)

const meFalso = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: "Bearer token.falso.qualquer" } })
conferir("token adulterado é recusado em /me", meFalso.status === 401)

// ---------- cadastro ----------
// Atenção: cria um sócio de verdade no banco (CPF e e-mail aleatórios)
function cpfAleatorio(): string {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10))
  const dv = (nums: number[]) => {
    const soma = nums.reduce((acc, n, i) => acc + n * (nums.length + 1 - i), 0)
    const resto = (soma * 10) % 11
    return resto === 10 ? 0 : resto
  }
  base.push(dv(base))
  base.push(dv(base))
  return base.join("")
}

async function cadastrar(dados: Record<string, unknown>) {
  const r = await fetch(`${BASE}/api/auth/cadastro`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dados),
  })
  return { status: r.status, corpo: await r.json() }
}

const cpf = cpfAleatorio()
const email = `teste.${cpf}@example.com`
const novo = {
  nome: "Teste Automático da Silva",
  cpf: `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`,
  rg: "9999999",
  telefone: "(82) 99999-0000",
  email,
  endereco: { rua: "Rua de Teste", numero: "1", bairro: "Centro", cep: "57300-000" },
  senha: "senha-teste",
  consentimentoLgpd: true,
}

const criado = await cadastrar(novo)
conferir("cadastro válido retorna 201 com token", criado.status === 201 && typeof criado.corpo.token === "string", criado.corpo)
conferir("novo sócio vem com perfil socio e sem pendências", criado.corpo.usuario?.perfil === "socio" && criado.corpo.usuario?.pendencias === false)
conferir("cadastro devolve os dados gravados (CPF só com dígitos)", criado.corpo.cadastro?.cpf === cpf && criado.corpo.cadastro?.endereco?.cep === "57300000", criado.corpo.cadastro)

const entraNovo = await login(cpf, "senha-teste")
conferir("novo sócio consegue entrar pelo CPF", entraNovo.status === 200, entraNovo.corpo)

const cpfRepetido = await cadastrar({ ...novo, email: `outro.${cpf}@example.com` })
conferir("CPF repetido retorna 409", cpfRepetido.status === 409 && /CPF/.test(cpfRepetido.corpo.mensagem), cpfRepetido.corpo)

const emailRepetido = await cadastrar({ ...novo, cpf: cpfAleatorio(), email: email.toUpperCase() })
conferir("e-mail repetido (outra caixa) retorna 409", emailRepetido.status === 409 && /e-mail/.test(emailRepetido.corpo.mensagem), emailRepetido.corpo)

const cpfInvalido = await cadastrar({ ...novo, cpf: "123.456.789-00" })
conferir("CPF inválido retorna 400", cpfInvalido.status === 400 && cpfInvalido.corpo.mensagem === "CPF inválido.", cpfInvalido.corpo)

const semConsentimento = await cadastrar({ ...novo, cpf: cpfAleatorio(), consentimentoLgpd: false })
conferir("sem consentimento LGPD retorna 400", semConsentimento.status === 400 && /LGPD/.test(semConsentimento.corpo.mensagem), semConsentimento.corpo)

const senhaCurta = await cadastrar({ ...novo, cpf: cpfAleatorio(), senha: "123" })
conferir("senha curta retorna 400", senhaCurta.status === 400, senhaCurta.corpo)

console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : "\nTodas as verificações passaram.")
process.exit(falhas ? 1 : 0)
