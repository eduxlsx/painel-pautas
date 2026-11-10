import { spawn } from 'node:child_process';

export const IS_WINDOWS = process.platform === 'win32';

export interface PsOptions {
  stdin?: string;
  timeoutMs?: number;
  sta?: boolean;
}

/**
 * Executa um script do Windows PowerShell 5.1 via -EncodedCommand (sem problemas de aspas).
 * Dados variáveis devem ser passados por stdin, nunca interpolados no script.
 */
export function runPowerShell(script: string, opts: PsOptions = {}): Promise<string> {
  if (!IS_WINDOWS) return Promise.reject(new Error('Recurso disponível apenas no Windows'));
  const prelude = '$ProgressPreference="SilentlyContinue"; $ErrorActionPreference="Stop"; [Console]::OutputEncoding=[Text.Encoding]::UTF8; $InputEncoding=[Text.Encoding]::UTF8;\n';
  const encoded = Buffer.from(prelude + script, 'utf16le').toString('base64');
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
  if (opts.sta) args.push('-STA');
  args.push('-EncodedCommand', encoded);
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', args, { windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Tempo esgotado ao executar PowerShell'));
    }, opts.timeoutMs ?? 30_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => (out += d));
    child.stderr.on('data', (d: string) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(cleanPsError(err) || `PowerShell saiu com código ${code}`));
    });
    if (opts.stdin !== undefined) {
      // Base64 garante transporte seguro de qualquer conteúdo pelo stdin
      child.stdin.end(Buffer.from(opts.stdin, 'utf8').toString('base64'));
    } else child.stdin.end();
  });
}

/** Converte o stderr do PowerShell (às vezes em CLIXML) em uma mensagem curta e legível. */
export function cleanPsError(err: string): string {
  let text = err.trim();
  if (text.startsWith('#< CLIXML')) {
    text = [...text.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map((m) => m[1]!).join('');
    text = text.replace(/_x000D__x000A_/g, '\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }
  const first = text.split('\n').map((l) => l.trim()).filter((l) => l && !/^(No linha|At line|\+|CategoryInfo|FullyQualifiedErrorId)/.test(l));
  return first.slice(0, 3).join(' ').slice(0, 500);
}

/** Lê o stdin (base64) como texto UTF-8 dentro do script PowerShell. */
export const PS_READ_STDIN = '$__in=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()));';
