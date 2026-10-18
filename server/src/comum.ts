import type { NextFunction, Request, Response } from "express"
import pg from "pg"
import { pool } from "./db.ts"

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Erro de regra de negócio: vira { ok: false, mensagem } com o status informado
export class ErroRegra extends Error {
  status: number
  constructor(status: number, mensagem: string) {
    super(mensagem)
    this.status = status
  }
}

export const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "")

export const corpoDe = (req: Request) =>
  (typeof req.body === "object" && req.body !== null && !Buffer.isBuffer(req.body) ? req.body : {}) as Record<
    string,
    unknown
  >

export function idDe(req: Request, mensagem: string, param = "id"): string {
  const id = String(req.params[param] ?? "")
  if (!UUID.test(id)) throw new ErroRegra(404, mensagem)
  return id
}

export async function emTransacao<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query("BEGIN")
    const r = await fn(c)
    await c.query("COMMIT")
    return r
  } catch (erro) {
    await c.query("ROLLBACK")
    throw erro
  } finally {
    c.release()
  }
}

// Erros de regra viram { ok: false, mensagem }; as mensagens dos triggers
// (RAISE EXCEPTION, código P0001) já são frases para o usuário e viram 409.
// Os demais erros seguem para o tratador geral (500).
export function tratarErroDeRegra(erro: unknown, _req: Request, res: Response, next: NextFunction) {
  if (erro instanceof ErroRegra) {
    res.status(erro.status).json({ ok: false, mensagem: erro.message })
    return
  }
  if (erro instanceof pg.DatabaseError && erro.code === "P0001") {
    res.status(409).json({ ok: false, mensagem: erro.message })
    return
  }
  next(erro)
}
