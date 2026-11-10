<#
  PautaFlow Intelligence — iniciar automaticamente ao entrar no Windows.
  Cria a tarefa agendada "PautaFlow Intelligence" (somente para o usuário atual, sem privilégios
  de administrador e sem instalar serviço). Pode ser removida com uninstall-autostart.ps1.
  Executado pela interface somente após confirmação explícita do usuário.
#>
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $Root 'scripts\start-background.ps1'
$taskName = 'PautaFlow Intelligence'

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`"" -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$trigger.Delay = 'PT30S'   # aguarda a rede/sessão estabilizar
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Mantém o PautaFlow Intelligence (servidor local em 127.0.0.1) em execução após o logon.' -Force | Out-Null
Write-Host "Tarefa '$taskName' registrada. O PautaFlow iniciará automaticamente no próximo logon." -ForegroundColor Green
