<#
  PautaFlow Intelligence — supervisor em segundo plano.
  Mantém o servidor local rodando (reinicia em caso de falha) sem janela visível.
  É o comando usado pela tarefa "Iniciar com o Windows".
  Para iniciar manualmente sem janela:
    powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File scripts\start-background.ps1
#>
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$logDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
$supLog = Join-Path $logDir 'supervisor.log'

function Log($msg) { Add-Content -Path $supLog -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $msg) -Encoding UTF8 }

# Evita dois supervisores
$mutex = New-Object System.Threading.Mutex($false, 'Global\PautaFlowSupervisor')
if (-not $mutex.WaitOne(0)) { Log 'Supervisor já em execução — saindo.'; exit 0 }

if (-not (Test-Path (Join-Path $Root 'apps\web\dist\index.html'))) {
  Log 'Interface não compilada — executando npm run build'
  & npm.cmd run build *>> $supLog
}

$tsx = Join-Path $Root 'node_modules\tsx\dist\cli.mjs'
$entry = Join-Path $Root 'apps\server\src\index.ts'
$failures = 0
Log 'Supervisor iniciado'
try {
  while ($true) {
    $started = Get-Date
    Log 'Iniciando servidor PautaFlow'
    $p = Start-Process -FilePath 'node' -ArgumentList @("`"$tsx`"", "`"$entry`"") -WorkingDirectory $Root -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput (Join-Path $logDir 'server.out.log') -RedirectStandardError (Join-Path $logDir 'server.err.log')
    $p.WaitForExit()
    $code = $p.ExitCode
    $ran = ((Get-Date) - $started).TotalSeconds
    Log "Servidor encerrado (código $code após $([int]$ran)s)"
    if ($code -eq 0) { break }               # encerramento solicitado
    if ($ran -gt 300) { $failures = 0 } else { $failures++ }
    $wait = [Math]::Min(300, 5 * [Math]::Pow(2, [Math]::Min($failures, 6)))
    Log "Reiniciando em $wait s (falhas seguidas: $failures)"
    Start-Sleep -Seconds $wait
  }
} finally {
  $mutex.ReleaseMutex()
  Log 'Supervisor finalizado'
}
