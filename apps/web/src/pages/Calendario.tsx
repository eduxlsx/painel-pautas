import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { DndContext, DragOverlay, useDroppable, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  addDays,
  addMonths,
  differenceInMinutes,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Info, LayoutGrid, Plus, Rows3 } from 'lucide-react';
import type { CalendarItem } from '@pautaflow/shared';
import { PRIORITY_LABEL, type PriorityLevel } from '@pautaflow/shared';
import { cn, toDateKey } from '@/lib/utils';
import { useCalendar } from '@/lib/queries';
import { useUi } from '@/stores/ui';
import { Button, EmptyState, GlassCard, PageHeader, PRIORITY_HEX, Segmented, Skeleton } from '@/components/ui';
import { DraggablePauta, EVENT_HEX, ExternalChip, PautaChip, PLANNER_HEX, itemColor, timeRange, useDragSensors, useMovePauta } from '@/components/charts/calendar-items';

type View = 'day' | 'week' | 'month';
const HOUR_PX = 52;
const WEEK_OPTS = { weekStartsOn: 1 as const };
const WEEKDAY_SHORT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

function rangeFor(view: View, cursor: Date): { from: Date; to: Date } {
  if (view === 'day') return { from: startOfDay(cursor), to: startOfDay(cursor) };
  if (view === 'week') return { from: startOfWeek(cursor, WEEK_OPTS), to: endOfWeek(cursor, WEEK_OPTS) };
  return { from: startOfWeek(startOfMonth(cursor), WEEK_OPTS), to: endOfWeek(endOfMonth(cursor), WEEK_OPTS) };
}

function titleFor(view: View, cursor: Date): string {
  if (view === 'day') return format(cursor, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });
  if (view === 'week') {
    const s = startOfWeek(cursor, WEEK_OPTS);
    const e = addDays(s, 6);
    return isSameMonth(s, e) ? `${format(s, 'd')}–${format(e, "d 'de' MMMM", { locale: ptBR })}` : `${format(s, "d 'de' MMM", { locale: ptBR })} – ${format(e, "d 'de' MMM 'de' yyyy", { locale: ptBR })}`;
  }
  return format(cursor, "MMMM 'de' yyyy", { locale: ptBR });
}

const timed = (it: CalendarItem) => !it.allDay && it.start.length > 10;

