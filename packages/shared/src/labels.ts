import type { PautaKind, PautaStatus, PriorityLevel, SourceKind } from './schemas';

export const STATUS_LABEL: Record<PautaStatus, string> = {
  backlog: 'Backlog',
  todo: 'A fazer',
  in_progress: 'Em andamento',
  waiting: 'Aguardando',
  review: 'Em revisão',
  done: 'Concluída',
  cancelled: 'Cancelada',
};

export const STATUS_ORDER: PautaStatus[] = ['backlog', 'todo', 'in_progress', 'waiting', 'review', 'done'];

export const PRIORITY_LABEL: Record<PriorityLevel, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  critical: 'Crítica',
};

export const SOURCE_LABEL: Record<SourceKind, string> = {
  manual: 'Manual',
  outlook: 'Outlook',
  planner: 'Planner',
  calendar: 'Calendário',
  radar: 'Radar',
  assistant: 'Assistente',
};

export const KIND_LABEL: Record<PautaKind, string> = {
  tarefa: 'Tarefa',
  entrega: 'Entrega',
  publicacao: 'Publicação',
  reuniao: 'Reunião',
  aprovacao: 'Aprovação',
};

export const OPEN_STATUSES: PautaStatus[] = ['backlog', 'todo', 'in_progress', 'waiting', 'review'];

export function isOpenStatus(s: PautaStatus): boolean {
  return OPEN_STATUSES.includes(s);
}

/** Classificação a partir do score 0–100. */
export function classifyScore(score: number): PriorityLevel {
  if (score >= 75) return 'critical';
  if (score >= 55) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}
