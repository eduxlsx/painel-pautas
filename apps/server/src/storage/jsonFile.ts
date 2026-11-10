import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ZodType } from 'zod';
import { atomicWriteFile } from './atomic';

export interface StorageLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface RecoveryEvent {
  file: string;
  reason: string;
  recoveredFrom: 'bak' | 'backup' | 'default';
  quarantined: string | null;
}

export interface StorageContext {
  dataDir: string;
  backupsDir: string;
  logger: StorageLogger;
  onRecover?: (ev: RecoveryEvent) => void;
}

/**
 * Arquivo JSON validado por schema, com cache em memória, fila de escrita
 * serializada (coalescente) e recuperação automática de arquivos corrompidos.
 */
export class JsonFile<T> {
  readonly file: string;
  private value: T | undefined;
  private chain: Promise<void> = Promise.resolve();
  private pending: Promise<void> | null = null;
  private lastError: Error | null = null;
  writes = 0;

  constructor(
    readonly relPath: string,
    private readonly schema: ZodType<T>,
    private readonly defaults: () => T,
    private readonly ctx: StorageContext,
  ) {
    this.file = path.join(ctx.dataDir, relPath);
  }

  get loaded(): boolean {
    return this.value !== undefined;
  }

  get error(): Error | null {
    return this.lastError;
  }

  async load(): Promise<T> {
    this.value = await this.readWithRecovery();
    return this.value;
  }

  get(): T {
    if (this.value === undefined) throw new Error(`${this.relPath} ainda não foi carregado`);
    return this.value;
  }

  /** Substitui o valor (validado) e agenda gravação. */
  async set(next: T): Promise<T> {
    const parsed = this.schema.parse(next);
    this.value = parsed;
    await this.scheduleWrite();
    return parsed;
  }

  /** Atualização transacional: o mutador trabalha numa cópia; só é aplicada se válida. */
  async update(mutator: (draft: T) => T | void): Promise<T> {
    const draft = structuredClone(this.get());
    const result = mutator(draft);
    return this.set((result ?? draft) as T);
  }

  /** Aplica mudança já validada externamente (usado por coleções com validação por item). */
  async commit(next: T): Promise<void> {
    this.value = next;
    await this.scheduleWrite();
  }

  flush(): Promise<void> {
    return this.pending ?? this.chain;
  }

  private scheduleWrite(): Promise<void> {
    if (this.pending) return this.pending;
    const run = this.chain.then(async () => {
      this.pending = null; // mudanças a partir daqui geram nova gravação
      const content = JSON.stringify(this.value, null, 1);
      try {
        await atomicWriteFile(this.file, content);
        this.writes++;
        this.lastError = null;
      } catch (err) {
        this.lastError = err as Error;
        this.ctx.logger.error({ err, file: this.relPath }, 'Falha ao gravar arquivo JSON');
        throw err;
      }
    });
    this.pending = run;
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async tryRead(file: string): Promise<{ ok: true; value: T } | { ok: false; reason: string; missing: boolean }> {
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      return { ok: false, reason: code === 'ENOENT' ? 'arquivo inexistente' : String(err), missing: code === 'ENOENT' };
    }
    if (raw.trim() === '') return { ok: false, reason: 'arquivo vazio', missing: false };
    let json: unknown;
    try {
      json = JSON.parse(raw.replace(/^﻿/, ''));
    } catch (err) {
      return { ok: false, reason: `JSON inválido: ${(err as Error).message}`, missing: false };
    }
    const parsed = this.schema.safeParse(json);
    if (!parsed.success) {
      return { ok: false, reason: `schema inválido: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, missing: false };
    }
    return { ok: true, value: parsed.data };
  }

  private async readWithRecovery(): Promise<T> {
    const primary = await this.tryRead(this.file);
    if (primary.ok) return primary.value;

    let quarantined: string | null = null;
    if (!primary.missing) {
      quarantined = `${this.file}.corrupt-${Date.now()}`;
      await fs.rename(this.file, quarantined).catch(() => {
        quarantined = null;
      });
      this.ctx.logger.warn({ file: this.relPath, reason: primary.reason, quarantined }, 'Arquivo JSON inválido — iniciando recuperação');
    }

    const bak = await this.tryRead(`${this.file}.bak`);
    if (bak.ok) {
      await this.persistRecovered(bak.value);
      this.report(primary, 'bak', quarantined);
      return bak.value;
    }

    // Procura nos backups (mais recente primeiro)
    const fromBackup = await this.readFromBackups();
    if (fromBackup !== undefined) {
      await this.persistRecovered(fromBackup);
      this.report(primary, 'backup', quarantined);
      return fromBackup;
    }

    const def = this.schema.parse(this.defaults());
    await this.persistRecovered(def);
    if (!primary.missing) this.report(primary, 'default', quarantined);
    return def;
  }

  private async readFromBackups(): Promise<T | undefined> {
    let dirs: string[] = [];
    try {
      dirs = (await fs.readdir(this.ctx.backupsDir)).sort().reverse();
    } catch {
      return undefined;
    }
    for (const d of dirs) {
      const candidate = path.join(this.ctx.backupsDir, d, 'data', this.relPath);
      const r = await this.tryRead(candidate);
      if (r.ok) return r.value;
    }
    return undefined;
  }

  private async persistRecovered(value: T) {
    this.value = value;
    await atomicWriteFile(this.file, JSON.stringify(value, null, 1), { keepBak: false });
  }

  private report(primary: { reason: string; missing: boolean }, from: RecoveryEvent['recoveredFrom'], quarantined: string | null) {
    const ev: RecoveryEvent = { file: this.relPath, reason: primary.reason, recoveredFrom: from, quarantined };
    this.ctx.logger.warn(ev, 'Arquivo JSON recuperado');
    this.ctx.onRecover?.(ev);
  }
}
