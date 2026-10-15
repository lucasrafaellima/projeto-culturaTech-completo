import { useRef, useState } from "react"
import { DatabaseBackup, Download, RotateCcw, Upload, Trash2, ShieldCheck, RefreshCcw } from "lucide-react"
import { useStore } from "@/lib/store"
import { Aviso, Badge, Button, Card, CardHeader, Confirmar, Vazio, useAcao, useToast } from "@/components/ui"
import { baixarArquivo, lerBackup, listarBackups, removerBackup } from "@/lib/persistencia"
import { formatBytes, formatDateTime, hojeISO } from "@/lib/utils"
import type { Backup } from "@/lib/types"

export function BackupsPage() {
  const { gerarBackup, restaurarBackup, importarBackup, restaurarDemonstracao, exportarEstado } = useStore()
  const executar = useAcao()
  const { notificar } = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [versao, setVersao] = useState(0) // força a releitura da lista
  const [restaurando, setRestaurando] = useState<Backup | null>(null)
  const [resetando, setResetando] = useState(false)

  const backups = listarBackups()
  const atualizar = () => setVersao(versao + 1)

  function baixar(b?: Backup) {
    const dados = b ? lerBackup(b.id) : exportarEstado()
    if (!dados) return notificar("Backup não encontrado.", false)
    const data = b ? b.data.slice(0, 10) : hojeISO()
    baixarArquivo(`culturatech-backup-${data}.json`, JSON.stringify(dados, null, 2), "application/json")
  }

  async function importar(arquivo: File | undefined) {
    if (!arquivo) return
    try {
      const dados = JSON.parse(await arquivo.text())
      executar(importarBackup(dados), atualizar)
    } catch {
      notificar("O arquivo não é um backup válido do CulturaTech (JSON).", false)
    } finally {
      if (input.current) input.current.value = ""
    }
  }

  return (
    <div className="space-y-5">
      <Aviso tipo="info">
        Um backup completo do acervo, dos sócios-leitores e da circulação é gerado automaticamente todos os dias ao abrir o
        sistema, e os 7 mais recentes ficam guardados (RNF05). Baixe uma cópia periodicamente e guarde fora deste computador.
        Os arquivos digitalizados (PDFs e imagens) ficam no armazenamento do navegador e não entram no arquivo de backup.
      </Aviso>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => executar(gerarBackup(), atualizar)}>
          <DatabaseBackup className="h-4 w-4" /> Gerar backup agora
        </Button>
        <Button variante="outline" onClick={() => baixar()}>
          <Download className="h-4 w-4" /> Baixar dados atuais
        </Button>
        <input ref={input} type="file" accept=".json,application/json" className="hidden" onChange={(e) => importar(e.target.files?.[0])} />
        <Button variante="outline" onClick={() => input.current?.click()}>
          <Upload className="h-4 w-4" /> Importar arquivo de backup
        </Button>
      </div>

      <Card>
        <CardHeader titulo="Backups armazenados" icone={<ShieldCheck className="h-5 w-5" />} />
        <div className="divide-y divide-border" key={versao}>
          {backups.length === 0 && <Vazio>Nenhum backup gerado ainda.</Vazio>}
          {backups.map((b) => (
            <div key={b.id} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">{formatDateTime(b.data)}</p>
                <p className="text-sm text-muted-foreground">{formatBytes(b.tamanho)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={b.automatico ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}>
                  {b.automatico ? "Automático" : "Manual"}
                </Badge>
                <Button variante="ghost" tamanho="sm" onClick={() => baixar(b)}>
                  <Download className="h-4 w-4" /> Baixar
                </Button>
                <Button variante="outline" tamanho="sm" onClick={() => setRestaurando(b)}>
                  <RotateCcw className="h-4 w-4" /> Restaurar
                </Button>
                <Button
                  variante="ghost"
                  tamanho="icon"
                  aria-label="Excluir backup"
                  onClick={() => {
                    removerBackup(b.id)
                    atualizar()
                  }}
                >
                  <Trash2 className="h-4 w-4 text-danger" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium">Restaurar dados de demonstração</p>
            <p className="text-sm text-muted-foreground">Volta o sistema aos dados de exemplo. Um backup do estado atual é gerado antes.</p>
          </div>
          <Button variante="outline" onClick={() => setResetando(true)}>
            <RefreshCcw className="h-4 w-4" /> Restaurar demonstração
          </Button>
        </div>
      </Card>

      <Confirmar
        aberto={!!restaurando}
        titulo="Restaurar backup"
        mensagem={`Os dados atuais serão substituídos pelo backup de ${restaurando ? formatDateTime(restaurando.data) : ""}. Um backup do estado atual será gerado antes.`}
        rotuloConfirmar="Restaurar"
        perigo
        onCancelar={() => setRestaurando(null)}
        onConfirmar={() =>
          restaurando &&
          executar(restaurarBackup(restaurando.id), () => {
            setRestaurando(null)
            atualizar()
          })
        }
      />
      <Confirmar
        aberto={resetando}
        titulo="Restaurar dados de demonstração"
        mensagem="Todos os cadastros e movimentações atuais serão substituídos pelos dados de exemplo."
        rotuloConfirmar="Restaurar demonstração"
        perigo
        onCancelar={() => setResetando(false)}
        onConfirmar={() =>
          executar(restaurarDemonstracao(), () => {
            setResetando(false)
            atualizar()
          })
        }
      />
    </div>
  )
}
