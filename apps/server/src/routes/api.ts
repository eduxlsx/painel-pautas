import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  Categoria,
  CategoriaInput,
  Configuracoes,
  PautaInput,
  Projeto,
  ProjetoInput,
  type BootstrapResponse,
  type HealthResponse,
  isOpenStatus,
  STATUS_LABEL,
  PRIORITY_LABEL,
  SOURCE_LABEL,
} from '@pautaflow/shared';
import type { AppContext } from '../core/context';
import { askAssistant, calendarItems, dashboard, priorityList, weekView } from '../modules/views';
import { computeAnalytics, resolvePeriod, toCsv, type PeriodKey } from '../analytics/metrics';
import { addDays, startOfDay } from '../intelligence/dates';
import { autostartStatus, setAutostart } from '../system/windows';
import { bookmarkRoutes } from './bookmarks';

const notFound = (what: string) => Object.assign(new Error(`${what} não encontrado(a)`), { statusCode: 404 });

export function registerApi(app: FastifyInstance, ctx: AppContext) {
  const { db, bus, history, pautas, radar, scheduler, ms, ai, backups, notify, summaries } = ctx;

  /* ------------------------------ Sistema ------------------------------ */

  app.get('/api/bootstrap', async (): Promise<BootstrapResponse> => {
    const v = await ctx.version.info();
    return {
      app: { name: 'PautaFlow Intelligence', version: v.version, versionParts: v.parts, dataDir: ctx.env.dataDir, startedAt: ctx.startedAt.toISOString(), platform: `${os.type()} ${os.release()}` },
      profile: db.users.get(),
      config: db.config.get(),
      microsoft: await ms.status(),
      ai: await ai.status(),
    };
  });

  app.get('/api/health', async (): Promise<HealthResponse> => {
    const checks: HealthResponse['checks'] = [];
    const errored = [db.pautas, db.sugestoes, db.projetos, db.notificacoes].filter((c) => c.lastError);
    checks.push({ key: 'storage', label: 'Armazenamento JSON', status: errored.length ? 'error' : 'ok', detail: errored.length ? `Falha ao gravar: ${errored.map((c) => c.relPath).join(', ')}` : `${db.managedFiles().length} arquivos íntegros` });
    const lastBackup = (await backups.list())[0];
    const backupAge = lastBackup ? (Date.now() - new Date(lastBackup.createdAt).getTime()) / 3_600_000 : null;
    checks.push({ key: 'backup', label: 'Backup', status: backupAge === null ? 'warning' : backupAge > 48 ? 'warning' : 'ok', detail: lastBackup ? `Último: ${new Date(lastBackup.createdAt).toLocaleString('pt-BR')}` : 'Nenhum backup ainda' });
    const msSt = await ms.status();
    checks.push({ key: 'microsoft', label: 'Microsoft 365', status: msSt.connected ? (msSt.lastError ? 'warning' : 'ok') : 'warning', detail: msSt.connected ? (msSt.lastError ?? `Conectado: ${msSt.account?.username ?? ''}`) : msSt.configured ? 'Não conectado' : 'Não configurado' });
    const aiSt = await ai.status();
    checks.push({ key: 'ai', label: 'Inteligência', status: aiSt.provider === 'none' || aiSt.available ? 'ok' : 'warning', detail: aiSt.detail });
    const jobs = await scheduler.list();
    const failing = jobs.filter((j) => j.lastStatus === 'error');
    checks.push({ key: 'automations', label: 'Automações', status: failing.length ? 'warning' : 'ok', detail: failing.length ? `Com falha: ${failing.map((j) => j.name).join(', ')}` : `${jobs.filter((j) => j.enabled).length} ativas` });
    checks.push({ key: 'queue', label: 'Fila do radar', status: radar.queueSize() > 500 ? 'warning' : 'ok', detail: `${radar.queueSize()} item(ns) aguardando análise` });
    const status = checks.some((c) => c.status === 'error') ? 'error' : checks.some((c) => c.status === 'warning') ? 'degraded' : 'ok';
    return { status, uptimeSeconds: Math.round(process.uptime()), checks };
  });

  app.get('/api/version', async () => ctx.version.info());
  app.post('/api/version/bump', async (req) => {
    const b = z.object({ type: z.enum(['feature', 'fix', 'visual']), message: z.string().default('') }).parse(req.body);
    const v = await ctx.version.bump(b.type, b.message);
    await history.record({ entity: 'sistema', entityId: null, action: 'version', summary: `Versão atualizada manualmente para ${v.version}`, actor: 'user' });
    return v;
  });
  app.post('/api/version/set', async (req) => {
    const b = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Use o formato X.Y.Z'), message: z.string().default('') }).parse(req.body);
    const v = await ctx.version.set(b.version, b.message);
    await history.record({ entity: 'sistema', entityId: null, action: 'version', summary: `Versão definida manualmente: ${v.version}`, actor: 'user' });
    return v;
  });

  /** Server-Sent Events: a interface recebe avisos de mudança e atualiza sozinha. */
  app.get('/api/events', (req, reply) => {
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    reply.raw.write(`event: hello\ndata: {}\n\n`);
    const onChange = (topics: string[]) => reply.raw.write(`event: change\ndata: ${JSON.stringify(topics)}\n\n`);
    bus.on('change', onChange);
    const ping = setInterval(() => reply.raw.write(`: ping\n\n`), 25_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      bus.off('change', onChange);
    });
  });

  /* ------------------------------ Perfil / Config ------------------------------ */

  app.patch('/api/profile', async (req) => {
    const b = z.object({ name: z.string().max(80).optional(), email: z.string().nullable().optional(), role: z.string().nullable().optional() }).parse(req.body);
    const p = await db.users.update((u) => {
      Object.assign(u, b);
    });
    bus.changed('config');
    return p;
  });

  app.get('/api/config', async () => db.config.get());
  app.patch('/api/config', async (req) => {
    const patch = req.body as Record<string, unknown>;
    const before = db.config.get();
    const merged: Record<string, unknown> = { ...before };
    for (const [k, v] of Object.entries(patch ?? {})) {
      const cur = (before as Record<string, unknown>)[k];
      merged[k] = v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' ? { ...cur, ...v } : v;
    }
    const next = await db.config.set(Configuracoes.parse(merged));
    if (patch?.ai) ai.invalidate();
    await history.record({ entity: 'config', entityId: null, action: 'updated', summary: `Configurações alteradas: ${Object.keys(patch ?? {}).join(', ')}`, actor: 'user' });
    if (patch?.workday) await pautas.recomputeAll();
    bus.changed('config', 'automacoes');
    return next;
  });

  /* ------------------------------ Dashboard e visões ------------------------------ */

  app.get('/api/dashboard', async () => dashboard(ctx));
  app.get('/api/week', async (req) => {
    const { date } = req.query as { date?: string };
    return weekView(ctx, date ? new Date(`${date}T12:00:00`) : new Date());
  });
  app.get('/api/calendar', async (req) => {
    const q = req.query as { from?: string; to?: string };
    const from = q.from ? new Date(`${q.from}T00:00:00`) : startOfDay(addDays(new Date(), -7));
    const to = q.to ? new Date(`${q.to}T23:59:59`) : addDays(new Date(), 35);
    return calendarItems(ctx, from, to);
  });
  app.get('/api/priorities', async () => priorityList(ctx));
  app.post('/api/priorities/order', async (req) => {
    const { ids } = z.object({ ids: z.array(z.string()) }).parse(req.body);
    await pautas.setManualOrder(ids);
    return priorityList(ctx);
  });
  app.post('/api/priorities/accept', async () => {
    await pautas.acceptRecommended();
    return priorityList(ctx);
  });
  app.post('/api/priorities/recompute', async () => ({ changed: await pautas.recomputeAll() }));

  /* ------------------------------ Pautas ------------------------------ */

  app.get('/api/pautas', async () => db.pautas.list().sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  app.get('/api/pautas/:id', async (req) => {
    const p = db.pautas.get((req.params as { id: string }).id);
    if (!p) throw notFound('Pauta');
    return p;
  });
  app.get('/api/pautas/:id/history', async (req) => history.forEntity((req.params as { id: string }).id));
  app.post('/api/pautas', async (req) => {
    const body = PautaInput.extend({ title: z.string().min(1, 'Informe o título') }).parse(req.body);
    return pautas.create(body, { origin: 'manual', actor: 'user' });
  });
  app.patch('/api/pautas/:id', async (req) => pautas.update((req.params as { id: string }).id, PautaInput.parse(req.body)));
  app.delete('/api/pautas/:id', async (req) => {
    await pautas.remove((req.params as { id: string }).id);
    return { ok: true };
  });

  /* ------------------------------ Projetos e categorias ------------------------------ */

  app.get('/api/projetos', async () => db.projetos.list().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
  app.post('/api/projetos', async (req) => {
    const input = ProjetoInput.extend({ name: z.string().min(1, 'Informe o nome') }).parse(req.body);
    const now = new Date().toISOString();
    const p = await db.projetos.insert(Projeto.parse({ ...input, id: randomUUID(), createdAt: now, updatedAt: now }));
    await history.record({ entity: 'projeto', entityId: p.id, action: 'created', summary: `Projeto criado: ${p.name}`, actor: 'user' });
    bus.changed('projetos');
    return p;
  });
  app.patch('/api/projetos/:id', async (req) => {
    const input = ProjetoInput.parse(req.body);
    const p = await db.projetos.patch((req.params as { id: string }).id, (d) => {
      Object.assign(d, input);
      d.updatedAt = new Date().toISOString();
    });
    await history.record({ entity: 'projeto', entityId: p.id, action: 'updated', summary: `Projeto atualizado: ${p.name}`, actor: 'user' });
    bus.changed('projetos');
    return p;
  });
  app.delete('/api/projetos/:id', async (req) => {
    const { id } = req.params as { id: string };
    const p = db.projetos.get(id);
    if (!p) throw notFound('Projeto');
    await backups.create('pre-op');
    await db.pautas.patchMany(db.pautas.filter((x) => x.projectId === id).map((x) => x.id), (x) => {
      x.projectId = null;
    });
    await db.projetos.remove(id);
    await history.record({ entity: 'projeto', entityId: id, action: 'deleted', summary: `Projeto excluído: ${p.name}`, actor: 'user' });
    bus.changed('projetos', 'pautas');
    return { ok: true };
  });

  app.get('/api/categorias', async () => db.categorias.list().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
  app.post('/api/categorias', async (req) => {
    const input = CategoriaInput.extend({ name: z.string().min(1) }).parse(req.body);
    const c = await db.categorias.insert(Categoria.parse({ ...input, id: randomUUID(), createdAt: new Date().toISOString() }));
    bus.changed('categorias');
    return c;
  });
  app.patch('/api/categorias/:id', async (req) => {
    const input = CategoriaInput.parse(req.body);
    const c = await db.categorias.patch((req.params as { id: string }).id, (d) => {
      Object.assign(d, input);
    });
    bus.changed('categorias');
    return c;
  });
  app.delete('/api/categorias/:id', async (req) => {
    const { id } = req.params as { id: string };
    await db.pautas.patchMany(db.pautas.filter((x) => x.categoryId === id).map((x) => x.id), (x) => {
      x.categoryId = null;
    });
    await db.categorias.remove(id);
    bus.changed('categorias', 'pautas');
    return { ok: true };
  });

  /* ------------------------------ Radar e sugestões ------------------------------ */

  app.get('/api/radar/status', async () => radar.status());
  app.post('/api/radar/scan', async () => {
    void scheduler.runChain(['outlook-sync', 'planner-sync', 'calendar-sync', 'radar-analysis'], 'manual');
    return { started: true };
  });
  app.get('/api/sugestoes', async (req) => {
    const { status } = req.query as { status?: string };
    return db.sugestoes
      .filter((s) => !status || status.split(',').includes(s.status))
      .sort((a, b) => (b.receivedAt ?? b.createdAt).localeCompare(a.receivedAt ?? a.createdAt));
  });
  app.post('/api/sugestoes/:id/approve', async (req) => radar.approve((req.params as { id: string }).id, PautaInput.parse(req.body ?? {})));
  app.post('/api/sugestoes/:id/ignore', async (req) => radar.ignore((req.params as { id: string }).id));
  app.post('/api/sugestoes/:id/restore', async (req) => radar.restore((req.params as { id: string }).id));
  app.post('/api/sugestoes/:id/snooze', async (req) => {
    const { until } = z.object({ until: z.string().min(10) }).parse(req.body);
    return radar.snooze((req.params as { id: string }).id, until);
  });
  app.post('/api/sugestoes/:id/link', async (req) => {
    const { pautaId } = z.object({ pautaId: z.string() }).parse(req.body);
    return radar.link((req.params as { id: string }).id, pautaId);
  });
  app.patch('/api/sugestoes/:id', async (req) => {
    const patch = z
      .object({
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        dueDate: z.string().nullable().optional(),
        suggestedPriority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
        categoryId: z.string().nullable().optional(),
        projectId: z.string().nullable().optional(),
        requester: z.string().nullable().optional(),
        kind: z.enum(['tarefa', 'entrega', 'publicacao', 'reuniao', 'aprovacao']).optional(),
      })
      .parse(req.body);
    return radar.edit((req.params as { id: string }).id, patch);
  });

  /* ------------------------------ Analytics e resumos ------------------------------ */

  const analyticsFor = async (q: { period?: string; from?: string; to?: string }) => {
    const now = new Date();
    const period = resolvePeriod((q.period as PeriodKey) ?? 'month', now, q.from, q.to);
    const hFrom = new Date(Math.min(period.from.getTime() - (period.to.getTime() - period.from.getTime()), addDays(now, -190).getTime()));
    const hist = await history.range(hFrom.toISOString(), now.toISOString(), 50_000);
    return computeAnalytics({ pautas: db.pautas.list(), suggestions: db.sugestoes.list(), categories: db.categorias.list(), projects: db.projetos.list(), history: hist, now }, period);
  };
  app.get('/api/analytics', async (req) => analyticsFor(req.query as Record<string, string>));
  app.get('/api/analytics/export', async (req, reply) => {
    const q = req.query as { period?: string; from?: string; to?: string; format?: string; dataset?: string };
    const a = await analyticsFor(q);
    const stamp = new Date().toISOString().slice(0, 10);
    if (q.format === 'csv') {
      const cats = new Map(db.categorias.list().map((c) => [c.id, c.name]));
      const projs = new Map(db.projetos.list().map((p) => [p.id, p.name]));
      const rows =
        q.dataset === 'metrics'
          ? a.metrics.map((m) => ({ indicador: m.label, valor: m.value, unidade: m.unit ?? '', tipo: m.kind === 'observed' ? 'observado' : 'estimativa', periodo_anterior: m.previous ?? '', observacao: m.note ?? '' }))
          : db.pautas.list().map((p) => ({
              id: p.id,
              titulo: p.title,
              status: STATUS_LABEL[p.status],
              categoria: p.categoryId ? cats.get(p.categoryId) ?? '' : '',
              projeto: p.projectId ? projs.get(p.projectId) ?? '' : '',
              solicitante: p.requester ?? '',
              origem: SOURCE_LABEL[p.origin],
              prioridade_manual: p.manualPriority ? PRIORITY_LABEL[p.manualPriority] : '',
              prioridade_recomendada: PRIORITY_LABEL[p.recommendedPriority],
              score: p.priorityScore,
              criada_em: p.createdAt,
              prazo: p.dueDate ?? '',
              concluida_em: p.completedAt ?? '',
            }));
      reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="pautaflow-${q.dataset ?? 'pautas'}-${stamp}.csv"`);
      return toCsv(rows);
    }
    reply.header('content-disposition', `attachment; filename="pautaflow-relatorio-${stamp}.json"`);
    return a;
  });

  app.get('/api/resumos', async (req) => {
    const { type } = req.query as { type?: 'daily' | 'weekly' | 'monthly' };
    return summaries.list(type);
  });
  app.post('/api/resumos/generate', async (req) => {
    const { type } = z.object({ type: z.enum(['daily', 'weekly', 'monthly']) }).parse(req.body);
    return summaries.generate(type);
  });

  /* ------------------------------ Automações e backups ------------------------------ */

  app.get('/api/automations', async () => scheduler.list());
  app.post('/api/automations/:id/run', async (req) => scheduler.run((req.params as { id: string }).id, 'manual'));
  app.patch('/api/automations/:id', async (req) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    return scheduler.setEnabled((req.params as { id: string }).id, enabled);
  });

  app.get('/api/backups', async () => backups.list());
  app.post('/api/backups', async () => {
    const b = await backups.create('manual');
    await history.record({ entity: 'sistema', entityId: b.id, action: 'backup', summary: `Backup manual criado (${b.files} arquivos)`, actor: 'user' });
    return b;
  });
  app.post('/api/backups/:id/restore', async (req) => {
    const r = await backups.restore((req.params as { id: string }).id);
    await history.record({ entity: 'sistema', entityId: (req.params as { id: string }).id, action: 'restore', summary: `Backup restaurado (cópia de segurança: ${r.safetyBackup})`, actor: 'user' });
    bus.changed('all');
    return r;
  });
  app.get('/api/export', async (_req, reply) => {
    reply.header('content-disposition', `attachment; filename="pautaflow-export-${new Date().toISOString().slice(0, 10)}.json"`);
    return backups.exportAll();
  });

  /* ------------------------------ Notificações e histórico ------------------------------ */

  app.get('/api/notifications', async () => db.notificacoes.list().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100));
  app.post('/api/notifications/:id/read', async (req) => {
    await notify.markRead((req.params as { id: string }).id);
    return { ok: true };
  });
  app.post('/api/notifications/read-all', async () => {
    await notify.markAllRead();
    return { ok: true };
  });
  app.post('/api/notifications/test-native', async () => ({ shown: await notify.sendNative('PautaFlow Intelligence', 'As notificações do Windows estão funcionando.', true) }));
  app.get('/api/history', async (req) => {
    const { limit } = req.query as { limit?: string };
    return history.range(addDays(new Date(), -365).toISOString(), new Date().toISOString(), Math.min(500, Number(limit ?? 100)));
  });

  /* ------------------------------ Integrações ------------------------------ */

  app.get('/api/integrations/microsoft', async () => ms.status());
  app.post('/api/integrations/microsoft/connect', async (req) => {
    const { mode } = z.object({ mode: z.enum(['interactive', 'device_code']) }).parse(req.body);
    ms.startConnect(mode);
    await new Promise((r) => setTimeout(r, mode === 'device_code' ? 2500 : 300));
    return ms.status();
  });
  app.post('/api/integrations/microsoft/disconnect', async () => {
    await ms.disconnect();
    return ms.status();
  });
  app.get('/api/integrations/microsoft/folders', async () => ms.listMailFolders());
  app.get('/api/integrations/microsoft/plans', async () => ms.listPlans());

  /* Outlook deste computador (automação COM do Outlook clássico) */
  app.get('/api/integrations/outlook-local', async () => ctx.outlookLocal.status());
  app.post('/api/integrations/outlook-local/probe', async (req) => {
    const { start } = z.object({ start: z.boolean().default(false) }).parse(req.body ?? {});
    return ctx.outlookLocal.probe(start);
  });
  /** Links "Abrir no Outlook" das sugestões/pautas apontam para cá: abre o item no Outlook da máquina. */
  app.get('/api/integrations/outlook-local/open', async (req, reply) => {
    const { id } = z.object({ id: z.string().min(10).max(600) }).parse(req.query);
    let msg = 'Item aberto no Outlook. Você pode fechar esta aba.';
    try {
      await ctx.outlookLocal.open(id);
    } catch (err) {
      msg = `Não foi possível abrir no Outlook: ${(err as Error).message}`;
    }
    return reply
      .type('text/html; charset=utf-8')
      .send(`<!doctype html><meta charset="utf-8"><title>PautaFlow</title><body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0b1020;color:#e2e8f0"><p>${msg.replace(/[<>&]/g, '')}</p><script>setTimeout(()=>window.close(),1500)</script>`);
  });

  app.get('/api/integrations/discord', async () => ctx.discord.status());
  app.post('/api/integrations/discord/panel', async () => {
    await ctx.discord.refreshPanel(true);
    return ctx.discord.status();
  });

  app.get('/api/ai/status', async () => ai.status(true));
  app.get('/api/ai/ollama/models', async () => {
    try {
      return { available: true, models: await ai.ollamaModels() };
    } catch {
      return { available: false, models: [] };
    }
  });
  app.post('/api/ai/key', async (req) => {
    const { apiKey } = z.object({ apiKey: z.string().nullable() }).parse(req.body);
    await ctx.secrets.set('aiApiKey', apiKey && apiKey.trim() ? apiKey.trim() : null);
    ai.invalidate();
    return ai.status(true);
  });
  app.post('/api/ai/test', async () => {
    const st = await ai.status(true);
    if (!st.available) return { ok: false, detail: st.detail };
    const t0 = Date.now();
    const out = await ai.complete('test', [{ role: 'user', content: 'Responda apenas: OK' }]);
    return { ok: !!out, detail: out ? `Resposta em ${((Date.now() - t0) / 1000).toFixed(1)}s: ${out.slice(0, 80)}` : 'Sem resposta do provedor.' };
  });

  /* ------------------------------ Assistente ------------------------------ */

  app.post('/api/assistant', async (req) => {
    const { question } = z.object({ question: z.string().min(1).max(1000) }).parse(req.body);
    return askAssistant(ctx, question);
  });

  /* ------------------------------ Windows ------------------------------ */

  app.get('/api/system/autostart', async () => autostartStatus());
  app.post('/api/system/autostart', async (req) => {
    const { enable, confirmed } = z.object({ enable: z.boolean(), confirmed: z.literal(true) }).parse(req.body);
    void confirmed;
    await setAutostart(enable);
    await history.record({ entity: 'sistema', entityId: null, action: 'autostart', summary: enable ? 'Inicialização com o Windows ativada' : 'Inicialização com o Windows desativada', actor: 'user' });
    return autostartStatus();
  });

  app.get('/api/stats/open', async () => ({ open: db.pautas.filter((p) => isOpenStatus(p.status)).length }));

  bookmarkRoutes(app, ctx);
}

export async function fileExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
