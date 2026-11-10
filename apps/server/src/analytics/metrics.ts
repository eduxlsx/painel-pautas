import {
  type AnalyticsResponse,
  type ChartDatum,
  type HistoryEntry,
  type MetricValue,
  type Pauta,
  type SeriesPoint,
  type Sugestao,
  type Categoria,
  type Projeto,
  isOpenStatus,
  SOURCE_LABEL,
  STATUS_LABEL,
  STATUS_ORDER,
} from '@pautaflow/shared';
import { addDays, dueToDate, startOfDay, startOfWeek, toLocalDateKey } from '../intelligence/dates';

export interface MetricsInput {
  pautas: Pauta[];
  suggestions: Sugestao[];
  categories: Categoria[];
  projects: Projeto[];
  history: HistoryEntry[];
  now: Date;
}

export type PeriodKey = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

export function resolvePeriod(key: PeriodKey, now: Date, from?: string, to?: string): { from: Date; to: Date; label: string } {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  switch (key) {
    case 'today':
      return { from: startOfDay(now), to: end, label: 'Hoje' };
    case 'week':
      return { from: startOfWeek(now), to: end, label: 'Esta semana' };
    case 'month':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: end, label: 'Este mês' };
    case 'quarter': {
      const q = Math.floor(now.getMonth() / 3) * 3;
      return { from: new Date(now.getFullYear(), q, 1), to: end, label: 'Este trimestre' };
    }
    case 'year':
      return { from: new Date(now.getFullYear(), 0, 1), to: end, label: 'Este ano' };
    case 'custom': {
      const f = from ? new Date(`${from}T00:00:00`) : addDays(startOfDay(now), -30);
      const t = to ? new Date(`${to}T23:59:59`) : end;
      return { from: f, to: t, label: `${toLocalDateKey(f)} a ${toLocalDateKey(t)}` };
    }
  }
}

const inRange = (iso: string | null, from: Date, to: Date) => !!iso && new Date(iso) >= from && new Date(iso) <= to;

export function isOverdue(p: Pauta, now: Date): boolean {
  return isOpenStatus(p.status) && !!p.dueDate && dueToDate(p.dueDate).getTime() < now.getTime();
}

export function completedOnTime(p: Pauta): boolean | null {
  if (!p.completedAt || !p.dueDate) return null;
  return new Date(p.completedAt).getTime() <= dueToDate(p.dueDate).getTime();
}

