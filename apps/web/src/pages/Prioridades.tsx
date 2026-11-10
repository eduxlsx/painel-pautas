import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type Modifier } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, Check, ChevronDown, Compass, GripVertical, Hand, Info, ListOrdered, RefreshCw, Sparkles, Undo2 } from 'lucide-react';
import type { Pauta, PriorityLevel, PriorityListItem } from '@pautaflow/shared';
import { PRIORITY_LABEL, isOpenStatus } from '@pautaflow/shared';
import { cn, fmtRelative } from '@/lib/utils';
import { post, useApiMutation, usePautas, usePriorities, useUpdatePauta } from '@/lib/queries';
import { useUi } from '@/stores/ui';
import { Badge, Button, DueChip, EmptyState, GlassCard, NativeSelect, PageHeader, PriorityBadge, ScoreRing, Skeleton, Tip, useConfirm } from '@/components/ui';
import { ScoreTooltip, useLookups } from '@/components/pauta/PautaCard';
import { PriorityOptions, daysUntil, effectivePriority, isOverdue } from '@/components/pauta/helpers';

/** Restringe o arraste ao eixo vertical. */
const restrictToVerticalAxisModifier: Modifier = ({ transform }) => ({ ...transform, x: 0 });

const INVALIDATE = ['priorities', 'pautas', 'pauta', 'dashboard'];

/** Sugestão de próxima ação a partir dos sinais da pauta. */
function nextAction(p: Pauta, byId: Map<string, Pauta>): string {
  const pendingDeps = p.dependencies.map((id) => byId.get(id)).filter((d): d is Pauta => !!d && isOpenStatus(d.status));
  if (isOverdue(p)) return 'Prazo vencido: conclua hoje ou renegocie a data com o solicitante.';
  if (pendingDeps.length) return `Destrave a dependência "${pendingDeps[0]!.title}" antes de avançar.`;
  if (p.approvalPending) return `Cobre a aprovação pendente${p.requester ? ` de ${p.requester}` : ''}.`;
  if (p.status === 'waiting') return `Aguardando retorno — faça um follow-up${p.requester ? ` com ${p.requester}` : ''}.`;
  const d = daysUntil(p.dueDate);
  if (d === 0) return 'Entrega hoje: reserve um bloco de foco agora.';
  if (d !== null && d <= 2) return 'Prazo muito próximo: priorize a execução nas próximas horas.';
  if (p.status === 'review') return 'Finalize a revisão e conclua a pauta.';
  if (p.status === 'in_progress') return 'Continue a execução e atualize o checklist.';
  if (!p.dueDate) return 'Defina um prazo para que a recomendação fique mais precisa.';
  return 'Planeje o início e quebre em subtarefas se for grande.';
}

