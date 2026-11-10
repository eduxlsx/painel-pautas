import { forwardRef, type HTMLAttributes } from 'react';
import { CheckSquare, Link2, MessageSquare, GitBranch, Mail, KanbanSquare, ShieldCheck } from 'lucide-react';
import type { Pauta } from '@pautaflow/shared';
import { isOpenStatus } from '@pautaflow/shared';
import { cn } from '@/lib/utils';
import { useCategorias, useProjetos } from '@/lib/queries';
import { useUi } from '@/stores/ui';
import { Avatar, DueChip, PriorityBadge, ScoreRing, StatusBadge, Tip } from '@/components/ui';

export function useLookups() {
  const { data: projetos = [] } = useProjetos();
  const { data: categorias = [] } = useCategorias();
  return {
    project: (id: string | null) => (id ? projetos.find((p) => p.id === id) ?? null : null),
    category: (id: string | null) => (id ? categorias.find((c) => c.id === id) ?? null : null),
    projetos,
    categorias,
  };
}

export function ScoreTooltip({ pauta }: { pauta: Pauta }) {
  return (
    <div className="space-y-1.5">
      <div className="font-medium">{pauta.priorityJustification || 'Score ainda não calculado'}</div>
      {pauta.priorityFactors.map((f) => (
        <div key={f.key} className="flex justify-between gap-4 text-fg-2">
          <span>{f.label}</span>
          <span className="tabular">{f.points > 0 ? '+' : ''}{f.points}</span>
        </div>
      ))}
    </div>
  );
}

/** Card de pauta reutilizável (Kanban, listas, dashboard). Clique abre o painel de detalhes. */
export const PautaCard = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { pauta: Pauta; compact?: boolean; showStatus?: boolean; dragging?: boolean }>(
  ({ pauta: p, compact, showStatus, dragging, className, onClick, ...rest }, ref) => {
    const { openPauta } = useUi();
    const { project, category } = useLookups();
    const proj = project(p.projectId);
    const cat = category(p.categoryId);
    const doneChecks = p.checklist.filter((c) => c.done).length + p.subtasks.filter((s) => s.done).length;
    const totalChecks = p.checklist.length + p.subtasks.length;
    const level = p.manualPriority ?? p.recommendedPriority;
    const open = isOpenStatus(p.status);
    return (
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        onClick={(e) => (onClick ? onClick(e) : openPauta(p.id))}
        onKeyDown={(e) => e.key === 'Enter' && openPauta(p.id)}
        className={cn(
          'glass glass-hover group cursor-pointer !rounded-2xl p-3.5 text-left outline-none',
          dragging && 'rotate-[1.5deg] scale-[1.02] shadow-[var(--pf-shadow-lg)]',
          !open && 'opacity-70',
          className,
        )}
        {...rest}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {(proj || cat) && (
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-fg-3">
                {proj && (
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: proj.color }} />
                    <span className="truncate">{proj.name}</span>
                  </span>
                )}
                {proj && cat && <span>·</span>}
                {cat && <span className="truncate" style={{ color: cat.color }}>{cat.name}</span>}
              </div>
            )}
            <div className={cn('font-medium leading-snug text-fg', compact ? 'line-clamp-1 text-[13px]' : 'line-clamp-2 text-[13.5px]', p.status === 'done' && 'line-through decoration-fg-3/50')}>{p.title}</div>
          </div>
          {open && <ScoreRing score={p.priorityScore} level={p.recommendedPriority} size={compact ? 30 : 34} factors={<ScoreTooltip pauta={p} />} />}
        </div>
        {!compact && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {showStatus && <StatusBadge status={p.status} />}
            <PriorityBadge level={level} />
            <DueChip due={p.dueDate} done={p.status === 'done'} />
            {p.approvalPending && (
              <Tip content="Aprovação pendente">
                <span className="grid size-6 place-items-center rounded-full bg-warning/15 text-amber-600 dark:text-amber-300 [&_svg]:size-3.5"><ShieldCheck /></span>
              </Tip>
            )}
          </div>
        )}
        {!compact && (totalChecks > 0 || p.comments.length > 0 || p.links.length > 0 || p.dependencies.length > 0 || p.sourceRefs.length > 0 || p.requester) && (
          <div className="mt-3 flex items-center justify-between gap-2 text-[11.5px] text-fg-3 [&_svg]:size-3.5">
            <div className="flex items-center gap-2.5">
              {totalChecks > 0 && <span className="tabular flex items-center gap-1"><CheckSquare />{doneChecks}/{totalChecks}</span>}
              {p.comments.length > 0 && <span className="tabular flex items-center gap-1"><MessageSquare />{p.comments.length}</span>}
              {p.links.length > 0 && <span className="tabular flex items-center gap-1"><Link2 />{p.links.length}</span>}
              {p.dependencies.length > 0 && <span className="tabular flex items-center gap-1"><GitBranch />{p.dependencies.length}</span>}
              {p.sourceRefs.some((r) => r.source === 'outlook') && <Mail />}
              {p.sourceRefs.some((r) => r.source === 'planner') && <KanbanSquare />}
            </div>
            {p.requester && <Avatar name={p.requester} className="size-6 text-[9.5px]" />}
          </div>
        )}
      </div>
    );
  },
);
PautaCard.displayName = 'PautaCard';
