import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Cloud, File, Folder, FolderOpen, Globe, Info, Link2, Pin, RefreshCw, Search, TriangleAlert, X } from 'lucide-react';
import type { Bookmark } from '@pautaflow/shared';
import { useBookmarks, useBookmarkStatus, usePautas, useProjetos, post, useApiMutation } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toast';
import { Button, EmptyState, GlassCard, Input, NativeSelect, PageHeader, Segmented, Skeleton, useConfirm } from '@/components/ui';
import { AddLocationDialog, BookmarkEditDialog, BookmarkItem, useBookmarkActions, usePicker } from '@/components/files/bookmarks';

type KindFilter = 'all' | 'file' | 'folder' | 'url';

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export default function Arquivos() {
  const { data: bookmarks, isLoading } = useBookmarks();
  const { data: status = {} } = useBookmarkStatus();
  const { data: pautas = [] } = usePautas();
  const { data: projetos = [] } = useProjetos();
  const { pick, element: pickerEl, busy } = usePicker();
  const { remove } = useBookmarkActions();
  const { confirm, element: confirmEl } = useConfirm();

  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [link, setLink] = useState('all');
  const [onlyBroken, setOnlyBroken] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Bookmark | null>(null);

  const refreshWeb = useApiMutation(() => post<{ updated: number; syncRoots: number }>('/api/bookmarks/refresh-web'), { invalidate: ['bookmarks'] });

  const pautaTitle = useMemo(() => new Map(pautas.map((p) => [p.id, p.title])), [pautas]);
  const projectById = useMemo(() => new Map(projetos.map((p) => [p.id, p])), [projetos]);

  const all = bookmarks ?? [];
  const brokenCount = all.filter((b) => b.kind !== 'url' && status[b.id]?.exists === false).length;
  const counts = {
    all: all.length,
    file: all.filter((b) => b.kind === 'file').length,
    folder: all.filter((b) => b.kind === 'folder').length,
    url: all.filter((b) => b.kind === 'url').length,
    web: all.filter((b) => b.kind !== 'url' && b.webUrl).length,
  };

  const linkedPautas = useMemo(() => {
    const ids = new Set(all.map((b) => b.pautaId).filter((x): x is string => !!x));
    return pautas.filter((p) => ids.has(p.id));
  }, [all, pautas]);
  const linkedProjects = useMemo(() => {
    const ids = new Set(all.map((b) => b.projectId).filter((x): x is string => !!x));
    return projetos.filter((p) => ids.has(p.id));
  }, [all, projetos]);

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    return all
      .filter((b) => kind === 'all' || b.kind === kind)
      .filter((b) => {
        if (link === 'all') return true;
        if (link === 'none') return !b.pautaId && !b.projectId;
        if (link.startsWith('project:')) return b.projectId === link.slice(8);
        if (link.startsWith('pauta:')) return b.pautaId === link.slice(6);
        return true;
      })
      .filter((b) => !onlyBroken || (b.kind !== 'url' && status[b.id]?.exists === false))
      .filter((b) => {
        if (!q) return true;
        const hay = norm([b.name, b.location, b.description, b.webUrl ?? '', ...b.tags, b.pautaId ? (pautaTitle.get(b.pautaId) ?? '') : '', b.projectId ? (projectById.get(b.projectId)?.name ?? '') : ''].join(' '));
        return q.split(/\s+/).every((t) => hay.includes(t));
      })
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastOpenedAt ?? b.createdAt).localeCompare(a.lastOpenedAt ?? a.createdAt));
  }, [all, kind, link, onlyBroken, query, status, pautaTitle, projectById]);

  const pinned = filtered.filter((b) => b.pinned);
  const rest = filtered.filter((b) => !b.pinned);
  const hasFilters = !!query.trim() || kind !== 'all' || link !== 'all' || onlyBroken;

  const onRemove = async (b: Bookmark) => {
    const ok = await confirm({
      title: 'Remover da lista?',
      body: (
        <>
          <strong className="text-fg">{b.name}</strong> deixará de aparecer no PautaFlow. {b.kind === 'url' ? 'O link continua funcionando normalmente.' : 'O arquivo ou pasta não é apagado nem movido — apenas o atalho é removido.'}
        </>
      ),
      confirm: 'Remover',
      danger: true,
    });
    if (ok) remove.mutate(b.id);
  };

  const doRefresh = () =>
    refreshWeb.mutate(undefined, {
      onSuccess: (r) => {
        if (r.syncRoots === 0) toast.info('Nenhuma pasta sincronizada do OneDrive/SharePoint foi encontrada neste computador.');
        else if (r.updated === 0) toast.info(`Nenhum link novo: ${r.syncRoots} pasta(s) sincronizada(s) verificada(s).`);
        else toast.success(`${r.updated} link(s) web adicionado(s) · ${r.syncRoots} pasta(s) sincronizada(s)`);
      },
    });

  const renderItem = (b: Bookmark, i: number) => (
    <motion.div
      key={b.id}
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.35, delay: Math.min(i, 12) * 0.03, ease: [0.22, 1, 0.36, 1] }}
    >
      <BookmarkItem
        b={b}
        status={status[b.id]}
        pautaTitle={b.pautaId ? pautaTitle.get(b.pautaId) : null}
        project={b.projectId ? projectById.get(b.projectId) : null}
        onEdit={setEditing}
        onRemove={(x) => void onRemove(x)}
      />
    </motion.div>
  );

  return (
    <div>
      <PageHeader
        eyebrow="Atalhos do seu computador"
        title="Arquivos e pastas"
        subtitle="Sinalize arquivos e pastas para reencontrá-los em um clique — abrindo direto no Explorador, no aplicativo ou pelo link web."
        actions={
          <Button variant="ghost" onClick={doRefresh} loading={refreshWeb.isPending} disabled={!all.length}>
            {!refreshWeb.isPending && <RefreshCw />}
            Atualizar links web
          </Button>
        }
      />

      {/* Hero: ações principais */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
        <GlassCard strong className="relative mb-6 overflow-hidden !rounded-[28px] p-6">
          <div className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-flow opacity-[0.13] blur-3xl" />
          <div className="relative grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="flex items-start gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-flow text-white shadow-[0_12px_30px_-12px_var(--pf-accent)] [&_svg]:size-6">
                <FolderOpen />
              </span>
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.02em] text-fg">Selecione pelo próprio Windows</h2>
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-fg-2">
                  O seletor nativo abre neste computador. Os itens escolhidos ficam sinalizados aqui com o caminho completo e, quando estiverem em uma pasta sincronizada, com o link web correspondente.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="lg" onClick={() => void pick('file')} disabled={busy}>
                <File />
                Selecionar arquivo(s)
              </Button>
              <Button variant="secondary" size="lg" onClick={() => void pick('folder')} disabled={busy}>
                <Folder />
                Selecionar pasta
              </Button>
              <Button variant="ghost" size="lg" onClick={() => setAddOpen(true)}>
                <Link2 />
                Adicionar link ou caminho
              </Button>
            </div>
          </div>

          {all.length > 0 && (
            <div className="relative mt-6 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[
                { label: 'Itens', value: counts.all, icon: <Pin /> },
                { label: 'Arquivos', value: counts.file, icon: <File /> },
                { label: 'Pastas', value: counts.folder, icon: <Folder /> },
                { label: 'Com link web', value: counts.web + counts.url, icon: <Globe /> },
                { label: 'Não encontrados', value: brokenCount, icon: <TriangleAlert />, warn: brokenCount > 0 },
              ].map((s) => (
                <div key={s.label} className={cn('rounded-2xl bg-sunken px-4 py-3 ring-1 ring-line', s.warn && 'bg-warning/10 ring-warning/30')}>
                  <div className={cn('flex items-center gap-1.5 text-[11.5px] font-medium text-fg-3 [&_svg]:size-3.5', s.warn && 'text-amber-600 dark:text-amber-300')}>
                    {s.icon}
                    {s.label}
                  </div>
                  <div className="tabular mt-1 text-2xl font-semibold tracking-[-0.03em] text-fg">{s.value}</div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </motion.div>

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          {/* Filtros */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nome, caminho, etiqueta, pauta…" className="pl-9" />
              {query && (
                <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-fg-3 hover:bg-sunken hover:text-fg" aria-label="Limpar busca">
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <Segmented
              id="arquivos-kind"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'all', label: 'Todos' },
                { value: 'file', label: 'Arquivos', icon: <File /> },
                { value: 'folder', label: 'Pastas', icon: <Folder /> },
                { value: 'url', label: 'Links', icon: <Globe /> },
              ]}
            />
            <NativeSelect value={link} onChange={(e) => setLink(e.target.value)} className="w-auto min-w-[180px]" aria-label="Filtrar por pauta ou projeto">
              <option value="all">Todas as pautas e projetos</option>
              <option value="none">Sem vínculo</option>
              {linkedProjects.length > 0 && (
                <optgroup label="Projetos">
                  {linkedProjects.map((p) => (
                    <option key={p.id} value={`project:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {linkedPautas.length > 0 && (
                <optgroup label="Pautas">
                  {linkedPautas.map((p) => (
                    <option key={p.id} value={`pauta:${p.id}`}>
                      {p.title}
                    </option>
                  ))}
                </optgroup>
              )}
            </NativeSelect>
            {brokenCount > 0 && (
              <Button size="sm" variant={onlyBroken ? 'subtle' : 'ghost'} onClick={() => setOnlyBroken((v) => !v)}>
                <TriangleAlert />
                Não encontrados ({brokenCount})
              </Button>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-[92px] !rounded-2xl" />
              ))}
            </div>
          ) : all.length === 0 ? (
            <GlassCard>
              <EmptyState
                icon={<FolderOpen />}
                title="Nenhum arquivo ou pasta sinalizado ainda"
                description="Use “Selecionar arquivo(s)” ou “Selecionar pasta” para escolher itens pelo Windows, ou cole um caminho/URL. Itens anexados a pautas e projetos também aparecem aqui."
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button variant="primary" onClick={() => void pick('file')} disabled={busy}>
                      <File />
                      Selecionar arquivo(s)
                    </Button>
                    <Button onClick={() => void pick('folder')} disabled={busy}>
                      <Folder />
                      Selecionar pasta
                    </Button>
                  </div>
                }
              />
            </GlassCard>
          ) : filtered.length === 0 ? (
            <GlassCard>
              <EmptyState
                icon={<Search />}
                title="Nada encontrado com esses filtros"
                description="Tente outro termo ou limpe os filtros para ver todos os itens."
                action={
                  hasFilters && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setQuery('');
                        setKind('all');
                        setLink('all');
                        setOnlyBroken(false);
                      }}
                    >
                      Limpar filtros
                    </Button>
                  )
                }
              />
            </GlassCard>
          ) : (
            <div className="space-y-6">
              {pinned.length > 0 && (
                <section>
                  <h3 className="mb-2.5 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-3">
                    <Pin className="size-3.5" /> Fixados
                  </h3>
                  <div className="space-y-2.5">
                    <AnimatePresence initial={false}>{pinned.map(renderItem)}</AnimatePresence>
                  </div>
                </section>
              )}
              {rest.length > 0 && (
                <section>
                  {pinned.length > 0 && <h3 className="mb-2.5 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-3">Demais itens</h3>}
                  <div className="space-y-2.5">
                    <AnimatePresence initial={false}>{rest.map((b, i) => renderItem(b, i + pinned.length))}</AnimatePresence>
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        {/* Explicação */}
        <aside className="space-y-4">
          <GlassCard className="!rounded-[24px]">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-xl bg-sky-500/12 text-sky-600 dark:text-sky-300 [&_svg]:size-4">
                <Cloud />
              </span>
              <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">Como funcionam os links web</h3>
            </div>
            <div className="space-y-2.5 text-[13px] leading-relaxed text-fg-2">
              <p>
                Quando o item está em uma pasta do <strong className="font-medium text-fg">OneDrive</strong> ou de uma biblioteca do <strong className="font-medium text-fg">SharePoint/Teams</strong> sincronizada neste computador, o PautaFlow identifica a pasta raiz e monta o link web equivalente automaticamente.
              </p>
              <p>Sincronizou uma biblioteca nova depois de sinalizar os itens? Use “Atualizar links web”. Você também pode colar um link manualmente em Editar.</p>
            </div>
          </GlassCard>
          <GlassCard className="!rounded-[24px]">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-xl bg-accent-soft text-accent [&_svg]:size-4">
                <Info />
              </span>
              <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">Referenciados, não copiados</h3>
            </div>
            <ul className="space-y-2 text-[13px] leading-relaxed text-fg-2">
              <li>Os arquivos continuam onde estão — o PautaFlow guarda apenas o caminho.</li>
              <li>Remover um item daqui nunca apaga o arquivo ou a pasta.</li>
              <li>Se algo for movido ou renomeado, ele aparece como “Não encontrado neste computador”.</li>
              <li>Pastas abrem no Explorador; arquivos, no aplicativo padrão do Windows.</li>
            </ul>
          </GlassCard>
        </aside>
      </div>

      <AddLocationDialog open={addOpen} onOpenChange={setAddOpen} />
      <BookmarkEditDialog bookmark={editing} onClose={() => setEditing(null)} />
      {pickerEl}
      {confirmEl}
    </div>
  );
}