export default function Prioridades() {
  const { data, isLoading } = usePriorities();
  const { data: pautas = [] } = usePautas();
  const [draft, setDraft] = useState<string[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { confirm, element: confirmEl } = useConfirm();

  const items = data ?? [];
  const byPautaId = useMemo(() => new Map(items.map((i) => [i.pauta.id, i])), [items]);
  const allById = useMemo(() => new Map(pautas.map((p) => [p.id, p])), [pautas]);

  // Descarta o rascunho se a lista mudar de composição (pauta concluída/criada).
  useEffect(() => {
    if (!draft) return;
    const ids = new Set(items.map((i) => i.pauta.id));
    if (draft.length !== ids.size || draft.some((id) => !ids.has(id))) setDraft((d) => (d ? [...d.filter((id) => ids.has(id)), ...items.map((i) => i.pauta.id).filter((id) => !d.includes(id))] : d));
  }, [items, draft]);

  const order = useMemo(() => (draft ? draft.map((id) => byPautaId.get(id)).filter((x): x is PriorityListItem => !!x) : items), [draft, items, byPautaId]);
  const hasManual = items.some((i) => i.manualRank !== null);
  const lastComputed = useMemo(() => items.reduce<string | null>((acc, i) => (i.pauta.priorityComputedAt && (!acc || i.pauta.priorityComputedAt > acc) ? i.pauta.priorityComputedAt : acc), null), [items]);

  const saveOrder = useApiMutation((ids: string[]) => post<PriorityListItem[]>('/api/priorities/order', { ids }), { invalidate: INVALIDATE, success: 'Ordem manual salva' });
  const accept = useApiMutation(() => post<PriorityListItem[]>('/api/priorities/accept'), { invalidate: INVALIDATE, success: 'Ordem recomendada aplicada' });
  const recompute = useApiMutation(() => post<{ changed: number }>('/api/priorities/recompute'), {
    invalidate: INVALIDATE,
    success: (r) => (r.changed ? `Scores recalculados · ${r.changed} ${r.changed === 1 ? 'pauta mudou' : 'pautas mudaram'}` : 'Scores recalculados · nada mudou'),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = order.map((i) => i.pauta.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    setDraft(arrayMove(ids, from, to));
  };

  const onAccept = async () => {
    const ok = await confirm({
      title: 'Aceitar a ordem recomendada?',
      body: 'A ordem manual definida por você será removida e a lista passará a seguir o score recomendado. Prioridades manuais e ajustes de score de cada pauta são mantidos.',
      confirm: 'Aceitar recomendação',
    });
    if (ok) accept.mutate(undefined, { onSuccess: () => setDraft(null) });
  };

  const active = activeId ? byPautaId.get(activeId) ?? null : null;

  return (
    <div>
      {confirmEl}
      <PageHeader
        eyebrow="Inteligência operacional"
        title="Prioridades"
        subtitle={items.length ? `${items.length} pautas abertas · scores ${lastComputed ? `calculados ${fmtRelative(lastComputed)}` : 'ainda não calculados'}` : 'Ordem recomendada das pautas abertas'}
        actions={
          <>
            <Button variant="secondary" onClick={() => recompute.mutate(undefined)} loading={recompute.isPending}>
              {!recompute.isPending && <RefreshCw />}
              Recalcular agora
            </Button>
            <Button variant="secondary" onClick={() => void onAccept()} loading={accept.isPending} disabled={!hasManual && !draft}>
              {!accept.isPending && <Sparkles />}
              Aceitar ordem recomendada
            </Button>
          </>
        }
      />

      <GlassCard className="mb-5 flex items-start gap-4 !rounded-[22px]">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent">
          <Compass className="size-5" />
        </span>
        <div className="space-y-1 text-[13.5px] leading-relaxed text-fg-2">
          <p>
            <strong className="font-semibold text-fg">O score é uma recomendação operacional, não uma previsão estatística.</strong> Ele combina prazo, impacto, prioridade informada, dependências, aprovações e tempo parado em pesos explicáveis — passe o mouse sobre um fator para ver o porquê.
          </p>
          <p>
            <Hand className="mr-1 inline size-3.5 -translate-y-px text-accent" />
            Suas decisões manuais (ordem arrastada, prioridade manual e ajuste de score) <strong className="font-medium text-fg">nunca são sobrescritas automaticamente</strong>; só mudam quando você aceita a recomendação.
          </p>
        </div>
      </GlassCard>

      <AnimatePresence>
        {draft && (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            className="sticky top-0 z-20 mb-4 overflow-hidden"
          >
            <div className="glass glass-strong flex flex-wrap items-center gap-3 !rounded-[18px] px-4 py-2.5">
              <ListOrdered className="size-4 text-accent" />
              <span className="text-[13px] text-fg">Nova ordem em rascunho — salve para fixá-la como ordem manual.</span>
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                  <Undo2 />
                  Descartar
                </Button>
                <Button size="sm" variant="primary" loading={saveOrder.isPending} onClick={() => saveOrder.mutate(draft, { onSuccess: () => setDraft(null) })}>
                  {!saveOrder.isPending && <Check />}
                  Salvar ordem manual
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[76px] !rounded-[20px]" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <GlassCard className="!rounded-[26px]">
          <EmptyState
            icon={<ListOrdered />}
            title="Nenhuma pauta aberta para priorizar"
            description="Assim que houver pautas abertas — criadas por você ou aprovadas a partir do Radar (Outlook e Planner) — elas aparecem aqui ordenadas pelo score recomendado."
          />
        </GlassCard>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxisModifier]}
          onDragStart={(e) => {
            setActiveId(String(e.active.id));
            setExpanded(null);
          }}
          onDragEnd={onEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <SortableContext items={order.map((i) => i.pauta.id)} strategy={verticalListSortingStrategy}>
            <ol className="space-y-2.5">
              {order.map((item, idx) => (
                <SortableRow
                  key={item.pauta.id}
                  item={item}
                  rank={idx + 1}
                  index={idx}
                  expanded={expanded === item.pauta.id}
                  onToggle={() => setExpanded((e) => (e === item.pauta.id ? null : item.pauta.id))}
                  nextAction={nextAction(item.pauta, allById)}
                />
              ))}
            </ol>
          </SortableContext>
          <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }}>
            {active ? <RowBody item={active} rank={order.findIndex((i) => i.pauta.id === active.pauta.id) + 1} overlay /> : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

function SortableRow({ item, rank, index, expanded, onToggle, nextAction }: { item: PriorityListItem; rank: number; index: number; expanded: boolean; onToggle: () => void; nextAction: string }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.pauta.id });
  return (
    <motion.li
      ref={setNodeRef}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 14) * 0.03, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.35 : undefined }}
      className="list-none"
    >
      <RowBody item={item} rank={rank} expanded={expanded} onToggle={onToggle} nextAction={nextAction} handle={{ ref: setActivatorNodeRef, props: { ...attributes, ...listeners } }} />
    </motion.li>
  );
}

