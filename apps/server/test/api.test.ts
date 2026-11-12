import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { resolveEnv } from '../src/env';
import { createContext, type AppContext } from '../src/core/context';
import { buildApp } from '../src/app';
import { silentLogger } from './helpers';

/** Microsoft Graph simulado — usado exclusivamente nos testes automatizados. */
function fakeGraph() {
  const now = new Date();
  const inTwoDays = new Date(now.getTime() + 2 * 86_400_000);
  const dd = `${String(inTwoDays.getDate()).padStart(2, '0')}/${String(inTwoDays.getMonth() + 1).padStart(2, '0')}`;
  const state = { plannerTitle: 'Revisar release Fenasucro', calls: [] as string[] };
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    state.calls.push(url);
    if (url.includes('/mailFolders/inbox/messages/delta'))
      return json({
        value: [
          {
            id: 'msg-1',
            subject: 'Release Fenasucro',
            from: { emailAddress: { name: 'Ana Souza', address: 'ana@empresa.com' } },
            toRecipients: [{ emailAddress: { address: 'eu@empresa.com' } }],
            receivedDateTime: now.toISOString(),
            bodyPreview: 'Você pode revisar o release?',
            body: { contentType: 'text', content: `Oi! Você pode revisar o release da Fenasucro até ${dd}? Precisamos enviar ao jornalista.` },
            importance: 'normal',
            flag: { flagStatus: 'notFlagged' },
            conversationId: 'conv-1',
            webLink: 'https://outlook.office.com/mail/msg-1',
          },
          {
            id: 'msg-2',
            subject: 'Newsletter semanal',
            from: { emailAddress: { name: 'News', address: 'no-reply@news.com' } },
            receivedDateTime: now.toISOString(),
            body: { contentType: 'text', content: 'Novidades. Clique para descadastrar.' },
          },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta-inbox-next',
      });
    if (url.includes('delta-inbox-next')) return json({ value: [], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta-inbox-next' });
    if (url.includes('/mailFolders/sentitems/messages/delta')) return json({ value: [], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta-sent' });
    if (url.includes('delta-sent')) return json({ value: [] });
    if (url.endsWith('/me/planner/tasks'))
      return json({ value: [{ id: 'task-1', planId: 'plan-1', title: state.plannerTitle, percentComplete: 0, priority: 3, dueDateTime: inTwoDays.toISOString(), '@odata.etag': 'W/"1"' }] });
    if (url.endsWith('/me/planner/plans')) return json({ value: [{ id: 'plan-1', title: 'Comunicação' }] });
    if (url.includes('/planner/tasks/task-1/details')) return json({ description: 'Revisão final do release' });
    if (url.includes('/me/calendarView/delta'))
      return json({
        value: [
          { id: 'ev-1', subject: 'Reunião de pauta', start: { dateTime: now.toISOString().replace('Z', ''), timeZone: 'UTC' }, end: { dateTime: new Date(now.getTime() + 3_600_000).toISOString().replace('Z', ''), timeZone: 'UTC' }, showAs: 'busy' },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta-cal',
      });
    return new Response(JSON.stringify({ error: { code: 'NotFound', message: url } }), { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, state };
}

let root: string;
let ctx: AppContext;
let app: FastifyInstance;
const H = { 'x-pautaflow': '1', host: '127.0.0.1:3000' };
const get = (url: string) => app.inject({ method: 'GET', url, headers: { host: '127.0.0.1:3000' } });
const post = (url: string, payload?: unknown) => app.inject({ method: 'POST', url, headers: H, payload: (payload ?? {}) as object });
const patch = (url: string, payload: unknown) => app.inject({ method: 'PATCH', url, headers: H, payload: payload as object });

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'pautaflow-api-'));
  const env = resolveEnv({ home: root, port: 3000 });
  const graph = fakeGraph();
  ctx = await createContext(env, silentLogger, { fetchImpl: graph.fetchImpl, sandbox: true, msTokenProvider: async () => 'fake-token' });
  await ctx.db.users.update((u) => {
    u.email = 'eu@empresa.com';
  });
  app = await buildApp(ctx, { serveWeb: false });
});

afterAll(async () => {
  await app.close();
  await ctx.db.flushAll();
  await rm(root, { recursive: true, force: true });
});

describe('segurança local', () => {
  it('bloqueia escrita sem cabeçalho X-PautaFlow', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/pautas', headers: { host: '127.0.0.1:3000' }, payload: { title: 'x' } });
    expect(r.statusCode).toBe(403);
  });
  it('bloqueia Host externo (DNS rebinding) e Origin de outro site', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/pautas', headers: { host: 'evil.com' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/pautas', headers: { host: '127.0.0.1:3000', origin: 'https://evil.com' } })).statusCode).toBe(403);
  });
});

