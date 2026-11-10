import { type AttentionItem, type Insight, type Pauta, type Sugestao, isOpenStatus } from '@pautaflow/shared';
import { daysBetween, dueToDate, startOfWeek, addDays, brDate } from './dates';
import { effectiveOrder, remainingHours } from './priority';
import { isOverdue } from '../analytics/metrics';
import { truncate } from './text';

export function nextActionFor(p: Pauta, now: Date): { action: string; reason: string } {
  const who = p.requester ? ` com ${p.requester}` : '';
  if (isOverdue(p, now)) return { action: `Concluir hoje ou renegociar o prazo${who}`, reason: `Atrasada desde ${brDate(p.dueDate)}` };
  if (p.approvalPending) return { action: 'Revisar e registrar a aprovação', reason: 'Aprovação pendente' };
  if (p.dependencies.length) return { action: 'Verificar andamento das dependências', reason: 'Depende de outras pautas' };
  if (p.status === 'waiting') return { action: `Cobrar retorno${p.requester ? ` de ${p.requester}` : ''}`, reason: 'Aguardando terceiros' };
  if (p.status === 'review') return { action: 'Finalizar a revisão e entregar', reason: 'Em revisão' };
  const nextCheck = p.checklist.find((c) => !c.done);
  if (nextCheck) return { action: `Próximo passo: ${truncate(nextCheck.text, 60)}`, reason: 'Checklist em aberto' };
  const nextSub = p.subtasks.find((s) => !s.done);
  if (nextSub) return { action: `Próxima subtarefa: ${truncate(nextSub.title, 60)}`, reason: 'Subtarefas pendentes' };
  if (p.status === 'in_progress') return { action: 'Continuar a execução e atualizar o status', reason: 'Em andamento' };
  return { action: 'Iniciar a execução', reason: p.dueDate ? `Prazo em ${brDate(p.dueDate)}` : 'Prioridade recomendada' };
}

export function attentionList(pautas: Pauta[], now: Date, limit = 6): AttentionItem[] {
  const ordered = effectiveOrder(pautas).filter((p) => {
    if (p.recommendedPriority === 'critical' || p.recommendedPriority === 'high') return true;
    if (p.approvalPending) return true;
    return !!p.dueDate && daysBetween(now, dueToDate(p.dueDate)) <= 3;
  });
  return ordered.slice(0, limit).map((p) => {
    const { action, reason } = nextActionFor(p, now);
    return { pauta: p, nextAction: action, reason };
  });
}

/** Insights determinísticos, gerados exclusivamente a partir dos dados locais. */
export function buildInsights(pautas: Pauta[], suggestions: Sugestao[], now: Date, capacityHoursPerDay: number, workdays: number[]): Insight[] {
  const out: Insight[] = [];
  const open = pautas.filter((p) => isOpenStatus(p.status));
  const overdue = open.filter((p) => isOverdue(p, now));
  const approvals = open.filter((p) => p.approvalPending);
  const pending = suggestions.filter((s) => s.status === 'pending');
  const soon = effectiveOrder(open).filter((p) => p.dueDate && !isOverdue(p, now) && daysBetween(now, dueToDate(p.dueDate)) <= 2);

  if (overdue.length) {
    out.push({
      id: 'overdue',
      tone: 'critical',
      text: `${overdue.length === 1 ? 'Há 1 pauta atrasada' : `Há ${overdue.length} pautas atrasadas`}: ${overdue.slice(0, 2).map((p) => `“${truncate(p.title, 50)}”`).join(' e ')}. Conclua ou renegocie os prazos antes de assumir novas demandas.`,
      pautaIds: overdue.map((p) => p.id),
    });
  }
  if (approvals.length || soon.length) {
    const parts: string[] = [];
    if (approvals.length) parts.push(`${approvals.length} pauta(s) aguardando aprovação`);
    if (soon.length) parts.push(`${soon.length} entrega(s) nos próximos 2 dias`);
    const top = soon[0] ?? approvals[0]!;
    out.push({
      id: 'focus',
      tone: 'warning',
      text: `Você possui ${parts.join(' e ')}. Recomendo priorizar “${truncate(top.title, 60)}” antes de iniciar novas atividades.`,
      pautaIds: [top.id, ...approvals.map((p) => p.id)],
    });
  }
  if (pending.length) {
    const withDue = pending.filter((s) => s.dueDate).length;
    out.push({
      id: 'suggestions',
      tone: 'info',
      text: `O radar identificou ${pending.length} possível(is) nova(s) demanda(s)${withDue ? `, ${withDue} com prazo detectado` : ''}. Revise para não perder solicitações.`,
      pautaIds: [],
    });
  }

  // Carga da semana (estimativa explícita)
  const ws = startOfWeek(now);
  const we = addDays(ws, 7);
  const weekItems = open.filter((p) => p.dueDate && dueToDate(p.dueDate) >= now && dueToDate(p.dueDate) < we);
  const hours = weekItems.reduce((s, p) => s + remainingHours(p).hours, 0);
  let daysLeft = 0;
  for (let d = new Date(now); d < we; d = addDays(d, 1)) if (workdays.includes(d.getDay())) daysLeft++;
  const capacity = daysLeft * capacityHoursPerDay;
  if (weekItems.length && capacity > 0 && hours > capacity) {
    out.push({
      id: 'overload',
      tone: 'warning',
      text: `Estimativa: as entregas desta semana somam ~${Math.round(hours)}h para ~${capacity}h disponíveis. Considere renegociar prazos ou delegar.`,
      pautaIds: weekItems.map((p) => p.id),
    });
  }

  const stale = open.filter((p) => p.status === 'waiting' && daysBetween(new Date(p.lastActivityAt ?? p.updatedAt), now) >= 5);
  if (stale.length) {
    out.push({ id: 'stale', tone: 'info', text: `${stale.length} pauta(s) aguardando retorno há mais de 5 dias. Um follow-up pode destravar o fluxo.`, pautaIds: stale.map((p) => p.id) });
  }

  const doneWeek = pautas.filter((p) => p.completedAt && new Date(p.completedAt) >= ws).length;
  if (doneWeek > 0) {
    out.push({ id: 'progress', tone: 'positive', text: `Você concluiu ${doneWeek} pauta(s) nesta semana.`, pautaIds: [] });
  }
  if (!out.length) {
    out.push({
      id: 'empty',
      tone: 'positive',
      text: open.length ? 'Nenhum risco identificado no momento. Suas pautas estão dentro dos prazos.' : 'Nenhuma pauta em aberto. Cadastre uma pauta ou conecte o Microsoft 365 para o radar começar a trabalhar.',
      pautaIds: [],
    });
  }
  return out.slice(0, 5);
}
