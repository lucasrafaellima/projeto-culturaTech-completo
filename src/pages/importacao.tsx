import { useRef, useState } from "react"
import { FileSpreadsheet, Upload, Download, CheckCircle2, XCircle, Loader2 } from "lucide-react"
import { useStore } from "@/lib/store"
import { Aviso, Badge, Button, Card, CardHeader, Campo, Input, Rodape, Select, useToast } from "@/components/ui"
import { COLUNAS, MODELOS, lerObras, lerSocios, type ErroLinha, type LinhaObra, type LinhaSocio, type TipoImportacao } from "@/lib/csv"
import { csvValido, labelCategoria } from "@/lib/constants"
import { baixarArquivo } from "@/lib/persistencia"
import { formatCpf } from "@/lib/utils"

type Previa =
  | { tipo: "obras"; linhas: LinhaObra[]; erros: ErroLinha[] }
  | { tipo: "socios"; linhas: LinhaSocio[]; erros: ErroLinha[] }

export function ImportacaoPage() {
  const { importarObras, importarSocios } = useStore()
  const { notificar } = useToast()
  const input = useRef<HTMLInputElement>(null)

  const [tipo, setTipo] = useState<TipoImportacao>("obras")
  const [nomeArquivo, setNomeArquivo] = useState("")
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [lendo, setLendo] = useState(false)
  const [importando, setImportando] = useState(false)

  function limpar() {
    setPrevia(null)
    setNomeArquivo("")
    if (input.current) input.current.value = ""
  }

  async function aoEscolher(arquivo: File | undefined) {
    setPrevia(null)
    if (!arquivo) return
    setNomeArquivo(arquivo.name)
    // RN21: somente CSV
    if (!csvValido(arquivo)) {
      notificar("Arquivo recusado: a importação aceita somente o formato CSV (RN21).", false)
      limpar()
      return
    }
    setLendo(true)
    const inicio = performance.now()
    try {
      const texto = await arquivo.text()
      if (texto.includes("\u0000")) {
        notificar("O arquivo parece estar corrompido (conteúdo binário).", false)
        limpar()
        return
      }
      const r = tipo === "obras" ? lerObras(texto) : lerSocios(texto)
      setPrevia({ tipo, ...r } as Previa)
      const ms = Math.round(performance.now() - inicio)
      notificar(
        r.erros.length
          ? `${r.erros.length} linha(s) com erro. Corrija o arquivo: nada será importado (RNF03).`
          : `${r.linhas.length} registro(s) válidos, verificados em ${ms} ms.`,
        r.erros.length === 0,
      )
    } finally {
      setLendo(false)
    }
  }

  async function confirmar() {
    if (!previa || previa.erros.length > 0 || importando) return
    setImportando(true)
    try {
      // a importação de obras espera o servidor quando o acervo está no banco
      const r = previa.tipo === "obras" ? await importarObras(previa.linhas) : importarSocios(previa.linhas)
      if (!r.ok && r.erros) {
        setPrevia({ ...previa, erros: r.erros } as Previa)
      }
      notificar(r.mensagem, r.ok)
      if (r.ok) limpar()
    } finally {
      setImportando(false)
    }
  }

  return (
    <div className="space-y-5">
      <Aviso tipo="info">
        Migre as planilhas atuais para o sistema. Salve a planilha do Excel como <strong>CSV (separado por ponto e vírgula)</strong>{" "}
        e envie aqui. O arquivo é validado por completo antes de importar: se qualquer linha tiver erro, nada é gravado e os
        erros são listados por linha (RN21, RNF03).
      </Aviso>

      <Card>
        <CardHeader titulo="Importar planilha" icone={<FileSpreadsheet className="h-5 w-5" />} />
        <div className="grid gap-4 p-5 md:grid-cols-[16rem_1fr]">
          <Campo rotulo="O que será importado">
            {(id) => (
              <Select
                id={id}
                value={tipo}
                onChange={(e) => {
                  setTipo(e.target.value as TipoImportacao)
                  limpar()
                }}
              >
                <option value="obras">Obras e exemplares</option>
                <option value="socios">Sócios-leitores</option>
              </Select>
            )}
          </Campo>
          <Campo rotulo="Arquivo CSV" dica={`Colunas: ${COLUNAS[tipo].join("; ")}`}>
            {(id) => (
              <Input
                id={id}
                ref={input}
                type="file"
                accept=".csv,text/csv"
                className="py-1.5 file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm"
                onChange={(e) => aoEscolher(e.target.files?.[0])}
              />
            )}
          </Campo>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border p-5">
          <Button
            variante="outline"
            tamanho="sm"
            onClick={() => baixarArquivo(`modelo-${tipo}.csv`, "\uFEFF" + MODELOS[tipo], "text/csv;charset=utf-8")}
          >
            <Download className="h-4 w-4" /> Baixar modelo de {tipo === "obras" ? "obras" : "sócios"}
          </Button>
          {tipo === "obras" && (
            <p className="text-xs text-muted-foreground">
              Vários autores ou tombamentos na mesma célula são separados por “|”. Categorias:{" "}
              {Object.values(labelCategoria).join(", ")}.
            </p>
          )}
          {tipo === "socios" && (
            <p className="text-xs text-muted-foreground">
              A senha provisória é formada pelos 6 primeiros dígitos do CPF. O consentimento LGPD deve ser coletado no primeiro
              atendimento.
            </p>
          )}
        </div>
      </Card>

      {lendo && (
        <Card className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Validando {nomeArquivo}...
        </Card>
      )}

      {previa && (
        <Card>
          <CardHeader
            titulo={`Pré-visualização: ${nomeArquivo}`}
            descricao={
              <span className="flex flex-wrap gap-2">
                <Badge className="bg-success/15 text-success">
                  <CheckCircle2 className="h-3 w-3" /> {previa.linhas.length} válida(s)
                </Badge>
                <Badge className={previa.erros.length ? "bg-danger/15 text-danger" : "bg-muted text-muted-foreground"}>
                  <XCircle className="h-3 w-3" /> {previa.erros.length} com erro
                </Badge>
              </span>
            }
            icone={<FileSpreadsheet className="h-5 w-5" />}
          />
          {previa.erros.length > 0 && (
            <div className="space-y-2 border-b border-border p-5">
              <p className="text-sm font-medium text-danger">Corrija estes problemas no arquivo e envie novamente:</p>
              <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
                {previa.erros.map((e, i) => (
                  <li key={i} className="rounded-md bg-danger/5 px-3 py-1.5">
                    <strong>Linha {e.linha}:</strong> {e.mensagem}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {previa.linhas.length > 0 && (
            <div className="max-h-80 overflow-auto">
              {previa.tipo === "obras" ? (
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="p-3 font-medium">Linha</th>
                      <th className="p-3 font-medium">Título</th>
                      <th className="p-3 font-medium">Autor(es)</th>
                      <th className="p-3 font-medium">Categoria</th>
                      <th className="p-3 font-medium">Seção</th>
                      <th className="p-3 font-medium">Exemplares</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {previa.linhas.map((l) => (
                      <tr key={l.linha}>
                        <td className="p-3 text-muted-foreground">{l.linha}</td>
                        <td className="p-3 font-medium">{l.titulo}</td>
                        <td className="p-3">{l.autores.join("; ")}</td>
                        <td className="p-3">{labelCategoria[l.categoria]}</td>
                        <td className="p-3">{l.secao}</td>
                        <td className="p-3">{l.tombamentos.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="p-3 font-medium">Linha</th>
                      <th className="p-3 font-medium">Nome</th>
                      <th className="p-3 font-medium">CPF</th>
                      <th className="p-3 font-medium">E-mail</th>
                      <th className="p-3 font-medium">Bairro</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {previa.linhas.map((l) => (
                      <tr key={l.linha}>
                        <td className="p-3 text-muted-foreground">{l.linha}</td>
                        <td className="p-3 font-medium">{l.nome}</td>
                        <td className="p-3 font-mono text-xs">{formatCpf(l.cpf)}</td>
                        <td className="p-3">{l.email || "-"}</td>
                        <td className="p-3">{l.bairro}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          <div className="p-5">
            <Rodape>
              <Button variante="outline" onClick={limpar}>
                Descartar
              </Button>
              <Button disabled={previa.erros.length > 0 || previa.linhas.length === 0 || importando} onClick={confirmar}>
                <Upload className="h-4 w-4" />{" "}
                {importando ? "Importando..." : `Importar ${previa.linhas.length} registro(s)`}
              </Button>
            </Rodape>
          </div>
        </Card>
      )}
    </div>
  )
}
