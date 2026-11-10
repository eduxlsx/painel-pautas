import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Bookmark, BookmarkInput } from '@pautaflow/shared';
import type { AppContext } from '../core/context';
import { onlyProvided } from '../core/patch';
import { getSyncRoots, openLocalPath, openUrl, pathInfo, pickPaths, webUrlFor } from '../system/windows';

function isUrl(s: string) {
  return /^https?:\/\//i.test(s);
}

export function bookmarkRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, bus, history } = ctx;

  async function build(input: z.infer<typeof BookmarkInput> & { location: string }): Promise<Bookmark> {
    const location = input.location.trim().replace(/^"(.*)"$/, '$1');
    let kind = input.kind;
    let webUrl = input.webUrl ?? null;
    if (isUrl(location)) {
      kind = 'url';
      new URL(location); // valida
    } else {
      if (!path.isAbsolute(location)) throw Object.assign(new Error('Informe um caminho absoluto (ex.: C:\\Pasta\\arquivo.docx) ou uma URL'), { statusCode: 400 });
      const info = await pathInfo(location);
      if (!info.exists) throw Object.assign(new Error('Arquivo ou pasta não encontrado neste computador'), { statusCode: 400 });
      kind = info.isDir ? 'folder' : 'file';
      webUrl ??= webUrlFor(location, await getSyncRoots());
    }
    const now = new Date().toISOString();
    return Bookmark.parse({
      id: randomUUID(),
      name: input.name?.trim() || (kind === 'url' ? new URL(location).hostname : path.basename(location) || location),
      kind,
      location,
      webUrl,
      description: input.description ?? '',
      tags: input.tags ?? [],
      pautaId: input.pautaId ?? null,
      projectId: input.projectId ?? null,
      pinned: input.pinned ?? false,
      createdAt: now,
      updatedAt: now,
    });
  }

  app.get('/api/bookmarks', async (req) => {
    const q = req.query as { pautaId?: string; projectId?: string };
    return db.bookmarks
      .filter((b) => (!q.pautaId || b.pautaId === q.pautaId) && (!q.projectId || b.projectId === q.projectId))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastOpenedAt ?? b.createdAt).localeCompare(a.lastOpenedAt ?? a.createdAt));
  });

  /** Verifica se os caminhos locais ainda existem (para indicar links quebrados). */
  app.get('/api/bookmarks/status', async () => {
    const out: Record<string, { exists: boolean; size: number | null; modifiedAt: string | null }> = {};
    await Promise.all(
      db.bookmarks.list().map(async (b) => {
        out[b.id] = b.kind === 'url' ? { exists: true, size: null, modifiedAt: null } : await pathInfo(b.location);
      }),
    );
    return out;
  });

  app.post('/api/bookmarks', async (req) => {
    const input = BookmarkInput.extend({ location: z.string().min(1) }).parse(req.body);
    const b = await build(input);
    await db.bookmarks.insert(b);
    await history.record({ entity: 'sistema', entityId: b.id, action: 'bookmark_added', summary: `Arquivo sinalizado: ${b.name}`, actor: 'user' });
    bus.changed('bookmarks');
    return b;
  });

  /** Abre o seletor nativo do Windows e sinaliza os itens escolhidos. */
  app.post('/api/bookmarks/pick', async (req) => {
    const body = z.object({ kind: z.enum(['file', 'folder']), pautaId: z.string().nullable().optional(), projectId: z.string().nullable().optional() }).parse(req.body);
    const paths = await pickPaths(body.kind, true);
    const created: Bookmark[] = [];
    for (const p of paths) {
      const existing = db.bookmarks.find((b) => b.location.toLowerCase() === p.toLowerCase() && b.pautaId === (body.pautaId ?? null));
      if (existing) {
        created.push(existing);
        continue;
      }
      const b = await build({ location: p, kind: body.kind, pautaId: body.pautaId ?? null, projectId: body.projectId ?? null });
      await db.bookmarks.insert(b);
      created.push(b);
    }
    if (created.length) {
      await history.record({ entity: 'sistema', entityId: null, action: 'bookmark_added', summary: `${created.length} item(ns) sinalizado(s)`, actor: 'user' });
      bus.changed('bookmarks');
    }
    return { cancelled: paths.length === 0, items: created };
  });

  app.patch('/api/bookmarks/:id', async (req) => {
    const { id } = req.params as { id: string };
    const input = onlyProvided(BookmarkInput.omit({ location: true, kind: true }).parse(req.body), req.body);
    const b = await db.bookmarks.patch(id, (d) => {
      Object.assign(d, input);
      d.updatedAt = new Date().toISOString();
    });
    bus.changed('bookmarks');
    return b;
  });

  app.delete('/api/bookmarks/:id', async (req) => {
    const { id } = req.params as { id: string };
    await db.bookmarks.remove(id);
    bus.changed('bookmarks');
    return { ok: true };
  });

  /** Abre o item: pasta no Explorer, arquivo no app padrão, "reveal" seleciona no Explorer, "web" abre o link do SharePoint/OneDrive. */
  app.post('/api/bookmarks/:id/open', async (req) => {
    const { id } = req.params as { id: string };
    const { mode } = z.object({ mode: z.enum(['open', 'reveal', 'web']).default('open') }).parse(req.body ?? {});
    const b = db.bookmarks.get(id);
    if (!b) throw Object.assign(new Error('Item não encontrado'), { statusCode: 404 });
    if (b.kind === 'url') openUrl(b.location);
    else if (mode === 'web') {
      if (!b.webUrl) throw Object.assign(new Error('Este item não possui link web'), { statusCode: 400 });
      openUrl(b.webUrl);
    } else await openLocalPath(b.location, mode);
    await db.bookmarks.patch(id, (d) => {
      d.lastOpenedAt = new Date().toISOString();
    });
    bus.changed('bookmarks');
    return { ok: true };
  });

  /** Recalcula links web (útil após configurar a sincronização do OneDrive/SharePoint). */
  app.post('/api/bookmarks/refresh-web', async () => {
    const roots = await getSyncRoots();
    const ids = db.bookmarks.filter((b) => b.kind !== 'url' && !b.webUrl).map((b) => b.id);
    let updated = 0;
    await db.bookmarks.patchMany(ids, (b) => {
      const w = webUrlFor(b.location, roots);
      if (w) {
        b.webUrl = w;
        updated++;
      }
    });
    bus.changed('bookmarks');
    return { updated, syncRoots: roots.length };
  });
}
