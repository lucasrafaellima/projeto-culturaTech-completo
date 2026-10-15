import { useEffect, useState } from "react"
import { AlertTriangle } from "lucide-react"
import { StoreProvider, useStore } from "@/lib/store"
import { Aviso, Button, Modal, Rodape, ToastProvider } from "@/components/ui"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import {
  itensNavegacao,
  navegar,
  rotaInicialPorPerfil,
  rotaPermitida,
  useRota,
  type RotaId,
} from "@/lib/navigation"
import { formatCurrency, primeiroNome } from "@/lib/utils"

import { MuralPage } from "@/pages/mural"
import { ConsultaPage } from "@/pages/consulta"
import { RepositorioPage } from "@/pages/repositorio"
import { EntrarPage } from "@/pages/entrar"
import { CadastroPage } from "@/pages/cadastro"
import { MinhaAreaPage } from "@/pages/minha-area"
import { MesasPage } from "@/pages/mesas"
import { AcervoPage } from "@/pages/acervo"
import { SociosPage } from "@/pages/socios"
import { CirculacaoPage } from "@/pages/circulacao"
import { NotificacoesPage } from "@/pages/notificacoes"
import { ParceriasPage } from "@/pages/parcerias"
import { ImportacaoPage } from "@/pages/importacao"
import { BackupsPage } from "@/pages/backups"

function tituloDaRota(rota: RotaId): string {
  return itensNavegacao.find((i) => i.id === rota)?.rotulo ?? "CulturaTech"
}

function Pagina({ rota, parametro }: { rota: RotaId; parametro: string | null }) {
  switch (rota) {
    case "mural":
      return <MuralPage />
    case "consulta":
      return <ConsultaPage livroInicial={parametro} />
    case "repositorio":
      return <RepositorioPage arquivoInicial={parametro} />
    case "entrar":
      return <EntrarPage />
    case "cadastro":
      return <CadastroPage />
    case "minha-area":
      return <MinhaAreaPage />
    case "mesas":
      return <MesasPage />
    case "acervo":
      return <AcervoPage />
    case "socios":
      return <SociosPage socioInicial={parametro} />
    case "circulacao":
      return <CirculacaoPage />
    case "notificacoes":
      return <NotificacoesPage />
    case "parcerias":
      return <ParceriasPage />
    case "importacao":
      return <ImportacaoPage />
    case "backups":
      return <BackupsPage />
  }
}

// RN11: alerta de pendências exibido assim que o sócio-leitor faz login
function AlertaPendencias() {
  const { alertaLogin, fecharAlertaLogin, socioLogado, debitos } = useStore()
  if (!socioLogado) return null
  const d = debitos(socioLogado.id)
  return (
    <Modal aberto={alertaLogin} onFechar={fecharAlertaLogin} titulo="Você possui pendências">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="space-y-1 text-sm">
            <p className="font-medium">Olá, {primeiroNome(socioLogado.nome)}. Antes de continuar, confira:</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {d.atrasados.length > 0 && (
                <li>
                  {d.atrasados.length} devolução(ões) em atraso, com multa acumulada de {formatCurrency(d.totalCorrente)}.
                </li>
              )}
              {d.multasAbertas.length > 0 && <li>Multas em aberto: {formatCurrency(d.totalMultas)}.</li>}
            </ul>
          </div>
        </div>
        <Aviso tipo="erro">Novos empréstimos e reservas ficam bloqueados até a regularização (RN08).</Aviso>
        <Rodape>
          <Button variante="outline" onClick={fecharAlertaLogin}>
            Fechar
          </Button>
          <Button
            onClick={() => {
              fecharAlertaLogin()
              navegar("minha-area")
            }}
          >
            Ver minhas pendências
          </Button>
        </Rodape>
      </div>
    </Modal>
  )
}

function Conteudo() {
  const { perfil, persistenciaOk } = useStore()
  const { rota, parametro } = useRota()
  const [menuAberto, setMenuAberto] = useState(false)

  // Controle de acesso por perfil (RNF02): rota não permitida volta para a inicial do perfil
  const permitida = rota !== null && rotaPermitida(rota, perfil)
  useEffect(() => {
    if (!permitida) navegar(rotaInicialPorPerfil[perfil])
  }, [permitida, perfil])

  const atual: RotaId = permitida ? rota! : rotaInicialPorPerfil[perfil]

  useEffect(() => {
    document.title = `${tituloDaRota(atual)} · CulturaTech`
  }, [atual])

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-card focus:px-4 focus:py-2 focus:shadow"
      >
        Pular para o conteúdo
      </a>
      <Sidebar rotaAtiva={atual} aberta={menuAberto} onFechar={() => setMenuAberto(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header titulo={tituloDaRota(atual)} onAbrirMenu={() => setMenuAberto(true)} />
        <main id="conteudo" className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl space-y-4">
            {!persistenciaOk && (
              <Aviso tipo="erro">
                O armazenamento do navegador está cheio e as últimas alterações podem não ter sido salvas. Gere um backup
                e remova arquivos grandes do repositório.
              </Aviso>
            )}
            <Pagina rota={atual} parametro={parametro} />
          </div>
        </main>
      </div>
      <AlertaPendencias />
    </div>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <StoreProvider>
        <Conteudo />
      </StoreProvider>
    </ToastProvider>
  )
}
