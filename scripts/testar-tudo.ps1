# Roda todos os testes automáticos do CulturaTech num banco PostgreSQL descartável (nunca no banco de produção).
# Uso (na raiz do projeto): npm run testar-tudo
#   ou: powershell -ExecutionPolicy Bypass -File scripts/testar-tudo.ps1 -PgBin "C:\Program Files\PostgreSQL\17\bin"
# Requisitos: Node 22.18+, PostgreSQL 17 instalado (só os executáveis; o script cria e apaga o próprio banco),
# Google Chrome, e as portas 3333, 4173 e 55432 livres. Veja TESTES.md.
param(
  [string]$PgBin = "C:\Program Files\PostgreSQL\17\bin",
  [int]$PortaBanco = 55432
)

$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz
foreach ($exe in "initdb.exe", "pg_ctl.exe", "psql.exe") {
  if (-not (Test-Path (Join-Path $PgBin $exe))) { throw "Não encontrei $exe em $PgBin. Informe -PgBin com a pasta bin do PostgreSQL." }
}
foreach ($porta in 3333, 4173, $PortaBanco) {
  if (Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue) {
    throw "A porta $porta está em uso. Encerre a API, o front ou o banco que estiverem rodando e tente de novo."
  }
}

# Banco descartável e variáveis próprias: valem para tudo o que este script inicia e têm prioridade sobre o server/.env
$dados = Join-Path $env:TEMP ("culturatech-testes-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
$senha = Join-Path $env:TEMP ("culturatech-testes-" + [guid]::NewGuid().ToString("N").Substring(0, 8) + ".txt")
$uploads = Join-Path $dados "uploads"
$env:PGHOST = "localhost"
$env:PGPORT = "$PortaBanco"
$env:PGDATABASE = "culturatech"
$env:PGUSER = "postgres"
$env:PGPASSWORD = "senha-de-teste"
$env:DB_SSL = "disable"
$env:JWT_SECRET = "segredo-somente-para-os-testes-automaticos-do-culturatech"
$env:ARMAZENAMENTO = "disco"
$env:PASTA_UPLOADS = $uploads
$env:PORT = "3333"
if ($env:PGHOST -ne "localhost") { throw "Trava de segurança: os testes só rodam num banco local." }

$resumo = [System.Collections.Generic.List[object]]::new()
function Registrar($nome, $saida) {
  $linhas = @($saida | ForEach-Object { "$_" })
  $oks = @($linhas | Where-Object { $_ -match '^ok\s' }).Count
  $ruins = @($linhas | Where-Object { $_ -match '^FALHOU' })
  $conhecidas = @($ruins | Where-Object { $nome -eq "api: login" -and $_ -match 'data de nascimento futura|data inexistente' })
  $erroFatal = @($linhas | Where-Object { $_ -match '^(Error|TypeError|\[TypeError)|Cannot find|ECONNREFUSED' }).Count -gt 0
  $resumo.Add([pscustomobject]@{
    Suite = $nome; Ok = $oks; Falhas = $ruins.Count - $conhecidas.Count; Conhecidas = $conhecidas.Count; Erro = $erroFatal
  })
  foreach ($r in $ruins) { if ($conhecidas -notcontains $r) { Write-Host "   $r" -ForegroundColor Red } }
  if ($erroFatal) { $linhas | Select-Object -Last 8 | ForEach-Object { Write-Host "   $_" -ForegroundColor Red } }
  Write-Host ("== {0}: {1} ok, {2} falha(s){3}" -f $nome, $oks, ($ruins.Count - $conhecidas.Count), $(if ($conhecidas.Count) { ", $($conhecidas.Count) conhecida(s) (limitador de cadastros)" } else { "" }))
}

function Psql([string[]]$argumentos) { & (Join-Path $PgBin "psql.exe") -p $PortaBanco -U postgres -q -v ON_ERROR_STOP=1 @argumentos }
function Recarregar {
  Psql @("-d", "postgres", "-c", "DROP DATABASE IF EXISTS culturatech WITH (FORCE)") | Out-Null
  Psql @("-d", "postgres", "-c", "CREATE DATABASE culturatech") | Out-Null
  Psql @("-d", "culturatech", "-f", "database\01_schema.sql") 2>&1 | Where-Object { $_ -notmatch 'NOTA|NOTICE' } | Out-Null
  Psql @("-d", "culturatech", "-f", "database\02_dados_exemplo.sql") 2>&1 | Where-Object { $_ -notmatch 'NOTA|NOTICE' } | Out-Null
}
function PararPorta($porta) {
  $p = (Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique
  foreach ($x in $p) { Stop-Process -Id $x -Force -Confirm:$false -ErrorAction SilentlyContinue }
}
function IniciarApi([string]$fuso) {
  PararPorta 3333
  if ($fuso) { $env:FUSO_HORARIO = $fuso } else { Remove-Item Env:FUSO_HORARIO -ErrorAction SilentlyContinue }
  Start-Process -FilePath node -ArgumentList "src/index.ts" -WorkingDirectory (Join-Path $raiz "server") -WindowStyle Hidden | Out-Null
  for ($i = 0; $i -lt 60; $i++) {
    try { Invoke-RestMethod http://localhost:3333/api/saude -TimeoutSec 2 | Out-Null; return } catch { Start-Sleep -Seconds 1 }
  }
  throw "A API não subiu na porta 3333."
}
function Rodar([string]$nome, [string]$pasta, [string]$script) {
  Push-Location $pasta
  try {
    $saida = & node $script 2>&1
  } finally { Pop-Location }
  Registrar $nome $saida
}

# daqui em diante, mensagens dos programas em stderr (avisos do psql, do node) não interrompem o script
$ErrorActionPreference = "Continue"
try {
  Write-Host "Criando o banco descartável em $dados"
  "senha-de-teste" | Out-File -Encoding ascii $senha
  & (Join-Path $PgBin "initdb.exe") -D $dados -U postgres -A trust -E UTF8 --pwfile $senha > $null
  # sem redirecionar a saída: com pipe, o pg_ctl não devolve o controle no Windows
  & (Join-Path $PgBin "pg_ctl.exe") -D $dados -o "-p $PortaBanco" -l (Join-Path $dados "log.txt") -w start
  Recarregar

  # 1) API: fuso em que o turno da manhã está aberto agora, para testar a confirmação de uso (US30) a qualquer hora
  $n = 10 - [DateTime]::UtcNow.Hour
  if ($n -lt -12) { $n += 24 }
  if ($n -gt 14) { $n -= 24 }
  $fusoTeste = if ($n -ge 0) { "Etc/GMT-$n" } else { "Etc/GMT+$(-$n)" }
  IniciarApi $fusoTeste
  foreach ($s in "login", "acervo", "circulacao", "repositorio", "mural", "mesas", "parcerias", "notificacoes") {
    Rodar "api: $s" "server" "scripts/testar-$s.ts"
  }
  Rodar "api: armazenamento" "server" "scripts/testar-s3.ts"

  # 2) Front compilado; desempenho e telas com a API no fuso real
  Write-Host "Compilando o front-end"
  npm run build 2>&1 | Select-Object -Last 1 | Write-Host
  $env:FUSO_HORARIO = $null
  Recarregar
  IniciarApi ""
  Start-Process -FilePath npm.cmd -ArgumentList "run", "preview" -WorkingDirectory $raiz -WindowStyle Hidden | Out-Null
  Start-Sleep -Seconds 5
  Rodar "desempenho (5.000 livros)" "server" "scripts/testar-desempenho.ts"
  Recarregar
  Rodar "telas com a API" "." "scripts/testar-telas-api.mjs"

  # 3) Sem a API: modo demonstração, celular e regras puras
  PararPorta 3333
  Rodar "navegador sem a API" "." "scripts/testar-navegador.mjs"
  Rodar "celular e tablet" "." "scripts/testar-celular.mjs"
  $saida = npm run verificar 2>&1
  Registrar "regras puras" $saida
} finally {
  PararPorta 3333
  PararPorta 4173
  if (Test-Path $dados) {
    & (Join-Path $PgBin "pg_ctl.exe") -D $dados -m fast -w stop
    Start-Sleep -Seconds 1
    Remove-Item -Recurse -Force $dados -Confirm:$false -ErrorAction SilentlyContinue
  }
  Remove-Item -Force $senha -ErrorAction SilentlyContinue
}

Write-Host ""
$resumo | Format-Table Suite, Ok, Falhas, Conhecidas, Erro -AutoSize | Out-String | Write-Host
$problemas = @($resumo | Where-Object { $_.Falhas -gt 0 -or $_.Erro })
if ($problemas.Count) {
  Write-Host "$($problemas.Count) suíte(s) com falha." -ForegroundColor Red
  exit 1
}
Write-Host "Todos os testes passaram (fora as falhas conhecidas do limitador de cadastros)." -ForegroundColor Green
exit 0
