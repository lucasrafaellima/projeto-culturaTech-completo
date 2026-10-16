// Limita tentativas por IP + chave: logins errados (chave = login digitado,
// contra força bruta) e cadastros (chave "#cadastro"). Fica em memória:
// reiniciar o servidor zera a contagem.
const MAX_FALHAS = 5
const JANELA_MS = 15 * 60 * 1000

const falhas = new Map<string, { quantidade: number; expiraEm: number }>()

const chave = (ip: string, login: string) => `${ip}|${login.trim().toLowerCase()}`

export function segundosBloqueado(ip: string, login: string): number {
  const item = falhas.get(chave(ip, login))
  if (!item || item.expiraEm <= Date.now()) return 0
  return item.quantidade >= MAX_FALHAS ? Math.ceil((item.expiraEm - Date.now()) / 1000) : 0
}

export function registrarFalha(ip: string, login: string) {
  const k = chave(ip, login)
  const item = falhas.get(k)
  if (!item || item.expiraEm <= Date.now()) {
    falhas.set(k, { quantidade: 1, expiraEm: Date.now() + JANELA_MS })
  } else {
    item.quantidade++
  }
}

export function limparFalhas(ip: string, login: string) {
  falhas.delete(chave(ip, login))
}

// remove entradas vencidas de tempos em tempos
setInterval(() => {
  const agora = Date.now()
  for (const [k, item] of falhas) if (item.expiraEm <= agora) falhas.delete(k)
}, JANELA_MS).unref()