export default function Calendario() {
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState(() => new Date());
  const { from, to } = rangeFor(view, cursor);
  const { data = [], isLoading } = useCalendar(toDateKey(from), toDateKey(to));
  const { openEditor } = useUi();
  const sensors = useDragSensors();
  const { move, dayOf } = useMovePauta();
  const [active, setActive] = useState<CalendarItem | null>(null);

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    for (const it of data) {
      const k = dayOf(it);
      const list = m.get(k);
      if (list) list.push(it);
      else m.set(k, [it]);
    }
    for (const l of m.values()) l.sort((a, b) => Number(timed(b)) - Number(timed(a)) || a.start.localeCompare(b.start));
    return m;
  }, [data, dayOf]);

  const step = (dir: 1 | -1) => setCursor((c) => (view === 'month' ? addMonths(c, dir) : addDays(c, view === 'week' ? 7 * dir : dir)));
  const goDay = (d: string) => {
    setCursor(parseISO(d));
    setView('day');
  };

  const onDragStart = (e: DragStartEvent) => setActive((e.active.data.current as { item?: CalendarItem } | undefined)?.item ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    const it = (e.active.data.current as { item?: CalendarItem } | undefined)?.item;
    const target = (e.over?.data.current as { date?: string } | undefined)?.date;
    if (!it?.pautaId || !target || target === dayOf(it)) return;
    move(it.pautaId, target, it.title);
  };

  const counts = {
    pautas: data.filter((i) => i.kind === 'pauta').length,
    events: data.filter((i) => i.kind === 'event').length,
    planner: data.filter((i) => i.kind === 'planner').length,
  };

  return (
    <div className="pb-10">
      <PageHeader
        eyebrow="Calendário inteligente"
        title={titleFor(view, cursor).replace(/^./, (c) => c.toUpperCase())}
        subtitle={`${counts.pautas} pautas · ${counts.events} reuniões · ${counts.planner} tarefas do Planner no período`}
        actions={
          <>
            <Segmented
              id="cal-view"
              value={view}
              onChange={setView}
              options={[
                { value: 'day', label: 'Dia', icon: <Rows3 /> },
                { value: 'week', label: 'Semana', icon: <CalendarRange /> },
                { value: 'month', label: 'Mês', icon: <LayoutGrid /> },
              ]}
            />
            <div className="flex items-center gap-1 rounded-xl bg-sunken p-1 ring-1 ring-line">
              <Button variant="ghost" size="icon-sm" aria-label="Anterior" onClick={() => step(-1)}>
                <ChevronLeft />
              </Button>
              <Button variant="ghost" size="sm" className="h-7" onClick={() => setCursor(new Date())}>
                Hoje
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Próximo" onClick={() => step(1)}>
                <ChevronRight />
              </Button>
            </div>
            <Button variant="primary" onClick={() => openEditor(null, { dueDate: toDateKey(view === 'month' && !isSameMonth(cursor, new Date()) ? startOfMonth(cursor) : cursor) })}>
              <Plus /> Nova pauta
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Legend />
        <div className="flex items-start gap-2 rounded-2xl bg-sky-500/[0.07] px-3 py-2 text-[12px] text-fg-2 ring-1 ring-inset ring-sky-500/20">
          <Info className="mt-0.5 size-3.5 shrink-0 text-sky-600 dark:text-sky-300" />
          Alterações no calendário local não modificam eventos/tarefas Microsoft.
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-[620px] !rounded-[22px]" />
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={view + toDateKey(from)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.22 }}>
              {view === 'month' && <MonthGrid from={from} cursor={cursor} byDay={byDay} onMore={goDay} />}
              {view === 'week' && <WeekGrid from={from} byDay={byDay} onDayClick={goDay} />}
              {view === 'day' && <DayView date={toDateKey(cursor)} items={byDay.get(toDateKey(cursor)) ?? []} />}
            </motion.div>
          </AnimatePresence>
          <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }}>{active ? <PautaChip item={active} dense overlay className="w-48" /> : null}</DragOverlay>
        </DndContext>
      )}

      {!isLoading && data.length === 0 && (
        <p className="mt-4 text-center text-[12.5px] text-fg-3">
          Nada agendado neste período. Clique em um dia para criar uma pauta com prazo, ou conecte o Microsoft 365 em Integrações para trazer reuniões e tarefas do Planner.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Legenda                                                             */
/* ------------------------------------------------------------------ */

function Legend() {
  const levels: PriorityLevel[] = ['critical', 'high', 'medium', 'low'];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-fg-2">
      <span className="flex items-center gap-1.5">
        <span className="font-medium text-fg">Pautas</span>
        {levels.map((l) => (
          <span key={l} className="flex items-center gap-1" title={`Prioridade ${PRIORITY_LABEL[l].toLowerCase()}`}>
            <span className="size-2 rounded-full" style={{ background: PRIORITY_HEX[l] }} />
            <span className="text-fg-3">{PRIORITY_LABEL[l]}</span>
          </span>
        ))}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full" style={{ background: EVENT_HEX }} /> Reuniões Outlook
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full" style={{ background: PLANNER_HEX }} /> Planner
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mês                                                                 */
/* ------------------------------------------------------------------ */

function MonthGrid({ from, cursor, byDay, onMore }: { from: Date; cursor: Date; byDay: Map<string, CalendarItem[]>; onMore: (d: string) => void }) {
  const days: Date[] = [];
  const end = endOfWeek(endOfMonth(cursor), WEEK_OPTS);
  for (let d = from; d <= end; d = addDays(d, 1)) days.push(d);
  return (
    <GlassCard padded={false} className="overflow-hidden">
      <div className="grid grid-cols-7 border-b border-line">
        {WEEKDAY_SHORT.map((w) => (
          <div key={w} className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-3">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => (
          <MonthCell key={toDateKey(d)} date={d} outside={!isSameMonth(d, cursor)} items={byDay.get(toDateKey(d)) ?? []} lastCol={i % 7 === 6} onMore={onMore} />
        ))}
      </div>
    </GlassCard>
  );
}

function MonthCell({ date, outside, items, lastCol, onMore }: { date: Date; outside: boolean; items: CalendarItem[]; lastCol: boolean; onMore: (d: string) => void }) {
  const key = toDateKey(date);
  const { setNodeRef, isOver } = useDroppable({ id: `m:${key}`, data: { date: key } });
  const { openEditor } = useUi();
  const today = isToday(date);
  const MAX = 3;
  const shown = items.slice(0, MAX);
  return (
    <div
      ref={setNodeRef}
      onClick={() => openEditor(null, { dueDate: key })}
      className={cn(
        'group relative min-h-[118px] cursor-pointer border-b border-line p-1.5 transition-colors hover:bg-sunken/60',
        !lastCol && 'border-r',
        outside && 'bg-sunken/40',
        isOver && '!bg-accent-soft ring-2 ring-inset ring-accent',
      )}
      title="Clique para criar uma pauta neste dia"
    >
      <div className="mb-1 flex items-center justify-between px-1">
        <span className={cn('tabular grid size-6 place-items-center rounded-full text-[12px] font-semibold', today ? 'bg-flow text-white' : outside ? 'text-fg-3/70' : 'text-fg-2')}>{format(date, 'd')}</span>
        <Plus className="size-3.5 text-fg-3 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div className="space-y-1">
        {shown.map((it) => (
          <CompactItem key={it.id} item={it} />
        ))}
        {items.length > MAX && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMore(key);
            }}
            className="w-full rounded-lg px-1.5 py-0.5 text-left text-[11px] font-medium text-accent hover:bg-accent-soft"
          >
            +{items.length - MAX} mais
          </button>
        )}
      </div>
    </div>
  );
}

