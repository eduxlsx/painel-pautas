import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { Pauta } from '@pautaflow/shared';
import { PRIORITY_LABEL, SOURCE_LABEL, STATUS_ORDER, isOpenStatus } from '@pautaflow/shared';
import { cn, parseDue } from '@/lib/utils';
import { useUi } from '@/stores/ui';
import { toast } from '@/stores/toast';
import { Avatar, DueChip, PriorityBadge, ScoreRing, SourceBadge, StatusBadge } from '@/components/ui';
import { ScoreTooltip, useLookups } from '../PautaCard';
import { effectivePriority, useOptimisticPautaUpdate, PRIORITY_LEVELS } from '../helpers';

type SortKey = 'title' | 'project' | 'status' | 'priority' | 'due' | 'requester' | 'origin';
const COLS: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Título' },
  { key: 'project', label: 'Projeto' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Prioridade' },
  { key: 'due', label: 'Prazo' },
  { key: 'requester', label: 'Solicitante' },
  { key: 'origin', label: 'Origem' },
];
const GRID = 'grid grid-cols-[36px_minmax(240px,2.4fr)_minmax(120px,1fr)_120px_150px_120px_minmax(120px,1fr)_110px] items-center gap-3';
const ROW_H = 60;

export function ListView({ pautas }: { pautas: Pauta[] }) {
  const { openPauta } = useUi();
  const { project } = useLookups();
  const move = useOptimisticPautaUpdate();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'priority', dir: -1 });
  const parentRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const val = (p: Pauta): string | number => {
      switch (sort.key) {
        case 'title':
          return p.title.toLowerCase();
        case 'project':
          return (project(p.projectId)?.name ?? '￿').toLowerCase();
        case 'status':
          return STATUS_ORDER.indexOf(p.status) === -1 ? 99 : STATUS_ORDER.indexOf(p.status);
        case 'priority':
          return (3 - PRIORITY_LEVELS.indexOf(effectivePriority(p))) * 1000 + p.priorityScore;
        case 'due':
          return p.dueDate ? parseDue(p.dueDate).getTime() : sort.dir === 1 ? Number.MAX_SAFE_INTEGER : -1;
        case 'requester':
          return (p.requester ?? '￿').toLowerCase();
        case 'origin':
          return SOURCE_LABEL[p.origin];
      }
    };
    return [...pautas].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  }, [pautas, sort, project]);

  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => ROW_H, overscan: 10 });

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'priority' ? -1 : 1 }));

  const complete = (p: Pauta) => {
    const was = p.status;
    if (isOpenStatus(p.status)) {
      move(p.id, { status: 'done' });
      toast.success('Pauta concluída', { label: 'Desfazer', onClick: () => move(p.id, { status: was }) });
    } else move(p.id, { status: 'todo' });
  };

  return (
    <div className="glass overflow-hidden !rounded-[24px]">
      <div className="overflow-x-auto">
        <div className="min-w-[1080px]">
          <div className={cn(GRID, 'border-b border-line px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-3')}>
            <span />
            {COLS.map((c) => (
              <button key={c.key} onClick={() => toggleSort(c.key)} className={cn('flex items-center gap-1 text-left uppercase transition-colors hover:text-fg', sort.key === c.key && 'text-fg')}>
                {c.label}
                {sort.key === c.key ? sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ChevronsUpDown className="size-3 opacity-40" />}
              </button>
            ))}
          </div>
          <div ref={parentRef} className="overflow-y-auto" style={{ height: `min(${Math.max(rows.length, 1) * ROW_H + 8}px, calc(100vh - 330px))`, minHeight: 240 }}>
            <div className="relative" style={{ height: virt.getTotalSize() }}>
              {virt.getVirtualItems().map((v) => {
                const p = rows[v.index];
                if (!p) return null;
                const proj = project(p.projectId);
                const done = !isOpenStatus(p.status);
                return (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openPauta(p.id)}
                    onKeyDown={(e) => e.key === 'Enter' && openPauta(p.id)}
                    className={cn(GRID, 'absolute inset-x-0 cursor-pointer border-b border-line/60 px-4 outline-none transition-colors hover:bg-sunken focus-visible:bg-sunken')}
                    style={{ height: ROW_H, transform: `translateY(${v.start}px)` }}
                  >
                    <button
                      role="checkbox"
                      aria-checked={p.status === 'done'}
                      aria-label={done ? 'Reabrir' : 'Concluir'}
                      title={done ? 'Reabrir' : 'Concluir'}
                      onClick={(e) => {
                        e.stopPropagation();
                        complete(p);
                      }}
                      className={cn('grid size-5 place-items-center rounded-full ring-1 transition-all', p.status === 'done' ? 'bg-success text-white ring-success' : 'ring-line-strong hover:bg-success/15 hover:ring-success')}
                    >
                      {p.status === 'done' && (
                        <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="3.5">
                          <path d="M5 12.5 10 17 19 7" />
                        </svg>
                      )}
                    </button>
                    <div className="flex min-w-0 items-center gap-3">
                      {!done && <ScoreRing score={p.priorityScore} level={p.recommendedPriority} size={30} factors={<ScoreTooltip pauta={p} />} />}
                      <span className={cn('truncate text-[13.5px] font-medium text-fg', done && 'text-fg-3 line-through')}>{p.title}</span>
                    </div>
                    <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-fg-2">
                      {proj ? (
                        <>
                          <span className="size-2 shrink-0 rounded-full" style={{ background: proj.color }} />
                          <span className="truncate">{proj.name}</span>
                        </>
                      ) : (
                        <span className="text-fg-3">—</span>
                      )}
                    </span>
                    <span>
                      <StatusBadge status={p.status} />
                    </span>
                    <span className="flex items-center gap-1.5" title={`${PRIORITY_LABEL[effectivePriority(p)]} · score ${p.priorityScore}`}>
                      <PriorityBadge level={effectivePriority(p)} />
                      <span className="tabular text-[11px] text-fg-3">{p.priorityScore}</span>
                    </span>
                    <span>
                      <DueChip due={p.dueDate} done={p.status === 'done'} />
                    </span>
                    <span className="flex min-w-0 items-center gap-2 text-[12.5px] text-fg-2">
                      {p.requester ? (
                        <>
                          <Avatar name={p.requester} className="size-6 text-[9.5px]" />
                          <span className="truncate">{p.requester}</span>
                        </>
                      ) : (
                        <span className="text-fg-3">—</span>
                      )}
                    </span>
                    <span>
                      <SourceBadge source={p.origin} />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[11.5px] text-fg-3">
        <span className="tabular">
          {rows.length} {rows.length === 1 ? 'pauta' : 'pautas'}
        </span>
        <span>
          Ordenado por {COLS.find((c) => c.key === sort.key)?.label.toLowerCase()} · {sort.dir === 1 ? 'crescente' : 'decrescente'} · clique no círculo para concluir
        </span>
      </div>
    </div>
  );
}
