<#
  PautaFlow Intelligence — instalação
  Verifica o Node.js, instala dependências, compila a interface e prepara o .env.
  Uso:  powershell -ExecutionPolicy Bypass -File scripts\install.ps1
#>
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "`n  PautaFlow Intelligence — instalação`n" -ForegroundColor Cyan

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "  Node.js não encontrado. Instale a versão LTS (22 ou superior) em https://nodejs.org e execute novamente." -ForegroundColor Red
  exit 1
}
$ver = (node -v).TrimStart('v')
$major = [int]($ver.Split('.')[0])
if ($major -lt 22) {
  Write-Host "  Node.js $ver encontrado; é necessário 22 ou superior." -ForegroundColor Red
  exit 1
}
Write-Host "  ✓ Node.js $ver"

if (-not (Test-Path (Join-Path $Root '.env'))) {
  Copy-Item (Join-Path $Root '.env.example') (Join-Path $Root '.env')
  Write-Host "  ✓ .env criado a partir de .env.example"
}

Write-Host "  • Instalando dependências (npm install)…"
npm install --no-fund --no-audit
if ($LASTEXITCODE -ne 0) { throw 'npm install falhou' }

Write-Host "  • Compilando a interface (npm run build)…"
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build da interface falhou' }

Write-Host "  • Gerando PautaFlow.exe…"
if (-not (Test-Path (Join-Path $Root "PautaFlow.exe"))) { & (Join-Path $PSScriptRoot "build-launcher.ps1") }

foreach ($d in 'data', 'backups', 'logs') { New-Item -ItemType Directory -Force (Join-Path $Root $d) | Out-Null }

Write-Host "`n  Instalação concluída." -ForegroundColor Green
Write-Host "  Iniciar:            powershell -ExecutionPolicy Bypass -File scripts\start.ps1"
Write-Host "  Em segundo plano:   powershell -ExecutionPolicy Bypass -File scripts\start-background.ps1"
Write-Host "  Iniciar com o Windows (opcional, pede confirmação): scripts\install-autostart.ps1`n"