function RowBody({
  item,
  rank,
  expanded,
  onToggle,
  nextAction,
  handle,
  overlay,
}: {
  item: PriorityListItem;
  rank: number;
  expanded?: boolean;
  onToggle?: () => void;
  nextAction?: string;
  handle?: { ref: (el: HTMLElement | null) => void; props: Record<string, unknown> };
  overlay?: boolean;
}) {
  const { openPauta } = useUi();
  const { project } = useLookups();
  const p = item.pauta;
  const proj = project(p.projectId);
  const delta = item.recommendedRank - rank; // positivo = acima da recomendação
  const level = effectivePriority(p);

  return (
    <div className={cn('glass !rounded-[20px] transition-shadow', overlay && 'glass-strong scale-[1.01] shadow-[var(--pf-shadow-lg)]')}>
      <div className="flex items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4">
        <button
          ref={handle?.ref}
          {...(handle?.props ?? {})}
          className="grid h-10 w-6 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-fg-3 transition hover:bg-sunken hover:text-fg active:cursor-grabbing"
          aria-label="Arrastar para reordenar"
        >
          <GripVertical className="size-4" />
        </button>
        <span className={cn('tabular w-7 shrink-0 text-center text-xl font-semibold tracking-[-0.03em]', rank <= 3 ? 'text-gradient' : 'text-fg-3')}>{rank}</span>
        <ScoreRing score={p.priorityScore} level={item.classification} size={44} factors={<ScoreTooltip pauta={p} />} />
        <button className="min-w-0 flex-1 text-left" onClick={() => openPauta(p.id)}>
          <div className="truncate text-[14px] font-medium tracking-[-0.01em] text-fg">{p.title}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-fg-3">
            {proj ? (
              <>
                <span className="size-2 rounded-full" style={{ background: proj.color }} />
                <span className="truncate">{proj.name}</span>
              </>
            ) : (
              <span>Sem projeto</span>
            )}
            {p.requester && <span className="truncate">· {p.requester}</span>}
          </div>
        </button>
        <div className="hidden shrink-0 items-center gap-2 md:flex">
          <DueChip due={p.dueDate} />
          <PriorityBadge level={level} />
          {p.manualPriority && (
            <Tip content={`Prioridade manual (recomendada: ${PRIORITY_LABEL[item.classification]})`}>
              <span className="grid size-6 place-items-center rounded-full bg-accent-soft text-accent">
                <Hand className="size-3" />
              </span>
            </Tip>
          )}
        </div>
        <DeltaBadge delta={delta} manual={item.manualRank !== null} recommended={item.recommendedRank} />
        {onToggle && (
          <Button size="icon-sm" variant="ghost" onClick={onToggle} aria-label={expanded ? 'Recolher detalhes' : 'Ver detalhes'} aria-expanded={expanded}>
            <ChevronDown className={cn('transition-transform duration-300', expanded && 'rotate-180')} />
          </Button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {expanded && nextAction && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
            <Expanded pauta={p} nextAction={nextAction} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DeltaBadge({ delta, manual, recommended }: { delta: number; manual: boolean; recommended: number }) {
  if (delta === 0)
    return (
      <Tip content={manual ? 'Na mesma posição da recomendação' : 'Seguindo a recomendação'}>
        <span className="w-14 shrink-0 text-center text-[11px] text-fg-3">{manual ? '=' : 'auto'}</span>
      </Tip>
    );
  const up = delta > 0;
  return (
    <Tip content={`Recomendada na posição ${recommended}`}>
      <span className="w-14 shrink-0 text-center">
        <Badge tone={up ? 'success' : 'warning'} icon={up ? <ArrowUp /> : <ArrowDown />} className="tabular">
          {Math.abs(delta)}
        </Badge>
      </span>
    </Tip>
  );
}

function Expanded({ pauta: p, nextAction }: { pauta: Pauta; nextAction: string }) {
  const update = useUpdatePauta();
  const [adj, setAdj] = useState(p.scoreAdjustment);
  useEffect(() => setAdj(p.scoreAdjustment), [p.scoreAdjustment]);
  const commitAdj = () => {
    if (adj !== p.scoreAdjustment) update.mutate({ id: p.id, scoreAdjustment: adj });
  };
  return (
    <div className="grid gap-4 border-t border-line px-4 pb-4 pt-4 lg:grid-cols-[1.4fr_1fr]">
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-3">Fatores do score</div>
        {p.priorityFactors.length === 0 ? (
          <p className="text-xs text-fg-3">Fatores ainda não calculados — use "Recalcular agora".</p>
        ) : (
          <div className="space-y-2">
            {p.priorityFactors.map((f, i) => {
              const neg = f.points < 0;
              const pct = f.max ? Math.min(100, (Math.abs(f.points) / Math.abs(f.max)) * 100) : 0;
              return (
                <Tip key={f.key} content={f.detail}>
                  <div className="grid grid-cols-[130px_1fr_48px] items-center gap-3 text-[12px]">
                    <span className="truncate text-fg-2">{f.label}</span>
                    <div className="h-1.5 overflow-hidden rounded-full bg-line">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: neg ? '#ef4444' : 'linear-gradient(90deg, var(--pf-accent), var(--pf-accent-2))' }}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.6, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
                      />
                    </div>
                    <span className={cn('tabular text-right font-medium', neg ? 'text-critical' : 'text-fg')}>
                      {f.points > 0 ? '+' : ''}
                      {f.points}
                      <span className="text-fg-3">/{f.max}</span>
                    </span>
                  </div>
                </Tip>
              );
            })}
          </div>
        )}
        {p.priorityJustification && <p className="mt-3 text-[13px] leading-relaxed text-fg-2">{p.priorityJustification}</p>}
      </div>
      <div className="space-y-3">
        <div className="flex gap-2.5 rounded-2xl bg-accent-soft px-3.5 py-3 text-[13px] leading-relaxed text-fg">
          <Info className="mt-0.5 size-4 shrink-0 text-accent" />
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-accent">Próxima ação</div>
            {nextAction}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-fg-2">Prioridade manual</span>
            <NativeSelect className="h-9 text-[13px]" value={p.manualPriority ?? ''} onChange={(e) => update.mutate({ id: p.id, manualPriority: (e.target.value || null) as PriorityLevel | null })}>
              <PriorityOptions />
            </NativeSelect>
          </label>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-medium text-fg-2">
              <span>Ajuste</span>
              <span className={cn('tabular', adj > 0 ? 'text-success' : adj < 0 ? 'text-critical' : 'text-fg-3')}>
                {adj > 0 ? '+' : ''}
                {adj}
              </span>
            </div>
            <input
              type="range"
              min={-30}
              max={30}
              step={1}
              value={adj}
              onChange={(e) => setAdj(Number(e.target.value))}
              onPointerUp={commitAdj}
              onKeyUp={commitAdj}
              onBlur={commitAdj}
              aria-label="Ajuste de score"
              className="h-9 w-full cursor-pointer accent-[var(--pf-accent)]"
            />
          </div>
        </div>
        {update.isPending && <p className="text-[11px] text-fg-3">Salvando e recalculando…</p>}
      </div>
    </div>
  );
}
