import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { IS_WINDOWS, PS_READ_STDIN, runPowerShell } from './powershell';
import { REPO_ROOT } from '../env';

/* ------------------------------------------------------------------ */
/* DPAPI (escopo do usuário atual)                                     */
/* ------------------------------------------------------------------ */

export async function dpapiProtect(plain: string): Promise<string> {
  const script = `${PS_READ_STDIN}
Add-Type -AssemblyName System.Security
$b=[Text.Encoding]::UTF8.GetBytes($__in)
$p=[Security.Cryptography.ProtectedData]::Protect($b,[Text.Encoding]::UTF8.GetBytes('PautaFlow'),[Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($p))`;
  return runPowerShell(script, { stdin: plain });
}

export async function dpapiUnprotect(cipherB64: string): Promise<string> {
  const script = `${PS_READ_STDIN}
Add-Type -AssemblyName System.Security
$p=[Convert]::FromBase64String($__in)
$b=[Security.Cryptography.ProtectedData]::Unprotect($p,[Text.Encoding]::UTF8.GetBytes('PautaFlow'),[Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($b))`;
  const b64 = await runPowerShell(script, { stdin: cipherB64 });
  return Buffer.from(b64, 'base64').toString('utf8');
}

/* ------------------------------------------------------------------ */
/* Notificação nativa (toast)                                          */
/* ------------------------------------------------------------------ */

export async function showToast(title: string, body: string): Promise<void> {
  const script = `${PS_READ_STDIN}
$d = $__in | ConvertFrom-Json
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
$t=[Security.SecurityElement]::Escape($d.title); $b=[Security.SecurityElement]::Escape($d.body)
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$t</text><text>$b</text></binding></visual></toast>")
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)`;
  await runPowerShell(script, { stdin: JSON.stringify({ title: title.slice(0, 120), body: body.slice(0, 300) }) });
}

/* ------------------------------------------------------------------ */
/* Seletor nativo de arquivos/pastas                                   */
/* ------------------------------------------------------------------ */

export async function pickPaths(kind: 'file' | 'folder', multiple = true): Promise<string[]> {
  const script =
    kind === 'folder'
      ? `Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{TopMost=$true; ShowInTaskbar=$false; Opacity=0}
$owner.Show(); $owner.Activate()
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'PautaFlow — selecione a pasta para sinalizar'
$d.ShowNewFolderButton = $false
$r = $d.ShowDialog($owner)
$owner.Close()
if ($r -eq 'OK') { [Console]::Out.Write((ConvertTo-Json @($d.SelectedPath) -Compress)) } else { [Console]::Out.Write('[]') }`
      : `Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{TopMost=$true; ShowInTaskbar=$false; Opacity=0}
$owner.Show(); $owner.Activate()
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Title = 'PautaFlow — selecione arquivo(s) para sinalizar'
$d.Multiselect = $${multiple ? 'true' : 'false'}
$d.CheckFileExists = $true
$r = $d.ShowDialog($owner)
$owner.Close()
if ($r -eq 'OK') { [Console]::Out.Write((ConvertTo-Json @($d.FileNames) -Compress)) } else { [Console]::Out.Write('[]') }`;
  const out = await runPowerShell(script, { sta: true, timeoutMs: 10 * 60_000 });
  const parsed = JSON.parse(out || '[]') as string[] | string;
  return Array.isArray(parsed) ? parsed : [parsed];
}

/* ------------------------------------------------------------------ */
/* Abrir caminhos e URLs                                               */
/* ------------------------------------------------------------------ */

function detached(cmd: string, args: string[]) {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
}

export async function pathInfo(p: string): Promise<{ exists: boolean; isDir: boolean; size: number | null; modifiedAt: string | null }> {
  try {
    const s = await fs.stat(p);
    return { exists: true, isDir: s.isDirectory(), size: s.isDirectory() ? null : s.size, modifiedAt: s.mtime.toISOString() };
  } catch {
    return { exists: false, isDir: false, size: null, modifiedAt: null };
  }
}

/** Abre uma pasta no Explorer, ou um arquivo com o aplicativo padrão (ou selecionado no Explorer). */
export async function openLocalPath(p: string, mode: 'open' | 'reveal' = 'open'): Promise<void> {
  if (!IS_WINDOWS) throw new Error('Abrir caminhos locais está disponível apenas no Windows');
  if (!path.isAbsolute(p)) throw new Error('Caminho deve ser absoluto');
  const info = await pathInfo(p);
  if (!info.exists) throw new Error('Arquivo ou pasta não encontrado neste computador');
  if (mode === 'reveal' || info.isDir) {
    detached('explorer.exe', info.isDir && mode === 'open' ? [p] : [`/select,${p}`]);
  } else {
    // Abre com o aplicativo padrão associado à extensão
    detached('rundll32.exe', ['url.dll,FileProtocolHandler', p]);
  }
}

