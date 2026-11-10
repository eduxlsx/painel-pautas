<#
  PautaFlow Intelligence — iniciar em primeiro plano (janela visível, Ctrl+C encerra).
  Abre o navegador automaticamente quando o servidor responde.
#>
param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$port = 3000
$envFile = Join-Path $Root '.env'
if (Test-Path $envFile) {
  $line = Select-String -Path $envFile -Pattern '^\s*PAUTAFLOW_PORT\s*=\s*(\d+)' | Select-Object -First 1
  if ($line) { $port = [int]$line.Matches[0].Groups[1].Value }
}

if (-not (Test-Path (Join-Path $Root 'apps\web\dist\index.html'))) {
  Write-Host 'Interface não compilada — executando npm run build…' -ForegroundColor Yellow
  npm run build
}

if (-not $NoBrowser) {
  Start-Job -ArgumentList $port -ScriptBlock {
    param($p)
    for ($i = 0; $i -lt 60; $i++) {
      try { Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$p/api/health" -TimeoutSec 2 | Out-Null; Start-Process "http://localhost:$p"; break } catch { Start-Sleep -Milliseconds 700 }
    }
  } | Out-Null
}

Write-Host "PautaFlow Intelligence em http://localhost:$port  (Ctrl+C para encerrar)" -ForegroundColor Cyan
npm start
