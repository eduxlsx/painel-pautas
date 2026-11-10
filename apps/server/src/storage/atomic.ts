import { promises as fs, constants as fsc } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

let tmpCounter = 0;

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES', 'EMFILE', 'ENOTEMPTY']);

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** fs.rename com novas tentativas — no Windows antivírus/indexador podem bloquear o arquivo por instantes. */
export async function renameWithRetry(from: string, to: string, attempts = 8): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (!RETRYABLE.has(code)) throw err;
      await sleep(25 * 2 ** i);
    }
  }
  throw lastErr;
}

export function sha1(content: string): string {
  return createHash('sha1').update(content).digest('hex');
}

/**
 * Escrita atômica:
 * 1. grava em arquivo temporário no mesmo diretório;
 * 2. fsync do conteúdo;
 * 3. preserva a versão atual como `.bak` (última versão íntegra);
 * 4. substitui o arquivo principal via rename (atômico no mesmo volume);
 * 5. relê e confere o hash do conteúdo gravado.
 */
export async function atomicWriteFile(file: string, content: string, opts: { keepBak?: boolean } = {}): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${tmpCounter++}`;
  const handle = await fs.open(tmp, fsc.O_CREAT | fsc.O_WRONLY | fsc.O_TRUNC, 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (opts.keepBak !== false) {
      try {
        await fs.copyFile(file, `${file}.bak`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
    await renameWithRetry(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
  const written = await fs.readFile(file, 'utf8');
  if (sha1(written) !== sha1(content)) {
    throw new Error(`Validação pós-escrita falhou para ${path.basename(file)}`);
  }
}

/** Remove temporários órfãos deixados por quedas de energia/encerramentos inesperados. */
export async function cleanupOrphanTemps(dir: string): Promise<number> {
  let removed = 0;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return 0;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    if (/\.tmp-\d+-\d+-\d+$/.test(name)) {
      await fs.rm(full, { force: true }).catch(() => undefined);
      removed++;
      continue;
    }
    const stat = await fs.stat(full).catch(() => null);
    if (stat?.isDirectory()) removed += await cleanupOrphanTemps(full);
  }
  return removed;
}
