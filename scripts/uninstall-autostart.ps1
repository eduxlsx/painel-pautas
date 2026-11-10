<#
  PautaFlow Intelligence — remove a inicialização automática com o Windows.
#>
$ErrorActionPreference = 'Stop'
$taskName = 'PautaFlow Intelligence'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "Tarefa '$taskName' removida." -ForegroundColor Green
} else {
  Write-Host "Tarefa '$taskName' não estava configurada."
}
