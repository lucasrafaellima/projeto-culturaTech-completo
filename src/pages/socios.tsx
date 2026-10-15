import { useEffect, useMemo, useState } from "react"
import {
  Users,
  UserPlus,
  Ban,
  CheckCircle2,
  AlertTriangle,
  Search,
  Pencil,
  History,
  KeyRound,
  ShieldOff,
  UserRound,
  BookMarked,
} from "lucide-react"
import { useStore, type DadosSocio } from "@/lib/store"
import {
  Aviso,
  Badge,
  Button,
  Campo,
  Card,
  CardHeader,
  Confirmar,
  Input,
  Modal,
  Rodape,
  Vazio,
  useAcao,
} from "@/components/ui"
import { ImagemArmazenada, SeletorImagens } from "@/components/arquivos"
import { TabelaHistorico, BadgeReserva } from "@/components/historico"
import { BadgeMulta, descricaoMulta } from "@/components/multas"
import { MAX_EXEMPLARES_SIMULTANEOS } from "@/lib/constants"
import { navegar } from "@/lib/navigation"
import {
  formatCep,
  formatCpf,
  formatCurrency,
  formatDate,
  formatTelefone,
  mascararCpf,
  normalizar,
  somenteDigitos,
} from "@/lib/utils"
import type { SocioLeitor } from "@/lib/types"

const formVazio = (): DadosSocio => ({
  nome: "",
  cpf: "",
  rg: "",
  telefone: "",
  email: "",
  endereco: { rua: "", numero: "", bairro: "", cep: "" },
  fotoId: undefined,
  senha: "",
  consentimentoLgpd: false,
})

