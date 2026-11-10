import { isOpenStatus, type Pauta } from '@pautaflow/shared';
import { parseDue } from '@/lib/utils';

export interface ProjectStats {
  /** Pautas consideradas no progresso (canceladas não contam). */
  total: number;
  done: number;
  open: number;
  overdue: number;
  nextDue: string | null;
}

/** Contagens por projeto a partir da lista de pautas. */
export function computeProjectStats(pautas: Pauta[]): Map<string, ProjectStats> {
  const now = Date.now();
  const out = new Map<string, ProjectStats>();
  for (const p of pautas) {
    if (!p.projectId) continue;
    let s = out.get(p.projectId);
    if (!s) {
      s = { total: 0, done: 0, open: 0, overdue: 0, nextDue: null };
      out.set(p.projectId, s);
    }
    if (p.status === 'cancelled') continue;
    s.total++;
    if (p.status === 'done') s.done++;
    if (isOpenStatus(p.status)) {
      s.open++;
      if (p.dueDate) {
        if (parseDue(p.dueDate).getTime() < now) s.overdue++;
        else if (!s.nextDue || parseDue(p.dueDate) < parseDue(s.nextDue)) s.nextDue = p.dueDate;
      }
    }
  }
  return out;
}
