import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { CalendarClock, File, Folder, Link2, ListTodo, Pencil, Plus, Tag, X } from 'lucide-react';
import { isOpenStatus, type Bookmark, type Pauta, type Projeto } from '@pautaflow/shared';
import { useBookmarks, useBookmarkStatus } from '@/lib/queries';
import { cn, fmtDate } from '@/lib/utils';
import { useUi } from '@/stores/ui';
import { Avatar, Badge, Button, EmptyState, Progress, Segmented, Sheet, Skeleton, useConfirm } from '@/components/ui';
import { PautaCard } from '@/components/pauta/PautaCard';
import { AddLocationDialog, BookmarkEditDialog, BookmarkItem, useBookmarkActions, usePicker } from '@/components/files/bookmarks';
import { ProjectStatusBadge } from './ProjectCard';
import type { ProjectStats } from './stats';

export function ProjectSheet({ projeto, pautas, stats, onClose, onEdit }: { projeto: Projeto | null; pautas: Pauta[]; stats: ProjectStats | undefined; onClose: () => void; onEdit: (p: Projeto) => void }) {
  return (
    <Sheet open={!!projeto} onOpenChange={(o) => !o && onClose()} title={projeto?.name ?? 'Projeto'} width={640}>
      {projeto && <SheetBody projeto={projeto} pautas={pautas} stats={stats} onClose={onClose} onEdit={onEdit} />}
    </Sheet>
  );
}