describe('pautas e prioridades', () => {
  let a: string;
  let b: string;
  it('cria pautas com score calculado e histórico', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const r1 = await post('/api/pautas', { title: 'Relatório mensal', dueDate: tomorrow, impact: 5, manualPriority: 'high' });
    expect(r1.statusCode).toBe(200);
    a = r1.json().id;
    expect(r1.json().priorityScore).toBeGreaterThan(40);
    expect(r1.json().priorityFactors.length).toBeGreaterThan(4);
    const r2 = await post('/api/pautas', { title: 'Post institucional', dependencies: [a] });
    b = r2.json().id;
    const h = await get(`/api/pautas/${a}/history`);
    expect(h.json()[0].action).toBe('created');
  });
  it('rejeita dependência circular e título vazio', async () => {
    expect((await patch(`/api/pautas/${a}`, { dependencies: [b] })).statusCode).toBe(400);
    expect((await post('/api/pautas', { title: '' })).statusCode).toBe(400);
  });
  it('concluir registra data e zera o score', async () => {
    const r = await patch(`/api/pautas/${b}`, { status: 'done' });
    expect(r.json().completedAt).toBeTruthy();
    expect(r.json().priorityScore).toBe(0);
  });
  it('atualização parcial preserva os demais campos (regressão: status apagava descrição/prazo/tags)', async () => {
    const full = (
      await post('/api/pautas', {
        title: 'Pauta completa',
        description: 'Descrição importante',
        dueDate: '2026-11-30',
        startDate: '2026-11-01',
        requester: 'TI',
        owner: 'Eduardo',
        manualPriority: 'low',
        impact: 4,
        complexity: 5,
        estimatedHours: 4,
        tags: ['TVs', 'Email'],
        checklist: [{ id: 'c1', text: 'Roteiro', done: false }],
      })
    ).json();
    const r = (await patch(`/api/pautas/${full.id}`, { status: 'done' })).json();
    expect(r.status).toBe('done');
    for (const k of ['description', 'dueDate', 'startDate', 'requester', 'owner', 'manualPriority', 'impact', 'complexity', 'estimatedHours', 'tags', 'checklist']) {
      expect(r[k], k).toEqual(full[k]);
    }
    const r2 = (await patch(`/api/pautas/${full.id}`, { owner: 'Natanael' })).json();
    expect(r2.requester).toBe('TI');
    expect(r2.status).toBe('done');
  });

  it('prazo com ano digitado a mais é reparado; data impossível vira vazio', async () => {
    const p = (await post('/api/pautas', { title: 'Datas', dueDate: '262026-11-03' })).json();
    expect(p.dueDate).toBe('2026-11-03');
    const r = (await patch(`/api/pautas/${p.id}`, { dueDate: '0002-11-30' })).json();
    expect(r.dueDate).toBeNull();
  });

  it('editar projeto parcialmente preserva cor, descrição e palavras-chave', async () => {
    const pr = (await post('/api/projetos', { name: 'Feira', description: 'Stand', color: '#ff0000', keywords: ['fenasucro'] })).json();
    const r = (await patch(`/api/projetos/${pr.id}`, { status: 'paused' })).json();
    expect(r).toMatchObject({ status: 'paused', description: 'Stand', color: '#ff0000', keywords: ['fenasucro'] });
  });

  it('ordem manual e aceite da recomendação', async () => {
    const c = (await post('/api/pautas', { title: 'Terceira pauta' })).json().id;
    let list = (await post('/api/priorities/order', { ids: [c, a] })).json();
    expect(list[0].pauta.id).toBe(c);
    list = (await post('/api/priorities/accept')).json();
    expect(list[0].pauta.id).toBe(a);
  });
});

