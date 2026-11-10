import { type Pauta, type PriorityLevel, type Sugestao, type Resumo, PRIORITY_LABEL, STATUS_LABEL, KIND_LABEL, SOURCE_LABEL, isOpenStatus } from '@pautaflow/shared';
import { dueToDate } from '../../intelligence/dates';
import { truncate } from '../../intelligence/text';

/** Cores das embeds (inteiros RGB). */
export const COLOR = {
  brand: 0x5b5bf6,
  critical: 0xef4444,
  high: 0xf97316,
  medium: 0x6366f1,
  low: 0x64748b,
  success: 0x10b981,
  warning: 0xf59e0b,
  info: 0x0ea5e9,
} as const;

export const PRIORITY_COLOR: Record<PriorityLevel, number> = { critical: COLOR.critical, high: COLOR.high, medium: COLOR.medium, low: COLOR.low };
export const PRIORITY_EMOJI: Record<PriorityLevel, string> = { critical: '🔴', high: '🟠', medium: '🔵', low: '⚪' };
export const STATUS_EMOJI: Record<string, string> = { backlog: '🗂️', todo: '📝', in_progress: '⚙️', waiting: '⏳', review: '🔎', done: '✅', cancelled: '🚫' };

export const shortId = (id: string) => id.slice(0, 8);

/** Timestamp nativo do Discord (exibido no fuso de quem lê). */
export function discordTime(iso: string | Date, style: 'R' | 'D' | 'f' | 't' | 'd' = 'R'): string {
  const d = typeof iso === 'string' ? (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? dueToDate(iso) : new Date(iso)) : iso;
  return `<t:${Math.floor(d.getTime() / 1000)}:${style}>`;
}

export function dueText(p: Pick<Pauta, 'dueDate' | 'status'>): string {
  if (!p.dueDate) return 'sem prazo';
  const due = dueToDate(p.dueDate);
  const overdue = isOpenStatus(p.status) && due.getTime() < Date.now();
  return `${overdue ? '⚠️ atrasada · ' : ''}${discordTime(due, 'D')} (${discordTime(due, 'R')})`;
}

export function pautaLine(p: Pauta, projectName?: string | null): string {
  const lvl = p.manualPriority ?? p.recommendedPriority;
  const proj = projectName ? ` · ${projectName}` : '';
  const due = p.dueDate ? ` · ${dueText(p)}` : '';
  return `${PRIORITY_EMOJI[lvl]} **${truncate(p.title, 80)}** \`${shortId(p.id)}\`\n${STATUS_EMOJI[p.status] ?? ''} ${STATUS_LABEL[p.status]} · score ${p.priorityScore}${proj}${due}`;
}

export interface EmbedData {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
  url?: string;
}

export function pautaEmbed(p: Pauta, extra: { project?: string | null; category?: string | null; appUrl?: string } = {}): EmbedData {
  const lvl = p.manualPriority ?? p.recommendedPriority;
  const checks = [...p.checklist.map((c) => c.done), ...p.subtasks.map((s) => s.done)];
  const fields: EmbedData['fields'] = [
    { name: 'Status', value: `${STATUS_EMOJI[p.status] ?? ''} ${STATUS_LABEL[p.status]}`, inline: true },
    { name: 'Prioridade', value: `${PRIORITY_EMOJI[lvl]} ${PRIORITY_LABEL[lvl]} · score ${p.priorityScore}`, inline: true },
    { name: 'Prazo', value: dueText(p), inline: true },
  ];
  if (extra.project) fields.push({ name: 'Projeto', value: extra.project, inline: true });
  if (extra.category) fields.push({ name: 'Categoria', value: extra.category, inline: true });
  if (p.requester) fields.push({ name: 'Solicitante', value: truncate(p.requester, 100), inline: true });
  fields.push({ name: 'Tipo / origem', value: `${KIND_LABEL[p.kind]} · ${SOURCE_LABEL[p.origin]}`, inline: true });
  if (checks.length) fields.push({ name: 'Checklist', value: `${checks.filter(Boolean).length}/${checks.length} concluído(s)`, inline: true });
  if (p.approvalPending) fields.push({ name: 'Aprovação', value: '🛡️ pendente', inline: true });
  if (p.priorityJustification && isOpenStatus(p.status)) fields.push({ name: 'Por que esta prioridade', value: truncate(p.priorityJustification, 1000) });
  const links = p.sourceRefs.filter((r) => r.url).map((r) => `[${SOURCE_LABEL[r.source]}](${r.url})`);
  if (links.length) fields.push({ name: 'Fontes', value: links.join(' · ') });
  return {
    title: truncate(p.title, 250),
    description: p.description ? truncate(p.description, 1500) : undefined,
    color: p.status === 'done' ? COLOR.success : PRIORITY_COLOR[lvl],
    fields,
    footer: { text: `ID ${p.id}` },
    url: extra.appUrl ? `${extra.appUrl}/pautas?id=${p.id}` : undefined,
  };
}

