import pg from "pg"
import { config } from "./config.ts"

// Host, porta, banco, usuário e senha vêm das variáveis PG* do ambiente
export const pool = new pg.Pool({
  ssl: config.ssl,
  max: 10,
  connectionTimeoutMillis: 10_000,
  // as tabelas ficam no schema culturatech; pgcrypto fica em public
  options: "-c search_path=culturatech,public",
})

pool.on("error", (erro) => {
  console.error("Erro inesperado numa conexão ociosa do banco:", erro.message)
})
