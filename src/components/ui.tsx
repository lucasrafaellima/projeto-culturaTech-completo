import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react"
import { CheckCircle2, XCircle, X, AlertTriangle, Info } from "lucide-react"
import { cn } from "@/lib/utils"

// ============================================================
// Button
// ============================================================
type Variante = "primary" | "accent" | "outline" | "ghost" | "danger" | "success"
type Tamanho = "sm" | "md" | "icon"

const variantes: Record<Variante, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  accent: "bg-accent text-accent-foreground hover:bg-accent/90",
  danger: "bg-danger text-danger-foreground hover:bg-danger/90",
  success: "bg-success text-success-foreground hover:bg-success/90",
  outline: "border border-border bg-card text-foreground hover:bg-muted",
  ghost: "text-foreground hover:bg-muted",
}

const tamanhos: Record<Tamanho, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  icon: "h-9 w-9",
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante
  tamanho?: Tamanho
}

export function Button({ variante = "primary", tamanho = "md", className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        variantes[variante],
        tamanhos[tamanho],
        className,
      )}
      {...props}
    />
  )
}

// ============================================================
// Card
// ============================================================
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card text-card-foreground shadow-sm", className)}>
      {children}
    </div>
  )
}

export function CardHeader({
  titulo,
  descricao,
  acao,
  icone,
}: {
  titulo: string
  descricao?: ReactNode
  acao?: ReactNode
  icone?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border p-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        {icone && <div className="mt-0.5 text-primary">{icone}</div>}
        <div>
          <h3 className="font-serif text-lg font-semibold leading-tight text-balance">{titulo}</h3>
          {descricao && <p className="mt-1 text-sm text-muted-foreground text-pretty">{descricao}</p>}
        </div>
      </div>
      {acao && <div className="flex flex-wrap gap-2">{acao}</div>}
    </div>
  )
}

// ============================================================
// Badge
// ============================================================
export function Badge({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", className)}
    >
      {children}
    </span>
  )
}

// ============================================================
// Modal — prende o foco, fecha com Esc e devolve o foco ao fechar
// ============================================================
const FOCAVEIS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({
  aberto,
  onFechar,
  titulo,
  children,
  largura = "max-w-lg",
}: {
  aberto: boolean
  onFechar: () => void
  titulo: string
  children: ReactNode
  largura?: string
}) {
  const caixa = useRef<HTMLDivElement>(null)
  const idTitulo = useId()
  const fecharRef = useRef(onFechar)
  fecharRef.current = onFechar

  useEffect(() => {
    if (!aberto) return
    const anterior = document.activeElement as HTMLElement | null
    const primeiro = caixa.current?.querySelector<HTMLElement>(
      "input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
    )
    ;(primeiro ?? caixa.current)?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.stopPropagation()
        fecharRef.current()
        return
      }
      if (ev.key !== "Tab" || !caixa.current) return
      const itens = Array.from(caixa.current.querySelectorAll<HTMLElement>(FOCAVEIS))
      if (itens.length === 0) return
      const inicio = itens[0]
      const fim = itens[itens.length - 1]
      if (ev.shiftKey && document.activeElement === inicio) {
        ev.preventDefault()
        fim.focus()
      } else if (!ev.shiftKey && document.activeElement === fim) {
        ev.preventDefault()
        inicio.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = overflow
      anterior?.focus?.()
    }
  }, [aberto])

  if (!aberto) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-foreground/40" onClick={onFechar} aria-hidden="true" />
      <div
        ref={caixa}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
        className={cn(
          "relative z-10 flex max-h-[92vh] w-full flex-col rounded-t-xl border border-border bg-card shadow-xl outline-none sm:rounded-xl",
          largura,
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border p-4">
          <h2 id={idTitulo} className="font-serif text-lg font-semibold text-balance">
            {titulo}
          </h2>
          <Button variante="ghost" tamanho="icon" onClick={onFechar} aria-label="Fechar">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

// ============================================================
// Campos de formulário
// ============================================================
export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60",
        className,
      )}
      {...props}
    />
  )
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/40",
        className,
      )}
      {...props}
    />
  )
}

export function Label({ children, className, htmlFor }: { children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn("mb-1.5 block text-sm font-medium text-foreground", className)}>
      {children}
    </label>
  )
}

/** Campo com rótulo e dica, ligados ao input por id (acessibilidade). */
export function Campo({
  rotulo,
  dica,
  children,
  className,
}: {
  rotulo: string
  dica?: ReactNode
  children: (id: string) => ReactNode
  className?: string
}) {
  const id = useId()
  return (
    <div className={className}>
      <Label htmlFor={id}>{rotulo}</Label>
      {children(id)}
      {dica && <p className="mt-1 text-xs text-muted-foreground text-pretty">{dica}</p>}
    </div>
  )
}

export function Rodape({ children }: { children: ReactNode }) {
  return <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">{children}</div>
}

// ============================================================
// Avisos em linha
// ============================================================
type TipoAviso = "info" | "alerta" | "erro" | "sucesso"

