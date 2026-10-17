import { useState } from "react"
import { Eye, EyeOff, UserPlus } from "lucide-react"
import { useStore, type DadosSocio } from "@/lib/store"
import { navegar, rotaInicialPorPerfil } from "@/lib/navigation"
import { Aviso, Button, Card, Campo, Input, useToast } from "@/components/ui"
import { formatCep, formatCpf, formatTelefone } from "@/lib/utils"

const formVazio = (): DadosSocio => ({
  nome: "",
  cpf: "",
  rg: "",
  telefone: "",
  email: "",
  endereco: { rua: "", numero: "", bairro: "", cep: "" },
  senha: "",
  consentimentoLgpd: false,
})

// Cadastro de usuário feito pelo próprio visitante (cria um sócio-leitor)
export function CadastroPage() {
  const { cadastrarConta, sessao } = useStore()
  const { notificar } = useToast()
  const [form, setForm] = useState<DadosSocio>(formVazio)
  const [confirmacao, setConfirmacao] = useState("")
  const [mostrar, setMostrar] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const set = <K extends keyof DadosSocio>(k: K, v: DadosSocio[K]) => {
    setForm({ ...form, [k]: v })
    setErro(null)
  }
  const setEnd = (k: keyof DadosSocio["endereco"], v: string) => {
    setForm({ ...form, endereco: { ...form.endereco, [k]: v } })
    setErro(null)
  }

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault()
    if (enviando) return
    if ((form.senha ?? "") !== confirmacao) {
      setErro("As senhas não conferem.")
      return
    }
    setEnviando(true)
    const r = await cadastrarConta(form)
    setEnviando(false)
    if (!r.ok) {
      setErro(r.mensagem)
      return
    }
    notificar(r.mensagem, true)
    navegar(rotaInicialPorPerfil.socio)
  }

  if (sessao.perfil !== "publico") return null

  return (
    <div className="mx-auto max-w-2xl py-4 md:py-8">
      <Card className="p-6">
        <form onSubmit={enviar} className="space-y-5" noValidate>
          <div>
            <h2 className="font-serif text-xl font-semibold">Criar conta</h2>
            <p className="mt-1 text-sm text-muted-foreground text-pretty">
              Cadastre-se como sócio-leitor da Biblioteca Municipal. Depois, entre com o seu CPF (ou e-mail) e a senha
              escolhida.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Nome completo" className="sm:col-span-2">
              {(id) => <Input id={id} autoComplete="name" value={form.nome} onChange={(e) => set("nome", e.target.value)} />}
            </Campo>
            <Campo rotulo="CPF">
              {(id) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  value={form.cpf}
                  onChange={(e) => set("cpf", formatCpf(e.target.value))}
                  placeholder="000.000.000-00"
                />
              )}
            </Campo>
            <Campo rotulo="RG">{(id) => <Input id={id} value={form.rg} onChange={(e) => set("rg", e.target.value)} />}</Campo>
            <Campo rotulo="Telefone">
              {(id) => (
                <Input
                  id={id}
                  inputMode="tel"
                  autoComplete="tel"
                  value={form.telefone}
                  onChange={(e) => set("telefone", formatTelefone(e.target.value))}
                  placeholder="(82) 99999-9999"
                />
              )}
            </Campo>
            <Campo rotulo="E-mail">
              {(id) => (
                <Input id={id} type="email" autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
              )}
            </Campo>
          </div>

          <fieldset className="grid gap-3 sm:grid-cols-[1fr_7rem]">
            <legend className="mb-1.5 text-sm font-medium">Endereço</legend>
            <Campo rotulo="Rua">{(id) => <Input id={id} value={form.endereco.rua} onChange={(e) => setEnd("rua", e.target.value)} />}</Campo>
            <Campo rotulo="Número">
              {(id) => <Input id={id} value={form.endereco.numero} onChange={(e) => setEnd("numero", e.target.value)} />}
            </Campo>
            <Campo rotulo="Bairro">
              {(id) => <Input id={id} value={form.endereco.bairro} onChange={(e) => setEnd("bairro", e.target.value)} />}
            </Campo>
            <Campo rotulo="CEP">
              {(id) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  value={form.endereco.cep}
                  onChange={(e) => setEnd("cep", formatCep(e.target.value))}
                  placeholder="57300-000"
                />
              )}
            </Campo>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Senha" dica="Mínimo de 6 caracteres.">
              {(id) => (
                <div className="relative">
                  <Input
                    id={id}
                    type={mostrar ? "text" : "password"}
                    autoComplete="new-password"
                    value={form.senha ?? ""}
                    onChange={(e) => set("senha", e.target.value)}
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
            <Campo rotulo="Confirmar senha">
              {(id) => (
                <Input
                  id={id}
                  type={mostrar ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmacao}
                  onChange={(e) => {
                    setConfirmacao(e.target.value)
                    setErro(null)
                  }}
                />
              )}
            </Campo>
          </div>

          <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
            <input
              type="checkbox"
              checked={form.consentimentoLgpd}
              onChange={(e) => set("consentimentoLgpd", e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
            />
            <span className="text-pretty">
              Autorizo o tratamento dos meus dados pessoais pela biblioteca, conforme a LGPD (RNF06). Os dados ficam
              visíveis apenas para a administração.
            </span>
          </label>

          {erro && <Aviso tipo="erro">{erro}</Aviso>}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Já tem conta?{" "}
              <button type="button" onClick={() => navegar("entrar")} className="font-medium text-primary underline">
                Entrar
              </button>
            </p>
            <Button type="submit" disabled={enviando}>
              <UserPlus className="h-4 w-4" /> {enviando ? "Criando conta..." : "Criar conta"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