function CompactItem({ item }: { item: CalendarItem }) {
  if (item.kind === 'pauta' && item.editable) return <DraggablePauta item={item} dense className="!shadow-none ring-1 ring-inset ring-line" />;
  const t = timeRange(item);
  const inner = (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: itemColor(item) }} />
      {t && <span className="tabular shrink-0 text-fg-3">{t.split(' ')[0]}</span>}
      <span className="truncate">{item.title}</span>
    </span>
  );
  const cls = cn('block w-full rounded-lg px-1.5 py-1 text-[11.5px] font-medium text-fg', item.kind === 'event' ? 'bg-sky-500/[0.08]' : 'bg-emerald-500/[0.08]', item.url && 'hover:brightness-110');
  return item.url ? (
    <a href={item.url} target="_blank" rel="noopener noreferrer" className={cls} onClick={(e) => e.stopPropagation()} title={item.joinUrl ? `${item.title} — entrar na reunião` : `${item.title} — abrir no ${item.kind === "event" ? "Outlook" : "Planner"}`}>
      {inner}
    </a>
  ) : (
    <div className={cls} onClick={(e) => e.stopPropagation()} title={item.title}>
      {inner}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Grade de horas (semana e dia)                                       */
/* ------------------------------------------------------------------ */

function hourBounds(items: CalendarItem[]): [number, number] {
  let lo = 8;
  let hi = 19;
  for (const it of items) {
    if (!timed(it)) continue;
    const s = parseISO(it.start);
    const e = it.end ? parseISO(it.end) : s;
    lo = Math.min(lo, s.getHours());
    hi = Math.max(hi, Math.min(24, e.getHours() + (e.getMinutes() ? 1 : 0)));
  }
  return [Math.max(0, lo), Math.min(24, Math.max(hi, lo + 1))];
}

/** Distribui itens sobrepostos em colunas (lanes). */
function layoutTimed(items: CalendarItem[]) {
  const sorted = items.filter(timed).sort((a, b) => a.start.localeCompare(b.start));
  const out: { item: CalendarItem; lane: number; lanes: number; start: Date; end: Date }[] = [];
  let group: typeof out = [];
  let groupEnd = 0;
  const flush = () => {
    const lanes = Math.max(1, ...group.map((g) => g.lane + 1));
    for (const g of group) g.lanes = lanes;
    out.push(...group);
    group = [];
  };
  for (const it of sorted) {
    const start = parseISO(it.start);
    const rawEnd = it.end ? parseISO(it.end) : new Date(start.getTime() + 30 * 60_000);
    const end = differenceInMinutes(rawEnd, start) < 20 ? new Date(start.getTime() + 20 * 60_000) : rawEnd;
    if (group.length && start.getTime() >= groupEnd) flush();
    const laneEnds = new Map<number, number>();
    for (const g of group) laneEnds.set(g.lane, Math.max(laneEnds.get(g.lane) ?? 0, g.end.getTime()));
    let lane = 0;
    while ((laneEnds.get(lane) ?? 0) > start.getTime()) lane++;
    group.push({ item: it, lane, lanes: 1, start, end });
    groupEnd = Math.max(groupEnd, end.getTime());
  }
  if (group.length) flush();
  return out;
}

function NowLine({ lo }: { lo: number }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const top = (now.getHours() + now.getMinutes() / 60 - lo) * HOUR_PX;
  if (top < 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top }}>
      <div className="relative h-0.5 bg-critical">
        <span className="absolute -left-1 -top-[3px] size-2 rounded-full bg-critical" />
      </div>
    </div>
  );
}

