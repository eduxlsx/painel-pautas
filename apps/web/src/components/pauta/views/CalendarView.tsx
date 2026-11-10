import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { addDays, addMonths, endOfMonth, endOfWeek, format, isSameMonth, isToday, startOfMonth, startOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { Pauta } from '@pautaflow/shared';
import { isOpenStatus } from '@pautaflow/shared';
import { cn, toDateKey } from '@/lib/utils';
import { useUi } from '@/stores/ui';
import { Button, Popover, PopoverContent, PopoverTrigger, PRIORITY_HEX } from '@/components/ui';
import { effectivePriority, useOptimisticPautaUpdate } from '../helpers';

const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const MAX_VISIBLE = 3;
const monthTitle = (d: Date) => { const s = format(d, "MMMM 'de' yyyy", { locale: ptBR }); return s.charAt(0).toUpperCase() + s.slice(1); };

export function CalendarView({ pautas }: { pautas: Pauta[] }) {
  const { openEditor } = useUi();
  const move = useOptimisticPautaUpdate();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [dir, setDir] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const days = useMemo(() => {
    const start = startOfWeek(month, { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    const out: Date[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
    return out;
  }, [month]);

  const byDay = useMemo(() => {
    const map = new Map<string, Pauta[]>();
    for (const p of pautas) {
      if (!p.dueDate) continue;
      const k = p.dueDate.slice(0, 10);
      const list = map.get(k) ?? [];
      list.push(p);
      map.set(k, list);
    }
    for (const list of map.values()) list.sort((a, b) => Number(isOpenStatus(b.status)) - Number(isOpenStatus(a.status)) || b.priorityScore - a.priorityScore);
    return map;
  }, [pautas]);

  const noDue = pautas.filter((p) => !p.dueDate && isOpenStatus(p.status)).length;
  const active = activeId ? pautas.find((p) => p.id === activeId) ?? null : null;

  const go = (delta: number) => {
    setDir(delta);
    setMonth((m) => (delta === 0 ? startOfMonth(new Date()) : addMonths(m, delta)));
  };

  const onEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const id = String(e.active.id);
    const to = e.over ? String(e.over.id) : null;
    const p = pautas.find((x) => x.id === id);
    if (!p || !to || p.dueDate?.slice(0, 10) === to) return;
    move(id, { dueDate: to });
  };

  return (
    <div className="glass !rounded-[24px] p-4">
      <div className="mb-4 flex flex-wrap items-center gap-3 px-1">
        <h2 className="text-lg font-semibold tracking-[-0.02em] text-fg">{monthTitle(month)}</h2>
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" onClick={() => go(-1)} aria-label="Mês anterior">
            <ChevronLeft />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => go(0)}>
            Hoje
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => go(1)} aria-label="Próximo mês">
            <ChevronRight />
          </Button>
        </div>
        <span className="ml-auto text-xs text-fg-3">Arraste uma pauta para outro dia para mudar o prazo{noDue ? ` · ${noDue} sem prazo` : ''}</span>
      </div>
      <div className="grid grid-cols-7 gap-1.5 px-0.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-3">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2">
            {d}
          </div>
        ))}
      </div>
      <DndContext sensors={sensors} onDragStart={(e) => setActiveId(String(e.active.id))} onDragEnd={onEnd} onDragCancel={() => setActiveId(null)}>
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div
            key={toDateKey(month)}
            custom={dir}
            initial={{ opacity: 0, x: dir * 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -24 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="grid grid-cols-7 gap-1.5"
          >
            {days.map((d) => {
              const key = toDateKey(d);
              return <DayCell key={key} date={d} dateKey={key} inMonth={isSameMonth(d, month)} items={byDay.get(key) ?? []} onAdd={() => openEditor(null, { dueDate: key })} activeId={activeId} />;
            })}
          </motion.div>
        </AnimatePresence>
        <DragOverlay dropAnimation={null}>{active ? <Chip pauta={active} overlay /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}

function DayCell({ date, dateKey, inMonth, items, onAdd, activeId }: { date: Date; dateKey: string; inMonth: boolean; items: Pauta[]; onAdd: () => void; activeId: string | null }) {
  const { setNodeRef, isOver } = useDroppable({ id: dateKey });
  const today = isToday(date);
  const weekend = date.getDay() === 0 || date.getDay() === 6;
  const visible = items.slice(0, MAX_VISIBLE);
  const rest = items.length - visible.length;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'group relative flex min-h-[118px] flex-col gap-1 rounded-2xl p-1.5 ring-1 transition-colors duration-200',
        isOver ? 'bg-accent-soft ring-accent/50' : today ? 'bg-surface-strong ring-accent/30' : weekend ? 'bg-sunken/50 ring-line/70' : 'bg-surface ring-line',
        !inMonth && 'opacity-45',
      )}
    >
      <div className="flex items-center justify-between px-1">
        <span className={cn('tabular grid size-6 place-items-center rounded-full text-[12px] font-semibold', today ? 'bg-flow text-white' : 'text-fg-2')}>{format(date, 'd')}</span>
        <button onClick={onAdd} className="grid size-6 place-items-center rounded-full text-fg-3 opacity-0 transition hover:bg-sunken hover:text-fg group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Nova pauta em ${format(date, "d 'de' MMMM", { locale: ptBR })}`}>
          <Plus className="size-3.5" />
        </button>
      </div>
      {visible.map((p) => (
        <DraggableChip key={p.id} pauta={p} hidden={activeId === p.id} />
      ))}
      {rest > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button className="rounded-lg px-1.5 py-0.5 text-left text-[11px] font-medium text-fg-3 hover:bg-sunken hover:text-fg">+{rest} mais</button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 space-y-1 p-2">
            <div className="px-1 pb-1 text-xs font-semibold capitalize text-fg">{format(date, "EEEE, d 'de' MMMM", { locale: ptBR })}</div>
            {items.map((p) => (
              <Chip key={p.id} pauta={p} />
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function DraggableChip({ pauta, hidden }: { pauta: Pauta; hidden: boolean }) {
  const { setNodeRef, listeners, attributes } = useDraggable({ id: pauta.id });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={cn('touch-none', hidden && 'opacity-30')}>
      <Chip pauta={pauta} />
    </div>
  );
}

function Chip({ pauta: p, overlay }: { pauta: Pauta; overlay?: boolean }) {
  const { openPauta } = useUi();
  const color = PRIORITY_HEX[effectivePriority(p)];
  const open = isOpenStatus(p.status);
  return (
    <div
      onClick={() => openPauta(p.id)}
      title={p.title}
      className={cn(
        'flex cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11.5px] font-medium leading-tight text-fg transition hover:brightness-105',
        overlay && 'w-44 shadow-[var(--pf-shadow-lg)]',
        !open && 'text-fg-3 line-through',
      )}
      style={{ background: `color-mix(in srgb, ${color} ${open ? 14 : 6}%, var(--pf-surface-strong))`, boxShadow: overlay ? undefined : `inset 2px 0 0 ${color}` }}
    >
      <span className="truncate">{p.title}</span>
    </div>
  );
}