function SheetBody({ projeto: p, pautas, stats, onClose, onEdit }: { projeto: Projeto; pautas: Pauta[]; stats: ProjectStats | undefined; onClose: () => void; onEdit: (p: Projeto) => void }) {
  const { openPauta, openEditor } = useUi();
  const [tab, setTab] = useState<'pautas' | 'arquivos'>('pautas');
  const [showDone, setShowDone] = useState(false);
  const { data: files, isLoading: filesLoading } = useBookmarks({ projectId: p.id });
  const { data: status = {} } = useBookmarkStatus();
  const { pick, element: pickerEl, busy } = usePicker();
  const { remove } = useBookmarkActions();
  const { confirm, element: confirmEl } = useConfirm();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Bookmark | null>(null);

  const mine = useMemo(() => pautas.filter((x) => x.projectId === p.id), [pautas, p.id]);
  const open = useMemo(() => mine.filter((x) => isOpenStatus(x.status)).sort((a, b) => b.priorityScore - a.priorityScore), [mine]);
  const closed = useMemo(() => mine.filter((x) => !isOpenStatus(x.status)).sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt)), [mine]);
  const pautaTitle = useMemo(() => new Map(pautas.map((x) => [x.id, x.title])), [pautas]);

  const pct = stats && stats.total ? Math.round((stats.done / stats.total) * 100) : 0;

  const onRemove = async (b: Bookmark) => {
    const ok = await confirm({
      title: 'Remover da lista?',
      body: <>“{b.name}” deixará de aparecer no projeto. O arquivo ou pasta não é apagado.</>,
      confirm: 'Remover',
      danger: true,
    });
    if (ok) remove.mutate(b.id);
  };

  return (
    <>
      {/* Cabeçalho */}
      <div className="relative shrink-0 overflow-hidden px-6 pb-5 pt-6">
        <div className="pointer-events-none absolute -left-10 -top-24 size-64 rounded-full opacity-25 blur-3xl" style={{ background: p.color }} />
        <div className="relative flex items-start gap-4">
          <span
            className="grid size-12 shrink-0 place-items-center rounded-2xl text-lg font-semibold text-white"
            style={{ background: `linear-gradient(140deg, ${p.color}, color-mix(in srgb, ${p.color} 70%, #000))`, boxShadow: `0 12px 28px -12px ${p.color}` }}
          >
            {(p.name[0] ?? 'P').toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-semibold tracking-[-0.025em] text-fg">{p.name}</h2>
              <ProjectStatusBadge status={p.status} />
            </div>
            {p.description ? <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-fg-2">{p.description}</p> : <p className="mt-1 text-sm text-fg-3">Sem descrição.</p>}
          </div>
          <div className="flex shrink-0 gap-1">
            <Button size="icon" variant="ghost" onClick={() => onEdit(p)} aria-label="Editar projeto">
              <Pencil />
            </Button>
            <Button size="icon" variant="ghost" onClick={onClose} aria-label="Fechar">
              <X />
            </Button>
          </div>
        </div>

        <div className="relative mt-5 grid grid-cols-4 gap-2">
          {[
            { label: 'Abertas', value: stats?.open ?? 0 },
            { label: 'Atrasadas', value: stats?.overdue ?? 0, warn: (stats?.overdue ?? 0) > 0 },
            { label: 'Concluídas', value: stats?.done ?? 0 },
            { label: 'Arquivos', value: files?.length ?? 0 },
          ].map((s) => (
            <div key={s.label} className={cn('rounded-2xl bg-sunken px-3 py-2.5 ring-1 ring-line', s.warn && 'bg-critical/8 ring-critical/25')}>
              <div className={cn('text-[11px] font-medium text-fg-3', s.warn && 'text-critical')}>{s.label}</div>
              <div className="tabular text-xl font-semibold tracking-[-0.03em] text-fg">{s.value}</div>
            </div>
          ))}
        </div>
        <div className="relative mt-4">
          <div className="mb-1.5 flex items-center justify-between text-xs text-fg-3">
            <span>Progresso</span>
            <span className="tabular font-medium text-fg-2">
              {pct}% · {stats?.done ?? 0}/{stats?.total ?? 0} pautas
            </span>
          </div>
          <Progress value={pct} color={p.color} className="h-2" />
        </div>
        <div className="relative mt-4 flex flex-wrap items-center gap-2 text-xs text-fg-2">
          {p.owner && (
            <span className="flex items-center gap-1.5">
              <Avatar name={p.owner} className="size-5 text-[8.5px]" />
              {p.owner}
            </span>
          )}
          {p.dueDate && (
            <Badge icon={<CalendarClock />} tone="neutral">
              Prazo {fmtDate(p.dueDate)}
            </Badge>
          )}
          {p.keywords.map((k) => (
            <Badge key={k} icon={<Tag />}>
              {k}
            </Badge>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-y border-line px-6 py-3">
        <Segmented
          id="proj-sheet-tab"
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'pautas', label: `Pautas (${mine.length})`, icon: <ListTodo /> },
            { value: 'arquivos', label: `Arquivos (${files?.length ?? 0})`, icon: <Folder /> },
          ]}
        />
        {tab === 'pautas' ? (
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              onClose();
              openEditor(null, { projectId: p.id });
            }}
          >
            <Plus />
            Nova pauta neste projeto
          </Button>
        ) : (
          <div className="flex gap-1">
            <Button size="sm" variant="primary" onClick={() => void pick('file', { projectId: p.id })} disabled={busy}>
              <File />
              Selecionar arquivo
            </Button>
            <Button size="sm" onClick={() => void pick('folder', { projectId: p.id })} disabled={busy}>
              <Folder />
              Pasta
            </Button>
            <Button size="icon-sm" variant="ghost" className="size-8" onClick={() => setAddOpen(true)} aria-label="Adicionar link ou caminho">
              <Link2 />
            </Button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {tab === 'pautas' ? (
          mine.length === 0 ? (
            <EmptyState
              icon={<ListTodo />}
              title="Nenhuma pauta neste projeto"
              description="Crie uma pauta aqui ou vincule pautas existentes pelo campo Projeto. O radar também associa demandas automaticamente pelas palavras-chave do projeto."
            />
          ) : (
            <div className="space-y-5">
              {open.length > 0 && (
                <section>
                  <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-3">Em aberto · {open.length}</h4>
                  <div className="space-y-2">
                    {open.map((x, i) => (
                      <motion.div key={x.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * 0.03 }}>
                        <PautaCard
                          pauta={x}
                          showStatus
                          onClick={() => {
                            onClose();
                            openPauta(x.id);
                          }}
                        />
                      </motion.div>
                    ))}
                  </div>
                </section>
              )}
              {closed.length > 0 && (
                <section>
                  <button onClick={() => setShowDone((v) => !v)} className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-3 hover:text-fg-2">
                    {showDone ? 'Ocultar' : 'Mostrar'} concluídas e canceladas · {closed.length}
                  </button>
                  {showDone && (
                    <div className="space-y-2">
                      {closed.map((x) => (
                        <PautaCard
                          key={x.id}
                          pauta={x}
                          compact
                          onClick={() => {
                            onClose();
                            openPauta(x.id);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
          )
        ) : filesLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-20 !rounded-2xl" />
            ))}
          </div>
        ) : !files?.length ? (
          <EmptyState
            icon={<Folder />}
            title="Nenhum arquivo vinculado"
            description="Selecione arquivos ou pastas pelo seletor do Windows. Eles ficam referenciados aqui (não são copiados) e também aparecem em Arquivos."
          />
        ) : (
          <div className="space-y-2">
            {files.map((b) => (
              <BookmarkItem
                key={b.id}
                b={b}
                compact
                status={status[b.id]}
                pautaTitle={b.pautaId ? pautaTitle.get(b.pautaId) : null}
                onEdit={setEditing}
                onRemove={(x) => void onRemove(x)}
              />
            ))}
          </div>
        )}
      </div>

      <AddLocationDialog open={addOpen} onOpenChange={setAddOpen} defaults={{ projectId: p.id }} />
      <BookmarkEditDialog bookmark={editing} onClose={() => setEditing(null)} />
      {pickerEl}
      {confirmEl}
    </>
  );
}