function TimedBlock({ entry, lo }: { entry: ReturnType<typeof layoutTimed>[number]; lo: number }) {
  const { item, lane, lanes, start, end } = entry;
  const top = (start.getHours() + start.getMinutes() / 60 - lo) * HOUR_PX;
  const height = Math.max(22, (differenceInMinutes(end, start) / 60) * HOUR_PX - 2);
  const style = { top, height, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` };
  if (item.kind === 'pauta' && item.editable)
    return (
      <div className="absolute z-10" style={style}>
        <DraggablePauta item={item} dense={height < 44} className="h-full" />
      </div>
    );
  return (
    <div className="absolute z-10 overflow-hidden" style={style} onClick={(e) => e.stopPropagation()}>
      <ExternalChip item={item} dense={height < 50} className="h-full" />
    </div>
  );
}

function AllDayCell({ date, items, children }: { date: string; items: CalendarItem[]; children?: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `a:${date}`, data: { date } });
  return (
    <div ref={setNodeRef} className={cn('min-h-[52px] space-y-1 border-r border-line p-1 last:border-r-0', isOver && 'bg-accent-soft ring-2 ring-inset ring-accent')}>
      {children}
      {items.map((it) => (
        <CompactItem key={it.id} item={it} />
      ))}
    </div>
  );
}

function HourColumn({ date, items, lo, hi, droppable = true }: { date: string; items: CalendarItem[]; lo: number; hi: number; droppable?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `h:${date}`, data: { date }, disabled: !droppable });
  const { openEditor } = useUi();
  const laid = useMemo(() => layoutTimed(items), [items]);
  return (
    <div
      ref={setNodeRef}
      onClick={() => openEditor(null, { dueDate: date })}
      className={cn('relative cursor-pointer border-r border-line last:border-r-0', isToday(parseISO(date)) && 'bg-accent-soft/40', isOver && 'bg-accent-soft')}
      style={{ height: (hi - lo) * HOUR_PX }}
      title="Clique para criar uma pauta neste dia"
    >
      {Array.from({ length: hi - lo }, (_, i) => (
        <div key={i} className="absolute inset-x-0 border-t border-line/70" style={{ top: i * HOUR_PX }} />
      ))}
      {laid.map((e) => (
        <TimedBlock key={e.item.id} entry={e} lo={lo} />
      ))}
      {isToday(parseISO(date)) && <NowLine lo={lo} />}
    </div>
  );
}

function HourGutter({ lo, hi }: { lo: number; hi: number }) {
  return (
    <div className="relative" style={{ height: (hi - lo) * HOUR_PX }}>
      {Array.from({ length: hi - lo }, (_, i) => (
        <span key={i} className="tabular absolute right-2 -translate-y-1/2 text-[10.5px] text-fg-3" style={{ top: i * HOUR_PX }}>
          {`${String(lo + i).padStart(2, '0')}:00`}
        </span>
      ))}
    </div>
  );
}

function WeekGrid({ from, byDay, onDayClick }: { from: Date; byDay: Map<string, CalendarItem[]>; onDayClick: (d: string) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => toDateKey(addDays(from, i)));
  const all = days.flatMap((d) => byDay.get(d) ?? []);
  const [lo, hi] = hourBounds(all);
  const cols = '56px repeat(7, minmax(120px, 1fr))';
  return (
    <GlassCard padded={false} className="overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[960px]">
          <div className="grid border-b border-line" style={{ gridTemplateColumns: cols }}>
            <div />
            {days.map((d) => {
              const date = parseISO(d);
              const today = isToday(date);
              return (
                <button key={d} type="button" onClick={() => onDayClick(d)} className="flex items-baseline gap-1.5 border-r border-line px-3 py-2.5 text-left last:border-r-0 hover:bg-sunken/60">
                  <span className={cn('text-[11px] font-semibold uppercase tracking-[0.12em]', today ? 'text-accent' : 'text-fg-3')}>{format(date, 'EEE', { locale: ptBR }).replace('.', '')}</span>
                  <span className={cn('tabular text-[18px] font-semibold tracking-[-0.02em]', today ? 'text-gradient' : 'text-fg')}>{format(date, 'd')}</span>
                </button>
              );
            })}
          </div>
          <div className="grid border-b border-line bg-sunken/30" style={{ gridTemplateColumns: cols }}>
            <div className="px-2 pt-2 text-right text-[10px] font-medium uppercase tracking-wide text-fg-3">Dia todo</div>
            {days.map((d) => (
              <AllDayCell key={d} date={d} items={(byDay.get(d) ?? []).filter((i) => !timed(i))} />
            ))}
          </div>
          <div className="max-h-[620px] overflow-y-auto">
            <div className="grid pt-2" style={{ gridTemplateColumns: cols }}>
              <HourGutter lo={lo} hi={hi} />
              {days.map((d) => (
                <HourColumn key={d} date={d} items={(byDay.get(d) ?? []).filter(timed)} lo={lo} hi={hi} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

/* ------------------------------------------------------------------ */
/* Dia                                                                 */
/* ------------------------------------------------------------------ */

function DayView({ date, items }: { date: string; items: CalendarItem[] }) {
  const { openEditor } = useUi();
  const reduce = useReducedMotion();
  const [lo, hi] = hourBounds(items);
  const allDay = items.filter((i) => !timed(i));
  const agenda = [...items].sort((a, b) => Number(timed(b)) - Number(timed(a)) || a.start.localeCompare(b.start));
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <GlassCard>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">Agenda</h3>
          <Button size="sm" variant="subtle" onClick={() => openEditor(null, { dueDate: date })}>
            <Plus /> Pauta neste dia
          </Button>
        </div>
        {agenda.length === 0 ? (
          <EmptyState icon={<CalendarDays />} title="Dia livre" description="Nenhuma pauta, reunião ou tarefa do Planner neste dia." className="py-8" />
        ) : (
          <ul className="space-y-2">
            {agenda.map((it, i) => (
              <motion.li key={it.id} initial={reduce ? false : { opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className="flex gap-3">
                <span className="tabular w-12 shrink-0 pt-2 text-right text-[11.5px] text-fg-3">{timed(it) ? format(parseISO(it.start), 'HH:mm') : 'Dia'}</span>
                <div className="min-w-0 flex-1">{it.kind === 'pauta' && it.editable ? <DraggablePauta item={it} /> : <ExternalChip item={it} />}</div>
              </motion.li>
            ))}
          </ul>
        )}
      </GlassCard>
      <GlassCard padded={false} className="overflow-hidden">
        {allDay.length > 0 && (
          <div className="grid border-b border-line bg-sunken/30" style={{ gridTemplateColumns: '56px 1fr' }}>
            <div className="px-2 pt-2 text-right text-[10px] font-medium uppercase tracking-wide text-fg-3">Dia todo</div>
            <AllDayCell date={date} items={allDay} />
          </div>
        )}
        <div className="max-h-[640px] overflow-y-auto">
          <div className="grid pt-2" style={{ gridTemplateColumns: '56px 1fr' }}>
            <HourGutter lo={lo} hi={hi} />
            <HourColumn date={date} items={items.filter(timed)} lo={lo} hi={hi} droppable={false} />
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

