// ============================================================
// SHA-256 em JavaScript puro (síncrono). Usado para não guardar
// senhas em texto claro (RNF06). Funciona também fora de contexto
// seguro (acesso por IP na rede local), onde crypto.subtle não existe.
// ============================================================

function primos(qtd: number): number[] {
  const lista: number[] = []
  for (let n = 2; lista.length < qtd; n++) {
    if (lista.every((p) => n % p !== 0)) lista.push(n)
  }
  return lista
}

const fracao = (x: number) => ((x - Math.floor(x)) * 0x100000000) | 0

const P = primos(64)
const K = P.map((p) => fracao(Math.cbrt(p)))
const H0 = P.slice(0, 8).map((p) => fracao(Math.sqrt(p)))

const ror = (x: number, n: number) => (x >>> n) | (x << (32 - n))

export function sha256(mensagem: string): string {
  const bytes = new TextEncoder().encode(mensagem)
  const tamanho = bytes.length
  const bloco = new Uint8Array(((tamanho + 9 + 63) >> 6) << 6)
  bloco.set(bytes)
  bloco[tamanho] = 0x80
  const view = new DataView(bloco.buffer)
  const bits = tamanho * 8
  view.setUint32(bloco.length - 4, bits >>> 0)
  view.setUint32(bloco.length - 8, Math.floor(bits / 0x100000000))

  const h = H0.slice()
  const w = new Array<number>(64)
  for (let off = 0; off < bloco.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4) | 0
    for (let i = 16; i < 64; i++) {
      const s0 = ror(w[i - 15], 7) ^ ror(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = ror(w[i - 2], 17) ^ ror(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
    }
    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i++) {
      const S1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0
      const S0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0
      hh = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    h[0] = (h[0] + a) | 0
    h[1] = (h[1] + b) | 0
    h[2] = (h[2] + c) | 0
    h[3] = (h[3] + d) | 0
    h[4] = (h[4] + e) | 0
    h[5] = (h[5] + f) | 0
    h[6] = (h[6] + g) | 0
    h[7] = (h[7] + hh) | 0
  }
  return h.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("")
}

export function hashSenha(senha: string): string {
  return sha256(`culturatech:${senha}`)
}

export function conferirSenha(senha: string, hash: string): boolean {
  return hashSenha(senha) === hash
}
