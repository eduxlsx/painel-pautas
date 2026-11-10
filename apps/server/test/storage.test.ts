import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { JsonFile } from '../src/storage/jsonFile';
import { Collection, ShardedCollection } from '../src/storage/collection';
import { Database } from '../src/storage/db';
import { BackupService } from '../src/storage/backup';
import { tempContext } from './helpers';

const Item = z.object({ id: z.string(), n: z.number() });
type Item = z.infer<typeof Item>;

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

describe('JsonFile', () => {
  it('cria arquivo com valor padrão e persiste atualizações', async () => {
    const t = await tempContext();
    cleanup = t.cleanup;
    const f = new JsonFile('cfg.json', z.object({ a: z.number() }), () => ({ a: 1 }), t.ctx);
    await f.load();
    await f.update((d) => {
      d.a = 42;
    });
    const raw = JSON.parse(await fs.readFile(path.join(t.ctx.dataDir, 'cfg.json'), 'utf8'));
    expect(raw.a).toBe(42);
  });

  it('rejeita atualização inválida sem alterar o estado', async () => {
    const t = await tempContext();
    cleanup = t.cleanup;
    const f = new JsonFile('cfg.json', z.object({ a: z.number() }), () => ({ a: 1 }), t.ctx);
    await f.load();
    await expect(f.update((d) => ({ ...d, a: 'x' as unknown as number }))).rejects.toThrow();
    expect(f.get().a).toBe(1);
  });

  it('recupera a partir do .bak quando o arquivo principal está corrompido', async () => {
    const t = await tempContext();
    cleanup = t.cleanup;
    const f = new JsonFile('cfg.json', z.object({ a: z.number() }), () => ({ a: 0 }), t.ctx);
    await f.load();
    await f.set({ a: 1 });
    await f.set({ a: 2 }); // .bak passa a conter a=1
    await fs.writeFile(f.file, '{"a": 2,,, corrompido');
    const g = new JsonFile('cfg.json', z.object({ a: z.number() }), () => ({ a: 0 }), t.ctx);
    const v = await g.load();
    expect(v.a).toBe(1);
    expect(t.recoveries[0]?.recoveredFrom).toBe('bak');
    const files = await fs.readdir(t.ctx.dataDir);
    expect(files.some((n) => n.includes('.corrupt-'))).toBe(true);
  });

  it('recupera a partir do backup mais recente quando .bak também falha', async () => {
    const t = await tempContext();
    cleanup = t.cleanup;
    const db = new Database(t.ctx);
    await db.loadAll();
    await db.users.update((u) => {
      u.name = 'Eduardo';
    });
    const backups = new BackupService(db, t.ctx.backupsDir);
    await backups.create('manual');
    await fs.writeFile(path.join(t.ctx.dataDir, 'users.json'), 'garbage');
    await fs.writeFile(path.join(t.ctx.dataDir, 'users.json.bak'), 'garbage');
    const db2 = new Database(t.ctx);
    await db2.loadAll();
    expect(db2.users.get().name).toBe('Eduardo');
    expect(t.recoveries.at(-1)?.recoveredFrom).toBe('backup');
  });

  it('serializa gravações concorrentes sem perder dados', async () => {
    const t = await tempContext();
    cleanup = t.cleanup;
    const c = new Collection<Item>('items.json', Item, t.ctx);
    await c.load();
    await Promise.all(Array.from({ length: 200 }, (_, i) => c.insert({ id: `i${i}`, n: i })));
    await c.flush();
    const c2 = new Collection<Item>('items.json', Item, t.ctx);
    await c2.load();
    expect(c2.size).toBe(200);
    expect(c2.get('i199')?.n).toBe(199);
  });

  it('remove temporários órfãos ao iniciar', async () => {
    const t = await tempContext();
    cleanup = t.cleanup;
    await fs.mkdir(t.ctx.dataDir, { recursive: true });
    await fs.writeFile(path.join(t.ctx.dataDir, 'pautas.json.tmp-123-456-0'), 'partial');
    const db = new Database(t.ctx);
    await db.loadAll();
    const files = await fs.readdir(t.ctx.dataDir);
    expect(files.some((n) => n.includes('.tmp-'))).toBe(false);
  });
});

describe('Collection', () => {
  it('patch valida e persiste; NotFound para id inexistente', async () => {
    const t = await tempContext();
    cleanup = t.cleanup;
    const c = new Collection<Item>('items.json', Item, t.ctx);
    await c.load();
    await c.insert({ id: 'a', n: 1 });
    const p = await c.patch('a', (d) => {
      d.n = 5;
    });
    expect(p.n).toBe(5);
    await expect(c.patch('zzz', () => undefined)).rejects.toThrow(/não encontrado/);
    await expect(c.insert({ id: 'a', n: 1 })).rejects.toThrow(/duplicado/);
  });
});

describe('ShardedCollection', () => {
  it('particiona por mês e consulta em ordem decrescente', async () => {
    const t = await tempContext();
    cleanup = t.cleanup;
    const S = z.object({ id: z.string(), at: z.string() });
    const s = new ShardedCollection('hist', S, (i) => i.at.slice(0, 7), t.ctx);
    await s.insert({ id: '1', at: '2026-09-10T10:00:00Z' });
    await s.insert({ id: '2', at: '2026-10-10T10:00:00Z' });
    await s.insert({ id: '3', at: '2026-11-10T10:00:00Z' });
    await s.flush();
    expect(await s.shardNames()).toEqual(['2026-09', '2026-10', '2026-11']);
    const r = await s.query({ limit: 2, sortKey: (i) => i.at });
    expect(r.map((i) => i.id)).toEqual(['3', '2']);
    expect(await s.pruneOlderThan('2026-10')).toBe(1);
  });
});

describe('BackupService', () => {
  it('cria, lista, restaura e exporta', async () => {
    const t = await tempContext();
    cleanup = t.cleanup;
    const db = new Database(t.ctx);
    await db.loadAll();
    const b = new BackupService(db, t.ctx.backupsDir);
    await db.users.update((u) => {
      u.name = 'Antes';
    });
    const bk = await b.create('manual');
    expect(bk.files).toBeGreaterThan(3);
    await db.users.update((u) => {
      u.name = 'Depois';
    });
    const res = await b.restore(bk.id);
    expect(db.users.get().name).toBe('Antes');
    expect(res.safetyBackup).toContain('pre-restore');
    const exp = await b.exportAll();
    expect(Object.keys(exp.files as object)).toContain('users.json');
  });
});
