import { CloudOff, LogIn, LogOut, Menu, ShieldCheck, UserRound } from "lucide-react"
import { useStore } from "@/lib/store"
import { navegar } from "@/lib/navigation"
import { labelPerfil } from "@/lib/constants"
import { primeiroNome } from "@/lib/utils"
import { Badge, Button, useToast } from "./ui"
import { ImagemArmazenada } from "./arquivos"

export function Header({ titulo, onAbrirMenu }: { titulo: string; onAbrirMenu: () => void }) {
  const { perfil, socioLogado, adminLogado, sair, sessao } = useStore()
  const { notificar } = useToast()

  const nome = socioLogado?.nome ?? adminLogado?.nome ?? null

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-card/95 px-4 py-3 backdrop-blur sm:px-5">
      <Button variante="ghost" tamanho="icon" className="lg:hidden" onClick={onAbrirMenu} aria-label="Abrir menu">
        <Menu className="h-5 w-5" />
      </Button>

      <div className="min-w-0 flex-1">
        <h1 className="truncate font-serif text-lg font-semibold sm:text-xl">{titulo}</h1>
        <p className="hidden text-sm text-muted-foreground sm:block">
          Portal Cultural de Arapiraca · sistema bibliotecário
        </p>
      </div>

      {perfil === "publico" ? (
        <Button onClick={() => navegar("entrar")}>
          <LogIn className="h-4 w-4" />
          Entrar
        </Button>
      ) : (
        <div className="flex items-center gap-2 sm:gap-3">
          {!sessao.token && (
            <Badge
              className="border border-warning/40 bg-warning/15 text-warning"
              title="Sessão aberta sem o servidor: os dados ficam só neste navegador. Inicie a API e entre novamente."
            >
              <CloudOff className="h-3 w-3" /> Modo demonstração
            </Badge>
          )}
          <div className="hidden items-center gap-2.5 rounded-lg border border-border bg-muted/50 px-3 py-1.5 sm:flex">
            {perfil === "socio" ? (
              <ImagemArmazenada
                id={socioLogado?.fotoId}
                alt=""
                className="h-8 w-8 rounded-full"
                fallback={
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <UserRound className="h-4 w-4" />
                  </div>
                }
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/15 text-accent">
                <ShieldCheck className="h-4 w-4" />
              </div>
            )}
            <div className="leading-tight">
              <p className="text-sm font-medium">{nome ? primeiroNome(nome) : "-"}</p>
              <Badge className="px-0 py-0 text-muted-foreground">{labelPerfil[perfil]}</Badge>
            </div>
          </div>
          <Button
            variante="outline"
            onClick={() => {
              sair()
              navegar("mural")
              notificar("Sessão encerrada.", true)
            }}
            aria-label="Sair"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sair</span>
          </Button>
        </div>
      )}
    </header>
  )
}
