import { useMemo } from 'react';
import { motion } from 'motion/react';
import { CalendarClock, Flame, Hourglass, Users } from 'lucide-react';
import type { Pauta } from '@pautaflow/shared';
import { isOpenStatus } from '@pautaflow/shared';
import { cn } from '@/lib/utils';
import { PautaCard } from '../PautaCard';
import { daysUntil, effectivePriority, isOverdue } from '../helpers';

type Q = 'do' | 'schedule' | 'delegate' | 'drop';

const QUADS: { key: Q; title: string; hint: string; icon: React.ReactNode; color: string; tag: string }[] = [
  { key: 'do', title: 'Fazer agora', hint: 'Urgente e importante', icon: <Flame />, color: '#ef4444', tag: 'Urgente · Importante' },
  { key: 'schedule', title: 'Agendar', hint: 'Importante, sem urgência — reserve tempo', icon: <CalendarClock />, color: '#6366f1', tag: 'Importante' },
  { key: 'delegate', title: 'Delegar / encaixar', hint: 'Urgente, menor impacto — delegue ou encaixe', icon: <Users />, color: '#f59e0b', tag: 'Urgente' },
  { key: 'drop', title: 'Eliminar / adiar', hint: 'Nem urgente nem importante', icon: <Hourglass />, color: '#64748b', tag: 'Baixa relevância' },
];

export function classify(p: Pauta): Q {
  const level = effectivePriority(p);
  const d = daysUntil(p.dueDate);
  const urgent = isOverdue(p) || (d !== null && d <= 3) || level === 'critical' || level === 'high';
  const important = p.impact >= 4 || level === 'critical';
  return urgent && important ? 'do' : important ? 'schedule' : urgent ? 'delegate' : 'drop';
}

export function MatrixView({ pautas }: { pautas: Pauta[] }) {
  const groups = useMemo(() => {
    const g: Record<Q, Pauta[]> = { do: [], schedule: [], delegate: [], drop: [] };
    for (const p of pautas) if (isOpenStatus(p.status)) g[classify(p)].push(p);
    for (const k of Object.keys(g) as Q[]) g[k].sort((a, b) => b.priorityScore - a.priorityScore);
    return g;
  }, [pautas]);

  return (
    <div>
      <p className="mb-3 px-1 text-xs text-fg-3">
        <span className="font-medium text-fg-2">Urgente</span> = atrasada, prazo em até 3 dias ou prioridade alta/crítica · <span className="font-medium text-fg-2">Importante</span> = impacto ≥ 4 ou prioridade crítica. Apenas pautas abertas.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {QUADS.map((q, i) => {
          const items = groups[q.key];
          return (
            <motion.section
              key={q.key}
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: i * 0.06, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="glass relative flex min-h-[280px] flex-col overflow-hidden !rounded-[26px] p-4"
            >
              <div className="pointer-events-none absolute -right-20 -top-20 size-56 rounded-full opacity-[0.16] blur-3xl" style={{ background: q.color }} />
              <div className="relative mb-3 flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-xl text-white [&_svg]:size-4" style={{ background: q.color, boxShadow: `0 8px 18px -8px ${q.color}` }}>
                  {q.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[15px] font-semibold tracking-[-0.015em] text-fg">{q.title}</h3>
                  <p className="truncate text-xs text-fg-3">{q.hint}</p>
                </div>
                <span className="tabular text-2xl font-semibold tracking-[-0.03em] text-fg">{items.length}</span>
              </div>
              <div className={cn('relative grid flex-1 content-start gap-2 overflow-y-auto pr-0.5', items.length > 0 && 'max-h-[420px]')}>
                {items.length === 0 ? (
                  <p className="grid flex-1 place-items-center py-8 text-center text-xs text-fg-3">Nenhuma pauta neste quadrante.</p>
                ) : (
                  items.map((p) => <PautaCard key={p.id} pauta={p} compact={items.length > 6} />)
                )}
              </div>
            </motion.section>
          );
        })}
      </div>
    </div>
  );
}
