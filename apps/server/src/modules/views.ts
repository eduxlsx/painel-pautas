import {
  type AssistantAnswer,
  type CalendarItem,
  type DashboardResponse,
  type KpiCard,
  type Pauta,
  type PriorityListItem,
  type WeekResponse,
  isOpenStatus,
  PRIORITY_LABEL,
  STATUS_LABEL,
  STATUS_ORDER,
} from '@pautaflow/shared';
import type { AppContext } from '../core/context';
import { addDays, daysBetween, dueToDate, startOfDay, startOfWeek, toLocalDateKey } from '../intelligence/dates';
import { effectiveOrder, recommendedOrder, remainingHours } from '../intelligence/priority';
import { attentionList, buildInsights, nextActionFor } from '../intelligence/insights';
import { computeAnalytics, isOverdue, resolvePeriod } from '../analytics/metrics';
import { norm, tokens, truncate } from '../intelligence/text';

const PRIORITY_COLOR: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#6366f1', low: '#64748b' };

function pautaToItem(p: Pauta): CalendarItem | null {
  const date = p.dueDate ?? null;
  if (!date) return null;
  return {
    id: `pauta:${p.id}`,
    kind: 'pauta',
    title: p.title,
    start: date,
    end: null,
    allDay: date.length === 10,
    pautaId: p.id,
    status: p.status,
    priority: p.manualPriority ?? p.recommendedPriority,
    color: PRIORITY_COLOR[p.manualPriority ?? p.recommendedPriority],
    editable: true,
  };
}

export function calendarItems(app: AppContext, from: Date, to: Date): CalendarItem[] {
  const { db } = app;
  const out: CalendarItem[] = [];
  for (const p of db.pautas.list()) {
    if (p.status === 'cancelled' || !p.dueDate) continue;
    const d = dueToDate(p.dueDate);
    if (d >= from && d <= addDays(to, 1)) out.push(pautaToItem(p)!);
  }
  for (const e of db.eventos.list()) {
    if (e.isCancelled) continue;
    const s = new Date(e.start);
    if (s > addDays(to, 1) || new Date(e.end) < from) continue;
    out.push({
      id: `event:${e.id}`,
      kind: 'event',
      title: e.subject,
      start: e.isAllDay ? e.start.slice(0, 10) : e.start,
      end: e.isAllDay ? null : e.end,
      allDay: e.isAllDay,
      pautaId: null,
      location: e.location,
      url: e.onlineMeetingUrl ?? e.webLink,
      color: '#0ea5e9',
      editable: false,
    });
  }
  const linkedTasks = new Set(db.pautas.list().flatMap((p) => p.sourceRefs.filter((r) => r.source === 'planner').map((r) => r.externalId)));
  for (const t of db.plannerTasks.list()) {
    if (!t.dueDateTime || t.percentComplete >= 100 || linkedTasks.has(t.id)) continue;
    const day = toLocalDateKey(new Date(t.dueDateTime));
    const d = dueToDate(day);
    if (d < from || d > addDays(to, 1)) continue;
    out.push({ id: `planner:${t.id}`, kind: 'planner', title: t.title, start: day, end: null, allDay: true, pautaId: null, url: t.url, color: '#10b981', status: `${t.percentComplete}%`, editable: false });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export function weekView(app: AppContext, ref: Date): WeekResponse {
  const ws = startOfWeek(ref);
  const cap = app.db.config.get().workday.dailyCapacityHours;
  const workdays = app.db.config.get().workday.days;
  const items = calendarItems(app, ws, addDays(ws, 7));
  const days: WeekResponse['days'] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i);
    const key = toLocalDateKey(d);
    const dayItems = items.filter((it) => it.start.slice(0, 10) === key || (!it.allDay && toLocalDateKey(new Date(it.start)) === key));
    const pautaHours = dayItems
      .filter((it) => it.kind === 'pauta')
      .map((it) => app.db.pautas.get(it.pautaId!))
      .filter((p): p is Pauta => !!p && isOpenStatus(p.status))
      .reduce((s, p) => s + remainingHours(p).hours, 0);
    const meetingHours = dayItems
      .filter((it) => it.kind === 'event' && it.end)
      .reduce((s, it) => s + (new Date(it.end!).getTime() - new Date(it.start).getTime()) / 3_600_000, 0);
    days.push({ date: key, items: dayItems, plannedHours: Math.round((pautaHours + meetingHours) * 10) / 10, capacityHours: workdays.includes(d.getDay()) ? cap : 0 });
  }
  return { start: toLocalDateKey(ws), days };
}

