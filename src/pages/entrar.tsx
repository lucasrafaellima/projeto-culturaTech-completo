import { useState } from "react"
import { BookOpenText, Eye, EyeOff, LogIn, UserPlus } from "lucide-react"
import { useStore } from "@/lib/store"
import { navegar, rotaInicialPorPerfil } from "@/lib/navigation"
import { Aviso, Button, Card, Campo, Input, useToast } from "@/components/ui"

export function EntrarPage() {
  const { entrar, sessao } = useStore()
  const { notificar } = useToast()
  const [usuario, setUsuario] = useState("")
  const [senha, setSenha] = useState("")
  const [mostrar, setMostrar] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault()
    if (enviando) return
    setEnviando(true)
    const r = await entrar(usuario, senha)
    setEnviando(false)
    if (!r.ok) {
      setErro(r.mensagem)
      return
    }
    notificar(r.mensagem, true)
    navegar(rotaInicialPorPerfil[r.perfil ?? "publico"])
  }

  if (sessao.perfil !== "publico") return null

  return (
    <div className="mx-auto grid max-w-4xl gap-6 py-4 md:grid-cols-2 md:py-10">
      <div className="flex flex-col justify-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <BookOpenText className="h-6 w-6" />
        </div>
        <h2 className="font-serif text-2xl font-semibold text-balance">Acesse o CulturaTech</h2>
        <p className="text-sm text-muted-foreground text-pretty">
          Sócios-leitores entram com o CPF (ou e-mail) e a senha cadastrada no balcão da biblioteca. Funcionários
          entram com o usuário administrativo.
        </p>
        <p className="text-sm text-muted-foreground text-pretty">
          Não precisa de login para consultar o acervo, ver o mural e ler as digitalizações do repositório.
        </p>
        <Card className="space-y-2 bg-muted/40 p-4 text-sm">
          <p className="font-medium">Contas de demonstração</p>
          <ul className="space-y-1 text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Administrador:</span> admin / admin123
            </li>
            <li>
              <span className="font-medium text-foreground">Sócio com pendências:</span> 529.982.247-25 / 123456
            </li>
            <li>
              <span className="font-medium text-foreground">Sócio regular:</span> 153.509.460-56 / 123456
            </li>
            <li>
              <span className="font-medium text-foreground">Multa em análise:</span> 714.602.380-01 / 123456
            </li>
          </ul>
        </Card>
      </div>

      <Card className="p-6">
        <form onSubmit={enviar} className="space-y-4" noValidate>
          <h3 className="font-serif text-lg font-semibold">Entrar</h3>
          <Campo rotulo="CPF, e-mail ou usuário">
            {(id) => (
              <Input
                id={id}
                autoComplete="username"
                value={usuario}
                onChange={(e) => {
                  setUsuario(e.target.value)
                  setErro(null)
                }}
                placeholder="000.000.000-00"
              />
            )}
          </Campo>
          <Campo rotulo="Senha">
            {(id) => (
              <div className="relative">
                <Input
                  id={id}
                  type={mostrar ? "text" : "password"}
                  autoComplete="current-password"
                  value={senha}
                  onChange={(e) => {
                    setSenha(e.target.value)
                    setErro(null)
                  }}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setMostrar(!mostrar)}
                  aria-label={mostrar ? "Ocultar senha" : "Mostrar senha"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  {mostrar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            )}
          </Campo>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <Button type="submit" className="w-full" disabled={enviando}>
            <LogIn className="h-4 w-4" />
            {enviando ? "Entrando..." : "Entrar"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Esqueceu a senha? Procure o balcão de atendimento para redefini-la.
          </p>
          <div className="border-t border-border pt-4 text-center">
            <p className="mb-2 text-sm text-muted-foreground">Ainda não tem conta?</p>
            <Button variante="outline" className="w-full" onClick={() => navegar("cadastro")}>
              <UserPlus className="h-4 w-4" />
              Criar conta
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
