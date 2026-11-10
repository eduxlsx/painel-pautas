# PautaFlow — leitura do Outlook clássico instalado (automação COM do Office, somente leitura).
# Entrada (stdin, JSON): mode ('sync'|'probe'|'open'), since, startIfClosed, includeSent, calendar, calFrom, calTo, max, id
# Saída (stdout): JSON.
$p = $__in | ConvertFrom-Json

$running = [bool](Get-Process OUTLOOK -ErrorAction SilentlyContinue)
if (-not $running -and -not $p.startIfClosed) {
  [Console]::Out.Write((@{ status = 'closed' } | ConvertTo-Json -Compress)); return
}
# O Outlook recusa chamadas (RPC_E_CALL_REJECTED) enquanto está iniciando: tenta por até 90 s
$ol = $null; $ns = $null; $lastErr = $null
for ($i = 0; $i -lt 45 -and -not $ns; $i++) {
  try {
    if (-not $ol) {
      try { $ol = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') } catch { $ol = New-Object -ComObject Outlook.Application }
    }
    $ns = $ol.GetNamespace('MAPI')
    [void]$ns.GetDefaultFolder(6).Name
  } catch { $lastErr = $_.Exception.Message; $ns = $null; Start-Sleep -Seconds 2 }
}
if (-not $ns) { throw ('O Outlook não respondeu: ' + $lastErr) }

if ($p.mode -eq 'open') {
  $parts = ([string]$p.id).Split('|')
  $item = $ns.GetItemFromID($parts[0])
  $item.Display()
  [Console]::Out.Write((@{ status = 'ok' } | ConvertTo-Json -Compress)); return
}

if ($p.mode -eq 'probe') {
  $inbox = $ns.GetDefaultFolder(6)
  [Console]::Out.Write((@{ status = 'ok'; account = [string]$ns.CurrentUser.Name; version = [string]$ol.Version; inboxCount = [int]$inbox.Items.Count; running = $running } | ConvertTo-Json -Compress)); return
}

function Iso($d) {
  if ($null -eq $d) { return $null }
  $dt = [datetime]$d
  if ($dt.Year -ge 4000 -or $dt.Year -lt 1990) { return $null }
  return $dt.ToUniversalTime().ToString('o')
}
# Endereços SMTP: lê as propriedades MAPI já gravadas na mensagem (rápido). A consulta ao diretório
# (GetExchangeUser) é lenta e fica só como último recurso, com cache por execução.
$PR_SMTP = 'http://schemas.microsoft.com/mapi/proptag/0x39FE001F'
$PR_SENDER_SMTP = 'http://schemas.microsoft.com/mapi/proptag/0x5D01001F'
$smtpCache = @{}
function ResolveEx($ae, $key) {
  if ($smtpCache.ContainsKey($key)) { return $smtpCache[$key] }
  $v = $null
  try { $u = $ae.GetExchangeUser(); if ($u) { $v = [string]$u.PrimarySmtpAddress } } catch { }
  $smtpCache[$key] = $v
  return $v
}
function RecipientSmtp($r) {
  try { $a = [string]$r.Address; if ($a -match '@') { return $a } } catch { }
  try { $v = [string]$r.PropertyAccessor.GetProperty($PR_SMTP); if ($v -match '@') { return $v } } catch { }
  try { return (ResolveEx $r.AddressEntry ([string]$r.Address)) } catch { return $null }
}
function SenderSmtp($m) {
  try { $a = [string]$m.SenderEmailAddress; if ($a -match '@') { return $a } } catch { }
  try { $v = [string]$m.PropertyAccessor.GetProperty($PR_SENDER_SMTP); if ($v -match '@') { return $v } } catch { }
  try { return (ResolveEx $m.Sender ([string]$m.SenderEmailAddress)) } catch { return $null }
}
function MailObj($m, $folderId, $folderName) {
  $to = @(); $cc = @()
  try {
    $k = 0
    foreach ($r in $m.Recipients) {
      $k++; if ($k -gt 25) { break }   # listas de distribuição grandes: o radar só precisa dos primeiros
      $a = RecipientSmtp $r
      if (-not $a) { $a = [string]$r.Name }
      if ($r.Type -eq 2) { $cc += $a } elseif ($r.Type -eq 1) { $to += $a }
    }
  } catch { }
  $body = ''
  try { $body = [string]$m.Body } catch { }
  if ($body.Length -gt 8000) { $body = $body.Substring(0, 8000) }
  $when = if ($folderId -eq 'sentitems') { $m.SentOn } else { $m.ReceivedTime }
  [pscustomobject]@{
    id = [string]$m.EntryID; folderId = $folderId; folderName = $folderName
    subject = [string]$m.Subject; fromName = [string]$m.SenderName; fromEmail = (SenderSmtp $m)
    to = $to; cc = $cc; receivedAt = (Iso $when); body = $body
    importance = [int]$m.Importance; flagged = ($m.FlagStatus -eq 2); flagDue = (Iso $m.TaskDueDate)
    isRead = (-not $m.UnRead); conversationId = [string]$m.ConversationID
    hasAttachments = ($m.Attachments.Count -gt 0); categories = [string]$m.Categories; messageClass = [string]$m.MessageClass
  }
}

$out = @{ status = 'ok'; account = [string]$ns.CurrentUser.Name; mails = @(); events = @(); errors = @() }
$since = ([datetime]$p.since).ToLocalTime()
$folders = @(@{ id = 'inbox'; num = 6; name = 'Caixa de Entrada'; field = 'ReceivedTime' })
if ($p.includeSent) { $folders += @{ id = 'sentitems'; num = 5; name = 'Itens Enviados'; field = 'SentOn' } }

foreach ($f in $folders) {
  try {
    $fo = $ns.GetDefaultFolder($f.num)
    $items = $fo.Items
    $items.Sort('[' + $f.field + ']', $true)
    $flt = $items.Restrict('[' + $f.field + "] >= '" + $since.ToString('g') + "'")
    $n = 0
    foreach ($m in $flt) {
      if ($m.MessageClass -like 'IPM.Note*' -or $m.MessageClass -like 'IPM.Schedule*') {
        $out.mails += (MailObj $m $f.id $f.name); $n++
        if ($n -ge $p.max) { break }
      }
    }
    if ($f.id -eq 'inbox') {
      $k = 0
      foreach ($m in $fo.Items.Restrict('[FlagStatus] = 2')) {
        if ($m.MessageClass -like 'IPM.Note*') { $out.mails += (MailObj $m 'inbox' $f.name); $k++; if ($k -ge 200) { break } }
      }
    }
  } catch { $out.errors += ($f.name + ': ' + $_.Exception.Message) }
}

if ($p.calendar) {
  try {
    $cal = $ns.GetDefaultFolder(9).Items
    $cal.IncludeRecurrences = $true
    $cal.Sort('[Start]')
    $s = ([datetime]$p.calFrom).ToLocalTime(); $e = ([datetime]$p.calTo).ToLocalTime()
    $r = $cal.Restrict("[Start] <= '" + $e.ToString('g') + "' AND [End] >= '" + $s.ToString('g') + "'")
    $n = 0
    foreach ($a in $r) {
      $n++; if ($n -gt 1500) { break }
      $prev = ''; try { $prev = [string]$a.Body } catch { }
      if ($prev.Length -gt 300) { $prev = $prev.Substring(0, 300) }
      $allDay = [bool]$a.AllDayEvent
      $out.events += [pscustomobject]@{
        id = ([string]$a.EntryID + '|' + ([datetime]$a.Start).ToString('yyyyMMddHHmm'))
        subject = [string]$a.Subject
        start = $(if ($allDay) { ([datetime]$a.Start).ToString('yyyy-MM-dd') } else { Iso $a.Start })
        end = $(if ($allDay) { ([datetime]$a.End).ToString('yyyy-MM-dd') } else { Iso $a.End })
        allDay = $allDay; location = [string]$a.Location; organizer = [string]$a.Organizer
        busy = [int]$a.BusyStatus; meetingStatus = [int]$a.MeetingStatus; responseStatus = [int]$a.ResponseStatus
        body = $prev
      }
    }
  } catch { $out.errors += ('Calendário: ' + $_.Exception.Message) }
}

[Console]::Out.Write(($out | ConvertTo-Json -Depth 5 -Compress))
