import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CalendarClock,
  CheckCircle2,
  CheckSquare,
  Copy,
  ExternalLink,
  File as FileIcon,
  FileSearch,
  Folder,
  FolderOpen,
  GitBranch,
  Globe,
  History,
  KanbanSquare,
  Link2,
  ListTree,
  Loader2,
  Lock,
  Mail,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  X,
  Ban,
} from 'lucide-react';
import type { Bookmark, HistoryEntry, Pauta, PautaInput, PautaKind, PautaStatus, PriorityLevel } from '@pautaflow/shared';
import { KIND_LABEL, PRIORITY_LABEL, SOURCE_LABEL, STATUS_LABEL, isOpenStatus } from '@pautaflow/shared';
import { cn, fmtDate, fmtDateTime, fmtRelative, uid } from '@/lib/utils';
import { queryClient } from '@/lib/api';
import { del, post, useApiMutation, useBookmarks, useDeletePauta, usePauta, usePautaHistory, usePautas, useUpdatePauta } from '@/lib/queries';
import { useUi } from '@/stores/ui';
import { toast } from '@/stores/toast';
import {
  Badge,
  Button,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  NativeSelect,
  PriorityBadge,
  Progress,
  ScoreRing,
  Sheet,
  Skeleton,
  SourceBadge,
  STATUS_HEX,
  StatusBadge,
  DueChip,
  Textarea,
  Tip,
  useConfirm,
  PRIORITY_HEX,
} from '@/components/ui';
import { useLookups } from './PautaCard';
import { COMPLEXITY_LABEL, IMPACT_LABEL, PriorityOptions, dateInput, effectivePriority } from './helpers';

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.05 } },
};
const rise = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const } },
};