describe('radar com Microsoft Graph (simulado)', () => {
  it('sincroniza Outlook, ignora newsletter e gera sugestão com prazo e evidência', async () => {
    const st = await ctx.scheduler.run('outlook-sync', 'manual');
    expect(st.lastStatus).toBe('success');
    await ctx.scheduler.run('radar-analysis', 'manual');
    const sugs = (await get('/api/sugestoes?status=pending')).json();
    expect(sugs).toHaveLength(1);
    expect(sugs[0].title).toBe('Release Fenasucro');
    expect(sugs[0].dueDate).toBeTruthy();
    expect(sugs[0].evidence).toContain('revisar o release');
    expect(sugs[0].sourceUrl).toContain('outlook');
  });

  it('Planner com a mesma demanda é mesclado à sugestão (referência cruzada)', async () => {
    await ctx.scheduler.run('planner-sync', 'manual');
    await ctx.scheduler.run('radar-analysis', 'manual');
    const sugs = (await get('/api/sugestoes?status=pending')).json();
    expect(sugs).toHaveLength(1);
    expect(sugs[0].sourceRefs.map((r: { source: string }) => r.source).sort()).toEqual(['outlook', 'planner']);
  });

  it('aprovar cria a pauta com as fontes vinculadas', async () => {
    const s = (await get('/api/sugestoes?status=pending')).json()[0];
    const p = (await post(`/api/sugestoes/${s.id}/approve`, { impact: 4 })).json();
    expect(p.origin).toBe('outlook');
    expect(p.sourceRefs).toHaveLength(2);
    expect(p.impact).toBe(4);
    expect((await get('/api/sugestoes?status=pending')).json()).toHaveLength(0);
  });

  it('resumo do dia inclui e-mails que pedem ação e reuniões; aviso de reunião é emitido uma vez', async () => {
    await ctx.scheduler.run('calendar-sync', 'manual');
    const r = (await post('/api/resumos/generate', { type: 'daily' })).json();
    const sec = (k: string) => r.sections.find((s: { key: string }) => s.key === k);
    expect(sec('emails').items.some((i: { text: string; url: string | null }) => i.text.includes('Release Fenasucro') && i.url)).toBe(true);
    expect(sec('meetings').items[0].text).toBe('Reunião de pauta');
    expect(sec('inbox').items[0].text).toMatch(/e-mail\(s\) recebido/);
    expect(r.headline).toMatch(/reunião/);
    const { meetingReminders } = await import('../src/automation/jobs');
    expect(await meetingReminders(ctx)).toBe(1);
    expect(await meetingReminders(ctx)).toBe(0); // sem repetir
    const notes = (await get('/api/notifications')).json();
    expect(notes.some((n: { type: string }) => n.type === 'meeting')).toBe(true);
  });

  it('calendário sincronizado aparece na agenda e na semana', async () => {
    await ctx.scheduler.run('calendar-sync', 'manual');
    const items = (await get('/api/calendar')).json();
    expect(items.some((i: { kind: string }) => i.kind === 'event')).toBe(true);
    const week = (await get('/api/week')).json();
    expect(week.days).toHaveLength(7);
  });
});

describe('visões, resumos e analytics', () => {
  it('dashboard com saudação, KPIs e insights reais', async () => {
    const d = (await get('/api/dashboard')).json();
    expect(d.greeting.headline).toMatch(/sugest/);
    expect(d.kpis).toHaveLength(8);
    expect(d.insights.length).toBeGreaterThan(0);
  });
  it('gera resumos diário, semanal e mensal', async () => {
    for (const type of ['daily', 'weekly', 'monthly']) {
      const r = (await post('/api/resumos/generate', { type })).json();
      expect(r.type).toBe(type);
      expect(r.sections.length).toBeGreaterThan(3);
    }
    expect((await get('/api/resumos')).json().length).toBe(3);
  });
  it('analytics distingue observado de estimado e exporta CSV', async () => {
    const a = (await get('/api/analytics?period=month')).json();
    expect(a.metrics.find((m: { key: string }) => m.key === 'backlogDays').kind).toBe('estimated');
    expect(a.metrics.find((m: { key: string }) => m.key === 'done').kind).toBe('observed');
    const csv = await get('/api/analytics/export?format=csv&period=month');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('titulo;status');
  });
  it('assistente responde com dados locais', async () => {
    const r = (await post('/api/assistant', { question: 'Quais são minhas prioridades hoje?' })).json();
    expect(r.source).toBe('rules');
    expect(r.items.length).toBeGreaterThan(0);
    const r2 = (await post('/api/assistant', { question: 'Tenho alguma entrega atrasada?' })).json();
    expect(r2.answer).toMatch(/atrasad/i);
  });
});

