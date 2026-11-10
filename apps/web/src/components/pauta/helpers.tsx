import { motion } from 'motion/react';
import { differenceInCalendarDays } from 'date-fns';
import type { Pauta, PautaInput, PriorityLevel } from '@pautaflow/shared';
import { PRIORITY_LABEL, isOpenStatus } from '@pautaflow/shared';
import { cn, parseDue } from '@/lib/utils';
import { PRIORITY_HEX } from '@/components/ui';
import { queryClient } from '@/lib/api';
import { useUpdatePauta } from '@/lib/queries';

/** Prioridade efetiva: a decisão manual prevalece sobre a recomendação. */
export const effectivePriority = (p: Pauta): PriorityLevel => p.manualPriority ?? p.recommendedPriority;

export const PRIORITY_LEVELS: PriorityLevel[] = ['critical', 'high', 'medium', 'low'];

/** Data (YYYY-MM-DD) de um campo ISO/data para inputs type="date" max="2100-12-31". */
export const dateInput = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : '');

export function daysUntil(due: string | null | undefined): number | null {
  if (!due) return null;
  return differenceInCalendarDays(parseDue(due), new Date());
}

export function isOverdue(p: Pauta): boolean {
  if (!p.dueDate || !isOpenStatus(p.status)) return false;
  return parseDue(p.dueDate).getTime() < Date.now();
}

export const IMPACT_LABEL = ['', 'Muito baixo', 'Baixo', 'Médio', 'Alto', 'Muito alto'] as const;
export const COMPLEXITY_LABEL = ['', 'Trivial', 'Simples', 'Moderada', 'Complexa', 'Muito complexa'] as const;

/** Seletor 1–5 com indicador deslizante. */
export function ScalePicker({ value, onChange, id, labels, color = 'var(--pf-accent)' }: { value: number; onChange: (v: number) => void; id: string; labels: readonly string[]; color?: string }) {
  return (
    <div>
      <div className="flex gap-1 rounded-xl bg-sunken p-1 ring-1 ring-line">
        {[1, 2, 3, 4, 5].map((n) => {
          const active = n === value;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              aria-pressed={active}
              title={labels[n]}
              className={cn('tabular relative h-8 flex-1 rounded-lg text-[13px] font-semibold transition-colors', active ? 'text-white' : n < value ? 'text-fg-2' : 'text-fg-3 hover:text-fg-2')}
            >
              {active && <motion.span layoutId={`scale-${id}`} className="absolute inset-0 rounded-lg shadow-[var(--pf-shadow)]" style={{ background: color }} transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
              {!active && n < value && <span className="absolute inset-x-2 bottom-1 h-0.5 rounded-full opacity-50" style={{ background: color }} />}
              <span className="relative z-10">{n}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-1 text-[11px] text-fg-3">{labels[value]}</div>
    </div>
  );
}

/** Opções do seletor de prioridade manual (inclui "Automática"). */
export function PriorityOptions() {
  return (
    <>
      <option value="">Automática</option>
      {PRIORITY_LEVELS.map((l) => (
        <option key={l} value={l}>
          {PRIORITY_LABEL[l]}
        </option>
      ))}
    </>
  );
}

export const priorityColor = (l: PriorityLevel) => PRIORITY_HEX[l];

/** Atualiza uma pauta com atualização otimista no cache da lista ['pautas']. */
export function useOptimisticPautaUpdate() {
  const update = useUpdatePauta();
  return (id: string, input: PautaInput) => {
    const prev = queryClient.getQueryData<Pauta[]>(['pautas']);
    queryClient.setQueryData<Pauta[]>(['pautas'], (list) => list?.map((p) => (p.id === id ? ({ ...p, ...input } as Pauta) : p)));
    update.mutate({ id, ...input }, { onError: () => prev && queryClient.setQueryData(['pautas'], prev) });
  };
}

/** Campos editáveis comparáveis: retorna apenas o que mudou. */
export function diffInput(before: Pauta, next: PautaInput): PautaInput {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next)) {
    const prev = (before as unknown as Record<string, unknown>)[k];
    if (JSON.stringify(prev) !== JSON.stringify(v)) out[k] = v;
  }
  return out as PautaInput;
}
