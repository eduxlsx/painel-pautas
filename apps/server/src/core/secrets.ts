import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from '../storage/atomic';
import { IS_WINDOWS } from '../system/powershell';
import { dpapiProtect, dpapiUnprotect } from '../system/windows';

/**
 * Armazenamento de segredos cifrado com DPAPI (escopo do usuário Windows).
 * Fora do Windows, os segredos ficam apenas em memória (não persistem).
 */
export class SecureBlob {
  private cache: string | null | undefined;

  constructor(private readonly file: string) {}

  get mode(): 'dpapi' | 'memory' {
    return IS_WINDOWS ? 'dpapi' : 'memory';
  }

  async read(): Promise<string | null> {
    if (this.cache !== undefined) return this.cache;
    if (!IS_WINDOWS) return (this.cache = null);
    try {
      const cipher = (await fs.readFile(this.file, 'utf8')).trim();
      this.cache = cipher ? await dpapiUnprotect(cipher) : null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      this.cache = null;
    }
    return this.cache;
  }

  async write(plain: string | null): Promise<void> {
    this.cache = plain;
    if (!IS_WINDOWS) return;
    if (plain === null) {
      await fs.rm(this.file, { force: true });
      return;
    }
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await atomicWriteFile(this.file, await dpapiProtect(plain), { keepBak: false });
  }
}

export class SecretStore {
  private readonly blob: SecureBlob;

  constructor(secureDir: string) {
    this.blob = new SecureBlob(path.join(secureDir, 'secrets.dat'));
  }

  get mode() {
    return this.blob.mode;
  }

  private async all(): Promise<Record<string, string>> {
    const raw = await this.blob.read();
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  }

  async get(key: string): Promise<string | null> {
    return (await this.all())[key] ?? null;
  }

  async set(key: string, value: string | null): Promise<void> {
    const all = await this.all();
    if (value === null) delete all[key];
    else all[key] = value;
    await this.blob.write(JSON.stringify(all));
  }
}