export function priorityList(app: AppContext): PriorityListItem[] {
  const all = app.db.pautas.list();
  const rec = recommendedOrder(all);
  const recRank = new Map(rec.map((p, i) => [p.id, i + 1]));
  return effectiveOrder(all).map((p) => ({ pauta: p, recommendedRank: recRank.get(p.id)!, manualRank: p.manualRank, classification: p.recommendedPriority }));
}

const WEEKDAY_FMT = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

export async function dashboard(app: AppContext): Promise<DashboardResponse> {
  const { db } = app;
  const now = new Date();
  const cfg = db.config.get();
  const pautas = db.pautas.list();
  const open = pautas.filter((p) => isOpenStatus(p.status));
  const sugs = db.sugestoes.list();
  const today = toLocalDateKey(now);
  const ws = startOfWeek(now);
  const we = addDays(ws, 7);
  const dueToday = open.filter((p) => p.dueDate?.slice(0, 10) === today);
  const importantToday = dueToday.filter((p) => ['high', 'critical'].includes(p.manualPriority ?? p.recommendedPriority) || p.kind !== 'tarefa');
  const pendingSugs = sugs.filter((s) => s.status === 'pending');
  const overdue = open.filter((p) => isOverdue(p, now));
  const weekDeliveries = open.filter((p) => p.dueDate && dueToDate(p.dueDate) >= startOfDay(now) && dueToDate(p.dueDate) < we);
  const critical = open.filter((p) => p.recommendedPriority === 'critical' || p.manualPriority === 'critical');
  const d30 = new Date(now.getTime() - 30 * 86_400_000);
  const recent = pautas.filter((p) => new Date(p.createdAt) >= d30 && p.status !== 'cancelled');
  const completionRate = recent.length ? Math.round((recent.filter((p) => p.status === 'done').length / recent.length) * 100) : 0;
  const doneMonth = pautas.filter((p) => p.completedAt && new Date(p.completedAt) >= new Date(now.getFullYear(), now.getMonth(), 1)).length;

  // Tendência observada: compara com o retrato de 7 dias atrás (se existir)
  const weekAgo = db.metricas.get(toLocalDateKey(addDays(now, -7)));
  const trend = (cur: number, prev: number | undefined, goodWhenUp: boolean): KpiCard['trend'] => {
    if (prev === undefined) return null;
    const delta = cur - prev;
    return { delta, direction: delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down', label: `${delta > 0 ? '+' : ''}${delta} vs. 7 dias${goodWhenUp ? '' : ''}` };
  };
  const projectsActive = db.projetos.filter((p) => p.status === 'active').length;
  const kpis: KpiCard[] = [
    { key: 'active', label: 'Pautas ativas', value: open.length, trend: trend(open.length, weekAgo?.open, false) },
    { key: 'done', label: 'Concluídas no mês', value: doneMonth },
    { key: 'overdue', label: 'Atrasadas', value: overdue.length, trend: trend(overdue.length, weekAgo?.overdue, false) },
    { key: 'week', label: 'Entregas da semana', value: weekDeliveries.length },
    { key: 'critical', label: 'Prioridades críticas', value: critical.length },
    { key: 'suggestions', label: 'Sugestões pendentes', value: pendingSugs.length, trend: trend(pendingSugs.length, weekAgo?.pendingSuggestions, false) },
    { key: 'projects', label: 'Projetos ativos', value: projectsActive },
    { key: 'rate', label: 'Taxa de conclusão', value: completionRate, unit: '%', hint: 'Pautas criadas nos últimos 30 dias que já foram concluídas' },
  ];

  const hour = now.getHours();
  const salutation = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const dateLabel = WEEKDAY_FMT.format(now).replace(/^./, (c) => c.toUpperCase()) + '.';
  const parts: string[] = [];
  parts.push(
    importantToday.length
      ? `Você tem ${importantToday.length} ${importantToday.length === 1 ? 'entrega importante' : 'entregas importantes'} hoje`
      : dueToday.length
        ? `Você tem ${dueToday.length} ${dueToday.length === 1 ? 'entrega' : 'entregas'} hoje`
        : 'Nenhuma entrega vence hoje',
  );
  if (overdue.length) parts.push(`${overdue.length} ${overdue.length === 1 ? 'pauta atrasada' : 'pautas atrasadas'}`);
  parts.push(`${pendingSugs.length} ${pendingSugs.length === 1 ? 'nova sugestão identificada' : 'novas sugestões identificadas'}`);
  const headline = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}.` : `${parts[0]}.`;

  const catMap = new Map(db.categorias.list().map((c) => [c.id, c]));
  const byCat = new Map<string, number>();
  for (const p of open) byCat.set(p.categoryId ?? 'none', (byCat.get(p.categoryId ?? 'none') ?? 0) + 1);
  const history = await app.history.range(addDays(now, -84).toISOString(), now.toISOString());
  const analytics = computeAnalytics(
    { pautas, suggestions: sugs, categories: db.categorias.list(), projects: db.projetos.list(), history, now },
    resolvePeriod('month', now),
  );
  const events = db.eventos
    .filter((e) => !e.isCancelled && new Date(e.end) >= now && new Date(e.start) < addDays(startOfDay(now), 2))
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 6)
    .map<DashboardResponse['upcomingEvents'][number]>((e) => ({
      id: `event:${e.id}`,
      kind: 'event',
      title: e.subject,
      start: e.start,
      end: e.end,
      allDay: e.isAllDay,
      pautaId: null,
      location: e.location,
      url: e.onlineMeetingUrl ?? e.webLink,
      editable: false,
    }));

  return {
    greeting: { salutation, name: db.users.get().name || '', dateLabel, headline },
    kpis,
    attention: attentionList(pautas, now),
    insights: buildInsights(pautas, sugs, now, cfg.workday.dailyCapacityHours, cfg.workday.days),
    dailySummary: await app.summaries.latest('daily'),
    charts: {
      byCategory: [...byCat.entries()].map(([id, value]) => ({ key: id, label: catMap.get(id)?.name ?? 'Sem categoria', value, color: catMap.get(id)?.color ?? '#94a3b8' })).sort((a, b) => b.value - a.value),
      byStatus: STATUS_ORDER.filter((s) => s !== 'done').map((s) => ({ key: s, label: STATUS_LABEL[s], value: open.filter((p) => p.status === s).length })),
      weeklyVolume: analytics.series.weekly,
      completions: analytics.series.weekly.map((w) => ({ date: w.date, concluidas: w.concluidas ?? 0 })),
    },
    upcomingEvents: events,
    generatedAt: now.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Assistente                                                          */
/* ------------------------------------------------------------------ */

type Intent = { key: string; test: RegExp };
const INTENTS: Intent[] = [
  { key: 'overdue', test: /(atrasad|vencid|passou do prazo)/ },
  { key: 'approval', test: /(aprova|aguardando (minha )?aprova|validac)/ },
  { key: 'outlook', test: /(outlook|e-?mail|chegou|novo no|novidade|caixa de entrada)/ },
  { key: 'week', test: /(resum|semana)/ },
  { key: 'projects', test: /(projeto)/ },
  { key: 'productivity', test: /(produtiv|desempenho|como estou|metricas|indicador)/ },
  { key: 'priorities', test: /(priori|o que (devo|fazer)|foco|agora|hoje)/ },
  { key: 'planner', test: /(planner|tarefa)/ },
];

const pautaRef = (p: Pauta, meta?: string) => ({ type: 'pauta' as const, id: p.id, title: p.title, meta: meta ?? (p.dueDate ? `prazo ${p.dueDate}` : STATUS_LABEL[p.status]) });

export async function askAssistant(app: AppContext, question: string): Promise<AssistantAnswer> {
  const { db } = app;
  const q = norm(question);
  const now = new Date();
  const pautas = db.pautas.list();
  const open = pautas.filter((p) => isOpenStatus(p.status));
  const intent = INTENTS.find((i) => i.test.test(q))?.key ?? 'search';
  let answer = '';
  let items: AssistantAnswer['items'] = [];

  switch (intent) {
    case 'priorities': {
      const top = effectiveOrder(pautas).slice(0, 5);
      answer = top.length
        ? `Suas prioridades agora, pela ordem recomendada:\n${top.map((p, i) => `${i + 1}. ${p.title} — score ${p.priorityScore} (${PRIORITY_LABEL[p.recommendedPriority].toLowerCase()}). ${nextActionFor(p, now).action}.`).join('\n')}`
        : 'Você não tem pautas em aberto.';
      items = top.map((p) => pautaRef(p, `score ${p.priorityScore}`));
      break;
    }
    case 'overdue': {
      const list = open.filter((p) => isOverdue(p, now));
      answer = list.length ? `Sim, ${list.length} pauta(s) atrasada(s):\n${list.map((p) => `• ${p.title} (prazo ${p.dueDate}, ${-daysBetween(now, dueToDate(p.dueDate!))} dia(s) de atraso)`).join('\n')}` : 'Nenhuma entrega atrasada. 👏';
      items = list.map((p) => pautaRef(p));
      break;
    }
    case 'approval': {
      const list = open.filter((p) => p.approvalPending || p.status === 'review');
      const sugs = db.sugestoes.filter((s) => s.status === 'pending' && s.approvalPending);
      answer = list.length || sugs.length
        ? `${list.length} pauta(s) aguardando aprovação${sugs.length ? ` e ${sugs.length} pedido(s) de aprovação detectados pelo radar` : ''}:\n${list.map((p) => `• ${p.title}`).join('\n')}`
        : 'Nenhuma pauta aguardando aprovação.';
      items = [...list.map((p) => pautaRef(p)), ...sugs.map((s) => ({ type: 'sugestao' as const, id: s.id, title: s.title, meta: 'sugestão' }))];
      break;
    }
    case 'outlook': {
      const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
      const msgs = db.mensagens.filter((m) => !m.isSent && m.receivedAt >= since);
      const sugs = db.sugestoes.filter((s) => s.source === 'outlook' && s.createdAt >= since);
      const last = db.sincronizacao.get().outlook.lastSyncAt;
      if (!app.ms.statusSync().connected && !last) answer = 'O Outlook ainda não está conectado. Configure em Integrações para o radar monitorar seus e-mails.';
      else
        answer = `Nas últimas 24h chegaram ${msgs.length} e-mail(s) nas pastas monitoradas; o radar identificou ${sugs.length} possível(is) demanda(s)${sugs.length ? ':\n' + sugs.map((s) => `• ${s.title}${s.requester ? ` — ${s.requester}` : ''}`).join('\n') : '.'}${last ? `\nÚltima sincronização: ${new Date(last).toLocaleString('pt-BR')}.` : ''}`;
      items = sugs.map((s) => ({ type: 'sugestao' as const, id: s.id, title: s.title, meta: s.requester ?? undefined }));
      break;
    }
    case 'week': {
      const r = await app.summaries.generate('weekly');
      answer = `${r.headline}\n${r.sections
        .filter((s) => s.items.length && ['done', 'bottlenecks', 'next'].includes(s.key))
        .map((s) => `${s.title}:\n${s.items.slice(0, 5).map((i) => `• ${i.text}`).join('\n')}`)
        .join('\n')}`;
      if (r.narrative) answer = `${r.narrative}\n\n${answer}`;
      items = r.sections.flatMap((s) => s.items).filter((i) => i.pautaId).slice(0, 8).map((i) => pautaRef(db.pautas.get(i.pautaId!) ?? ({ id: i.pautaId, title: i.text, status: 'todo' } as Pauta)));
      break;
    }
    case 'projects': {
      const since = addDays(now, -7).toISOString();
      const byProj = new Map<string, Pauta[]>();
      for (const p of pautas.filter((p) => p.createdAt >= since && p.projectId)) byProj.set(p.projectId!, [...(byProj.get(p.projectId!) ?? []), p]);
      answer = byProj.size
        ? `Projetos com novas demandas nos últimos 7 dias:\n${[...byProj.entries()].map(([id, l]) => `• ${db.projetos.get(id)?.name ?? 'Projeto'}: ${l.length} nova(s)`).join('\n')}`
        : 'Nenhum projeto recebeu novas demandas nos últimos 7 dias.';
      items = [...byProj.keys()].map((id) => ({ type: 'projeto' as const, id, title: db.projetos.get(id)?.name ?? id }));
      break;
    }
    case 'productivity': {
      const history = await app.history.range(new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(), now.toISOString());
      const a = computeAnalytics({ pautas, suggestions: db.sugestoes.list(), categories: db.categorias.list(), projects: db.projetos.list(), history, now }, resolvePeriod('month', now));
      const m = (k: string) => a.metrics.find((x) => x.key === k)!;
      const fmt = (k: string, unit = '') => {
        const x = m(k);
        return `${x.value ?? '—'}${x.value !== null ? unit : ''}${x.previous !== undefined && x.previous !== null ? ` (mês anterior: ${x.previous}${unit})` : ''}`;
      };
      answer = `Produtividade neste mês (dados observados):\n• Concluídas: ${fmt('done')}\n• Novas demandas: ${fmt('created')}\n• Cumprimento de prazos: ${fmt('onTime', '%')}\n• Tempo médio de conclusão: ${fmt('leadTime', ' dias')}\n• Atrasadas agora: ${m('overdue').value}`;
      break;
    }
    case 'planner': {
      const tasks = db.plannerTasks.filter((t) => t.percentComplete < 100);
      answer = tasks.length ? `${tasks.length} tarefa(s) do Planner atribuídas a você em aberto:\n${tasks.slice(0, 10).map((t) => `• ${t.title}${t.dueDateTime ? ` (prazo ${toLocalDateKey(new Date(t.dueDateTime))})` : ''} — ${t.planTitle}`).join('\n')}` : 'Nenhuma tarefa do Planner sincronizada em aberto.';
      break;
    }
    default: {
      const qt = tokens(question);
      const scored = pautas
        .map((p) => {
          const pt = new Set(tokens(`${p.title} ${p.description} ${p.requester ?? ''} ${p.tags.join(' ')}`));
          return { p, hits: qt.filter((t) => pt.has(t)).length };
        })
        .filter((x) => x.hits > 0)
        .sort((a, b) => b.hits - a.hits || b.p.priorityScore - a.p.priorityScore)
        .slice(0, 6);
      items = scored.map((x) => pautaRef(x.p));
      answer = scored.length ? `Encontrei ${scored.length} pauta(s) relacionada(s):\n${scored.map((x) => `• ${x.p.title} — ${STATUS_LABEL[x.p.status]}`).join('\n')}` : '';
    }
  }

  // IA opcional: responde perguntas abertas usando somente o contexto local
  if (app.ai.enabledFor('assistant') && (intent === 'search' || !answer)) {
    const context = effectiveOrder(pautas)
      .slice(0, 40)
      .map((p) => `- [${p.id.slice(0, 8)}] ${truncate(p.title, 80)} | ${STATUS_LABEL[p.status]} | prazo ${p.dueDate ?? '—'} | score ${p.priorityScore}${p.requester ? ` | solicitante ${p.requester}` : ''}`)
      .join('\n');
    const ai = await app.ai.complete('assistant', [
      { role: 'system', content: `Você é o assistente do PautaFlow. Responda em português, de forma objetiva, usando APENAS os dados abaixo. Se a informação não estiver nos dados, diga que não sabe. Hoje é ${toLocalDateKey(now)}.\n\nPautas em aberto:\n${context || '(nenhuma)'}` },
      { role: 'user', content: question },
    ]);
    if (ai) return { answer: ai, items, source: app.ai.providerLabel };
  }
  if (!answer) {
    answer = 'Não encontrei informações sobre isso nos seus dados locais. Experimente: "Quais são minhas prioridades hoje?", "Tenho alguma entrega atrasada?", "Resuma minha semana" ou "O que chegou de novo no Outlook?".';
  }
  return { answer, items, source: 'rules' };
}