export function PautaDetailSheet() {
  const { pautaId, openPauta } = useUi();
  const { data: pauta, isLoading, isError } = usePauta(pautaId);
  return (
    <Sheet open={!!pautaId} onOpenChange={(o) => !o && openPauta(null)} title={pauta?.title ?? 'Detalhes da pauta'} width={640}>
      {pauta && pauta.id === pautaId ? (
        <DetailBody key={pauta.id} pauta={pauta} />
      ) : isError ? (
        <div className="grid flex-1 place-items-center p-8 text-center">
          <div>
            <p className="font-semibold text-fg">Pauta não encontrada</p>
            <p className="mt-1 text-sm text-fg-3">Ela pode ter sido excluída ou mesclada.</p>
            <Button className="mt-4" variant="secondary" onClick={() => openPauta(null)}>
              Fechar
            </Button>
          </div>
        </div>
      ) : isLoading || pautaId ? (
        <div className="space-y-4 p-6">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-40" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : null}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */

function usePautaSaver(pauta: Pauta) {
  const update = useUpdatePauta();
  const save = (input: PautaInput, opts?: { success?: string }) => {
    // Atualização otimista do painel; o servidor recalcula e as consultas são invalidadas.
    const prev = queryClient.getQueryData<Pauta>(['pauta', pauta.id]);
    queryClient.setQueryData<Pauta>(['pauta', pauta.id], (old) => (old ? ({ ...old, ...input } as Pauta) : old));
    update.mutate(
      { id: pauta.id, ...input },
      {
        onSuccess: (p) => {
          queryClient.setQueryData(['pauta', pauta.id], p);
          if (opts?.success) toast.success(opts.success);
        },
        onError: () => prev && queryClient.setQueryData(['pauta', pauta.id], prev),
      },
    );
  };
  return { save, pending: update.isPending };
}

function DetailBody({ pauta: p }: { pauta: Pauta }) {
  const { openPauta, openEditor } = useUi();
  const { save, pending } = usePautaSaver(p);
  const deleteM = useDeletePauta();
  const { confirm, element: confirmEl } = useConfirm();
  const open = isOpenStatus(p.status);

  const remove = async () => {
    const ok = await confirm({
      title: 'Excluir pauta?',
      body: (
        <>
          <strong className="text-fg">{p.title}</strong> será removida com checklist, comentários e links. Os arquivos sinalizados continuam no computador.
        </>
      ),
      confirm: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    deleteM.mutate(p.id, { onSuccess: () => openPauta(null) });
  };

  return (
    <>
      {confirmEl}
      <Header pauta={p} save={save} pending={pending} />
      <motion.div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-6 pt-2" variants={stagger} initial="hidden" animate="show">
        <motion.div variants={rise}>
          <PriorityPanel pauta={p} save={save} />
        </motion.div>
        <motion.div variants={rise}>
          <MetaGrid pauta={p} save={save} />
        </motion.div>
        <motion.div variants={rise}>
          <DescriptionPanel pauta={p} save={save} />
        </motion.div>
        <motion.div variants={rise}>
          <ChecklistPanel pauta={p} save={save} />
        </motion.div>
        <motion.div variants={rise}>
          <SubtasksPanel pauta={p} save={save} />
        </motion.div>
        <motion.div variants={rise}>
          <FilesPanel pauta={p} />
        </motion.div>
        <motion.div variants={rise}>
          <LinksPanel pauta={p} save={save} />
        </motion.div>
        <motion.div variants={rise}>
          <RelationsPanel pauta={p} />
        </motion.div>
        {p.sourceRefs.length > 0 && (
          <motion.div variants={rise}>
            <SourcesPanel pauta={p} />
          </motion.div>
        )}
        <motion.div variants={rise}>
          <CommentsPanel pauta={p} save={save} />
        </motion.div>
        <motion.div variants={rise}>
          <HistoryPanel pauta={p} />
        </motion.div>
      </motion.div>
      <div className="flex items-center gap-2 border-t border-line bg-surface/40 px-6 py-3.5">
        <Button variant="ghost" size="sm" className="text-critical hover:bg-critical/10 hover:text-critical" onClick={() => void remove()} loading={deleteM.isPending}>
          <Trash2 />
          Excluir
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => openEditor(p.id)}>
            <Pencil />
            Editar
          </Button>
          {open ? (
            <Button variant="primary" size="sm" onClick={() => save({ status: 'done' }, { success: 'Pauta concluída' })}>
              <CheckCircle2 />
              Concluir
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => save({ status: 'todo' }, { success: 'Pauta reaberta' })}>
              <RotateCcw />
              Reabrir
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

type Save = (input: PautaInput, opts?: { success?: string }) => void;

/* ------------------------------ Cabeçalho ------------------------------ */

function Header({ pauta: p, save, pending }: { pauta: Pauta; save: Save; pending: boolean }) {
  const { openPauta } = useUi();
  const { project } = useLookups();
  const proj = project(p.projectId);
  return (
    <div className="relative px-6 pb-3 pt-5">
      <div className="mb-2 flex items-center gap-2">
        {proj ? (
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-fg-3">
            <span className="size-2 rounded-full" style={{ background: proj.color }} />
            <span className="truncate">{proj.name}</span>
          </span>
        ) : (
          <span className="text-xs font-medium text-fg-3">Pauta</span>
        )}
        <AnimatePresence>
          {pending && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1 text-[11px] text-fg-3">
              <Loader2 className="size-3 animate-spin" /> salvando
            </motion.span>
          )}
        </AnimatePresence>
        <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Fechar" onClick={() => openPauta(null)}>
          <X />
        </Button>
      </div>
      <InlineTitle value={p.title} done={p.status === 'done'} onSave={(title) => save({ title })} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <PillSelect
          value={p.status}
          dot={STATUS_HEX[p.status]}
          onChange={(v) => save({ status: v as PautaStatus }, v === 'done' ? { success: 'Pauta concluída' } : undefined)}
          options={(Object.keys(STATUS_LABEL) as PautaStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
          label="Status"
        />
        <PillSelect value={p.kind} onChange={(v) => save({ kind: v as PautaKind })} options={(Object.keys(KIND_LABEL) as PautaKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} label="Tipo" />
        <SourceBadge source={p.origin} />
        <DueChip due={p.dueDate} done={p.status === 'done'} />
        {p.approvalPending && (
          <button onClick={() => save({ approvalPending: false }, { success: 'Aprovação marcada como resolvida' })} title="Clique para marcar como aprovada">
            <Badge tone="warning">Aprovação pendente</Badge>
          </button>
        )}
        {p.tags.map((t) => (
          <Badge key={t}>#{t}</Badge>
        ))}
      </div>
    </div>
  );
}

function PillSelect({ value, onChange, options, label, dot }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label: string; dot?: string }) {
  return (
    <label className="relative inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full bg-surface-strong pl-2.5 pr-2 text-[12px] font-medium text-fg ring-1 ring-line transition hover:ring-line-strong">
      {dot && <span className="size-2 rounded-full" style={{ background: dot }} />}
      <span>{options.find((o) => o.value === value)?.label}</span>
      <svg viewBox="0 0 24 24" className="size-3 text-fg-3" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="m6 9 6 6 6-6" />
      </svg>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function InlineTitle({ value, onSave, done }: { value: string; onSave: (v: string) => void; done: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    setEditing(false);
    const t = draft.trim();
    if (t && t !== value) onSave(t);
    else setDraft(value);
  };
  if (editing)
    return (
      <textarea
        autoFocus
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
          if (e.key === 'Escape') {
            e.stopPropagation();
            setDraft(value);
            setEditing(false);
          }
        }}
        className="-mx-2 w-[calc(100%+16px)] resize-none rounded-xl bg-sunken px-2 py-1 text-[22px] font-semibold leading-tight tracking-[-0.025em] text-fg outline-none ring-2 ring-accent/40"
      />
    );
  return (
    <h2
      onClick={() => setEditing(true)}
      title="Clique para editar"
      className={cn('-mx-2 cursor-text rounded-xl px-2 py-1 text-[22px] font-semibold leading-tight tracking-[-0.025em] text-fg transition-colors hover:bg-sunken', done && 'text-fg-2 line-through decoration-fg-3/50')}
    >
      {value}
    </h2>
  );
}

/* ------------------------------ Painéis ------------------------------ */

function Panel({ icon, title, count, action, children, className }: { icon: ReactNode; title: ReactNode; count?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-[20px] bg-surface p-4 ring-1 ring-line', className)}>
      <div className="mb-3 flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-lg bg-accent-soft text-accent [&_svg]:size-3.5">{icon}</span>
        <h3 className="text-[13.5px] font-semibold tracking-[-0.01em] text-fg">{title}</h3>
        {count !== undefined && <span className="tabular text-xs text-fg-3">{count}</span>}
        {action && <div className="ml-auto flex items-center gap-1">{action}</div>}
      </div>
      {children}
    </section>
  );
}

function PriorityPanel({ pauta: p, save }: { pauta: Pauta; save: Save }) {
  const level = effectivePriority(p);
  const [adj, setAdj] = useState(p.scoreAdjustment);
  useEffect(() => setAdj(p.scoreAdjustment), [p.scoreAdjustment]);
  const commitAdj = () => {
    if (adj !== p.scoreAdjustment) save({ scoreAdjustment: adj });
  };
  return (
    <section className="relative overflow-hidden rounded-[22px] bg-surface p-5 ring-1 ring-line">
      <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full opacity-20 blur-3xl" style={{ background: PRIORITY_HEX[p.recommendedPriority] }} />
      <div className="relative flex items-start gap-5">
        <ScoreRing score={p.priorityScore} level={p.recommendedPriority} size={88} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-3">Prioridade</span>
            <PriorityBadge level={level} />
            {p.manualPriority && p.manualPriority !== p.recommendedPriority && (
              <span className="text-[11.5px] text-fg-3">recomendada: {PRIORITY_LABEL[p.recommendedPriority]}</span>
            )}
          </div>
          <p className="mt-2 text-[13.5px] leading-relaxed text-fg-2">{p.priorityJustification || 'O score será calculado na próxima rodada de priorização.'}</p>
          {p.priorityComputedAt && <p className="mt-1 text-[11px] text-fg-3">Calculado {fmtRelative(p.priorityComputedAt)}</p>}
        </div>
      </div>

      {p.priorityFactors.length > 0 && (
        <div className="relative mt-5 space-y-2.5">
          {p.priorityFactors.map((f, i) => {
            const neg = f.points < 0;
            const pct = f.max ? Math.min(100, (Math.abs(f.points) / Math.abs(f.max)) * 100) : 0;
            return (
              <Tip key={f.key} content={f.detail} side="left">
                <div className="grid grid-cols-[140px_1fr_52px] items-center gap-3 text-[12px]">
                  <span className="truncate text-fg-2">{f.label}</span>
                  <div className="h-1.5 overflow-hidden rounded-full bg-line">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: neg ? '#ef4444' : 'linear-gradient(90deg, var(--pf-accent), var(--pf-accent-2))' }}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.7, delay: 0.1 + i * 0.04, ease: [0.22, 1, 0.36, 1] }}
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

      <div className="relative mt-5 grid grid-cols-1 gap-4 border-t border-line pt-4 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-fg-2">Prioridade manual</span>
          <NativeSelect className="h-9" value={p.manualPriority ?? ''} onChange={(e) => save({ manualPriority: (e.target.value || null) as PriorityLevel | null })}>
            <PriorityOptions />
          </NativeSelect>
        </label>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-medium text-fg-2">
            <span>Ajuste de score</span>
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
    </section>
  );
}

function MetaGrid({ pauta: p, save }: { pauta: Pauta; save: Save }) {
  const { projetos, categorias } = useLookups();
  return (
    <section className="grid grid-cols-2 gap-px overflow-hidden rounded-[20px] bg-line ring-1 ring-line sm:grid-cols-3">
      <Meta label="Projeto">
        <MetaSelect value={p.projectId ?? ''} onChange={(v) => save({ projectId: v || null })}>
          <option value="">Sem projeto</option>
          {projetos.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </MetaSelect>
      </Meta>
      <Meta label="Categoria">
        <MetaSelect value={p.categoryId ?? ''} onChange={(v) => save({ categoryId: v || null })}>
          <option value="">Sem categoria</option>
          {categorias.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </MetaSelect>
      </Meta>
      <Meta label="Solicitante">
        <MetaText value={p.requester ?? ''} placeholder="—" onSave={(v) => save({ requester: v || null })} />
      </Meta>
      <Meta label="Responsável">
        <MetaText value={p.owner ?? ''} placeholder="—" onSave={(v) => save({ owner: v || null })} />
      </Meta>
      <Meta label={<span className="flex items-center gap-1">Prazo {p.dueLocked && <Tip content="Prazo definido por você: sincronizações não o alteram"><Lock className="size-3" /></Tip>}</span>}>
        <MetaDate value={dateInput(p.dueDate)} onSave={(v) => save({ dueDate: v || null })} />
      </Meta>
      <Meta label="Início">
        <MetaDate value={dateInput(p.startDate)} onSave={(v) => save({ startDate: v || null })} />
      </Meta>
      <Meta label="Impacto">
        <MetaSelect value={String(p.impact)} onChange={(v) => save({ impact: Number(v) })}>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n} · {IMPACT_LABEL[n]}
            </option>
          ))}
        </MetaSelect>
      </Meta>
      <Meta label="Complexidade">
        <MetaSelect value={String(p.complexity)} onChange={(v) => save({ complexity: Number(v) })}>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n} · {COMPLEXITY_LABEL[n]}
            </option>
          ))}
        </MetaSelect>
      </Meta>
      <Meta label="Estimativa">
        <MetaText
          value={p.estimatedHours === null ? '' : String(p.estimatedHours)}
          placeholder="— h"
          suffix="h"
          numeric
          onSave={(v) => {
            const n = v === '' ? null : Number(v.replace(',', '.'));
            if (n === null || (Number.isFinite(n) && n >= 0)) save({ estimatedHours: n });
          }}
        />
      </Meta>
      <Meta label="Criada">
        <span className="tabular block truncate px-1 text-[13px] text-fg">{fmtDateTime(p.createdAt)}</span>
      </Meta>
      <Meta label="Concluída">
        <span className="tabular block truncate px-1 text-[13px] text-fg">{p.completedAt ? fmtDateTime(p.completedAt) : '—'}</span>
      </Meta>
      <Meta label="Última atividade">
        <span className="block truncate px-1 text-[13px] text-fg">{fmtRelative(p.lastActivityAt ?? p.updatedAt)}</span>
      </Meta>
    </section>
  );
}

function Meta({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0 bg-surface-strong px-3 py-2.5">
      <div className="mb-0.5 px-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-3">{label}</div>
      {children}
    </div>
  );
}

const metaCtl = 'h-7 w-full rounded-lg bg-transparent px-1 text-[13px] text-fg outline-none transition hover:bg-sunken focus:bg-sunken focus:ring-1 focus:ring-accent/40';

function MetaSelect({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cn(metaCtl, 'cursor-pointer truncate')}>
      {children}
    </select>
  );
}

function MetaText({ value, onSave, placeholder, numeric, suffix }: { value: string; onSave: (v: string) => void; placeholder?: string; numeric?: boolean; suffix?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const v = draft.trim();
    if (v !== value) onSave(v);
  };
  return (
    <div className="flex items-center">
      <input
        value={draft}
        inputMode={numeric ? 'decimal' : undefined}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            e.stopPropagation();
            setDraft(value);
          }
        }}
        className={cn(metaCtl, numeric && 'tabular', 'placeholder:text-fg-3')}
      />
      {suffix && draft && <span className="pr-1 text-xs text-fg-3">{suffix}</span>}
    </div>
  );
}

function MetaDate({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  return <input type="date" value={value} onChange={(e) => e.target.value !== value && onSave(e.target.value)} className={cn(metaCtl, 'tabular cursor-pointer dark:[color-scheme:dark]')} />;
}

function DescriptionPanel({ pauta: p, save }: { pauta: Pauta; save: Save }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.description);
  useEffect(() => setDraft(p.description), [p.description]);
  const commit = () => {
    setEditing(false);
    if (draft !== p.description) save({ description: draft });
  };
  return (
    <Panel
      icon={<Pencil />}
      title="Descrição"
      action={
        !editing && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Editar
          </Button>
        )
      }
    >
      {editing ? (
        <div className="space-y-2">
          <Textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                e.stopPropagation();
                setDraft(p.description);
                setEditing(false);
              }
            }}
            className="min-h-[140px]"
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(p.description);
                setEditing(false);
              }}
            >
              Cancelar
            </Button>
            <Button size="sm" variant="primary" onClick={commit}>
              Salvar
            </Button>
          </div>
        </div>
      ) : p.description ? (
        <p onClick={() => setEditing(true)} className="cursor-text whitespace-pre-wrap text-[13.5px] leading-relaxed text-fg-2">
          {p.description}
        </p>
      ) : (
        <button onClick={() => setEditing(true)} className="w-full rounded-xl border border-dashed border-line-strong px-3 py-4 text-left text-[13px] text-fg-3 transition hover:bg-sunken">
          Adicionar descrição, contexto ou combinados…
        </button>
      )}
    </Panel>
  );
}

