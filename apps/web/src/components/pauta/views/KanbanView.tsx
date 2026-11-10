import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import type { Pauta, PautaStatus } from '@pautaflow/shared';
import { STATUS_LABEL, STATUS_ORDER } from '@pautaflow/shared';
import { cn } from '@/lib/utils';
import { useUi } from '@/stores/ui';
import { toast } from '@/stores/toast';
import { Button, STATUS_HEX } from '@/components/ui';
import { PautaCard } from '../PautaCard';
import { useOptimisticPautaUpdate } from '../helpers';

export function KanbanView({ pautas }: { pautas: Pauta[] }) {
  const { openEditor } = useUi();
  const move = useOptimisticPautaUpdate();
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const columns = useMemo(() => {
    const map = new Map<PautaStatus, Pauta[]>(STATUS_ORDER.map((s) => [s, []]));
    for (const p of pautas) map.get(p.status)?.push(p);
    for (const list of map.values()) list.sort((a, b) => b.priorityScore - a.priorityScore);
    return map;
  }, [pautas]);
  const active = activeId ? pautas.find((p) => p.id === activeId) ?? null : null;

  const onStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const id = String(e.active.id);
    const to = e.over?.id as PautaStatus | undefined;
    const p = pautas.find((x) => x.id === id);
    if (!p || !to || p.status === to) return;
    move(id, { status: to });
    if (to === 'done') toast.success('Pauta concluída', { label: 'Desfazer', onClick: () => move(id, { status: p.status }) });
  };

  return (
    <DndContext sensors={sensors} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setActiveId(null)}>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-4">
        {STATUS_ORDER.map((status, i) => (
          <Column key={status} status={status} items={columns.get(status) ?? []} index={i} onAdd={() => openEditor(null, { status })} activeId={activeId} />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }}>{active ? <PautaCard pauta={active} dragging className="w-[288px]" /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({ status, items, index, onAdd, activeId }: { status: PautaStatus; items: Pauta[]; index: number; onAdd: () => void; activeId: string | null }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="flex w-[300px] min-w-[272px] flex-1 shrink-0 flex-col"
    >
      <div className="mb-2.5 flex items-center gap-2 px-2">
        <span className="size-2.5 rounded-full shadow-[0_0_0_3px_color-mix(in_srgb,currentColor_18%,transparent)]" style={{ background: STATUS_HEX[status], color: STATUS_HEX[status] }} />
        <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-fg">{STATUS_LABEL[status]}</h3>
        <span className="tabular rounded-full bg-sunken px-1.5 text-[11px] font-medium text-fg-3 ring-1 ring-line">{items.length}</span>
        <Button size="icon-sm" variant="ghost" className="ml-auto" onClick={onAdd} aria-label={`Nova pauta em ${STATUS_LABEL[status]}`}>
          <Plus />
        </Button>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-[220px] flex-1 flex-col gap-2.5 rounded-[22px] p-2 ring-1 transition-colors duration-200',
          isOver ? 'bg-accent-soft ring-accent/40' : 'bg-sunken/70 ring-line',
        )}
      >
        <AnimatePresence initial={false}>
          {items.map((p) => (
            <DraggableCard key={p.id} pauta={p} hidden={activeId === p.id} />
          ))}
        </AnimatePresence>
        {items.length === 0 && (
          <button onClick={onAdd} className="grid flex-1 place-items-center rounded-2xl border border-dashed border-line-strong px-3 py-8 text-xs text-fg-3 transition hover:bg-surface hover:text-fg-2">
            {isOver ? 'Solte aqui' : 'Arraste uma pauta ou clique para criar'}
          </button>
        )}
      </div>
    </motion.div>
  );
}

function DraggableCard({ pauta, hidden }: { pauta: Pauta; hidden: boolean }) {
  const { setNodeRef, listeners, attributes } = useDraggable({ id: pauta.id });
  return (
    <motion.div layout="position" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: hidden ? 0.35 : 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.25 }}>
      <PautaCard ref={setNodeRef} pauta={pauta} {...listeners} {...attributes} className="touch-none" />
    </motion.div>
  );
}
