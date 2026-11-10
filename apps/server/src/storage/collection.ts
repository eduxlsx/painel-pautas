import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z, type ZodType } from 'zod';
import { JsonFile, type StorageContext } from './jsonFile';

export interface Identified {
  id: string;
}

function collectionSchema<T>(item: ZodType<T>) {
  return z.object({
    version: z.number().default(1),
    updatedAt: z.string().nullable().default(null),
    items: z.array(item).default([]),
  });
}

type CollectionData<T> = { version: number; updatedAt: string | null; items: T[] };

/**
 * Coleção de registros com índice em memória. Cada mutação valida apenas
 * os itens alterados e enfileira uma gravação atômica do arquivo.
 */
export class Collection<T extends Identified> {
  private readonly file: JsonFile<CollectionData<T>>;
  private index = new Map<string, T>();

  constructor(
    relPath: string,
    private readonly itemSchema: ZodType<T>,
    ctx: StorageContext,
  ) {
    this.file = new JsonFile(relPath, collectionSchema(itemSchema) as unknown as ZodType<CollectionData<T>>, () => ({ version: 1, updatedAt: null, items: [] }), ctx);
  }

  get relPath() {
    return this.file.relPath;
  }

  async load(): Promise<void> {
    const data = await this.file.load();
    this.index = new Map(data.items.map((i) => [i.id, i]));
  }

  list(): T[] {
    return [...this.index.values()];
  }

  get size(): number {
    return this.index.size;
  }

  get(id: string): T | undefined {
    return this.index.get(id);
  }

  find(pred: (item: T) => boolean): T | undefined {
    for (const i of this.index.values()) if (pred(i)) return i;
    return undefined;
  }

  filter(pred: (item: T) => boolean): T[] {
    return this.list().filter(pred);
  }

  async insert(item: T): Promise<T> {
    const parsed = this.itemSchema.parse(item);
    if (this.index.has(parsed.id)) throw new Error(`Registro duplicado: ${parsed.id}`);
    this.index.set(parsed.id, parsed);
    await this.persist();
    return parsed;
  }

  async upsertMany(items: T[]): Promise<void> {
    for (const item of items) {
      const parsed = this.itemSchema.parse(item);
      this.index.set(parsed.id, parsed);
    }
    if (items.length) await this.persist();
  }

  async patch(id: string, mutator: (draft: T) => T | void): Promise<T> {
    const current = this.index.get(id);
    if (!current) throw new NotFoundError(id);
    const draft = structuredClone(current);
    const result = (mutator(draft) ?? draft) as T;
    const parsed = this.itemSchema.parse(result);
    this.index.set(id, parsed);
    await this.persist();
    return parsed;
  }

  /** Aplica a mesma mutação a vários registros com uma única gravação. */
  async patchMany(ids: string[], mutator: (draft: T) => T | void): Promise<T[]> {
    const out: T[] = [];
    const staged = new Map<string, T>();
    for (const id of ids) {
      const current = this.index.get(id);
      if (!current) continue;
      const draft = structuredClone(current);
      const parsed = this.itemSchema.parse((mutator(draft) ?? draft) as T);
      staged.set(id, parsed);
      out.push(parsed);
    }
    for (const [id, v] of staged) this.index.set(id, v);
    if (staged.size) await this.persist();
    return out;
  }

  async remove(id: string): Promise<boolean> {
    const existed = this.index.delete(id);
    if (existed) await this.persist();
    return existed;
  }

  async removeWhere(pred: (item: T) => boolean): Promise<number> {
    let n = 0;
    for (const [id, item] of this.index) {
      if (pred(item)) {
        this.index.delete(id);
        n++;
      }
    }
    if (n) await this.persist();
    return n;
  }

  async replaceAll(items: T[]): Promise<void> {
    const parsed = items.map((i) => this.itemSchema.parse(i));
    this.index = new Map(parsed.map((i) => [i.id, i]));
    await this.persist();
  }

  flush() {
    return this.file.flush();
  }

  get lastError() {
    return this.file.error;
  }

  private persist(): Promise<void> {
    return this.file.commit({ version: 1, updatedAt: new Date().toISOString(), items: [...this.index.values()] });
  }
}

export class NotFoundError extends Error {
  readonly statusCode = 404;
  constructor(id: string) {
    super(`Registro não encontrado: ${id}`);
  }
}

/**
 * Coleção particionada por mês (ex.: historico/2026-11.json) para evitar
 * arquivos gigantes. Partições antigas são carregadas sob demanda.
 */
export class ShardedCollection<T extends Identified> {
  private shards = new Map<string, Collection<T>>();

  constructor(
    private readonly dir: string,
    private readonly itemSchema: ZodType<T>,
    private readonly shardKey: (item: T) => string,
    private readonly ctx: StorageContext,
  ) {}

  static monthKey(iso: string): string {
    return iso.slice(0, 7);
  }

  async shardNames(): Promise<string[]> {
    try {
      const files = await fs.readdir(path.join(this.ctx.dataDir, this.dir));
      return files
        .filter((f) => /^\d{4}-\d{2}\.json$/.test(f))
        .map((f) => f.slice(0, 7))
        .sort();
    } catch {
      return [];
    }
  }

  async shard(key: string): Promise<Collection<T>> {
    let c = this.shards.get(key);
    if (!c) {
      c = new Collection<T>(path.join(this.dir, `${key}.json`), this.itemSchema, this.ctx);
      await c.load();
      this.shards.set(key, c);
    }
    return c;
  }

  async insert(item: T): Promise<T> {
    const c = await this.shard(this.shardKey(item));
    return c.insert(item);
  }

  async upsert(item: T): Promise<T> {
    const c = await this.shard(this.shardKey(item));
    await c.upsertMany([item]);
    return c.get(item.id)!;
  }

  /** Lista do mais recente para o mais antigo, percorrendo partições até atingir o limite. */
  async query(opts: { from?: string; to?: string; limit?: number; filter?: (i: T) => boolean; sortKey: (i: T) => string }): Promise<T[]> {
    const names = (await this.shardNames()).reverse();
    for (const key of this.shards.keys()) if (!names.includes(key)) names.unshift(key);
    const out: T[] = [];
    const limit = opts.limit ?? Infinity;
    for (const key of names) {
      if (opts.from && key < opts.from.slice(0, 7)) break;
      if (opts.to && key > opts.to.slice(0, 7)) continue;
      const c = await this.shard(key);
      let items = c.list();
      if (opts.filter) items = items.filter(opts.filter);
      if (opts.from) items = items.filter((i) => opts.sortKey(i) >= opts.from!);
      if (opts.to) items = items.filter((i) => opts.sortKey(i) <= opts.to!);
      out.push(...items);
      if (out.length >= limit * 2) break;
    }
    out.sort((a, b) => opts.sortKey(b).localeCompare(opts.sortKey(a)));
    return out.slice(0, limit);
  }

  async flush() {
    await Promise.all([...this.shards.values()].map((s) => s.flush()));
  }

  async pruneOlderThan(monthKey: string): Promise<number> {
    let removed = 0;
    for (const key of await this.shardNames()) {
      if (key < monthKey) {
        await fs.rm(path.join(this.ctx.dataDir, this.dir, `${key}.json`), { force: true });
        await fs.rm(path.join(this.ctx.dataDir, this.dir, `${key}.json.bak`), { force: true });
        this.shards.delete(key);
        removed++;
      }
    }
    return removed;
  }
}
