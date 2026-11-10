import { randomUUID } from 'node:crypto';
import { type Resumo, type SummarySection, isOpenStatus, STATUS_LABEL } from '@pautaflow/shared';
import type { AppContext } from '../core/context';
import { addDays, dueToDate, startOfDay, startOfWeek, toLocalDateKey, brDate } from '../intelligence/dates';
import { effectiveOrder } from '../intelligence/priority';
import { buildInsights, nextActionFor } from '../intelligence/insights';
import { computeAnalytics, isOverdue } from '../analytics/metrics';
import { truncate } from '../intelligence/text';
import { analyzeMail } from '../intelligence/radar';

type Item = SummarySection['items'][number];
const item = (text: string, pautaId: string | null = null, meta: string | null = null, url: string | null = null): Item => ({ text, pautaId, meta, url });

export class SummaryService {
  constructor(private readonly app: AppContext) {}

  async latest(type: Resumo['type']): Promise<Resumo | null> {
    const r = await this.app.db.resumos.query({ limit: 1, filter: (x) => x.type === type, sortKey: (x) => x.generatedAt });
    return r[0] ?? null;
  }

  async list(type?: Resumo['type'], limit = 60): Promise<Resumo[]> {
    return this.app.db.resumos.query({ limit, filter: (x) => !type || x.type === type, sortKey: (x) => x.periodStart + x.generatedAt });
  }

  async generate(type: Resumo['type'], now = new Date()): Promise<Resumo> {
    const r = type === 'daily' ? this.daily(now) : type === 'weekly' ? await this.weekly(now) : await this.monthly(now);
    const narrative = await this.narrative(r);
    if (narrative) {
      r.narrative = narrative;
      r.generatedBy = this.app.ai.providerLabel;
    }
    // Um resumo por período: regenerar substitui o anterior
    const existing = await this.app.db.resumos.query({
      limit: 5,
      filter: (x) => x.type === type && x.periodStart === r.periodStart,
      sortKey: (x) => x.generatedAt,
    });
    if (existing[0]) r.id = existing[0].id;
    await this.app.db.resumos.upsert(r);
    this.app.bus.emit('summary', r);
    this.app.bus.changed('resumos');
    return r;
  }

