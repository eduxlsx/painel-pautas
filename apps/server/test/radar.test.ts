import { describe, expect, it } from 'vitest';
import { Pauta, Sugestao } from '@pautaflow/shared';
import { analyzeMail, analyzePlannerTask, deduplicate, type RadarContext } from '../src/intelligence/radar';
import { MailMessage, PlannerTask } from '../src/storage/internalSchemas';
import { computePriority } from '../src/intelligence/priority';

const now = new Date(2026, 10, 10, 9, 0, 0);
const ctx: RadarContext = {
  now,
  myEmails: ['eu@empresa.com'],
  categories: [{ id: 'c-imp', name: 'Imprensa', color: '#000', icon: 'x', keywords: ['release', 'jornalista'], createdAt: now.toISOString() }],
  projects: [],
  ignoreSenders: [],
};

const mail = (o: Partial<MailMessage>) =>
  MailMessage.parse({
    id: 'm1',
    folderId: 'inbox',
    subject: 'RE: Release Fenasucro',
    fromName: 'Ana',
    fromEmail: 'ana@empresa.com',
    to: ['eu@empresa.com'],
    receivedAt: now.toISOString(),
    bodyText: 'Oi! Você pode revisar o release da Fenasucro até sexta? Precisamos enviar ao jornalista.',
    conversationId: 'conv-1',
    syncedAt: now.toISOString(),
    ...o,
  });

describe('analyzeMail', () => {
  it('identifica solicitação com prazo, categoria e evidência', () => {
    const c = analyzeMail(mail({}), ctx)!;
    expect(c).not.toBeNull();
    expect(c.title).toBe('Release Fenasucro');
    expect(c.dueDate).toBe('2026-11-13');
    expect(c.categoryId).toBe('c-imp');
    expect(c.confidence).toBeGreaterThanOrEqual(0.45);
    expect(c.evidence).toContain('revisar o release');
    expect(c.kind).toBe('publicacao');
  });

  it('descarta newsletters e remetentes no-reply', () => {
    expect(analyzeMail(mail({ fromEmail: 'no-reply@site.com' }), ctx)).toBeNull();
    expect(analyzeMail(mail({ bodyText: 'Novidades da semana. Clique para descadastrar.' }), ctx)).toBeNull();
  });

  it('reconhece pedido de aprovação', () => {
    const c = analyzeMail(mail({ subject: 'Arte campanha', bodyText: 'Segue a arte para aprovação. Precisamos publicar amanhã.' }), ctx)!;
    expect(c.kind).toBe('aprovacao');
    expect(c.approvalPending).toBe(true);
    expect(c.title.startsWith('Aprovar:')).toBe(true);
  });

  it('detecta compromissos em e-mails enviados', () => {
    const c = analyzeMail(mail({ isSent: true, to: ['joao@x.com'], subject: 'Relatório', bodyText: 'Combinado, vou enviar o relatório até quinta.' }), ctx)!;
    expect(c.title).toBe('Retornar: Relatório');
    expect(c.requester).toBe('joao@x.com');
    expect(c.dueDate).toBe('2026-11-12');
  });

  it('confiança baixa quando apenas em cópia sem pedido', () => {
    const c = analyzeMail(mail({ to: ['outro@x.com'], cc: ['eu@empresa.com'], bodyText: 'Para conhecimento de todos.' }), ctx);
    expect(c === null || c.confidence < 0.45).toBe(true);
  });
});

describe('deduplicate', () => {
  const basePauta = Pauta.parse({
    id: 'p1',
    title: 'Release Fenasucro',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    sourceRefs: [{ source: 'outlook', externalId: 'm0', conversationId: 'conv-1', linkedAt: now.toISOString() }],
  });

  it('mesma conversa → atualização da pauta (thread)', () => {
    const c = analyzeMail(mail({}), ctx)!;
    expect(deduplicate(c, [basePauta], [], 0.55)).toEqual({ kind: 'thread', pautaId: 'p1' });
  });

  it('mesmo item já conhecido', () => {
    const c = analyzeMail(mail({ id: 'm0' }), ctx)!;
    expect(deduplicate(c, [basePauta], [], 0.55).kind).toBe('known');
  });

  it('Planner × pauta originada no Outlook → referência cruzada', () => {
    const task = PlannerTask.parse({ id: 't1', planId: 'pl', planTitle: 'Comunicação', title: 'Release Fenasucro', syncedAt: now.toISOString() });
    const c = analyzePlannerTask(task, ctx)!;
    const r = deduplicate(c, [basePauta], [], 0.55);
    expect(r.kind).toBe('crosslink');
  });

  it('sugestão pendente similar → mescla', () => {
    const s = Sugestao.parse({
      id: 's1', title: 'Revisão release Fenasucro', source: 'planner', confidence: 0.9, createdAt: now.toISOString(), updatedAt: now.toISOString(),
      sourceRefs: [{ source: 'planner', externalId: 't9', linkedAt: now.toISOString() }],
    });
    const c = analyzeMail(mail({ conversationId: 'other' }), ctx)!;
    expect(deduplicate(c, [], [s], 0.55).kind).toBe('merge');
  });

  it('demanda nova sem duplicidade', () => {
    const c = analyzeMail(mail({ conversationId: 'x', subject: 'Convite inauguração', bodyText: 'Pode confirmar presença até amanhã?' }), ctx)!;
    expect(deduplicate(c, [basePauta], [], 0.55)).toEqual({ kind: 'new', duplicates: [] });
  });
});

describe('computePriority', () => {
  const mk = (o: Partial<Pauta>) => Pauta.parse({ id: Math.random().toString(), title: 'x', createdAt: now.toISOString(), updatedAt: now.toISOString(), ...o });
  const pctx = (all: Pauta[]) => ({ now, all, capacityHoursPerDay: 6, workdays: [1, 2, 3, 4, 5] });

  it('atrasada + crítica + impacto alto → score alto e justificativa', () => {
    const p = mk({ dueDate: '2026-11-08', manualPriority: 'critical', impact: 5 });
    const r = computePriority(p, pctx([p]));
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.level).toBe('critical');
    expect(r.justification).toMatch(/atrasada/i);
    expect(r.factors.find((f) => f.key === 'deadline')?.points).toBe(35);
  });

  it('sem prazo e baixa prioridade → score baixo', () => {
    const p = mk({ manualPriority: 'low', impact: 1 });
    expect(computePriority(p, pctx([p])).level).toBe('low');
  });

  it('dependentes aumentam o score; bloqueio reduz', () => {
    const a = mk({ id: 'a', dueDate: '2026-11-20' });
    const b = mk({ id: 'b', dependencies: ['a'], dueDate: '2026-11-20' });
    const ra = computePriority(a, pctx([a, b]));
    const rb = computePriority(b, pctx([a, b]));
    expect(ra.score).toBeGreaterThan(rb.score);
    expect(rb.factors.some((f) => f.key === 'blocked')).toBe(true);
  });

  it('concluída → 0', () => {
    expect(computePriority(mk({ status: 'done' }), pctx([])).score).toBe(0);
  });
});
