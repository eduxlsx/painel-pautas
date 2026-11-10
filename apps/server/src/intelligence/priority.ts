import { classifyScore, isOpenStatus, PRIORITY_LABEL, STATUS_LABEL, type Pauta, type PriorityFactor, type PriorityLevel } from '@pautaflow/shared';
import { daysBetween, dueToDate } from './dates';

export interface PriorityContext {
  now: Date;
  all: Pauta[];
  capacityHoursPerDay: number;
  workdays: number[];
}

export interface PriorityResult {
  score: number;
  level: PriorityLevel;
  factors: PriorityFactor[];
  justification: string;
}

function businessDaysUntil(now: Date, due: Date, workdays: number[]): number {
  const total = daysBetween(now, due);
  if (total <= 0) return 0;
  let n = 0;
  for (let i = 1; i <= Math.min(total, 366); i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if (workdays.includes(d.getDay())) n++;
  }
  return n;
}

/** Horas restantes estimadas (estimativa declarada ou derivada da complexidade, descontado o progresso do checklist). */
export function remainingHours(p: Pauta): { hours: number; estimated: boolean } {
  const base = p.estimatedHours ?? [1, 2, 4, 8, 16][p.complexity - 1]!;
  const items = [...p.checklist.map((c) => c.done), ...p.subtasks.map((s) => s.done)];
  const progress = items.length ? items.filter(Boolean).length / items.length : 0;
  return { hours: Math.max(0.25, base * (1 - progress)), estimated: p.estimatedHours === null };
}

const URGENCY_POINTS: Record<PriorityLevel, number> = { critical: 15, high: 11, medium: 6, low: 2 };

/**
 * Score de prioridade (0–100) — recomendação operacional, não previsão estatística.
 * Fatores: prazo (35), urgência (15), impacto (15), dependências (10), risco de atraso (15), estado (5), carga simultânea (5).
 */