  private daily(now: Date): Resumo {
    const { db } = this.app;
    const pautas = db.pautas.list();
    const open = pautas.filter((p) => isOpenStatus(p.status));
    const today = toLocalDateKey(now);
    const dueToday = open.filter((p) => p.dueDate?.slice(0, 10) === today);
    const inProgress = open.filter((p) => p.status === 'in_progress');
    const overdue = open.filter((p) => isOverdue(p, now) && p.dueDate?.slice(0, 10) !== today);
    const approvals = open.filter((p) => p.approvalPending || p.status === 'review');
    const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
    const newSugs = db.sugestoes.filter((s) => s.status === 'pending' && s.createdAt >= dayAgo);
    const top = effectiveOrder(open).slice(0, 5);
    const cfg = db.config.get();
    const insights = buildInsights(pautas, db.sugestoes.list(), now, cfg.workday.dailyCapacityHours, cfg.workday.days);
    const sections: SummarySection[] = [
      { key: 'today', title: 'Entregas de hoje', items: dueToday.map((p) => item(p.title, p.id, STATUS_LABEL[p.status])) },
      { key: 'progress', title: 'Pautas em andamento', items: inProgress.map((p) => item(p.title, p.id, p.dueDate ? `prazo ${brDate(p.dueDate)}` : null)) },
      { key: 'overdue', title: 'Atividades atrasadas', items: overdue.map((p) => item(p.title, p.id, `desde ${brDate(p.dueDate)}`)) },
      { key: 'approvals', title: 'Pendências de aprovação', items: approvals.map((p) => item(p.title, p.id, STATUS_LABEL[p.status])) },
      { key: 'suggestions', title: 'Novas sugestões', items: newSugs.map((s) => item(s.title, null, s.source)) },
      { key: 'priorities', title: 'Principais prioridades', items: top.map((p) => item(p.title, p.id, `score ${p.priorityScore} · ${nextActionFor(p, now).action}`)) },
      { key: 'recommendations', title: 'Recomendações', items: insights.map((i) => item(i.text, i.pautaIds[0] ?? null)) },
    ];

    /* ---------------- Reuniões de hoje ---------------- */
    const hm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const meetings = db.eventos
      .filter((e) => !e.isCancelled && (e.isAllDay ? e.start.slice(0, 10) === today : toLocalDateKey(new Date(e.start)) === today))
      .sort((a, b) => a.start.localeCompare(b.start));
    sections.splice(1, 0, {
      key: 'meetings',
      title: 'Reuniões de hoje',
      items: meetings.map((e) =>
        item(e.subject, null, `${e.isAllDay ? 'dia inteiro' : `${hm(e.start)}–${hm(e.end)}`}${e.onlineMeetingUrl ? ' · online' : e.location ? ` · ${truncate(e.location, 30)}` : ''}`, e.onlineMeetingUrl ?? e.webLink),
      ),
    });

    /* ---------------- E-mails (últimas 24h) ---------------- */
    const inbox = db.mensagens.filter((m) => !m.isSent && m.receivedAt >= dayAgo).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    const tracked = new Set([...db.pautas.list().flatMap((p) => p.sourceRefs), ...db.sugestoes.list().flatMap((s) => s.sourceRefs)].map((r) => r.externalId));
    const profile = db.users.get();
    const radarCtx = {
      now,
      myEmails: [db.integracoes.get().microsoft.username, profile.email].filter((x): x is string => !!x).map((x) => x.toLowerCase()),
      categories: db.categorias.list(),
      projects: db.projetos.list(),
      ignoreSenders: cfg.radar.ignoreSenders,
    };
    const actionable = inbox
      .map((m) => ({ m, c: analyzeMail(m, radarCtx) }))
      .filter((x) => x.m.flagged || (x.c && x.c.confidence >= cfg.radar.minConfidence))
      .sort((a, b) => (b.c?.confidence ?? 0.5) - (a.c?.confidence ?? 0.5))
      .slice(0, 10);
    const senders = new Map<string, number>();
    for (const m of inbox) {
      const k = m.fromName || m.fromEmail || 'Desconhecido';
      senders.set(k, (senders.get(k) ?? 0) + 1);
    }
    const unread = inbox.filter((m) => !m.isRead).length;
    const important = inbox.filter((m) => m.importance === 'high').length;
    const flaggedOpen = db.mensagens.filter((m) => m.flagged && !m.isSent && !tracked.has(m.id));
    sections.splice(2, 0, {
      key: 'emails',
      title: 'E-mails que pedem ação',
      items: actionable.map(({ m, c }) =>
        item(`${m.subject || '(sem assunto)'} — ${m.fromName ?? m.fromEmail ?? ''}`, null, [m.flagged ? 'sinalizado' : null, c?.dueDate ? `prazo ${brDate(c.dueDate)}` : null, tracked.has(m.id) ? 'já no radar' : null].filter(Boolean).join(' · ') || null, m.webLink),
      ),
    });
    sections.splice(3, 0, {
      key: 'inbox',
      title: 'Caixa de entrada (24h)',
      items: [
        item(`${inbox.length} e-mail(s) recebido(s), ${unread} não lido(s)${important ? `, ${important} com importância alta` : ''}`),
        ...[...senders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, n]) => item(name, null, `${n} e-mail(s)`)),
        ...flaggedOpen.slice(0, 5).map((m) => item(`Sinalizado sem pauta: ${m.subject}`, null, m.fromName, m.webLink)),
      ],
    });

    const parts = [
      `${dueToday.length} entrega(s) hoje`,
      overdue.length ? `${overdue.length} atrasada(s)` : null,
      meetings.length ? `${meetings.length} reunião(ões)` : null,
      inbox.length ? `${inbox.length} e-mail(s) nas últimas 24h (${actionable.length} pedindo ação)` : null,
      approvals.length ? `${approvals.length} pendência(s) de aprovação` : null,
      `${newSugs.length} nova(s) sugestão(ões)`,
    ].filter(Boolean);
    return this.make('daily', startOfDay(now), now, `Resumo do dia: ${parts.join(', ')}.`, sections, {
      dueToday: dueToday.length,
      inProgress: inProgress.length,
      overdue: overdue.length,
      approvals: approvals.length,
      newSuggestions: newSugs.length,
      meetings: meetings.length,
      emails: inbox.length,
      emailsActionable: actionable.length,
      unread,
    });
  }

  private analyticsInput(now: Date, history: Awaited<ReturnType<AppContext['history']['range']>>) {
    const { db } = this.app;
    return { pautas: db.pautas.list(), suggestions: db.sugestoes.list(), categories: db.categorias.list(), projects: db.projetos.list(), history, now };
  }

  private async weekly(now: Date): Promise<Resumo> {
    const { db } = this.app;
    // Na segunda-feira, resume a semana anterior; em outros dias, a semana corrente até agora
    const thisWeek = startOfWeek(now);
    const isMonday = now.getDay() === 1;
    const from = isMonday ? addDays(thisWeek, -7) : thisWeek;
    const to = isMonday ? new Date(thisWeek.getTime() - 1000) : now;
    const history = await this.app.history.range(from.toISOString(), to.toISOString());
    const a = computeAnalytics(this.analyticsInput(now, history), { from, to, label: 'Semana' });
    const pautas = db.pautas.list();
    const inP = (iso: string | null) => !!iso && new Date(iso) >= from && new Date(iso) <= to;
    const done = pautas.filter((p) => p.status === 'done' && inP(p.completedAt));
    const received = pautas.filter((p) => inP(p.createdAt));
    const open = pautas.filter((p) => isOpenStatus(p.status));
    const projects = new Map<string, number>();
    for (const h of history) {
      const p = pautas.find((x) => x.id === h.entityId);
      if (p?.projectId) projects.set(p.projectId, (projects.get(p.projectId) ?? 0) + 1);
    }
    const projName = (id: string) => db.projetos.get(id)?.name ?? 'Projeto';
    const results = done.filter((p) => ['high', 'critical'].includes(p.manualPriority ?? p.recommendedPriority) || p.kind === 'entrega' || p.kind === 'publicacao');
    const bottlenecks: Item[] = [];
    const overdue = open.filter((p) => isOverdue(p, now));
    if (overdue.length) bottlenecks.push(item(`${overdue.length} pauta(s) atrasada(s)`, overdue[0]!.id));
    const waiting = open.filter((p) => p.status === 'waiting');
    if (waiting.length) bottlenecks.push(item(`${waiting.length} pauta(s) aguardando terceiros`, waiting[0]!.id));
    const blocked = open.filter((p) => p.dependencies.some((d) => isOpenStatus(db.pautas.get(d)?.status ?? 'done')));
    if (blocked.length) bottlenecks.push(item(`${blocked.length} pauta(s) bloqueada(s) por dependências`, blocked[0]!.id));
    const nextWeekEnd = addDays(startOfWeek(now), isMonday ? 7 : 14);
    const upcoming = effectiveOrder(open).filter((p) => p.dueDate && dueToDate(p.dueDate) < nextWeekEnd).slice(0, 6);
    const metric = (k: string) => a.metrics.find((m) => m.key === k)?.value ?? null;
    const sections: SummarySection[] = [
      { key: 'done', title: 'Atividades concluídas', items: done.map((p) => item(p.title, p.id, p.completedAt ? brDate(toLocalDateKey(new Date(p.completedAt))) : null)) },
      { key: 'received', title: 'Demandas recebidas', items: received.map((p) => item(p.title, p.id, p.origin)) },
      { key: 'pending', title: 'Demandas pendentes', items: effectiveOrder(open).slice(0, 10).map((p) => item(p.title, p.id, STATUS_LABEL[p.status])) },
      { key: 'projects', title: 'Projetos movimentados', items: [...projects.entries()].sort((x, y) => y[1] - x[1]).map(([id, n]) => item(projName(id), null, `${n} movimentação(ões)`)) },
      { key: 'results', title: 'Principais resultados', items: results.map((p) => item(p.title, p.id)) },
      {
        key: 'indicators',
        title: 'Indicadores da semana',
        items: [
          item(`Concluídas: ${done.length}`),
          item(`Recebidas: ${received.length}`),
          item(`Cumprimento de prazos: ${metric('onTime') ?? '—'}${metric('onTime') !== null ? '%' : ''}`),
          item(`Tempo médio de conclusão: ${metric('leadTime') ?? '—'} dia(s)`),
          item(`Sugestões do radar: ${metric('sugIdentified')} identificadas, ${metric('sugApproved')} aprovadas`),
        ],
      },
      { key: 'bottlenecks', title: 'Gargalos', items: bottlenecks },
      { key: 'next', title: 'Recomendações para a próxima semana', items: upcoming.map((p) => item(`${p.title} — ${nextActionFor(p, now).action}`, p.id, p.dueDate ? brDate(p.dueDate) : null)) },
    ];
    return this.make('weekly', from, to, `Semana: ${done.length} concluída(s), ${received.length} recebida(s), ${open.length} em aberto.`, sections, {
      done: done.length,
      received: received.length,
      open: open.length,
      overdue: overdue.length,
    });
  }

  private async monthly(now: Date): Promise<Resumo> {
    const { db } = this.app;
    const isEarly = now.getDate() <= db.config.get().schedules.monthlySummaryDay;
    const from = isEarly ? new Date(now.getFullYear(), now.getMonth() - 1, 1) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = isEarly ? new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, -1) : now;
    const prevFrom = new Date(from.getFullYear(), from.getMonth() - 1, 1);
    const history = await this.app.history.range(prevFrom.toISOString(), to.toISOString());
    const a = computeAnalytics(this.analyticsInput(now, history), { from, to, label: 'Mês' });
    const m = (k: string) => a.metrics.find((x) => x.key === k)!;
    const created = m('created');
    const done = m('done');
    const onTime = m('onTime');
    const lead = m('leadTime');
    const delivery = (created.value ?? 0) > 0 ? Math.round(((done.value ?? 0) / (created.value ?? 1)) * 100) : null;
    const cmp = (cur: number | null, prev: number | null | undefined, unit = '') =>
      prev === null || prev === undefined || cur === null ? 'sem base de comparação' : cur === prev ? 'estável' : `${cur > prev ? '+' : ''}${Math.round((cur - prev) * 10) / 10}${unit} vs. mês anterior`;
    const sections: SummarySection[] = [
      { key: 'volume', title: 'Volume de demandas', items: [item(`${created.value} nova(s) demanda(s)`, null, cmp(created.value, created.previous))] },
      { key: 'done', title: 'Conclusões', items: [item(`${done.value} pauta(s) concluída(s)`, null, cmp(done.value, done.previous))] },
      { key: 'delivery', title: 'Taxa de entrega', items: [item(delivery === null ? 'Sem demandas no período' : `${delivery}% (concluídas ÷ recebidas)`)] },
      { key: 'productivity', title: 'Evolução da produtividade', items: a.series.monthly.slice(-4).map((p) => item(`${p.date}: ${p.concluidas} concluída(s), ${p.criadas} criada(s)`)) },
      { key: 'categories', title: 'Categorias mais demandadas', items: a.byCategory.slice(0, 5).map((c) => item(c.label, null, `${c.value} pauta(s)`)) },
      { key: 'deadlines', title: 'Prazos cumpridos', items: [item(onTime.value === null ? 'Nenhuma pauta com prazo concluída' : `${onTime.value}% no prazo`, null, cmp(onTime.value, onTime.previous, ' p.p.'))] },
      { key: 'projects', title: 'Principais projetos', items: a.topProjects.slice(0, 5).map((p) => item(p.label, null, `${p.value} movimentação(ões)`)) },
      {
        key: 'compare',
        title: 'Comparativo com o mês anterior',
        items: [
          item(`Novas demandas: ${created.value} (antes: ${created.previous ?? '—'})`),
          item(`Concluídas: ${done.value} (antes: ${done.previous ?? '—'})`),
          item(`Tempo médio: ${lead.value ?? '—'} dia(s) (antes: ${lead.previous ?? '—'})`),
        ],
      },
    ];
    const label = from.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return this.make('monthly', from, to, `Resumo de ${label}: ${created.value} recebidas, ${done.value} concluídas${onTime.value !== null ? `, ${onTime.value}% no prazo` : ''}.`, sections, {
      created: created.value ?? 0,
      done: done.value ?? 0,
      onTime: onTime.value ?? -1,
      deliveryRate: delivery ?? -1,
    });
  }

  private make(type: Resumo['type'], from: Date, to: Date, headline: string, sections: SummarySection[], metrics: Record<string, number>): Resumo {
    return {
      id: randomUUID(),
      type,
      periodStart: toLocalDateKey(from),
      periodEnd: toLocalDateKey(to),
      generatedAt: new Date().toISOString(),
      generatedBy: 'rules',
      headline,
      narrative: null,
      sections,
      metrics,
    };
  }

  private async narrative(r: Resumo): Promise<string | null> {
    if (!this.app.ai.enabledFor('summary')) return null;
    const compact = r.sections
      .filter((s) => s.items.length)
      .map((s) => `${s.title}:\n${s.items.slice(0, 8).map((i) => `- ${truncate(i.text, 120)}${i.meta ? ` (${i.meta})` : ''}`).join('\n')}`)
      .join('\n\n');
    return this.app.ai.complete('summary', [
      { role: 'system', content: 'Você é um assistente executivo. Escreva em português do Brasil um parágrafo objetivo (3 a 4 frases) resumindo os dados. Use apenas as informações fornecidas; não invente números.' },
      { role: 'user', content: `${r.headline}\n\n${compact}` },
    ]);
  }
}