export function SociosPage({ socioInicial }: { socioInicial: string | null }) {
  const store = useStore()
  const { socios, emprestimos, getSocio, debitos, socioBloqueado } = store
  const executar = useAcao()

  const [busca, setBusca] = useState("")
  const [filtro, setFiltro] = useState<"todos" | "regular" | "bloqueado" | "inativo">("todos")
  const [editando, setEditando] = useState<{ id?: string; form: DadosSocio } | null>(null)
  const [detalheId, setDetalheId] = useState<string | null>(socioInicial)
  const [senha, setSenha] = useState<{ socio: SocioLeitor; nova: string } | null>(null)
  const [anonimizando, setAnonimizando] = useState<SocioLeitor | null>(null)

  useEffect(() => setDetalheId(socioInicial), [socioInicial])

  const lista = useMemo(() => {
    const t = normalizar(busca)
    const tDig = somenteDigitos(busca)
    return socios
      .filter((s) => {
        const casa =
          !t || normalizar(`${s.nome} ${s.email}`).includes(t) || (tDig.length >= 3 && s.cpf.includes(tDig))
        const situacao = !s.ativo ? "inativo" : socioBloqueado(s.id) ? "bloqueado" : "regular"
        return casa && (filtro === "todos" || filtro === situacao)
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socios, emprestimos, busca, filtro, store.multas])

  function editar(s: SocioLeitor) {
    setEditando({
      id: s.id,
      form: {
        nome: s.nome,
        cpf: formatCpf(s.cpf),
        rg: s.rg,
        telefone: formatTelefone(s.telefone),
        email: s.email,
        endereco: { ...s.endereco, cep: formatCep(s.endereco.cep) },
        fotoId: s.fotoId,
        consentimentoLgpd: !!s.consentimentoLgpd,
      },
    })
  }

  const detalhe = detalheId ? getSocio(detalheId) : undefined

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{socios.filter((s) => !s.anonimizado).length} sócios-leitores cadastrados</p>
        <Button onClick={() => setEditando({ form: formVazio() })}>
          <UserPlus className="h-4 w-4" /> Novo sócio-leitor
        </Button>
      </div>

      <Card className="grid gap-3 p-4 md:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            aria-label="Buscar sócio-leitor"
            placeholder="Nome, e-mail ou CPF..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-muted/50 p-1">
          {(["todos", "regular", "bloqueado", "inativo"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              className={`rounded-md px-3 py-1 text-sm capitalize ${filtro === f ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}
            >
              {f === "todos" ? "Todos" : f === "regular" ? "Regulares" : f === "bloqueado" ? "Bloqueados" : "Inativos"}
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="p-4 font-medium">Sócio-leitor</th>
                <th className="p-4 font-medium">CPF</th>
                <th className="p-4 font-medium">Empréstimos</th>
                <th className="p-4 font-medium">Débitos</th>
                <th className="p-4 font-medium">Situação</th>
                <th className="p-4 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lista.map((s) => {
                const ativos = emprestimos.filter((e) => e.socioId === s.id && e.status === "ativo").length
                const d = debitos(s.id)
                const bloqueado = socioBloqueado(s.id)
                return (
                  <tr key={s.id}>
                    <td className="p-4">
                      <button className="flex items-center gap-3 text-left" onClick={() => setDetalheId(s.id)}>
                        <ImagemArmazenada
                          id={s.fotoId}
                          alt=""
                          className="h-9 w-9 rounded-full"
                          fallback={
                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                              <Users className="h-4 w-4" />
                            </div>
                          }
                        />
                        <div>
                          <p className="font-medium hover:underline">{s.nome}</p>
                          <p className="text-xs text-muted-foreground">{s.email || "sem e-mail"}</p>
                        </div>
                      </button>
                    </td>
                    <td className="p-4 font-mono text-xs">{s.cpf ? mascararCpf(s.cpf) : "-"}</td>
                    <td className="p-4">
                      {ativos} / {MAX_EXEMPLARES_SIMULTANEOS}
                    </td>
                    <td className="p-4">
                      {d.totalMultas + d.totalCorrente > 0 ? (
                        <span className="text-danger">{formatCurrency(d.totalMultas + d.totalCorrente)}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="p-4">
                      {s.anonimizado ? (
                        <Badge className="bg-muted text-muted-foreground">Anonimizado</Badge>
                      ) : !s.ativo ? (
                        <Badge className="bg-muted text-muted-foreground">Inativo</Badge>
                      ) : bloqueado ? (
                        <Badge className="bg-danger/15 text-danger">
                          <AlertTriangle className="h-3 w-3" /> Bloqueado
                        </Badge>
                      ) : (
                        <Badge className="bg-success/15 text-success">
                          <CheckCircle2 className="h-3 w-3" /> Regular
                        </Badge>
                      )}
                    </td>
                    <td className="p-4">
                      <div className="flex justify-end gap-1">
                        <Button variante="ghost" tamanho="sm" onClick={() => setDetalheId(s.id)}>
                          <History className="h-4 w-4" /> Histórico
                        </Button>
                        {!s.anonimizado && (
                          <Button variante="ghost" tamanho="icon" aria-label={`Editar ${s.nome}`} onClick={() => editar(s)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {lista.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    Nenhum sócio-leitor encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Cadastro / edição (RF02) */}
      <Modal
        aberto={!!editando}
        onFechar={() => setEditando(null)}
        titulo={editando?.id ? "Editar sócio-leitor" : "Cadastrar sócio-leitor"}
        largura="max-w-2xl"
      >
        {editando && (
          <FormSocio
            form={editando.form}
            novo={!editando.id}
            onChange={(form) => setEditando({ ...editando, form })}
            onCancelar={() => setEditando(null)}
            onSalvar={() => executar(store.salvarSocio(editando.form, editando.id), () => setEditando(null))}
          />
        )}
      </Modal>

      {/* Ficha e histórico (RF04 / RN23 / RN28) */}
      <Modal
        aberto={!!detalhe}
        onFechar={() => {
          setDetalheId(null)
          if (socioInicial) navegar("socios")
        }}
        titulo={detalhe?.nome ?? ""}
        largura="max-w-4xl"
      >
        {detalhe && (
          <FichaSocio
            socio={detalhe}
            onEditar={() => {
              setDetalheId(null)
              editar(detalhe)
            }}
            onSenha={() => setSenha({ socio: detalhe, nova: "" })}
            onAnonimizar={() => setAnonimizando(detalhe)}
          />
        )}
      </Modal>

      <Modal aberto={!!senha} onFechar={() => setSenha(null)} titulo="Redefinir senha" largura="max-w-md">
        {senha && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Nova senha de acesso de {senha.socio.nome}.</p>
            <Campo rotulo="Nova senha" dica="Mínimo de 6 caracteres.">
              {(id) => <Input id={id} type="text" value={senha.nova} onChange={(e) => setSenha({ ...senha, nova: e.target.value })} />}
            </Campo>
            <Rodape>
              <Button variante="outline" onClick={() => setSenha(null)}>
                Cancelar
              </Button>
              <Button onClick={() => executar(store.redefinirSenhaSocio(senha.socio.id, senha.nova), () => setSenha(null))}>
                Redefinir
              </Button>
            </Rodape>
          </div>
        )}
      </Modal>

      <Confirmar
        aberto={!!anonimizando}
        titulo="Eliminar dados pessoais (LGPD)"
        mensagem={
          <>
            Os dados pessoais de <strong>{anonimizando?.nome}</strong> (nome, CPF, RG, contato, endereço e foto) serão
            apagados de forma definitiva, a pedido do titular. O histórico de circulação é mantido sem identificação.
          </>
        }
        rotuloConfirmar="Eliminar dados"
        perigo
        onCancelar={() => setAnonimizando(null)}
        onConfirmar={() =>
          anonimizando &&
          executar(store.anonimizarSocio(anonimizando.id), () => {
            setAnonimizando(null)
            setDetalheId(null)
          })
        }
      />
    </div>
  )
}

function FichaSocio({
  socio,
  onEditar,
  onSenha,
  onAnonimizar,
}: {
  socio: SocioLeitor
  onEditar: () => void
  onSenha: () => void
  onAnonimizar: () => void
}) {
  const { historicoDoSocio, reservasDoSocio, multas, debitos, tituloDoExemplar, alternarAtivoSocio, motivoBloqueio } = useStore()
  const executar = useAcao()
  const historico = historicoDoSocio(socio.id) ?? []
  const reservas = reservasDoSocio(socio.id) ?? []
  const multasSocio = multas.filter((m) => m.socioId === socio.id)
  const d = debitos(socio.id)
  const motivo = motivoBloqueio(socio.id)

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row">
        <ImagemArmazenada
          id={socio.fotoId}
          alt={`Foto 3x4 de ${socio.nome}`}
          className="h-32 w-24 shrink-0 rounded-lg border border-border"
          fallback={
            <div className="flex h-32 w-24 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
              <UserRound className="h-8 w-8" />
            </div>
          }
        />
        <div className="grid flex-1 grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Info rotulo="CPF" valor={socio.cpf ? formatCpf(socio.cpf) : "-"} />
          <Info rotulo="RG" valor={socio.rg || "-"} />
          <Info rotulo="Telefone" valor={socio.telefone ? formatTelefone(socio.telefone) : "-"} />
          <Info rotulo="E-mail" valor={socio.email || "não informado"} />
          <Info
            rotulo="Endereço"
            valor={socio.endereco.rua ? `${socio.endereco.rua}, ${socio.endereco.numero} - ${socio.endereco.bairro}` : "-"}
          />
          <Info rotulo="CEP" valor={socio.endereco.cep ? formatCep(socio.endereco.cep) : "-"} />
          <Info rotulo="Cadastro" valor={formatDate(socio.dataCadastro)} />
          <Info rotulo="Consentimento LGPD" valor={socio.consentimentoLgpd ? formatDate(socio.consentimentoLgpd) : "pendente"} />
        </div>
      </div>

      {!socio.anonimizado && (
        <div className="flex flex-wrap gap-2">
          <Button variante="outline" tamanho="sm" onClick={onEditar}>
            <Pencil className="h-4 w-4" /> Editar cadastro
          </Button>
          <Button variante="outline" tamanho="sm" onClick={onSenha}>
            <KeyRound className="h-4 w-4" /> Redefinir senha
          </Button>
          <Button variante={socio.ativo ? "outline" : "success"} tamanho="sm" onClick={() => executar(alternarAtivoSocio(socio.id))}>
            {socio.ativo ? <Ban className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            {socio.ativo ? "Inativar" : "Reativar"}
          </Button>
          <Button variante="ghost" tamanho="sm" className="text-danger" onClick={onAnonimizar}>
            <ShieldOff className="h-4 w-4" /> Eliminar dados (LGPD)
          </Button>
        </div>
      )}

      {!socio.consentimentoLgpd && !socio.anonimizado && (
        <Aviso tipo="alerta">Cadastro migrado sem consentimento registrado. Edite o cadastro e registre o consentimento.</Aviso>
      )}
      {motivo && <Aviso tipo="erro">Bloqueado para novos empréstimos: {motivo} (RN08).</Aviso>}

      <Card>
        <CardHeader titulo="Livros reservados" icone={<BookMarked className="h-5 w-5" />} />
        <div className="divide-y divide-border">
          {reservas.length === 0 && <Vazio>Nenhuma reserva.</Vazio>}
          {reservas.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
              <span>
                {tituloDoExemplar(r.exemplarId)} · {formatDate(r.dataReserva)}
              </span>
              <BadgeReserva r={r} />
            </div>
          ))}
        </div>
      </Card>

      {multasSocio.length > 0 && (
        <Card>
          <CardHeader
            titulo="Multas"
            descricao={d.totalMultas > 0 ? `Em aberto: ${formatCurrency(d.totalMultas)}` : undefined}
            icone={<AlertTriangle className="h-5 w-5" />}
          />
          <div className="divide-y divide-border">
            {multasSocio.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
                <span>
                  {formatCurrency(m.valor)} · {descricaoMulta(m)} · {formatDate(m.data)}
                </span>
                <BadgeMulta m={m} />
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader titulo="Histórico de leitura" icone={<History className="h-5 w-5" />} />
        <TabelaHistorico emprestimos={historico} />
      </Card>
    </div>
  )
}

function FormSocio({
  form,
  novo,
  onChange,
  onCancelar,
  onSalvar,
}: {
  form: DadosSocio
  novo: boolean
  onChange: (f: DadosSocio) => void
  onCancelar: () => void
  onSalvar: () => void
}) {
  const set = <K extends keyof DadosSocio>(k: K, v: DadosSocio[K]) => onChange({ ...form, [k]: v })
  const setEnd = (k: keyof DadosSocio["endereco"], v: string) => onChange({ ...form, endereco: { ...form.endereco, [k]: v } })

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
        <div>
          <p className="mb-1.5 text-sm font-medium">Foto 3x4</p>
          <SeletorImagens
            ids={form.fotoId ? [form.fotoId] : []}
            onChange={(ids) => set("fotoId", ids[0])}
            maximo={1}
            rotulo="Enviar foto"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Nome completo" className="sm:col-span-2">
            {(id) => <Input id={id} value={form.nome} onChange={(e) => set("nome", e.target.value)} autoComplete="off" />}
          </Campo>
          <Campo rotulo="CPF">
            {(id) => <Input id={id} inputMode="numeric" value={form.cpf} onChange={(e) => set("cpf", formatCpf(e.target.value))} placeholder="000.000.000-00" />}
          </Campo>
          <Campo rotulo="RG">{(id) => <Input id={id} value={form.rg} onChange={(e) => set("rg", e.target.value)} />}</Campo>
          <Campo rotulo="Telefone">
            {(id) => <Input id={id} inputMode="tel" value={form.telefone} onChange={(e) => set("telefone", formatTelefone(e.target.value))} placeholder="(82) 99999-9999" />}
          </Campo>
          <Campo rotulo="E-mail" dica="Usado para os avisos de prazo de devolução (RF05).">
            {(id) => <Input id={id} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />}
          </Campo>
        </div>
      </div>

      <fieldset className="grid gap-3 sm:grid-cols-[1fr_7rem]">
        <legend className="mb-1.5 text-sm font-medium">Endereço</legend>
        <Campo rotulo="Rua">{(id) => <Input id={id} value={form.endereco.rua} onChange={(e) => setEnd("rua", e.target.value)} />}</Campo>
        <Campo rotulo="Número">{(id) => <Input id={id} value={form.endereco.numero} onChange={(e) => setEnd("numero", e.target.value)} />}</Campo>
        <Campo rotulo="Bairro">{(id) => <Input id={id} value={form.endereco.bairro} onChange={(e) => setEnd("bairro", e.target.value)} />}</Campo>
        <Campo rotulo="CEP">
          {(id) => <Input id={id} inputMode="numeric" value={form.endereco.cep} onChange={(e) => setEnd("cep", formatCep(e.target.value))} placeholder="57300-000" />}
        </Campo>
      </fieldset>

      {novo && (
        <Campo rotulo="Senha inicial" dica="O sócio-leitor usa o CPF e esta senha para entrar. Mínimo de 6 caracteres.">
          {(id) => <Input id={id} type="text" value={form.senha ?? ""} onChange={(e) => set("senha", e.target.value)} />}
        </Campo>
      )}

      <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
        <input
          type="checkbox"
          checked={form.consentimentoLgpd}
          onChange={(e) => set("consentimentoLgpd", e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
        />
        <span className="text-pretty">
          O titular autorizou o tratamento dos seus dados pessoais para o serviço de empréstimo e uso das mesas de estudo,
          conforme a LGPD (RNF06). Os dados são visíveis apenas para a administração da biblioteca.
        </span>
      </label>

      <Rodape>
        <Button variante="outline" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button onClick={onSalvar}>
          <UserPlus className="h-4 w-4" /> {novo ? "Cadastrar" : "Salvar alterações"}
        </Button>
      </Rodape>
    </div>
  )
}

function Info({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="break-words font-medium">{valor}</p>
    </div>
  )
}