describe('Claude — ferramentas locais (sem chamar a API)', () => {
  const run = (name: string, input: unknown, actions: unknown[] = [], allow = true) =>
    (ctx.claude as unknown as { runTool(n: string, i: unknown, a: unknown[], allow: boolean): Promise<string> }).runTool(name, input, actions, allow);

  it('fica inativo sem chave e sem autorização', async () => {
    const s = (await get('/api/claude/status')).json();
    expect(s.ready).toBe(false);
    expect((await post('/api/claude/chat', { message: 'oi' })).statusCode).toBe(400);
    expect((await post('/api/claude/key', { apiKey: 'chave-errada' })).statusCode).toBe(400);
  });

  it('cria, atualiza e consulta pautas pelas ferramentas', async () => {
    await post('/api/projetos', { name: 'Feira Agro' });
    const actions: { summary: string; pautaId: string | null }[] = [];
    const created = JSON.parse(await run('criar_pauta', { titulo: 'Release da feira', prazo: '2026-11-20T14:00', prioridade: 'high', projeto: 'feira agro', solicitante: 'Ana' }, actions));
    expect(created.pauta.prazo).toBe('20/11/2026 às 14:00');
    expect(created.pauta.projeto).toBe('Feira Agro');
    const updated = JSON.parse(await run('atualizar_pauta', { id: created.pauta.id, responsavel: 'Eduardo', comentario: 'Revisar com a Ana' }, actions));
    expect(updated.pauta.responsavel).toBe('Eduardo');
    expect(updated.pauta.solicitante).toBe('Ana'); // atualização parcial preserva os demais campos
    expect(updated.pauta.prazo).toBe('20/11/2026 às 14:00');
    expect(actions).toHaveLength(2);
    const list = JSON.parse(await run('listar_pautas', { busca: 'release da feira' }));
    expect(list.pautas[0].titulo).toBe('Release da feira');
    const det = JSON.parse(await run('ver_pauta', { id: created.pauta.id }));
    expect(det.comentarios[0]).toContain('Revisar com a Ana');
  });

  it('recusa ações quando desativadas, projeto inexistente e prazo inválido', async () => {
    await expect(run('criar_pauta', { titulo: 'X' }, [], false)).rejects.toThrow(/Ações desativadas/);
    await expect(run('criar_pauta', { titulo: 'X', projeto: 'Inexistente' })).rejects.toThrow(/não existe/);
    await expect(run('criar_pauta', { titulo: 'X', prazo: '31/02' })).rejects.toThrow(/Prazo inválido/);
  });

  it('agenda e e-mails sincronizados', async () => {
    const emails = JSON.parse(await run('buscar_emails', { busca: 'fenasucro', dias: 3 }));
    expect(emails.total).toBeGreaterThan(0);
    const full = JSON.parse(await run('ler_email', { id: emails.emails[0].id }));
    expect(full.corpo).toContain('release');
    const agenda = JSON.parse(await run('agenda', {}));
    expect(agenda.some((i: { tipo: string }) => i.tipo === 'reunião')).toBe(true);
  });
});

describe('automações, backups e arquivos', () => {
  it('lista automações com próximo horário', async () => {
    const list = (await get('/api/automations')).json();
    expect(list.map((j: { id: string }) => j.id)).toContain('backup');
    expect(list.every((j: { nextRunAt: string | null }) => j.nextRunAt)).toBe(true);
  });
  it('cria backup e exporta dados', async () => {
    const b = (await post('/api/backups')).json();
    expect(b.files).toBeGreaterThan(5);
    const exp = (await get('/api/export')).json();
    expect(Object.keys(exp.files)).toContain('pautas.json');
  });
  it('sinaliza pasta local e URL', async () => {
    const r = await post('/api/bookmarks', { location: root, name: 'Pasta de teste' });
    expect(r.json().kind).toBe('folder');
    const u = await post('/api/bookmarks', { location: 'https://empresa.sharepoint.com/sites/x' });
    expect(u.json().kind).toBe('url');
    expect((await post('/api/bookmarks', { location: 'C:\\nao\\existe\\arquivo.txt' })).statusCode).toBe(400);
    expect((await get('/api/bookmarks')).json()).toHaveLength(2);
  });
  it('health check', async () => {
    const h = (await get('/api/health')).json();
    expect(h.checks.find((c: { key: string }) => c.key === 'storage').status).toBe('ok');
  });
});
