<#
  PautaFlow Intelligence — encerra o supervisor e o servidor local.
#>
$Root = Split-Path -Parent $PSScriptRoot
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*start-background.ps1*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host "Supervisor encerrado (PID $($_.ProcessId))" }
$lock = Join-Path $Root 'data\.lock'
if (Test-Path $lock) {
  $serverPid = (Get-Content $lock -Raw | ConvertFrom-Json).pid
  if (Get-Process -Id $serverPid -ErrorAction SilentlyContinue) { Stop-Process -Id $serverPid -Force; Write-Host "Servidor encerrado (PID $serverPid)" }
  Remove-Item $lock -Force -ErrorAction SilentlyContinue
}