export function computePriority(p: Pauta, ctx: PriorityContext): PriorityResult {
  if (!isOpenStatus(p.status)) {
    return { score: 0, level: 'low', factors: [], justification: p.status === 'done' ? 'Pauta concluída.' : 'Pauta cancelada.' };
  }
  const f: PriorityFactor[] = [];
  const due = p.dueDate ? dueToDate(p.dueDate) : null;
  const daysLeft = due ? daysBetween(ctx.now, due) : null;
  const overdue = due !== null && due.getTime() < ctx.now.getTime();

  // 1. Prazo
  let prazo = 5;
  let prazoDetail = 'Sem prazo definido';
  if (daysLeft !== null) {
    if (overdue) {
      prazo = 35;
      prazoDetail = daysLeft < 0 ? `Atrasada há ${-daysLeft} dia(s)` : 'Prazo vencido hoje';
    } else if (daysLeft <= 0) {
      prazo = 32;
      prazoDetail = 'Vence hoje';
    } else if (daysLeft === 1) {
      prazo = 28;
      prazoDetail = 'Vence amanhã';
    } else if (daysLeft === 2) {
      prazo = 24;
      prazoDetail = 'Vence em 2 dias';
    } else if (daysLeft <= 5) {
      prazo = 18;
      prazoDetail = `Vence em ${daysLeft} dias`;
    } else if (daysLeft <= 10) {
      prazo = 12;
      prazoDetail = `Vence em ${daysLeft} dias`;
    } else if (daysLeft <= 20) {
      prazo = 7;
      prazoDetail = `Vence em ${daysLeft} dias`;
    } else {
      prazo = 3;
      prazoDetail = `Vence em ${daysLeft} dias`;
    }
  }
  f.push({ key: 'deadline', label: 'Prazo', points: prazo, max: 35, detail: prazoDetail });

  // 2. Urgência (prioridade manual informada)
  const urg = p.manualPriority ? URGENCY_POINTS[p.manualPriority] : 5;
  f.push({
    key: 'urgency',
    label: 'Urgência',
    points: urg,
    max: 15,
    detail: p.manualPriority ? `Prioridade manual ${PRIORITY_LABEL[p.manualPriority].toLowerCase()}` : 'Sem prioridade manual (neutro)',
  });

  // 3. Impacto
  f.push({ key: 'impact', label: 'Impacto', points: p.impact * 3, max: 15, detail: `Impacto ${p.impact}/5` });

  // 4. Dependências: quantas pautas abertas dependem desta
  const dependents = ctx.all.filter((o) => o.id !== p.id && isOpenStatus(o.status) && o.dependencies.includes(p.id));
  const depPts = dependents.length === 0 ? 0 : dependents.length === 1 ? 5 : dependents.length === 2 ? 8 : 10;
  f.push({
    key: 'dependents',
    label: 'Dependências',
    points: depPts,
    max: 10,
    detail: dependents.length ? `${dependents.length} pauta(s) aguardam esta` : 'Nenhuma pauta depende desta',
  });

  // 5. Risco de atraso: trabalho restante vs. horas úteis disponíveis
  let riskPts = 0;
  let riskDetail = 'Sem prazo para avaliar risco';
  if (due) {
    const { hours, estimated } = remainingHours(p);
    const openSoon = ctx.all.filter((o) => isOpenStatus(o.status) && o.dueDate && dueToDate(o.dueDate) <= due).length || 1;
    const days = businessDaysUntil(ctx.now, due, ctx.workdays) + (overdue ? 0 : 0.5);
    const available = (days * ctx.capacityHoursPerDay) / Math.max(1, openSoon / 2);
    const ratio = available <= 0 ? 2 : hours / available;
    riskPts = ratio >= 1 ? 15 : ratio >= 0.6 ? 10 : ratio >= 0.3 ? 5 : 0;
    riskDetail = `${hours.toFixed(1)}h restantes${estimated ? ' (estimadas pela complexidade)' : ''} para ~${available.toFixed(1)}h disponíveis`;
  }
  f.push({ key: 'risk', label: 'Risco de atraso', points: riskPts, max: 15, detail: riskDetail });

  // 6. Estado atual
  const statePts = { in_progress: 5, review: 4, todo: 3, waiting: 1, backlog: 0 }[p.status as 'todo'] ?? 0;
  const statePlus = p.approvalPending ? 2 : 0;
  f.push({
    key: 'state',
    label: 'Estado',
    points: Math.min(5, statePts + statePlus),
    max: 5,
    detail: `${STATUS_LABEL[p.status]}${p.approvalPending ? ' + aprovação pendente' : ''}`,
  });

  // 7. Carga simultânea
  const dueWeek = ctx.all.filter((o) => isOpenStatus(o.status) && o.dueDate && daysBetween(ctx.now, dueToDate(o.dueDate)) <= 7).length;
  const loadPts = dueWeek >= 5 && daysLeft !== null && daysLeft <= 7 ? 5 : dueWeek >= 3 && daysLeft !== null && daysLeft <= 3 ? 3 : 0;
  f.push({
    key: 'load',
    label: 'Carga simultânea',
    points: loadPts,
    max: 5,
    detail: `${dueWeek} entrega(s) nos próximos 7 dias`,
  });

  // Penalidade: bloqueada por dependências abertas
  const blockers = p.dependencies.map((id) => ctx.all.find((o) => o.id === id)).filter((o): o is Pauta => !!o && isOpenStatus(o.status));
  if (blockers.length) {
    f.push({ key: 'blocked', label: 'Bloqueio', points: -10, max: 0, detail: `Depende de ${blockers.length} pauta(s) em aberto` });
  }
  if (p.scoreAdjustment) {
    f.push({ key: 'manual', label: 'Ajuste manual', points: p.scoreAdjustment, max: 30, detail: 'Ajuste definido por você' });
  }

  const score = Math.max(0, Math.min(100, Math.round(f.reduce((s, x) => s + x.points, 0))));
  const level = classifyScore(score);
  const top = [...f]
    .filter((x) => x.points > 0 && x.key !== 'state')
    .sort((a, b) => b.points / Math.max(1, b.max) - a.points / Math.max(1, a.max))
    .slice(0, 3)
    .map((x) => x.detail.charAt(0).toLowerCase() + x.detail.slice(1));
  const blockedTxt = blockers.length ? ' Atenção: bloqueada por dependências.' : '';
  const justification = `Score ${score} (${PRIORITY_LABEL[level].toLowerCase()}). Principais fatores: ${top.join('; ') || 'nenhum fator relevante'}.${blockedTxt}`;
  return { score, level, factors: f, justification };
}

/** Ordenação recomendada: score desc, prazo asc, criação asc. */
export function recommendedOrder(pautas: Pauta[]): Pauta[] {
  return pautas
    .filter((p) => isOpenStatus(p.status))
    .sort(
      (a, b) =>
        b.priorityScore - a.priorityScore ||
        (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

/** Ordem efetiva: itens com ordem manual primeiro (na ordem definida), depois a recomendação. */
export function effectiveOrder(pautas: Pauta[]): Pauta[] {
  const rec = recommendedOrder(pautas);
  const manual = rec.filter((p) => p.manualRank !== null).sort((a, b) => a.manualRank! - b.manualRank!);
  const auto = rec.filter((p) => p.manualRank === null);
  return [...manual, ...auto];
}