function avg(nums: number[]): number | null {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

function periodStats(pautas: Pauta[], suggestions: Sugestao[], from: Date, to: Date, now: Date) {
  const created = pautas.filter((p) => inRange(p.createdAt, from, to));
  const done = pautas.filter((p) => p.status === 'done' && inRange(p.completedAt, from, to));
  const withDue = done.map(completedOnTime).filter((x): x is boolean => x !== null);
  const onTimeRate = withDue.length ? (withDue.filter(Boolean).length / withDue.length) * 100 : null;
  const leadDays = done.map((p) => (new Date(p.completedAt!).getTime() - new Date(p.createdAt).getTime()) / 86_400_000);
  const sugs = suggestions.filter((s) => inRange(s.createdAt, from, to));
  return {
    created: created.length,
    done: done.length,
    onTimeRate: round1(onTimeRate),
    avgLead: round1(avg(leadDays)),
    overdue: pautas.filter((p) => isOverdue(p, now)).length,
    sugIdentified: sugs.length,
    sugApproved: sugs.filter((s) => s.status === 'approved' || s.status === 'linked').length,
    sugIgnored: sugs.filter((s) => s.status === 'ignored').length,
    doneList: done,
    createdList: created,
  };
}

export function computeAnalytics(input: MetricsInput, period: { from: Date; to: Date; label: string }): AnalyticsResponse {
  const { pautas, suggestions, categories, projects, history, now } = input;
  const { from, to } = period;
  const cur = periodStats(pautas, suggestions, from, to, now);
  const spanMs = to.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - spanMs - 1000);
  const prevTo = new Date(from.getTime() - 1000);
  const prev = periodStats(pautas, suggestions, prevFrom, prevTo, now);

  const open = pautas.filter((p) => isOpenStatus(p.status));
  // Estimativa (rotulada): dias para zerar o backlog no ritmo atual de conclusões
  const days = Math.max(1, spanMs / 86_400_000);
  const throughput = cur.done / days;
  const backlogDays = throughput > 0 ? Math.round(open.length / throughput) : null;

  const metrics: MetricValue[] = [
    { key: 'total', label: 'Total de demandas', value: pautas.length, kind: 'observed', note: 'Todas as pautas registradas' },
    { key: 'open', label: 'Demandas em aberto', value: open.length, kind: 'observed' },
    { key: 'created', label: 'Novas no período', value: cur.created, kind: 'observed', previous: prev.created },
    { key: 'done', label: 'Concluídas no período', value: cur.done, kind: 'observed', previous: prev.done },
    { key: 'overdue', label: 'Atrasadas agora', value: cur.overdue, kind: 'observed' },
    { key: 'onTime', label: 'Cumprimento de prazos', value: cur.onTimeRate, unit: '%', kind: 'observed', previous: prev.onTimeRate, note: 'Concluídas com prazo, entregues até a data' },
    { key: 'leadTime', label: 'Tempo médio de conclusão', value: cur.avgLead, unit: 'dias', kind: 'observed', previous: prev.avgLead },
    { key: 'sugIdentified', label: 'Sugestões identificadas', value: cur.sugIdentified, kind: 'observed', previous: prev.sugIdentified },
    { key: 'sugApproved', label: 'Sugestões aprovadas', value: cur.sugApproved, kind: 'observed', previous: prev.sugApproved },
    { key: 'sugIgnored', label: 'Sugestões ignoradas', value: cur.sugIgnored, kind: 'observed', previous: prev.sugIgnored },
    { key: 'backlogDays', label: 'Dias para zerar backlog', value: backlogDays, unit: 'dias', kind: 'estimated', note: 'Estimativa: pautas abertas ÷ ritmo de conclusões do período' },
  ];

  // Série diária (criadas × concluídas) no período, limitada a 92 pontos
  const daily: SeriesPoint[] = [];
  const dStart = startOfDay(from);
  const nDays = Math.min(92, Math.ceil(spanMs / 86_400_000));
  const offset = Math.max(0, Math.ceil(spanMs / 86_400_000) - nDays);
  for (let i = 0; i < nDays; i++) {
    const d = toLocalDateKey(addDays(dStart, i + offset));
    daily.push({
      date: d,
      criadas: pautas.filter((p) => toLocalDateKey(new Date(p.createdAt)) === d).length,
      concluidas: pautas.filter((p) => p.completedAt && toLocalDateKey(new Date(p.completedAt)) === d).length,
    });
  }

  const weekly: SeriesPoint[] = [];
  const w0 = startOfWeek(now);
  for (let i = 11; i >= 0; i--) {
    const ws = addDays(w0, -7 * i);
    const we = addDays(ws, 7);
    weekly.push({
      date: toLocalDateKey(ws),
      criadas: pautas.filter((p) => new Date(p.createdAt) >= ws && new Date(p.createdAt) < we).length,
      concluidas: pautas.filter((p) => p.completedAt && new Date(p.completedAt) >= ws && new Date(p.completedAt) < we).length,
    });
  }

  const monthly: SeriesPoint[] = [];
  for (let i = 11; i >= 0; i--) {
    const ms = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const me = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const doneM = pautas.filter((p) => p.completedAt && new Date(p.completedAt) >= ms && new Date(p.completedAt) < me);
    const ot = doneM.map(completedOnTime).filter((x): x is boolean => x !== null);
    monthly.push({
      date: toLocalDateKey(ms).slice(0, 7),
      criadas: pautas.filter((p) => new Date(p.createdAt) >= ms && new Date(p.createdAt) < me).length,
      concluidas: doneM.length,
      noPrazo: ot.length ? Math.round((ot.filter(Boolean).length / ot.length) * 100) : 0,
    });
  }

  const scoped = pautas.filter((p) => inRange(p.createdAt, from, to) || inRange(p.completedAt, from, to) || isOpenStatus(p.status));
  const catName = new Map(categories.map((c) => [c.id, c]));
  const byCategory = countBy(scoped, (p) => p.categoryId ?? 'none').map(([id, value]) => ({
    key: id,
    label: catName.get(id)?.name ?? 'Sem categoria',
    value,
    color: catName.get(id)?.color ?? '#94a3b8',
  }));
  const byOrigin = countBy(scoped, (p) => p.origin).map(([k, value]) => ({ key: k, label: SOURCE_LABEL[k as keyof typeof SOURCE_LABEL] ?? k, value }));
  const byStatus: ChartDatum[] = STATUS_ORDER.map((s) => ({ key: s, label: STATUS_LABEL[s], value: pautas.filter((p) => p.status === s).length }));

  const avgTimeByCategory: ChartDatum[] = [];
  for (const [id, list] of groupBy(cur.doneList, (p) => p.categoryId ?? 'none')) {
    const a = avg(list.map((p) => (new Date(p.completedAt!).getTime() - new Date(p.createdAt).getTime()) / 86_400_000));
    avgTimeByCategory.push({ key: id, label: catName.get(id)?.name ?? 'Sem categoria', value: round1(a) ?? 0, color: catName.get(id)?.color });
  }

  const projName = new Map(projects.map((p) => [p.id, p]));
  const activity = history.filter((h) => h.entity === 'pauta' && inRange(h.at, from, to));
  const projActivity = new Map<string, number>();
  for (const h of activity) {
    const p = pautas.find((x) => x.id === h.entityId);
    if (p?.projectId) projActivity.set(p.projectId, (projActivity.get(p.projectId) ?? 0) + 1);
  }
  for (const p of cur.createdList) if (p.projectId) projActivity.set(p.projectId, (projActivity.get(p.projectId) ?? 0) + 1);
  const topProjects = [...projActivity.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, value]) => ({ key: id, label: projName.get(id)?.name ?? 'Projeto removido', value, color: projName.get(id)?.color }));

  const suggestionFunnel: ChartDatum[] = [
    { key: 'identified', label: 'Identificadas', value: cur.sugIdentified },
    { key: 'approved', label: 'Aprovadas/vinculadas', value: cur.sugApproved },
    { key: 'ignored', label: 'Ignoradas', value: cur.sugIgnored },
    { key: 'pending', label: 'Pendentes', value: suggestions.filter((s) => s.status === 'pending' && inRange(s.createdAt, from, to)).length },
  ];

  // Heatmap: atividade registrada no histórico (últimas 26 semanas)
  const hmStart = addDays(startOfWeek(now), -7 * 25);
  const counts = new Map<string, number>();
  for (const h of history) {
    if (h.actor !== 'user' && h.action !== 'completed') continue;
    const k = toLocalDateKey(new Date(h.at));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const heatmap: { date: string; count: number }[] = [];
  for (let d = hmStart; d <= now; d = addDays(d, 1)) heatmap.push({ date: toLocalDateKey(d), count: counts.get(toLocalDateKey(d)) ?? 0 });

  return {
    period: { from: from.toISOString(), to: to.toISOString(), label: period.label },
    metrics,
    series: { daily, weekly, monthly },
    byCategory,
    byOrigin,
    byStatus,
    avgTimeByCategory,
    topProjects,
    suggestionFunnel,
    heatmap,
    generatedAt: now.toISOString(),
  };
}

function groupBy<T>(arr: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of arr) {
    const k = key(x);
    m.set(k, [...(m.get(k) ?? []), x]);
  }
  return m;
}

function countBy<T>(arr: T[], key: (t: T) => string): [string, number][] {
  return [...groupBy(arr, key).entries()].map(([k, v]) => [k, v.length] as [string, number]).sort((a, b) => b[1] - a[1]);
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Separador ";" e BOM para abrir corretamente no Excel em português
  return '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\r\n');
}
