import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { BackupInfo } from '@pautaflow/shared';
import type { Database } from './db';
import { atomicWriteFile } from './atomic';

const RETENTION: Record<string, number> = { daily: 14, manual: 20, 'pre-op': 10, 'pre-restore': 5 };

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function copyDir(src: string, dst: string, filter: (rel: string) => boolean, rel = ''): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  await fs.mkdir(dst, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (!filter(r)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      const sub = await copyDir(s, d, filter, r);
      files += sub.files;
      bytes += sub.bytes;
    } else if (entry.isFile()) {
      await fs.copyFile(s, d);
      files++;
      bytes += (await fs.stat(d)).size;
    }
  }
  return { files, bytes };
}

const includeInBackup = (rel: string) => !/\.(tmp-.*|corrupt-\d+|bak)$/.test(rel) && rel !== '.lock';

export class BackupService {
  constructor(
    private readonly db: Database,
    private readonly backupsDir: string,
  ) {}

  async create(reason: 'daily' | 'manual' | 'pre-op' | 'pre-restore' = 'manual'): Promise<BackupInfo> {
    await this.db.flushAll();
    const id = `${stamp()}-${reason}`;
    const target = path.join(this.backupsDir, id);
    const { files, bytes } = await copyDir(this.db.ctx.dataDir, path.join(target, 'data'), includeInBackup);
    const info: BackupInfo = { id, createdAt: new Date().toISOString(), reason, files, bytes };
    await atomicWriteFile(path.join(target, 'manifest.json'), JSON.stringify(info, null, 2), { keepBak: false });
    await this.rotate();
    return info;
  }

  async list(): Promise<BackupInfo[]> {
    let dirs: string[] = [];
    try {
      dirs = await fs.readdir(this.backupsDir);
    } catch {
      return [];
    }
    const out: BackupInfo[] = [];
    for (const d of dirs) {
      try {
        const raw = await fs.readFile(path.join(this.backupsDir, d, 'manifest.json'), 'utf8');
        out.push(JSON.parse(raw) as BackupInfo);
      } catch {
        /* diretório sem manifesto: ignora */
      }
    }
    return out.sort((a, b) => b.id.localeCompare(a.id));
  }

  async latestOf(reason: string): Promise<BackupInfo | undefined> {
    return (await this.list()).find((b) => b.reason === reason);
  }

  async rotate(): Promise<number> {
    const all = await this.list();
    let removed = 0;
    for (const [reason, keep] of Object.entries(RETENTION)) {
      const ofReason = all.filter((b) => b.reason === reason);
      for (const old of ofReason.slice(keep)) {
        await fs.rm(path.join(this.backupsDir, old.id), { recursive: true, force: true });
        removed++;
      }
    }
    return removed;
  }

  /** Restaura um backup. Cria antes um backup "pre-restore" do estado atual. */
  async restore(id: string): Promise<{ restoredFiles: number; safetyBackup: string }> {
    if (!/^[\w-]+$/.test(id)) throw new Error('Identificador de backup inválido');
    const src = path.join(this.backupsDir, id, 'data');
    await fs.access(src);
    const safety = await this.create('pre-restore');
    const { files } = await copyDir(src, this.db.ctx.dataDir, includeInBackup);
    await this.db.loadAll();
    return { restoredFiles: files, safetyBackup: safety.id };
  }

  /** Exporta todos os dados operacionais em um único JSON (sem segredos cifrados). */
  async exportAll(): Promise<Record<string, unknown>> {
    await this.db.flushAll();
    const files: Record<string, unknown> = {};
    const walk = async (dir: string, rel = '') => {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (r.startsWith('secure') || !includeInBackup(r)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full, r);
        else if (e.name.endsWith('.json')) {
          try {
            files[r] = JSON.parse(await fs.readFile(full, 'utf8'));
          } catch {
            files[r] = null;
          }
        }
      }
    };
    await walk(this.db.ctx.dataDir);
    return { product: 'PautaFlow Intelligence', exportedAt: new Date().toISOString(), files };
  }
}

/** Impede duas instâncias gravando o mesmo diretório de dados. */
export async function acquireLock(dataDir: string): Promise<() => Promise<void>> {
  await fs.mkdir(dataDir, { recursive: true });
  const lockFile = path.join(dataDir, '.lock');
  try {
    const raw = await fs.readFile(lockFile, 'utf8');
    const pid = Number(JSON.parse(raw).pid);
    if (pid && pid !== process.pid) {
      let alive = false;
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {
        alive = false;
      }
      if (alive) throw new Error(`Outra instância do PautaFlow (PID ${pid}) já está usando ${dataDir}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT' && !(err instanceof SyntaxError)) {
      if ((err as Error).message.startsWith('Outra instância')) throw err;
    }
  }
  await fs.writeFile(lockFile, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  return async () => {
    await fs.rm(lockFile, { force: true });
  };
}