export function suggestionEmbed(s: Sugestao, extra: { project?: string | null; category?: string | null } = {}): EmbedData {
  const fields: EmbedData['fields'] = [
    { name: 'Origem', value: s.sourceRefs.map((r) => (r.url ? `[${SOURCE_LABEL[r.source]}](${r.url})` : SOURCE_LABEL[r.source])).join(' + ') || SOURCE_LABEL[s.source], inline: true },
    { name: 'Prioridade sugerida', value: `${PRIORITY_EMOJI[s.suggestedPriority]} ${PRIORITY_LABEL[s.suggestedPriority]}`, inline: true },
    { name: 'Confiança', value: `${Math.round(s.confidence * 100)}%`, inline: true },
  ];
  if (s.requester) fields.push({ name: 'Solicitante', value: truncate(s.requester, 100), inline: true });
  if (s.dueDate) fields.push({ name: 'Prazo', value: `${discordTime(s.dueDate, 'D')}${s.dueDateEvidence ? `\n_${truncate(s.dueDateEvidence, 120)}_` : ''}`, inline: true });
  if (extra.project) fields.push({ name: 'Projeto', value: extra.project, inline: true });
  if (extra.category) fields.push({ name: 'Categoria', value: extra.category, inline: true });
  if (s.evidence) fields.push({ name: 'Evidência', value: `> ${truncate(s.evidence, 900).replace(/\n/g, '\n> ')}` });
  if (s.justification) fields.push({ name: 'Justificativa', value: truncate(s.justification, 1000) });
  if (s.duplicates.length) fields.push({ name: '⚠️ Possível duplicidade', value: s.duplicates.map((d) => `• ${truncate(d.title, 70)} (${Math.round(d.similarity * 100)}%)`).join('\n') });
  return {
    title: `📡 ${truncate(s.title, 240)}`,
    description: s.description ? truncate(s.description, 800) : undefined,
    color: COLOR.brand,
    fields,
    footer: { text: `Sugestão do radar · ${s.id}` },
  };
}

export function summaryEmbed(r: Resumo): EmbedData {
  const label = { daily: 'Resumo do dia', weekly: 'Resumo semanal', monthly: 'Resumo mensal' }[r.type];
  const fields = r.sections
    .filter((s) => s.items.length)
    .slice(0, 8)
    .map((s) => ({
      name: `${s.title} (${s.items.length})`,
      value: truncate(s.items.slice(0, 6).map((i) => `• ${truncate(i.text, 110)}${i.meta ? ` — _${truncate(i.meta, 40)}_` : ''}`).join('\n') + (s.items.length > 6 ? `\n… e mais ${s.items.length - 6}` : ''), 1020),
    }));
  return {
    title: `🗞️ ${label}`,
    description: [r.headline, r.narrative].filter(Boolean).join('\n\n'),
    color: COLOR.brand,
    fields,
    footer: { text: `Período ${r.periodStart} a ${r.periodEnd}` },
    timestamp: r.generatedAt,
  };
}
