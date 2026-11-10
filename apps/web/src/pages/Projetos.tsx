import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { FolderKanban, Plus, Search, X } from 'lucide-react';
import type { Projeto } from '@pautaflow/shared';
import { useBookmarks, useDeleteProjeto, usePautas, useProjetos, useSaveProjeto } from '@/lib/queries';
import { Button, EmptyState, GlassCard, Input, PageHeader, Segmented, Skeleton, useConfirm } from '@/components/ui';
import { ProjectCard } from '@/components/projects/ProjectCard';
import { ProjectEditorDialog } from '@/components/projects/ProjectEditorDialog';
import { ProjectSheet } from '@/components/projects/ProjectSheet';
import { computeProjectStats } from '@/components/projects/stats';

type Filter = 'all' | Projeto['status'];
const ORDER: Record<Projeto['status'], number> = { active: 0, paused: 1, done: 2 };

export default function Projetos() {
  const { data: projetos, isLoading } = useProjetos();
  const { data: pautas = [] } = usePautas();
  const { data: bookmarks = [] } = useBookmarks();
  const save = useSaveProjeto();
  const remove = useDeleteProjeto();
  const { confirm, element: confirmEl } = useConfirm();

  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<{ open: boolean; projeto: Projeto | null }>({ open: false, projeto: null });
  const [openId, setOpenId] = useState<string | null>(null);

  const stats = useMemo(() => computeProjectStats(pautas), [pautas]);
  const fileCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of bookmarks) if (b.projectId) m.set(b.projectId, (m.get(b.projectId) ?? 0) + 1);
    return m;
  }, [bookmarks]);

  const all = projetos ?? [];
  const counts = { all: all.length, active: 0, paused: 0, done: 0 } as Record<Filter, number>;
  for (const p of all) counts[p.status]++;

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((p) => filter === 'all' || p.status === filter)
      .filter((p) => !q || [p.name, p.description, p.owner ?? '', ...p.keywords].join(' ').toLowerCase().includes(q))
      .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name, 'pt-BR'));
  }, [all, filter, query]);

  const unassigned = pautas.filter((p) => !p.projectId && p.status !== 'cancelled' && p.status !== 'done').length;
  const opened = openId ? (all.find((p) => p.id === openId) ?? null) : null;

  const onDelete = async (p: Projeto) => {
    const n = stats.get(p.id)?.total ?? 0;
    const ok = await confirm({
      title: `Excluir “${p.name}”?`,
      body: (
        <div className="space-y-2">
          <p>O projeto será excluído. {n > 0 ? `As ${n} pauta(s) dele serão mantidas, apenas desvinculadas do projeto.` : 'Ele não tem pautas vinculadas.'}</p>
          <p className="text-fg-3">Um backup de segurança é criado automaticamente antes da exclusão.</p>
        </div>
      ),
      confirm: 'Excluir projeto',
      danger: true,
    });
    if (ok) {
      if (openId === p.id) setOpenId(null);
      remove.mutate(p.id);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Organização"
        title="Projetos"
        subtitle={
          all.length
            ? `${counts.active} ativo(s) · ${counts.paused} pausado(s) · ${counts.done} concluído(s)${unassigned ? ` · ${unassigned} pauta(s) em aberto sem projeto` : ''}`
            : 'Agrupe pautas, arquivos e prazos por frente de trabalho.'
        }
        actions={
          <Button variant="primary" onClick={() => setEditor({ open: true, projeto: null })}>
            <Plus />
            Novo projeto
          </Button>
        }
      />

      {all.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <Segmented
            id="projetos-filter"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `Todos ${counts.all}` },
              { value: 'active', label: `Ativos ${counts.active}` },
              { value: 'paused', label: `Pausados ${counts.paused}` },
              { value: 'done', label: `Concluídos ${counts.done}` },
            ]}
          />
          <div className="relative ml-auto w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar projeto ou palavra-chave" className="pl-9" />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-fg-3 hover:bg-sunken" aria-label="Limpar busca">
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[264px] !rounded-[24px]" />
          ))}
        </div>
      ) : all.length === 0 ? (
        <GlassCard className="!rounded-[28px]">
          <EmptyState
            icon={<FolderKanban />}
            title="Nenhum projeto ainda"
            description="Crie um projeto para agrupar pautas relacionadas e acompanhar o progresso. Com palavras-chave, o radar associa automaticamente novas demandas do Outlook e do Planner ao projeto certo."
            action={
              <Button variant="primary" onClick={() => setEditor({ open: true, projeto: null })}>
                <Plus />
                Criar primeiro projeto
              </Button>
            }
          />
        </GlassCard>
      ) : list.length === 0 ? (
        <GlassCard>
          <EmptyState icon={<Search />} title="Nenhum projeto encontrado" description="Ajuste a busca ou o filtro de status." />
        </GlassCard>
      ) : (
        <motion.div layout className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false} mode="popLayout">
            {list.map((p, i) => (
              <motion.div
                key={p.id}
                layout
                initial={{ opacity: 0, y: 14, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.4, delay: Math.min(i, 9) * 0.04, ease: [0.22, 1, 0.36, 1] }}
              >
                <ProjectCard
                  projeto={p}
                  stats={stats.get(p.id)}
                  files={fileCount.get(p.id) ?? 0}
                  onOpen={() => setOpenId(p.id)}
                  onEdit={() => setEditor({ open: true, projeto: p })}
                  onDelete={() => void onDelete(p)}
                  onStatus={(status) => save.mutate({ id: p.id, status })}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <ProjectSheet
        projeto={opened}
        pautas={pautas}
        stats={opened ? stats.get(opened.id) : undefined}
        onClose={() => setOpenId(null)}
        onEdit={(p) => setEditor({ open: true, projeto: p })}
      />
      <ProjectEditorDialog open={editor.open} onOpenChange={(o) => setEditor((s) => ({ ...s, open: o }))} projeto={editor.projeto} />
      {confirmEl}
    </div>
  );
}