const estiloAviso: Record<TipoAviso, { caixa: string; icone: typeof Info; cor: string }> = {
  info: { caixa: "border-primary/30 bg-primary/5", icone: Info, cor: "text-primary" },
  alerta: { caixa: "border-warning/50 bg-warning/15", icone: AlertTriangle, cor: "text-warning-foreground" },
  erro: { caixa: "border-danger/40 bg-danger/10", icone: AlertTriangle, cor: "text-danger" },
  sucesso: { caixa: "border-success/40 bg-success/10", icone: CheckCircle2, cor: "text-success" },
}

export function Aviso({ tipo = "info", children, className }: { tipo?: TipoAviso; children: ReactNode; className?: string }) {
  const { caixa, icone: Icone, cor } = estiloAviso[tipo]
  return (
    <div className={cn("flex items-start gap-2 rounded-lg border p-3 text-sm", caixa, className)}>
      <Icone className={cn("mt-0.5 h-4 w-4 shrink-0", cor)} />
      <div className="min-w-0 text-pretty">{children}</div>
    </div>
  )
}

export function Vazio({ children }: { children: ReactNode }) {
  return <p className="p-5 text-sm text-muted-foreground">{children}</p>
}

// ============================================================
// Abas
// ============================================================
export function Abas<T extends string>({
  abas,
  ativa,
  onChange,
}: {
  abas: { id: T; rotulo: string; contador?: number }[]
  ativa: T
  onChange: (id: T) => void
}) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-muted/50 p-1">
      {abas.map((a) => (
        <button
          key={a.id}
          type="button"
          role="tab"
          aria-selected={a.id === ativa}
          onClick={() => onChange(a.id)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
            a.id === ativa ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {a.rotulo}
          {a.contador !== undefined && a.contador > 0 && (
            <span className="rounded-full bg-primary/15 px-1.5 text-xs text-primary">{a.contador}</span>
          )}
        </button>
      ))}
    </div>
  )
}

// ============================================================
// Cartão de indicador
// ============================================================
export function Indicador({
  icone,
  rotulo,
  valor,
  alerta,
}: {
  icone: ReactNode
  rotulo: string
  valor: ReactNode
  alerta?: boolean
}) {
  return (
    <Card className="flex items-center gap-4 p-5">
      <div
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg",
          alerta ? "bg-danger/15 text-danger" : "bg-primary/10 text-primary",
        )}
      >
        {icone}
      </div>
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{rotulo}</p>
        <p className="font-serif text-xl font-semibold">{valor}</p>
      </div>
    </Card>
  )
}

// ============================================================
// Confirmação
// ============================================================
export function Confirmar({
  aberto,
  titulo,
  mensagem,
  rotuloConfirmar = "Confirmar",
  perigo,
  onConfirmar,
  onCancelar,
}: {
  aberto: boolean
  titulo: string
  mensagem: ReactNode
  rotuloConfirmar?: string
  perigo?: boolean
  onConfirmar: () => void
  onCancelar: () => void
}) {
  return (
    <Modal aberto={aberto} onFechar={onCancelar} titulo={titulo} largura="max-w-md">
      <div className="space-y-4">
        <div className="text-sm text-muted-foreground text-pretty">{mensagem}</div>
        <Rodape>
          <Button variante="outline" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button variante={perigo ? "danger" : "primary"} onClick={onConfirmar}>
            {rotuloConfirmar}
          </Button>
        </Rodape>
      </div>
    </Modal>
  )
}

// ============================================================
// Toast (resultado das regras de negócio) — anunciado por leitores de tela
// ============================================================
interface ToastItem {
  id: string
  texto: string
  ok: boolean
}

interface ToastCtx {
  notificar: (texto: string, ok: boolean) => void
}

const ToastContext = createContext<ToastCtx | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [itens, setItens] = useState<ToastItem[]>([])

  const notificar = useCallback((texto: string, ok: boolean) => {
    const id = Math.random().toString(36).slice(2)
    setItens((prev) => [...prev, { id, texto, ok }])
    setTimeout(() => setItens((prev) => prev.filter((t) => t.id !== id)), ok ? 4500 : 7000)
  }, [])

  return (
    <ToastContext.Provider value={{ notificar }}>
      {children}
      <div
        aria-live="polite"
        role="status"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-end gap-2 sm:left-auto sm:w-full sm:max-w-sm"
      >
        {itens.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex w-full items-start gap-2 rounded-lg border bg-card p-3 text-sm shadow-lg",
              t.ok ? "border-success/40" : "border-danger/40",
            )}
          >
            {t.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            )}
            <span className="flex-1 text-pretty">{t.texto}</span>
            <button
              type="button"
              aria-label="Fechar aviso"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setItens((prev) => prev.filter((x) => x.id !== t.id))}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error("useToast deve ser usado dentro de ToastProvider")
  return ctx
}

/** Atalho: executa uma ação de regra de negócio e mostra o resultado. */
export function useAcao() {
  const { notificar } = useToast()
  return useCallback(
    (r: { ok: boolean; mensagem: string }, depois?: () => void) => {
      notificar(r.mensagem, r.ok)
      if (r.ok) depois?.()
      return r.ok
    },
    [notificar],
  )
}
