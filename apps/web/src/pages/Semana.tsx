import { useMemo, useState } from 'react';
import { DndContext, DragOverlay, useDroppable, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { addDays, format, isSameMonth, isToday, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Clock, Info, Layers, Plus, Target, Video } from 'lucide-react';
import type { CalendarItem, WeekResponse } from '@pautaflow/shared';
import { cn, toDateKey } from '@/lib/utils';
import { useWeek } from '@/lib/queries';
import { useUi } from '@/stores/ui';
import { Button, EmptyState, GlassCard, PageHeader, Skeleton } from '@/components/ui';
import { CountUp } from '@/components/charts/kit';
import { DraggablePauta, ExternalChip, PautaChip, itemDay, useDragSensors, useMovePauta } from '@/components/charts/calendar-items';

function weekLabel(start: Date): string {
  const end = addDays(start, 6);
  if (isSameMonth(start, end)) return `${format(start, 'd')}–${format(end, "d 'de' MMMM", { locale: ptBR })}`;
  return `${format(start, "d 'de' MMMM", { locale: ptBR })} – ${format(end, "d 'de' MMMM", { locale: ptBR })}`;
}

const KIND_ORDER: Record<CalendarItem['kind'], number> = { event: 0, pauta: 1, planner: 2 };
const sortItems = (a: CalendarItem, b: CalendarItem) => {
  // Eventos com hora primeiro (por horário), depois pautas e Planner
  const ta = a.allDay ? 1 : 0;
  const tb = b.allDay ? 1 : 0;
  if (ta !== tb) return ta - tb;
  if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  return a.start.localeCompare(b.start);
};

export default function Semana() {
  const [anchor, setAnchor] = useState(() => new Date());
  const anchorKey = toDateKey(anchor);
  const { data, isLoading } = useWeek(anchorKey);
  const { openEditor } = useUi();
  const sensors = useDragSensors();
  const { move, dayOf } = useMovePauta();
  const [active, setActive] = useState<CalendarItem | null>(null);

  const start = data ? parseISO(data.start) : anchor;
  const isCurrentWeek = data ? data.days.some((d) => d.date === toDateKey(new Date())) : true;

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    if (!data) return map;
    for (const d of data.days) map.set(d.date, []);
    const seen = new Set<string>();
    for (const d of data.days)
      for (const it of d.items) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        const key = dayOf(it);
        map.get(key)?.push(it);
      }
    for (const list of map.values()) list.sort(sortItems);
    return map;
  }, [data, dayOf]);

  const summary = useMemo(() => {
    const all = data ? data.days.flatMap((d) => d.items) : [];
    return {
      deliveries: all.filter((i) => i.kind === 'pauta' && i.status !== 'done' && i.status !== 'cancelled').length,
      done: all.filter((i) => i.kind === 'pauta' && i.status === 'done').length,
      planned: data ? data.days.reduce((s, d) => s + d.plannedHours, 0) : 0,
      capacity: data ? data.days.reduce((s, d) => s + d.capacityHours, 0) : 0,
      meetings: all.filter((i) => i.kind === 'event').length,
      planner: all.filter((i) => i.kind === 'planner').length,
    };
  }, [data]);

  const onDragStart = (e: DragStartEvent) => setActive((e.active.data.current as { item?: CalendarItem } | undefined)?.item ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    const it = (e.active.data.current as { item?: CalendarItem } | undefined)?.item;
    const target = e.over?.id;
    if (!it?.pautaId || typeof target !== 'string') return;
    if (target === dayOf(it)) return;
    move(it.pautaId, target, it.title);
  };

  return (
    <div className="pb-10">
      <PageHeader
        eyebrow="Planejamento"
        title="Minha Semana"
        subtitle={weekLabel(start)}
        actions={
          <>
            <div className="flex items-center gap-1 rounded-xl bg-sunken p-1 ring-1 ring-line">
              <Button variant="ghost" size="icon-sm" aria-label="Semana anterior" onClick={() => setAnchor((a) => addDays(a, -7))}>
                <ChevronLeft />
              </Button>
              <Button variant={isCurrentWeek ? 'ghost' : 'secondary'} size="sm" className="h-7" onClick={() => setAnchor(new Date())}>
                Hoje
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Próxima semana" onClick={() => setAnchor((a) => addDays(a, 7))}>
                <ChevronRight />
              </Button>
            </div>
            <Button variant="primary" onClick={() => openEditor(null, { dueDate: isCurrentWeek ? toDateKey(new Date()) : (data?.start ?? anchorKey) })}>
              <Plus /> Nova pauta
            </Button>
          </>
        }
      />

      <SummaryStrip loading={isLoading} {...summary} />

      <div className="mb-4 flex items-start gap-2 rounded-2xl bg-sky-500/[0.07] px-3.5 py-2.5 text-[12.5px] text-fg-2 ring-1 ring-inset ring-sky-500/20">
        <Info className="mt-0.5 size-3.5 shrink-0 text-sky-600 dark:text-sky-300" />
        <span>
          Arraste pautas entre os dias para mudar o prazo. Alterações aqui são locais e não modificam Outlook/Planner — reuniões e tarefas do Planner aparecem apenas para leitura.
        </span>
      </div>

      {isLoading || !data ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-80 !rounded-[22px]" />
          ))}
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
          <div className="-mx-1 overflow-x-auto px-1 pb-2">
            <div className="grid min-w-[1050px] grid-cols-7 gap-3">
              {data.days.map((d, i) => (
                <DayColumn key={d.date} day={d} items={byDay.get(d.date) ?? []} index={i} onAdd={() => openEditor(null, { dueDate: d.date })} />
              ))}
            </div>
          </div>
          <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }}>{active ? <PautaChip item={active} overlay /> : null}</DragOverlay>
        </DndContext>
      )}

      {data && data.days.every((d) => d.items.length === 0) && (
        <GlassCard className="mt-4">
          <EmptyState
            icon={<CalendarRange />}
            title="Semana livre"
            description="Nenhuma pauta com prazo, reunião ou tarefa do Planner nesta semana. Crie uma pauta com prazo ou conecte o Microsoft 365 em Integrações para ver reuniões e tarefas."
            action={
              <Button variant="primary" onClick={() => openEditor(null, { dueDate: data.days[0]?.date })}>
                <Plus /> Planejar pauta
              </Button>
            }
          />
        </GlassCard>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SummaryStrip({ loading, deliveries, done, planned, capacity, meetings, planner }: { loading: boolean; deliveries: number; done: number; planned: number; capacity: number; meetings: number; planner: number }) {
  const over = capacity > 0 && planned > capacity;
  const pct = capacity > 0 ? Math.min(100, (planned / capacity) * 100) : planned > 0 ? 100 : 0;
  const cells = [
    { icon: <Target />, label: 'Entregas em aberto', value: deliveries, sub: done ? `${done} concluída${done > 1 ? 's' : ''}` : 'na semana' },
    { icon: <Video />, label: 'Reuniões', value: meetings, sub: 'Outlook' },
    { icon: <Layers />, label: 'Tarefas do Planner', value: planner, sub: 'somente leitura' },
  ];
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className={cn('glass p-4 sm:col-span-2 lg:col-span-1', over && 'ring-1 ring-inset ring-warning/40')}>
        <div className="flex items-center justify-between text-[12px] font-medium text-fg-2">
          <span className="flex items-center gap-1.5">
            <Clock className="size-3.5 text-accent" /> Horas planejadas
          </span>
          {over && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10.5px] font-semibold text-amber-600 dark:text-amber-300">Acima da capacidade</span>}
        </div>
        {loading ? (
          <Skeleton className="mt-2 h-8 w-32" />
        ) : (
          <div className="tabular mt-1.5 text-[24px] font-semibold tracking-[-0.03em] text-fg">
            <CountUp value={planned} decimals={planned % 1 ? 1 : 0} />
            <span className="text-[14px] font-medium text-fg-3"> / {capacity}h</span>
          </div>
        )}
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
          <motion.div className="h-full rounded-full" style={{ background: over ? '#f59e0b' : 'linear-gradient(90deg,var(--pf-accent),var(--pf-accent-2))' }} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
        </div>
      </div>
      {cells.map((c) => (
        <div key={c.label} className="glass flex items-center gap-3 p-4">
          <div className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent [&_svg]:size-[18px]">{c.icon}</div>
          <div>
            {loading ? <Skeleton className="h-7 w-10" /> : <div className="tabular text-[24px] font-semibold leading-none tracking-[-0.03em] text-fg"><CountUp value={c.value} /></div>}
            <div className="mt-1 text-[12px] text-fg-2">
              {c.label} <span className="text-fg-3">· {c.sub}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DayColumn({ day, items, index, onAdd }: { day: WeekResponse['days'][number]; items: CalendarItem[]; index: number; onAdd: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: day.date });
  const reduce = useReducedMotion();
  const date = parseISO(day.date);
  const today = isToday(date);
  const over = day.plannedHours > day.capacityHours;
  const pct = day.capacityHours > 0 ? Math.min(100, (day.plannedHours / day.capacityHours) * 100) : day.plannedHours > 0 ? 100 : 0;
  const off = day.capacityHours === 0;
  return (
    <motion.section
      ref={setNodeRef}
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'glass flex min-h-[420px] flex-col !rounded-[20px] p-2.5 transition-[box-shadow,background-color]',
        today && 'ring-2 ring-inset ring-accent/50',
        off && !today && 'bg-sunken/40',
        isOver && 'bg-accent-soft ring-2 ring-inset ring-accent',
      )}
    >
      <header className="mb-2 px-1 pt-0.5">
        <div className="flex items-start justify-between">
          <div>
            <div className={cn('text-[11px] font-semibold uppercase tracking-[0.12em]', today ? 'text-accent' : 'text-fg-3')}>{format(date, 'EEE', { locale: ptBR }).replace('.', '')}</div>
            <div className="flex items-baseline gap-1.5">
              <span className={cn('tabular text-[22px] font-semibold tracking-[-0.03em]', today ? 'text-gradient' : 'text-fg')}>{format(date, 'd')}</span>
              {today && <span className="rounded-full bg-accent px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-white">Hoje</span>}
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label={`Nova pauta em ${format(date, "d 'de' MMMM", { locale: ptBR })}`} onClick={onAdd}>
            <Plus />
          </Button>
        </div>
        <div className="mt-1.5" title={`${day.plannedHours}h planejadas de ${day.capacityHours}h de capacidade`}>
          <div className="h-1 overflow-hidden rounded-full bg-line">
            <motion.div className="h-full rounded-full" style={{ background: over ? '#f59e0b' : 'var(--pf-accent)' }} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.7, delay: 0.15 + index * 0.03 }} />
          </div>
          <div className={cn('tabular mt-1 text-[10.5px]', over ? 'font-semibold text-amber-600 dark:text-amber-300' : 'text-fg-3')}>
            {off ? (day.plannedHours > 0 ? `${day.plannedHours}h · dia de folga` : 'Fora do expediente') : `${day.plannedHours}h / ${day.capacityHours}h${over ? ' · sobrecarga' : ''}`}
          </div>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-1.5">
        <AnimatePresence initial={false}>
          {items.map((it) => (
            <motion.div key={it.id} layout={!reduce} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.2 }}>
              {it.kind === 'pauta' && it.editable ? <DraggablePauta item={it} /> : <ExternalChip item={it} />}
            </motion.div>
          ))}
        </AnimatePresence>
        <button
          type="button"
          onClick={onAdd}
          className={cn('mt-auto flex min-h-10 flex-1 items-center justify-center gap-1 rounded-xl text-[11.5px] text-fg-3 opacity-0 transition hover:bg-sunken hover:opacity-100 focus-visible:opacity-100', items.length === 0 && 'opacity-60')}
        >
          {items.length === 0 ? (
            <>
              <CalendarDays className="size-3.5" /> Livre
            </>
          ) : (
            <>
              <Plus className="size-3.5" /> Adicionar
            </>
          )}
        </button>
      </div>
    </motion.section>
  );
}
