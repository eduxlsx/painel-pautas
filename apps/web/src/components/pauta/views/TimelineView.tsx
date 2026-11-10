import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { addDays, differenceInCalendarDays, format, isToday, parseISO, startOfDay, startOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarOff, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Pauta } from '@pautaflow/shared';
import { PRIORITY_LABEL, isOpenStatus } from '@pautaflow/shared';
import { cn, fmtDate, parseDue } from '@/lib/utils';
import { useUi } from '@/stores/ui';
import { Button, PRIORITY_HEX, PriorityBadge, Tip } from '@/components/ui';
import { effectivePriority } from '../helpers';

const DAYS = 42;
const DAY_W = 34;
const ROW_H = 40;
const LABEL_W = 240;

const toDay = (iso: string) => startOfDay(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? parseDue(iso) : parseISO(iso));

export function TimelineView({ pautas }: { pautas: Pauta[] }) {
  const { openPauta } = useUi();
  const [origin, setOrigin] = useState(() => startOfWeek(addDays(new Date(), -14), { weekStartsOn: 1 }));
  const scrollRef = useRef<HTMLDivElement>(null);
  const windowEnd = addDays(origin, DAYS - 1);
  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(origin, i)), [origin]);
  const todayIdx = differenceInCalendarDays(new Date(), origin);

  const { rows, noDue } = useMemo(() => {
    const rows: { p: Pauta; s: number; e: number; clipL: boolean; clipR: boolean }[] = [];
    const noDue: Pauta[] = [];
    for (const p of pautas) {
      if (!p.dueDate) {
        if (isOpenStatus(p.status)) noDue.push(p);
        continue;
      }
      const end = toDay(p.dueDate);
      let start = toDay(p.startDate ?? p.createdAt);
      if (start > end) start = end;
      if (end < origin || start > windowEnd) continue;
      const s = Math.max(0, differenceInCalendarDays(start, origin));
      const e = Math.min(DAYS - 1, differenceInCalendarDays(end, origin));
      rows.push({ p, s, e, clipL: start < origin, clipR: end > windowEnd });
    }
    rows.sort((a, b) => a.s - b.s || a.e - b.e || b.p.priorityScore - a.p.priorityScore);
    noDue.sort((a, b) => b.priorityScore - a.priorityScore);
    return { rows, noDue };
  }, [pautas, origin, windowEnd]);

  // Rola até hoje ao montar / mudar janela.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && todayIdx >= 0 && todayIdx < DAYS) el.scrollTo({ left: Math.max(0, todayIdx * DAY_W - 3 * DAY_W), behavior: 'smooth' });
  }, [todayIdx]);

  return (
    <div className="space-y-4">
      <div className="glass overflow-hidden !rounded-[24px]">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">
            {format(origin, "d 'de' MMM", { locale: ptBR })} – {format(windowEnd, "d 'de' MMM yyyy", { locale: ptBR })}
          </h2>
          <div className="flex items-center gap-1">
            <Button size="icon-sm" variant="ghost" onClick={() => setOrigin((o) => addDays(o, -14))} aria-label="Duas semanas antes">
              <ChevronLeft />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOrigin(startOfWeek(addDays(new Date(), -14), { weekStartsOn: 1 }))}>
              Hoje
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => setOrigin((o) => addDays(o, 14))} aria-label="Duas semanas depois">
              <ChevronRight />
            </Button>
          </div>
          <div className="ml-auto flex items-center gap-3 text-[11px] text-fg-3">
            {(['critical', 'high', 'medium', 'low'] as const).map((l) => (
              <span key={l} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: PRIORITY_HEX[l] }} />
                {PRIORITY_LABEL[l]}
              </span>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="px-6 py-14 text-center text-sm text-fg-3">Nenhuma pauta com prazo nesta janela. Use as setas para navegar ou defina prazos nas pautas.</p>
        ) : (
          <div ref={scrollRef} className="relative max-h-[calc(100vh-340px)] min-h-[240px] overflow-auto">
            <div className="relative" style={{ width: LABEL_W + DAYS * DAY_W }}>
              {/* Cabeçalho de dias */}
              <div className="sticky top-0 z-20 flex border-b border-line bg-surface-solid">
                <div className="sticky left-0 z-10 shrink-0 border-r border-line bg-surface-solid px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-3" style={{ width: LABEL_W }}>
                  Pauta
                </div>
                {days.map((d, i) => (
                  <div key={i} className={cn('shrink-0 py-1.5 text-center', d.getDay() === 1 && 'border-l border-line')} style={{ width: DAY_W }}>
                    <div className="text-[9.5px] font-medium uppercase text-fg-3">{format(d, 'EEEEEE', { locale: ptBR })}</div>
                    <div className={cn('tabular mx-auto grid size-5 place-items-center rounded-full text-[11px] font-semibold', isToday(d) ? 'bg-flow text-white' : 'text-fg-2')}>{format(d, 'd')}</div>
                  </div>
                ))}
              </div>

              {/* Fundo: fins de semana e linha de hoje */}
              <div className="pointer-events-none absolute bottom-0 top-0" style={{ left: LABEL_W }}>
                {days.map((d, i) => (d.getDay() === 0 || d.getDay() === 6 ? <div key={i} className="absolute bottom-0 top-0 bg-sunken" style={{ left: i * DAY_W, width: DAY_W }} /> : null))}
                {todayIdx >= 0 && todayIdx < DAYS && (
                  <div className="absolute bottom-0 top-0 z-10 w-0.5 rounded-full bg-accent shadow-[0_0_12px_var(--pf-accent)]" style={{ left: todayIdx * DAY_W + DAY_W / 2 - 1 }} />
                )}
              </div>

              {rows.map(({ p, s, e, clipL, clipR }, idx) => {
                const level = effectivePriority(p);
                const color = PRIORITY_HEX[level];
                const open = isOpenStatus(p.status);
                const overdue = open && parseDue(p.dueDate!).getTime() < Date.now();
                return (
                  <div key={p.id} className="relative flex border-b border-line/50 hover:bg-sunken/60" style={{ height: ROW_H }}>
                    <button
                      onClick={() => openPauta(p.id)}
                      className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-line bg-surface-solid px-4 text-left transition-colors hover:bg-sunken"
                      style={{ width: LABEL_W }}
                    >
                      <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
                      <span className={cn('truncate text-[12.5px] font-medium text-fg', !open && 'text-fg-3 line-through')}>{p.title}</span>
                    </button>
                    <div className="relative flex-1">
                      <Tip
                        content={
                          <div className="space-y-1">
                            <div className="font-medium">{p.title}</div>
                            <div className="text-fg-2">
                              {fmtDate(p.startDate ?? p.createdAt)} → {fmtDate(p.dueDate)}
                            </div>
                            <PriorityBadge level={level} />
                          </div>
                        }
                      >
                        <motion.button
                          onClick={() => openPauta(p.id)}
                          initial={{ opacity: 0, scaleX: 0.6 }}
                          animate={{ opacity: 1, scaleX: 1 }}
                          transition={{ duration: 0.45, delay: Math.min(idx, 20) * 0.02, ease: [0.22, 1, 0.36, 1] }}
                          className={cn('absolute top-2 flex h-6 origin-left items-center overflow-hidden px-2 text-[11px] font-semibold text-white', clipL ? 'rounded-l-sm' : 'rounded-l-full', clipR ? 'rounded-r-sm' : 'rounded-r-full', !open && 'opacity-45')}
                          style={{
                            left: s * DAY_W + 3,
                            width: Math.max(DAY_W - 6, (e - s + 1) * DAY_W - 6),
                            background: `linear-gradient(90deg, color-mix(in srgb, ${color} 70%, transparent), ${color})`,
                            boxShadow: overdue ? `0 0 0 2px var(--pf-surface-strong), 0 0 0 3.5px #ef4444` : `0 6px 14px -6px ${color}`,
                          }}
                        >
                          <span className="truncate">{e - s >= 2 ? p.title : ''}</span>
                        </motion.button>
                      </Tip>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {noDue.length > 0 && (
        <div className="glass !rounded-[24px] p-4">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-fg">
            <CalendarOff className="size-4 text-fg-3" />
            Sem prazo
            <span className="tabular text-xs font-normal text-fg-3">{noDue.length}</span>
            <span className="ml-2 text-xs font-normal text-fg-3">Defina um prazo para posicioná-las na linha do tempo.</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {noDue.map((p) => (
              <button key={p.id} onClick={() => openPauta(p.id)} className="flex max-w-[320px] items-center gap-2 rounded-full bg-surface-strong py-1.5 pl-2.5 pr-3 text-[12.5px] font-medium text-fg ring-1 ring-line transition hover:ring-line-strong">
                <span className="size-2 shrink-0 rounded-full" style={{ background: PRIORITY_HEX[effectivePriority(p)] }} />
                <span className="truncate">{p.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