export function openUrl(url: string): void {
  const u = new URL(url);
  if (!['http:', 'https:', 'mailto:', 'ms-outlook:', 'msteams:'].includes(u.protocol)) throw new Error('Protocolo de URL não permitido');
  if (!IS_WINDOWS) throw new Error('Disponível apenas no Windows');
  detached('rundll32.exe', ['url.dll,FileProtocolHandler', u.toString()]);
}

/* ------------------------------------------------------------------ */
/* Link web de pastas sincronizadas (OneDrive / SharePoint)            */
/* ------------------------------------------------------------------ */

interface SyncRoot {
  mountPoint: string;
  urlNamespace: string;
}
let syncRootsCache: { at: number; roots: SyncRoot[] } | null = null;

/** Lê (somente leitura) o mapeamento de bibliotecas sincronizadas pelo OneDrive no registro do usuário. */
export async function getSyncRoots(): Promise<SyncRoot[]> {
  if (!IS_WINDOWS) return [];
  if (syncRootsCache && Date.now() - syncRootsCache.at < 10 * 60_000) return syncRootsCache.roots;
  const script = `$out=@()
$base='HKCU:\\Software\\SyncEngines\\Providers\\OneDrive'
if (Test-Path $base) { Get-ChildItem $base | ForEach-Object { $p = Get-ItemProperty $_.PSPath; if ($p.MountPoint -and $p.UrlNamespace) { $out += [pscustomobject]@{ mountPoint=$p.MountPoint; urlNamespace=$p.UrlNamespace } } } }
[Console]::Out.Write((ConvertTo-Json @($out) -Compress))`;
  try {
    const raw = await runPowerShell(script);
    const parsed = JSON.parse(raw || '[]') as SyncRoot[] | SyncRoot;
    const roots = (Array.isArray(parsed) ? parsed : [parsed]).filter((r) => r?.mountPoint && r?.urlNamespace);
    // Mais específicos primeiro
    roots.sort((a, b) => b.mountPoint.length - a.mountPoint.length);
    syncRootsCache = { at: Date.now(), roots };
    return roots;
  } catch {
    return [];
  }
}

/** Converte um caminho local sincronizado em URL web do SharePoint/OneDrive, quando possível. */
export function webUrlFor(localPath: string, roots: SyncRoot[]): string | null {
  const lp = path.normalize(localPath).toLowerCase();
  for (const r of roots) {
    const mp = path.normalize(r.mountPoint).toLowerCase();
    if (lp === mp || lp.startsWith(mp + path.sep)) {
      const rel = path.normalize(localPath).slice(path.normalize(r.mountPoint).length).split(path.sep).filter(Boolean);
      const base = r.urlNamespace.endsWith('/') ? r.urlNamespace : `${r.urlNamespace}/`;
      try {
        const u = new URL(base);
        const segs = rel.map((s) => encodeURIComponent(s));
        return u.toString() + segs.join('/');
      } catch {
        return null;
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Inicialização com o Windows (Agendador de Tarefas)                  */
/* ------------------------------------------------------------------ */

export const TASK_NAME = 'PautaFlow Intelligence';

export async function autostartStatus(): Promise<{ supported: boolean; enabled: boolean; detail: string }> {
  if (!IS_WINDOWS) return { supported: false, enabled: false, detail: 'Disponível apenas no Windows' };
  try {
    const out = await runPowerShell(
      `$t = Get-ScheduledTask -TaskName '${TASK_NAME}' -ErrorAction SilentlyContinue; if ($t) { [Console]::Out.Write($t.State) } else { [Console]::Out.Write('none') }`,
    );
    return { supported: true, enabled: out !== 'none', detail: out === 'none' ? 'Não configurado' : `Tarefa agendada: ${out}` };
  } catch (err) {
    return { supported: true, enabled: false, detail: (err as Error).message };
  }
}

/** Registra/remove a tarefa de logon. Só é chamado após confirmação explícita do usuário na interface. */
export async function setAutostart(enable: boolean): Promise<void> {
  const script = path.join(REPO_ROOT, 'scripts', enable ? 'install-autostart.ps1' : 'uninstall-autostart.ps1');
  await runPowerShell(`& '${script.replace(/'/g, "''")}'`, { timeoutMs: 60_000 });
}
