<#
  PautaFlow Intelligence — reinicia o servidor local.
  Encerra o processo registrado em data\.lock; o supervisor (start-background.ps1), se ativo, o reinicia.
  Sem supervisor, inicia novamente em segundo plano.
#>
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$lock = Join-Path $Root 'data\.lock'
$supervised = [bool](Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*start-background.ps1*' })

if (Test-Path $lock) {
  $serverPid = (Get-Content $lock -Raw | ConvertFrom-Json).pid
  $proc = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
  if ($proc) {
    Write-Host "Encerrando servidor (PID $serverPid)…"
    # Encerramento abrupto é seguro: gravações são atômicas e o supervisor reinicia (código ≠ 0)
    Stop-Process -Id $serverPid -Force
  }
}
if (-not $supervised) {
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$Root\scripts\start-background.ps1`""
  Write-Host 'Servidor iniciado em segundo plano.'
} else {
  Write-Host 'O supervisor reiniciará o servidor em alguns segundos.'
}