function AddRow({ placeholder, onAdd, extra }: { placeholder: string; onAdd: (text: string) => void; extra?: ReactNode }) {
  const [text, setText] = useState('');
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onAdd(t);
    setText('');
  };
  return (
    <div className="mt-2 flex items-center gap-2">
      <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder={placeholder} className="h-9" />
      {extra}
      <Button size="icon" variant="subtle" onClick={submit} disabled={!text.trim()} aria-label="Adicionar">
        <Plus />
      </Button>
    </div>
  );
}

function CheckBox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={cn('grid size-[18px] shrink-0 place-items-center rounded-md ring-1 transition-all', checked ? 'bg-success text-white ring-success' : 'ring-line-strong hover:ring-accent')}
    >
      <AnimatePresence>
        {checked && (
          <motion.svg initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="3.5">
            <path d="M5 12.5 10 17 19 7" />
          </motion.svg>
        )}
      </AnimatePresence>
    </button>
  );
}

function ChecklistPanel({ pauta: p, save }: { pauta: Pauta; save: Save }) {
  const done = p.checklist.filter((c) => c.done).length;
  const set = (checklist: Pauta['checklist']) => save({ checklist });
  return (
    <Panel icon={<CheckSquare />} title="Checklist" count={p.checklist.length ? `${done}/${p.checklist.length}` : undefined}>
      {p.checklist.length > 0 && <Progress value={(done / p.checklist.length) * 100} className="mb-3" color={done === p.checklist.length ? '#10b981' : undefined} />}
      <ul className="space-y-0.5">
        <AnimatePresence initial={false}>
          {p.checklist.map((c) => (
            <motion.li key={c.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="group flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 hover:bg-sunken">
              <CheckBox checked={c.done} label={c.text} onChange={() => set(p.checklist.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)))} />
              <span className={cn('min-w-0 flex-1 text-[13px] text-fg', c.done && 'text-fg-3 line-through')}>{c.text}</span>
              <button onClick={() => set(p.checklist.filter((x) => x.id !== c.id))} className="text-fg-3 opacity-0 transition hover:text-critical group-hover:opacity-100" aria-label="Remover item">
                <X className="size-3.5" />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <AddRow placeholder="Novo item do checklist" onAdd={(text) => set([...p.checklist, { id: uid(), text, done: false }])} />
    </Panel>
  );
}

function SubtasksPanel({ pauta: p, save }: { pauta: Pauta; save: Save }) {
  const [due, setDue] = useState('');
  const done = p.subtasks.filter((s) => s.done).length;
  const set = (subtasks: Pauta['subtasks']) => save({ subtasks });
  return (
    <Panel icon={<ListTree />} title="Subtarefas" count={p.subtasks.length ? `${done}/${p.subtasks.length}` : undefined}>
      <ul className="space-y-0.5">
        <AnimatePresence initial={false}>
          {p.subtasks.map((s) => (
            <motion.li key={s.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="group flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 hover:bg-sunken">
              <CheckBox checked={s.done} label={s.title} onChange={() => set(p.subtasks.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)))} />
              <span className={cn('min-w-0 flex-1 text-[13px] text-fg', s.done && 'text-fg-3 line-through')}>{s.title}</span>
              {s.dueDate && <DueChip due={s.dueDate} done={s.done} />}
              <button onClick={() => set(p.subtasks.filter((x) => x.id !== s.id))} className="text-fg-3 opacity-0 transition hover:text-critical group-hover:opacity-100" aria-label="Remover subtarefa">
                <X className="size-3.5" />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {p.subtasks.length === 0 && <p className="px-1.5 text-xs text-fg-3">Quebre a pauta em etapas com prazo próprio.</p>}
      <AddRow
        placeholder="Nova subtarefa"
        extra={<Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="tabular h-9 dark:[color-scheme:dark] w-[150px] shrink-0" aria-label="Prazo da subtarefa" />}
        onAdd={(title) => {
          set([...p.subtasks, { id: uid(), title, done: false, dueDate: due || null }]);
          setDue('');
        }}
      />
    </Panel>
  );
}

function CommentsPanel({ pauta: p, save }: { pauta: Pauta; save: Save }) {
  const [text, setText] = useState('');
  const sorted = useMemo(() => [...p.comments].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [p.comments]);
  const add = () => {
    const t = text.trim();
    if (!t) return;
    save({ comments: [...p.comments, { id: uid(), text: t, createdAt: new Date().toISOString(), author: 'Você' }] });
    setText('');
  };
  return (
    <Panel icon={<MessageSquare />} title="Comentários" count={p.comments.length || undefined}>
      <div className="flex items-end gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') add();
          }}
          placeholder="Escreva um comentário (Ctrl+Enter envia)"
          className="min-h-[44px] py-2"
          rows={1}
        />
        <Button size="icon" variant="primary" onClick={add} disabled={!text.trim()} aria-label="Enviar comentário">
          <Send />
        </Button>
      </div>
      <ul className="mt-3 space-y-2">
        <AnimatePresence initial={false}>
          {sorted.map((c) => (
            <motion.li key={c.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="group rounded-2xl bg-sunken px-3.5 py-2.5">
              <div className="mb-0.5 flex items-center gap-2 text-[11.5px]">
                <span className="font-semibold text-fg">{c.author}</span>
                <span className="text-fg-3">{fmtRelative(c.createdAt)}</span>
                <button onClick={() => save({ comments: p.comments.filter((x) => x.id !== c.id) })} className="ml-auto text-fg-3 opacity-0 transition hover:text-critical group-hover:opacity-100" aria-label="Excluir comentário">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-fg-2">{c.text}</p>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </Panel>
  );
}

function normalizeUrl(u: string): string | null {
  const s = u.trim();
  if (!s) return null;
  const withProto = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const url = new URL(withProto);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function LinksPanel({ pauta: p, save }: { pauta: Pauta; save: Save }) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const add = () => {
    const u = normalizeUrl(url);
    if (!u) {
      toast.error('Informe uma URL válida (http/https)');
      return;
    }
    let fallback = u;
    try {
      fallback = new URL(u).hostname || u;
    } catch {
      /* mantém a URL */
    }
    save({ links: [...p.links, { id: uid(), label: label.trim() || fallback, url: u }] });
    setLabel('');
    setUrl('');
  };
  return (
    <Panel icon={<Link2 />} title="Links" count={p.links.length || undefined}>
      <ul className="space-y-0.5">
        {p.links.map((l) => (
          <li key={l.id} className="group flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 hover:bg-sunken">
            <Globe className="size-4 shrink-0 text-fg-3" />
            <a href={l.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-[13px] font-medium text-accent hover:underline" title={l.url}>
              {l.label}
            </a>
            <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-fg-3 hover:text-fg" aria-label="Abrir em nova aba">
              <ExternalLink className="size-3.5" />
            </a>
            <button onClick={() => save({ links: p.links.filter((x) => x.id !== l.id) })} className="text-fg-3 opacity-0 transition hover:text-critical group-hover:opacity-100" aria-label="Remover link">
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 grid grid-cols-[1fr_1.4fr_auto] gap-2">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Rótulo" className="h-9" />
        <Input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="https://…" className="h-9" />
        <Button size="icon" variant="subtle" onClick={add} disabled={!url.trim()} aria-label="Adicionar link">
          <Plus />
        </Button>
      </div>
    </Panel>
  );
}

/* ------------------------------ Arquivos e pastas ------------------------------ */

function FilesPanel({ pauta: p }: { pauta: Pauta }) {
  const { data: items = [], isLoading } = useBookmarks({ pautaId: p.id });
  const [picking, setPicking] = useState<'file' | 'folder' | null>(null);
  const [adding, setAdding] = useState(false);
  const [loc, setLoc] = useState('');
  const [name, setName] = useState('');
  const pick = useApiMutation((kind: 'file' | 'folder') => post<{ cancelled: boolean; items: Bookmark[] }>('/api/bookmarks/pick', { kind, pautaId: p.id }), { invalidate: ['bookmarks'] });
  const addLink = useApiMutation((v: { location: string; name: string }) => post<Bookmark>('/api/bookmarks', { location: v.location, name: v.name || undefined, pautaId: p.id }), {
    invalidate: ['bookmarks'],
    success: 'Item sinalizado',
  });
  const remove = useApiMutation((id: string) => del(`/api/bookmarks/${id}`), { invalidate: ['bookmarks'], success: 'Item removido da pauta' });
  const openB = useApiMutation((v: { id: string; mode: 'open' | 'reveal' | 'web' }) => post(`/api/bookmarks/${v.id}/open`, { mode: v.mode }), { invalidate: ['bookmarks'] });

  const doPick = (kind: 'file' | 'folder') => {
    setPicking(kind);
    pick.mutate(kind, {
      onSuccess: (r) => {
        if (r.cancelled) toast.info('Seleção cancelada');
        else toast.success(r.items.length === 1 ? '1 item vinculado à pauta' : `${r.items.length} itens vinculados à pauta`);
      },
      onSettled: () => setPicking(null),
    });
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Caminho copiado');
    } catch {
      toast.error('Não foi possível copiar');
    }
  };

  return (
    <Panel
      icon={<Paperclip />}
      title="Arquivos e pastas"
      count={items.length || undefined}
      action={
        <Menu>
          <MenuTrigger asChild>
            <Button size="sm" variant="ghost" disabled={!!picking}>
              <Plus />
              Adicionar
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem icon={<FileIcon />} onSelect={() => doPick('file')}>
              Selecionar arquivo
            </MenuItem>
            <MenuItem icon={<Folder />} onSelect={() => doPick('folder')}>
              Selecionar pasta
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Link2 />} onSelect={() => setAdding(true)}>
              Adicionar link
            </MenuItem>
          </MenuContent>
        </Menu>
      }
    >
      <AnimatePresence>
        {picking && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mb-3 flex items-center gap-3 rounded-2xl bg-accent-soft px-3.5 py-3 text-[13px] text-accent">
              <Loader2 className="size-4 animate-spin" />
              <span>Escolha no seletor do Windows… ({picking === 'file' ? 'arquivo' : 'pasta'})</span>
            </div>
          </motion.div>
        )}
        {adding && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mb-3 space-y-2 rounded-2xl bg-sunken p-3">
              <Input autoFocus value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="C:\Pasta\arquivo.docx ou https://…" className="h-9" />
              <div className="flex gap-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome (opcional)" className="h-9" />
                <Button size="sm" variant="ghost" className="h-9" onClick={() => setAdding(false)}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  className="h-9"
                  loading={addLink.isPending}
                  disabled={!loc.trim()}
                  onClick={() =>
                    addLink.mutate(
                      { location: loc.trim(), name: name.trim() },
                      {
                        onSuccess: () => {
                          setLoc('');
                          setName('');
                          setAdding(false);
                        },
                      },
                    )
                  }
                >
                  Salvar
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <Skeleton className="h-12" />
      ) : items.length === 0 ? (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => doPick('file')} disabled={!!picking} className="flex items-center gap-2.5 rounded-2xl border border-dashed border-line-strong px-3 py-3 text-left text-[13px] text-fg-2 transition hover:bg-sunken disabled:opacity-50">
            <FileIcon className="size-4 text-fg-3" /> Selecionar arquivo
          </button>
          <button onClick={() => doPick('folder')} disabled={!!picking} className="flex items-center gap-2.5 rounded-2xl border border-dashed border-line-strong px-3 py-3 text-left text-[13px] text-fg-2 transition hover:bg-sunken disabled:opacity-50">
            <Folder className="size-4 text-fg-3" /> Selecionar pasta
          </button>
          <p className="col-span-2 px-1 text-[11.5px] text-fg-3">Os arquivos continuam onde estão no computador; a pauta guarda apenas o atalho.</p>
        </div>
      ) : (
        <ul className="space-y-1">
          {items.map((b) => (
            <li key={b.id} className="group flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 hover:bg-sunken">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-strong text-fg-2 ring-1 ring-line [&_svg]:size-4">
                {b.kind === 'folder' ? <Folder /> : b.kind === 'url' ? <Globe /> : <FileIcon />}
              </span>
              <button className="min-w-0 flex-1 text-left" onClick={() => openB.mutate({ id: b.id, mode: 'open' })} title={b.location}>
                <div className="truncate text-[13px] font-medium text-fg">{b.name}</div>
                <div className="truncate text-[11px] text-fg-3">{b.location}</div>
              </button>
              <div className="flex shrink-0 items-center gap-0.5">
                <Tip content="Abrir">
                  <Button size="icon-sm" variant="ghost" onClick={() => openB.mutate({ id: b.id, mode: 'open' })} aria-label="Abrir">
                    {b.kind === 'folder' ? <FolderOpen /> : <ExternalLink />}
                  </Button>
                </Tip>
                {b.kind !== 'url' && (
                  <Tip content="Mostrar na pasta">
                    <Button size="icon-sm" variant="ghost" onClick={() => openB.mutate({ id: b.id, mode: 'reveal' })} aria-label="Mostrar na pasta">
                      <FileSearch />
                    </Button>
                  </Tip>
                )}
                {b.webUrl && (
                  <Tip content="Link web (SharePoint/OneDrive)">
                    <Button size="icon-sm" variant="ghost" onClick={() => window.open(b.webUrl!, '_blank', 'noopener,noreferrer')} aria-label="Link web">
                      <Globe />
                    </Button>
                  </Tip>
                )}
                <Tip content={b.kind === 'url' ? 'Copiar link' : 'Copiar caminho'}>
                  <Button size="icon-sm" variant="ghost" onClick={() => void copy(b.location)} aria-label="Copiar caminho">
                    <Copy />
                  </Button>
                </Tip>
                <Tip content="Remover da pauta">
                  <Button size="icon-sm" variant="ghost" className="hover:text-critical" onClick={() => remove.mutate(b.id)} aria-label="Remover">
                    <Trash2 />
                  </Button>
                </Tip>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------ Relações e fontes ------------------------------ */

function RelationsPanel({ pauta: p }: { pauta: Pauta }) {
  const { data: all = [] } = usePautas();
  const { openPauta, openEditor } = useUi();
  const byId = useMemo(() => new Map(all.map((x) => [x.id, x])), [all]);
  const deps = p.dependencies.map((id) => ({ id, pauta: byId.get(id) ?? null }));
  const blocks = all.filter((x) => x.dependencies.includes(p.id));
  const pendingDeps = deps.filter((d) => d.pauta && isOpenStatus(d.pauta.status)).length;
  const Row = ({ x }: { x: Pauta }) => (
    <button onClick={() => openPauta(x.id)} className="flex w-full items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-left hover:bg-sunken">
      <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS_HEX[x.status] }} />
      <span className={cn('min-w-0 flex-1 truncate text-[13px] text-fg', !isOpenStatus(x.status) && 'text-fg-3 line-through')}>{x.title}</span>
      <StatusBadge status={x.status} />
    </button>
  );
  return (
    <Panel
      icon={<GitBranch />}
      title="Dependências"
      count={pendingDeps ? `${pendingDeps} pendente${pendingDeps > 1 ? 's' : ''}` : undefined}
      action={
        <Button size="sm" variant="ghost" onClick={() => openEditor(p.id)}>
          Gerenciar
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 px-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-3">Depende de</div>
          {deps.length === 0 ? (
            <p className="px-1.5 text-xs text-fg-3">Nenhuma dependência.</p>
          ) : (
            deps.map((d) => (d.pauta ? <Row key={d.id} x={d.pauta} /> : <p key={d.id} className="px-1.5 py-1.5 text-xs text-fg-3">Pauta removida</p>))
          )}
        </div>
        <div>
          <div className="mb-1 flex items-center gap-1 px-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-3">
            <Ban className="size-3" /> Bloqueia
          </div>
          {blocks.length === 0 ? <p className="px-1.5 text-xs text-fg-3">Nenhuma pauta depende desta.</p> : blocks.map((x) => <Row key={x.id} x={x} />)}
        </div>
      </div>
    </Panel>
  );
}

function SourcesPanel({ pauta: p }: { pauta: Pauta }) {
  return (
    <Panel icon={<Sparkles />} title="Fontes" count={p.sourceRefs.length}>
      <ul className="space-y-2">
        {p.sourceRefs.map((r) => (
          <li key={`${r.source}:${r.externalId}`} className="flex items-start gap-3 rounded-2xl bg-sunken px-3 py-2.5">
            <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4', r.source === 'outlook' ? 'bg-sky-500/12 text-sky-600 dark:text-sky-300' : r.source === 'planner' ? 'bg-success/12 text-success' : 'bg-accent-soft text-accent')}>
              {r.source === 'outlook' ? <Mail /> : r.source === 'planner' ? <KanbanSquare /> : r.source === 'calendar' ? <CalendarClock /> : <Sparkles />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-3">{SOURCE_LABEL[r.source]}</span>
                <span className="text-[11px] text-fg-3">· vinculada {fmtRelative(r.linkedAt)}</span>
              </div>
              <div className="truncate text-[13px] font-medium text-fg">{r.title ?? r.externalId}</div>
              {r.conversationId && <div className="truncate text-[11px] text-fg-3">Conversa {r.conversationId.slice(0, 18)}…</div>}
            </div>
            {r.url && (
              <Button size="sm" variant="ghost" onClick={() => window.open(r.url!, '_blank', 'noopener,noreferrer')}>
                Abrir
                <ExternalLink />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ------------------------------ Histórico ------------------------------ */

const FIELD_LABEL: Record<string, string> = {
  title: 'Título',
  description: 'Descrição',
  kind: 'Tipo',
  categoryId: 'Categoria',
  projectId: 'Projeto',
  requester: 'Solicitante',
  owner: 'Responsável',
  status: 'Status',
  manualPriority: 'Prioridade manual',
  recommendedPriority: 'Prioridade recomendada',
  priorityScore: 'Score',
  impact: 'Impacto',
  complexity: 'Complexidade',
  estimatedHours: 'Estimativa',
  approvalPending: 'Aprovação pendente',
  scoreAdjustment: 'Ajuste de score',
  manualRank: 'Ordem manual',
  startDate: 'Início',
  dueDate: 'Prazo',
  dueLocked: 'Prazo travado',
  checklist: 'Checklist',
  subtasks: 'Subtarefas',
  comments: 'Comentários',
  links: 'Links',
  dependencies: 'Dependências',
  tags: 'Tags',
};

function useFormatValue() {
  const { project, category } = useLookups();
  return (key: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (Array.isArray(v)) return `${v.length} ${v.length === 1 ? 'item' : 'itens'}`;
    if (typeof v === 'boolean') return v ? 'sim' : 'não';
    if (typeof v === 'string') {
      if (key === 'status' && v in STATUS_LABEL) return STATUS_LABEL[v as PautaStatus];
      if ((key === 'manualPriority' || key === 'recommendedPriority') && v in PRIORITY_LABEL) return PRIORITY_LABEL[v as PriorityLevel];
      if (key === 'kind' && v in KIND_LABEL) return KIND_LABEL[v as PautaKind];
      if (key === 'projectId') return project(v)?.name ?? 'projeto removido';
      if (key === 'categoryId') return category(v)?.name ?? 'categoria removida';
      if (/^\d{4}-\d{2}-\d{2}/.test(v)) return fmtDate(v, 'd MMM yyyy');
      return v.length > 40 ? `${v.slice(0, 40)}…` : v;
    }
    return String(v);
  };
}

const ACTOR_LABEL: Record<HistoryEntry['actor'], string> = { user: 'Você', system: 'Sistema', radar: 'Radar', sync: 'Sincronização', assistant: 'Assistente' };

function HistoryPanel({ pauta: p }: { pauta: Pauta }) {
  const { data = [], isLoading } = usePautaHistory(p.id);
  const fmt = useFormatValue();
  const [all, setAll] = useState(false);
  const list = all ? data : data.slice(0, 8);

  return (
    <Panel icon={<History />} title="Histórico" count={data.length || undefined}>
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : data.length === 0 ? (
        <p className="px-1 text-xs text-fg-3">As alterações desta pauta aparecerão aqui.</p>
      ) : (
        <div className="relative pl-4">
          <span className="absolute bottom-2 left-[5px] top-2 w-px bg-line-strong" />
          <ul className="space-y-3">
            {list.map((h) => {
              const changes = Object.entries(h.changes).filter(([k]) => k !== 'updatedAt' && k !== 'lastActivityAt' && k !== 'priorityFactors' && k !== 'priorityJustification');
              return (
                <li key={h.id} className="relative">
                  <span className={cn('absolute -left-[15px] top-1.5 size-2.5 rounded-full ring-2 ring-[var(--pf-surface-strong)]', h.actor === 'user' ? 'bg-accent' : h.actor === 'sync' ? 'bg-success' : 'bg-fg-3')} />
                  <div className="flex items-baseline gap-2 text-[12.5px]">
                    <span className="min-w-0 flex-1 text-fg">{h.summary}</span>
                    <Tip content={fmtDateTime(h.at)}>
                      <span className="shrink-0 text-[11px] text-fg-3">{fmtRelative(h.at)}</span>
                    </Tip>
                  </div>
                  <div className="text-[11px] text-fg-3">{ACTOR_LABEL[h.actor]}</div>
                  {changes.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {changes.slice(0, 6).map(([k, c]) => (
                        <span key={k} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-sunken px-2 py-0.5 text-[11px] text-fg-2">
                          <span className="font-medium text-fg">{FIELD_LABEL[k] ?? k}:</span>
                          <span className="truncate text-fg-3 line-through decoration-fg-3/40">{fmt(k, c.from)}</span>
                          <span className="text-fg-3">→</span>
                          <span className="truncate">{fmt(k, c.to)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {data.length > 8 && (
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAll((v) => !v)}>
              {all ? 'Mostrar menos' : `Ver todo o histórico (${data.length})`}
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}
