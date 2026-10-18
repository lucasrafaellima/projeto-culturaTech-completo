import bcrypt from "bcryptjs"
import { Router, type NextFunction, type Request, type Response } from "express"
import pg from "pg"
import { pool } from "./db.ts"
import { exigirAdmin } from "./auth.ts"
import { apagarArquivosDoBanco, apagarObjeto } from "./arquivos.ts"
import { validarDadosSocio, validarSenha, type DadosCadastro } from "./cadastro.ts"
import { ErroRegra, UUID, corpoDe, emTransacao, idDe, texto, tratarErroDeRegra } from "./comum.ts"

// Cadastro de sócios-leitores pelo administrador (RF02 / RN29 / RNF06).
// Mesmas regras e mensagens de salvarSocio, alternarAtivoSocio,
// redefinirSenhaSocio e anonimizarSocio (src/lib/store.tsx).

type Consulta = pg.PoolClient | pg.Pool

// Formato de SocioLeitor (src/lib/types.ts); a senha nunca sai do banco
export async function listarSocios(c: Consulta, filtro = "TRUE", valores: unknown[] = []) {
  const { rows } = await c.query(
    `SELECT s.id, s.nome, s.cpf, s.rg, s.telefone, s.email, s.foto_arquivo_id,
            s.endereco_rua, s.endereco_numero, s.endereco_bairro, s.endereco_cep, s.ativo, s.anonimizado,
            to_char(s.data_cadastro, 'YYYY-MM-DD') AS data_cadastro,
            to_char(s.consentimento_lgpd, 'YYYY-MM-DD') AS consentimento_lgpd
       FROM socio_leitor s WHERE ${filtro}
      ORDER BY lower(s.nome)`,
    valores,
  )
  return rows.map((s) => ({
    id: s.id,
    nome: s.nome,
    cpf: s.cpf ?? "",
    rg: s.rg ?? "",
    telefone: s.telefone ?? "",
    email: s.email ?? "",
    ...(s.foto_arquivo_id ? { fotoId: s.foto_arquivo_id } : {}),
    endereco: {
      rua: s.endereco_rua ?? "",
      numero: s.endereco_numero ?? "",
      bairro: s.endereco_bairro ?? "",
      cep: s.endereco_cep ?? "",
    },
    senha: "",
    ativo: s.ativo,
    dataCadastro: s.data_cadastro,
    consentimentoLgpd: s.consentimento_lgpd ?? "",
    ...(s.anonimizado ? { anonimizado: true } : {}),
  }))
}

const umSocio = async (c: Consulta, id: string) => (await listarSocios(c, "s.id = $1", [id]))[0]

function dadosDe(corpo: Record<string, unknown>, exigirSenha: boolean): DadosCadastro {
  const r = validarDadosSocio(corpo, { exigirSenha })
  if ("erro" in r) {
    // mesma mensagem do formulário do administrador
    const mensagem = exigirSenha && r.erro === "A senha deve ter ao menos 6 caracteres."
      ? "A senha inicial deve ter ao menos 6 caracteres."
      : r.erro
    throw new ErroRegra(400, mensagem)
  }
  return r.dados
}

// A foto 3x4 é um arquivo de imagem já enviado por POST /api/arquivos e ainda livre
async function conferirFoto(c: pg.PoolClient, fotoId: string | null, socioId: string | null) {
  if (!fotoId) return
  if (!UUID.test(fotoId)) throw new ErroRegra(400, "Foto inválida. Envie a imagem novamente.")
  const { rows } = await c.query<{ livre: boolean }>(
    `SELECT NOT (EXISTS (SELECT 1 FROM documento_digital WHERE arquivo_id = a.id)
              OR EXISTS (SELECT 1 FROM socio_leitor WHERE foto_arquivo_id = a.id AND id IS DISTINCT FROM $2::uuid)
              OR EXISTS (SELECT 1 FROM ocorrencia_dano_imagem WHERE arquivo_id = a.id)
              OR EXISTS (SELECT 1 FROM publicacao_imagem WHERE arquivo_id = a.id)) AS livre
       FROM arquivo a
      WHERE a.id = $1 AND a.mime LIKE 'image/%'
        -- foto nova vem da pasta "socios/"; a que o sócio já tem continua valendo
        AND (a.chave_storage LIKE 'socios/%'
             OR EXISTS (SELECT 1 FROM socio_leitor WHERE foto_arquivo_id = a.id AND id = $2::uuid))`,
    [fotoId, socioId],
  )
  if (!rows[0]?.livre) throw new ErroRegra(400, "Foto inválida. Envie a imagem novamente.")
}

