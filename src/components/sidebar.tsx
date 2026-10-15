import { useEffect } from "react"
import { BookOpenText, MapPin, X } from "lucide-react"
import { useStore } from "@/lib/store"
import { grupoDoItem, navegar, rotasDoPerfil, type ItemNav, type RotaId } from "@/lib/navigation"
import { cn } from "@/lib/utils"

const titulosGrupo: Record<ItemNav["grupo"], string> = {
  publico: "Portal Público",
  socio: "Sócio-leitor",
  admin: "Administração",
}

export function Sidebar({
  rotaAtiva,
  aberta,
  onFechar,
}: {
  rotaAtiva: RotaId
  aberta: boolean
  onFechar: () => void
}) {
  const { perfil, circulacaoPendencias } = useSidebarDados()
  const rotas = rotasDoPerfil(perfil).filter((r) => !r.oculto)

  const grupos = rotas.reduce<Record<string, ItemNav[]>>((acc, item) => {
    ;(acc[grupoDoItem(item, perfil)] ||= []).push(item)
    return acc
  }, {})

  useEffect(() => {
    if (!aberta) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onFechar()
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [aberta, onFechar])

  return (
    <>
      {aberta && <div className="fixed inset-0 z-40 bg-foreground/40 lg:hidden" onClick={onFechar} aria-hidden="true" />}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 shrink-0 flex-col border-r border-border bg-card transition-transform lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-64 lg:translate-x-0",
          aberta ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label="Menu principal"
      >
        <div className="flex items-center justify-between gap-2.5 bg-primary px-5 py-4">
          <button onClick={() => navegar("mural")} className="flex items-center gap-2.5 text-left">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <BookOpenText className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <p className="font-serif text-base text-primary-foreground">CulturaTech</p>
              <p className="text-xs text-white">Portal Cultural de Arapiraca</p>
            </div>
          </button>
          <button onClick={onFechar} aria-label="Fechar menu" className="rounded-md p-1 text-muted-foreground hover:bg-muted lg:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {(["publico", "socio", "admin"] as const)
            .filter((g) => grupos[g])
            .map((grupo) => (
              <div key={grupo} className="mb-5">
                <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {titulosGrupo[grupo]}
                </p>
                <ul className="flex flex-col gap-1">
                  {grupos[grupo].map((item) => {
                    const Icone = item.icone
                    const ativo = item.id === rotaAtiva
                    const contador = item.id === "circulacao" ? circulacaoPendencias : 0
                    return (
                      <li key={item.id}>
                        <button
                          onClick={() => {
                            navegar(item.id)
                            onFechar()
                          }}
                          aria-current={ativo ? "page" : undefined}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                            ativo ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted",
                          )}
                        >
                          <Icone className="h-4 w-4 shrink-0" />
                          <span className="flex-1 text-left text-pretty">{item.rotulo}</span>
                          {contador > 0 && (
                            <span
                              className={cn(
                                "rounded-full px-1.5 text-xs",
                                ativo ? "bg-primary-foreground/20" : "bg-warning/25 text-warning-foreground",
                              )}
                              title="Justificativas de multa aguardando julgamento"
                            >
                              {contador}
                            </span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
        </nav>

        <div className="border-t border-border p-4 text-xs text-muted-foreground">
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Biblioteca Municipal Prof. Pedro de França Reis · Arapiraca - AL</span>
          </div>
        </div>
      </aside>
    </>
  )
}

function useSidebarDados() {
  const { perfil, multas } = useStore()
  return {
    perfil,
    circulacaoPendencias: perfil === "admin" ? multas.filter((m) => m.status === "em_analise").length : 0,
  }
}
