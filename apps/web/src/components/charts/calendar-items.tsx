import { forwardRef, useState, type HTMLAttributes } from 'react';
import { useUpdatePauta } from '@/lib/queries';
import { useUi } from '@/stores/ui';
import { KeyboardSensor, PointerSensor, useDraggable, useSensor, useSensors } from '@dnd-kit/core';
import { queryClient } from '@/lib/api';
import { toast } from '@/stores/toast';
import { CheckCircle2, ExternalLink, KanbanSquare, MapPin, Video } from 'lucide-react';
import type { CalendarItem } from '@pautaflow/shared';
import { STATUS_LABEL, type PautaStatus } from '@pautaflow/shared';
import { parseISO } from 'date-fns';
import { cn, fmtDate, fmtTime, toDateKey } from '@/lib/utils';
import { PRIORITY_HEX } from '@/components/ui';

/**
 * Move uma pauta para outro dia (prazo YYYY-MM-DD) com atualização otimista local
 * até a consulta ser recarregada pelo servidor.
 */
export function useMovePauta() {
  const update = useUpdatePauta();
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const move = (pautaId: string, dueDate: string, title?: string) => {
    setOverrides((o) => ({ ...o, [pautaId]: dueDate }));
    update.mutate(
      { id: pautaId, dueDate },
      {
        onSuccess: () => toast.success(title ? `“${title}” movida para ${fmtDate(dueDate, "EEEE, d 'de' MMM")}` : 'Prazo atualizado'),
        onSettled: async () => {
          // Mantém a posição otimista até as consultas de semana/calendário recarregarem.
          await Promise.all([queryClient.invalidateQueries({ queryKey: ['week'] }), queryClient.invalidateQueries({ queryKey: ['calendar'] })]).catch(() => undefined);
          setOverrides((o) => {
            const rest = { ...o };
            delete rest[pautaId];
            return rest;
          });
        },
      },
    );
  };
  /** Dia efetivo de um item (aplica o movimento otimista). */
  const dayOf = (it: CalendarItem) => (it.pautaId && overrides[it.pautaId]) || itemDay(it);
  return { move, dayOf, overrides, pending: update.isPending };
}

/** Dia local (YYYY-MM-DD) em que o item começa. */
export function itemDay(it: CalendarItem): string {
  return it.allDay || it.start.length <= 10 ? it.start.slice(0, 10) : toDateKey(parseISO(it.start));
}

/** Cores fixas por tipo de item externo. */
export const EVENT_HEX = '#0ea5e9';
export const PLANNER_HEX = '#10b981';

export function itemColor(it: CalendarItem): string {
  if (it.kind === 'event') return EVENT_HEX;
  if (it.kind === 'planner') return PLANNER_HEX;
  return it.priority ? PRIORITY_HEX[it.priority] : (it.color ?? 'var(--pf-accent)');
}

export function timeRange(it: CalendarItem): string | null {
  if (it.allDay || it.start.length <= 10) return null;
  return `${fmtTime(it.start)}${it.end ? ` – ${fmtTime(it.end)}` : ''}`;
}

const isDone = (it: CalendarItem) => it.kind === 'pauta' && (it.status === 'done' || it.status === 'cancelled');

/** Chip de pauta (arrastável quando envolvido por useDraggable). */
export const PautaChip = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { item: CalendarItem; dragging?: boolean; overlay?: boolean; dense?: boolean }>(
  ({ item, dragging, overlay, dense, className, ...rest }, ref) => {
    const color = itemColor(item);
    const t = timeRange(item);
    return (
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        className={cn(
          'group relative flex cursor-grab touch-none select-none items-start gap-2 overflow-hidden rounded-xl bg-surface-strong text-left shadow-[var(--pf-shadow)] outline-none transition-[opacity,transform] active:cursor-grabbing',
          dense ? 'px-2 py-1.5' : 'px-2.5 py-2',
          dragging && 'opacity-30',
          overlay && 'rotate-[1.5deg] scale-[1.03] shadow-[var(--pf-shadow-lg)]',
          isDone(item) && 'opacity-60',
          className,
        )}
        {...rest}
      >
        <span className="absolute inset-y-1.5 left-1 w-[3px] rounded-full" style={{ background: color }} />
        <div className="min-w-0 flex-1 pl-1.5">
          <div className={cn('font-medium leading-snug text-fg', dense ? 'line-clamp-1 text-[12px]' : 'line-clamp-2 text-[12.5px]', isDone(item) && 'line-through decoration-fg-3/60')}>{item.title}</div>
          {!dense && (
            <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-fg-3">
              {isDone(item) && <CheckCircle2 className="size-3 text-success" />}
              {item.status && <span>{STATUS_LABEL[item.status as PautaStatus] ?? item.status}</span>}
              {t && <span className="tabular">· {t}</span>}
            </div>
          )}
        </div>
      </div>
    );
  },
);
PautaChip.displayName = 'PautaChip';

/** Item externo somente leitura (Outlook/Planner). */
export function ExternalChip({ item, dense, className }: { item: CalendarItem; dense?: boolean; className?: string }) {
  const isEvent = item.kind === 'event';
  const t = timeRange(item);
  const body = (
    <>
      <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-md [&_svg]:size-3', isEvent ? 'bg-sky-500/15 text-sky-600 dark:text-sky-300' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300')}>
        {isEvent ? <Video /> : <KanbanSquare />}
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn('font-medium leading-snug text-fg', dense ? 'line-clamp-1 text-[12px]' : 'line-clamp-2 text-[12.5px]')}>{item.title}</div>
        {!dense && (
          <div className="mt-0.5 space-y-0.5 text-[10.5px] text-fg-3">
            <div className="tabular">{isEvent ? (t ?? 'Dia inteiro') : `Planner${item.status ? ` · ${item.status}` : ''}`}</div>
            {item.location && (
              <div className="flex items-center gap-1 truncate">
                <MapPin className="size-2.5 shrink-0" />
                <span className="truncate">{item.location}</span>
              </div>
            )}
          </div>
        )}
      </div>
      {item.url && <ExternalLink className="mt-0.5 size-3 shrink-0 text-fg-3 opacity-60 group-hover:opacity-100" />}
    </>
  );
  const cls = cn(
    'group flex items-start gap-2 rounded-xl text-left ring-1 ring-inset',
    dense ? 'px-2 py-1.5' : 'px-2.5 py-2',
    isEvent ? 'bg-sky-500/[0.07] ring-sky-500/20' : 'bg-emerald-500/[0.07] ring-emerald-500/20',
    item.url && 'transition hover:brightness-105 hover:ring-2',
    className,
  );
  return item.url ? (
    <a href={item.url} target="_blank" rel="noopener noreferrer" className={cls} title={isEvent ? 'Abrir no Outlook' : 'Abrir no Planner'} onClick={(e) => e.stopPropagation()}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Pauta arrastável entre dias (id do draggable = id do item do calendário). */
export function DraggablePauta({ item, dense, className }: { item: CalendarItem; dense?: boolean; className?: string }) {
  const { openPauta } = useUi();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id, data: { item } });
  return (
    <PautaChip
      ref={setNodeRef}
      item={item}
      dense={dense}
      dragging={isDragging}
      className={className}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        e.stopPropagation();
        if (item.pautaId) openPauta(item.pautaId);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && item.pautaId) openPauta(item.pautaId);
        else listeners?.onKeyDown?.(e);
      }}
      title="Clique para abrir · arraste para mudar o prazo"
    />
  );
}

/** Sensores padrão: arrasta após 6px (o clique continua abrindo a pauta). */
export function useDragSensors() {
  return useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
}