// Apaga a foto antiga que ficou sem uso; devolve a chave do objeto a apagar
async function apagarFotoAntiga(c: pg.PoolClient, fotoId: string | null): Promise<string | null> {
  if (!fotoId) return null
  return (await apagarArquivosDoBanco(c, [fotoId]))[0] ?? null
}

export const rotasSocios = Router()
rotasSocios.use("/socios", exigirAdmin)

// POST /api/socios  (campos de DadosSocio + "senha" inicial + "fotoId"?)
rotasSocios.post("/socios", async (req, res) => {
  const corpo = corpoDe(req)
  const d = dadosDe(corpo, true)
  const fotoId = texto(corpo.fotoId) || null
  const senhaHash = await bcrypt.hash(d.senha, 10)
  const socio = await emTransacao(async (c) => {
    await conferirFoto(c, fotoId, null)
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO socio_leitor (nome, cpf, rg, telefone, email, foto_arquivo_id, endereco_rua, endereco_numero,
                                 endereco_bairro, endereco_cep, senha_hash, consentimento_lgpd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_DATE) RETURNING id`,
      [d.nome, d.cpf, d.rg || null, d.telefone, d.email, fotoId, d.rua, d.numero, d.bairro, d.cep, senhaHash],
    )
    return umSocio(c, rows[0].id)
  })
  res.status(201).json({ ok: true, mensagem: "Sócio-leitor cadastrado.", socio })
})

// PUT /api/socios/:id  (a senha não muda aqui: use /senha)
rotasSocios.put("/socios/:id", async (req, res) => {
  const id = idDe(req, "Sócio-leitor não encontrado.")
  const corpo = corpoDe(req)
  const d = dadosDe(corpo, false)
  const fotoId = texto(corpo.fotoId) || null
  const r = await emTransacao(async (c) => {
    const atual = (
      await c.query<{ foto_arquivo_id: string | null; anonimizado: boolean }>(
        "SELECT foto_arquivo_id, anonimizado FROM socio_leitor WHERE id = $1 FOR UPDATE",
        [id],
      )
    ).rows[0]
    if (!atual) throw new ErroRegra(404, "Sócio-leitor não encontrado.")
    if (atual.anonimizado) throw new ErroRegra(409, "Cadastro anonimizado não pode ser alterado.")
    await conferirFoto(c, fotoId, id)
    await c.query(
      `UPDATE socio_leitor
          SET nome = $2, cpf = $3, rg = $4, telefone = $5, email = $6, foto_arquivo_id = $7, endereco_rua = $8,
              endereco_numero = $9, endereco_bairro = $10, endereco_cep = $11,
              consentimento_lgpd = COALESCE(consentimento_lgpd, CURRENT_DATE)
        WHERE id = $1`,
      [id, d.nome, d.cpf, d.rg || null, d.telefone, d.email, fotoId, d.rua, d.numero, d.bairro, d.cep],
    )
    const fotoApagada = atual.foto_arquivo_id !== fotoId ? await apagarFotoAntiga(c, atual.foto_arquivo_id) : null
    return { fotoApagada, socio: await umSocio(c, id) }
  })
  if (r.fotoApagada) await apagarObjeto(r.fotoApagada)
  res.json({ ok: true, mensagem: "Cadastro atualizado.", socio: r.socio })
})

// POST /api/socios/:id/ativo  (alterna ativo/inativo)
rotasSocios.post("/socios/:id/ativo", async (req, res) => {
  const id = idDe(req, "Sócio-leitor não encontrado.")
  const r = await emTransacao(async (c) => {
    const s = (
      await c.query<{ ativo: boolean; anonimizado: boolean }>(
        "SELECT ativo, anonimizado FROM socio_leitor WHERE id = $1 FOR UPDATE",
        [id],
      )
    ).rows[0]
    if (!s) throw new ErroRegra(404, "Sócio-leitor não encontrado.")
    if (s.anonimizado) throw new ErroRegra(409, "Cadastro anonimizado não pode ser reativado.")
    if (s.ativo) {
      const ativos = await c.query("SELECT 1 FROM emprestimo WHERE socio_id = $1 AND status = 'ativo' LIMIT 1", [id])
      if (ativos.rowCount) {
        throw new ErroRegra(409, "O sócio-leitor tem empréstimos em andamento. Registre as devoluções antes de inativar.")
      }
    }
    await c.query("UPDATE socio_leitor SET ativo = NOT ativo WHERE id = $1", [id])
    return { estavaAtivo: s.ativo, socio: await umSocio(c, id) }
  })
  res.json({ ok: true, mensagem: r.estavaAtivo ? "Sócio-leitor inativado." : "Sócio-leitor reativado.", socio: r.socio })
})

// POST /api/socios/:id/senha  { "senha": "..." }
rotasSocios.post("/socios/:id/senha", async (req, res) => {
  const id = idDe(req, "Sócio-leitor não encontrado.")
  const senha = typeof corpoDe(req).senha === "string" ? (corpoDe(req).senha as string) : ""
  const erro = validarSenha(senha)
  if (erro) throw new ErroRegra(400, erro)
  const hash = await bcrypt.hash(senha, 10)
  const r = await pool.query("UPDATE socio_leitor SET senha_hash = $2 WHERE id = $1 AND NOT anonimizado", [id, hash])
  if (r.rowCount === 0) throw new ErroRegra(404, "Sócio-leitor não encontrado.")
  res.json({ ok: true, mensagem: "Senha redefinida. Informe a nova senha ao sócio-leitor." })
})

// POST /api/socios/:id/anonimizar  (RNF06 / LGPD: eliminação dos dados pessoais)
rotasSocios.post("/socios/:id/anonimizar", async (req, res) => {
  const id = idDe(req, "Sócio-leitor não encontrado.")
  const r = await emTransacao(async (c) => {
    const s = (
      await c.query<{ foto_arquivo_id: string | null }>("SELECT foto_arquivo_id FROM socio_leitor WHERE id = $1 FOR UPDATE", [id])
    ).rows[0]
    if (!s) throw new ErroRegra(404, "Sócio-leitor não encontrado.")
    const { rows } = await c.query<{ pendente: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM emprestimo WHERE socio_id = $1 AND status = 'ativo')
           OR EXISTS (SELECT 1 FROM multa WHERE socio_id = $1 AND status IN ('pendente', 'em_analise')) AS pendente`,
      [id],
    )
    if (rows[0].pendente) throw new ErroRegra(409, "Não é possível anonimizar: há empréstimos ou multas em aberto.")
    await c.query(
      `UPDATE socio_leitor
          SET nome = 'Titular anonimizado ' || upper(left(id::text, 4)), cpf = NULL, rg = NULL, telefone = NULL,
              email = NULL, foto_arquivo_id = NULL, endereco_rua = NULL, endereco_numero = NULL,
              endereco_bairro = NULL, endereco_cep = NULL, senha_hash = NULL, ativo = FALSE, anonimizado = TRUE
        WHERE id = $1`,
      [id],
    )
    await c.query("UPDATE reserva SET status = 'cancelada' WHERE socio_id = $1 AND status = 'ativa'", [id])
    await c.query("UPDATE fila_espera SET status = 'desistiu' WHERE socio_id = $1 AND status = 'aguardando'", [id])
    return { fotoApagada: await apagarFotoAntiga(c, s.foto_arquivo_id), socio: await umSocio(c, id) }
  })
  if (r.fotoApagada) await apagarObjeto(r.fotoApagada)
  res.json({
    ok: true,
    mensagem: "Dados pessoais eliminados. O histórico de circulação foi mantido sem identificação.",
    socio: r.socio,
  })
})

rotasSocios.use((erro: unknown, req: Request, res: Response, next: NextFunction) => {
  // CPF ou e-mail já cadastrados
  if (erro instanceof pg.DatabaseError && erro.code === "23505") {
    const mensagem =
      erro.constraint === "ux_socio_email"
        ? "Este e-mail já está em uso por outro sócio-leitor."
        : "Já existe um sócio-leitor com este CPF."
    res.status(409).json({ ok: false, mensagem })
    return
  }
  tratarErroDeRegra(erro, req, res, next)
})
