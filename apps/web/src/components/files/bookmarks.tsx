import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  Copy,
  Ellipsis,
  ExternalLink,
  FolderSearch,
  Globe,
  Link2,
  ListTodo,
  Loader2,
  MonitorUp,
  Pencil,
  Pin,
  PinOff,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { isOpenStatus, type Bookmark, type Projeto } from '@pautaflow/shared';
import { cn, bytes, fmtDateTime, fmtRelative } from '@/lib/utils';
import { del, patch, post, useApiMutation, usePautas, useProjetos } from '@/lib/queries';
import { queryClient } from '@/lib/api';
import { toast } from '@/stores/toast';
import { useUi } from '@/stores/ui';
import { Badge, Button, Dialog, Field, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, NativeSelect, Textarea, Tip } from '@/components/ui';
import { ChipsInput } from '@/components/projects/ChipsInput';
import { FileGlyph, fileVisual } from './fileVisual';

export type BookmarkStatus = { exists: boolean; size: number | null; modifiedAt: string | null };

export async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  } catch {
    toast.error('Não foi possível copiar para a área de transferência');
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/* ------------------------------------------------------------------ */
/* Seletor nativo do Windows                                           */
/* ------------------------------------------------------------------ */

type PickKind = 'file' | 'folder';

/** Abre o seletor nativo (no PC) via servidor e mostra um modal de espera até o retorno. */
export function usePicker() {
  const [waiting, setWaiting] = useState<PickKind | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const pick = async (kind: PickKind, extra: { projectId?: string | null; pautaId?: string | null } = {}) => {
    if (busyRef.current) {
      toast.info('O seletor do Windows já está aberto. Conclua ou cancele a seleção por lá.');
      setWaiting(kind);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setWaiting(kind);
    try {
      const r = await post<{ cancelled: boolean; items: Bookmark[] }>('/api/bookmarks/pick', { kind, ...extra });
      void queryClient.invalidateQueries({ queryKey: ['bookmarks'] });
      if (r.cancelled || r.items.length === 0) toast.info('Seleção cancelada — nada foi sinalizado.');
      else toast.success(r.items.length === 1 ? `“${r.items[0]?.name ?? 'Item'}” sinalizado` : `${r.items.length} itens sinalizados`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
      setWaiting(null);
    }
  };

  const element = (
    <Dialog
      open={waiting !== null}
      onOpenChange={(o) => !o && setWaiting(null)}
      title={waiting === 'folder' ? 'Selecionando pasta…' : 'Selecionando arquivo(s)…'}
      footer={
        <Button variant="ghost" onClick={() => setWaiting(null)}>
          Ocultar aviso
        </Button>
      }
    >
      <div className="flex flex-col items-center px-2 pb-4 pt-2 text-center">
        <div className="relative mb-5 grid size-20 place-items-center">
          <motion.span
            className="absolute inset-0 rounded-[26px] bg-flow opacity-20"
            animate={{ scale: [1, 1.12, 1], opacity: [0.25, 0.1, 0.25] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          />
          <span className="relative grid size-16 place-items-center rounded-[22px] bg-flow text-white shadow-[0_12px_30px_-10px_var(--pf-accent)] [&_svg]:size-7">
            <MonitorUp />
          </span>
        </div>
        <p className="text-[15px] font-semibold tracking-[-0.01em] text-fg">Escolha no seletor do Windows…</p>
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-fg-2">
          A janela pode abrir <strong className="font-semibold text-fg">atrás do navegador</strong>. Se não a encontrar, procure-a na barra de tarefas (Alt+Tab).
        </p>
        <div className="mt-5 flex items-center gap-2 text-xs text-fg-3">
          <Loader2 className="size-3.5 animate-spin" />
          Aguardando sua seleção
        </div>
        <p className="mt-3 max-w-xs text-xs text-fg-3">Pode ocultar este aviso: quando você concluir a seleção, mostraremos uma notificação aqui.</p>
      </div>
    </Dialog>
  );

  return { pick, element, busy };
}

/* ------------------------------------------------------------------ */
/* Ações de um item                                                    */
/* ------------------------------------------------------------------ */

export function useBookmarkActions() {
  const open = useApiMutation(({ id, mode }: { id: string; mode: 'open' | 'reveal' | 'web' }) => post(`/api/bookmarks/${id}/open`, { mode }), { invalidate: ['bookmarks'] });
  const pin = useApiMutation(({ id, pinned }: { id: string; pinned: boolean }) => patch(`/api/bookmarks/${id}`, { pinned }), {
    invalidate: ['bookmarks'],
    success: (r) => ((r as Bookmark).pinned ? 'Fixado no topo' : 'Desafixado'),
  });
  const remove = useApiMutation((id: string) => del(`/api/bookmarks/${id}`), { invalidate: ['bookmarks'], success: 'Removido da lista (o arquivo não foi alterado)' });
  return { open, pin, remove };
}

/* ------------------------------------------------------------------ */
/* Item                                                                */
/* ------------------------------------------------------------------ */

export function BookmarkItem({
  b,
  status,
  pautaTitle,
  project,
  onEdit,
  onRemove,
  compact,
}: {
  b: Bookmark;
  status?: BookmarkStatus;
  pautaTitle?: string | null;
  project?: Projeto | null;
  onEdit: (b: Bookmark) => void;
  onRemove: (b: Bookmark) => void;
  compact?: boolean;
}) {
  const { open, pin } = useBookmarkActions();
  const { openPauta } = useUi();
  const [pendingMode, setPendingMode] = useState<string | null>(null);
  const broken = status && !status.exists && b.kind !== 'url';
  const visual = fileVisual(b);

  const run = (mode: 'open' | 'reveal' | 'web') => {
    setPendingMode(mode);
    open.mutate(
      { id: b.id, mode },
      {
        onSuccess: () => {
          if (mode === 'reveal') toast.info('Abrindo no Explorador de Arquivos…');
        },
        onSettled: () => setPendingMode(null),
      },
    );
  };
  const openWeb = () => {
    if (!b.webUrl) return;
    const w = window.open(b.webUrl, '_blank', 'noopener');
    if (!w) run('web');
  };

  const meta: string[] = [];
  if (status?.size !== null && status?.size !== undefined && b.kind === 'file') meta.push(bytes(status.size));
  if (status?.modifiedAt) meta.push(`modificado ${fmtRelative(status.modifiedAt)}`);
  meta.push(b.lastOpenedAt ? `aberto ${fmtRelative(b.lastOpenedAt)}` : 'nunca aberto por aqui');

  return (
    <div className={cn('glass glass-hover group flex items-start gap-3.5 !rounded-2xl p-3.5', broken && 'ring-1 ring-warning/40')}>
      <button onClick={() => run('open')} className="relative shrink-0 rounded-[14px] outline-none" aria-label={`Abrir ${b.name}`}>
        <FileGlyph b={b} size={compact ? 38 : 44} />
        {b.pinned && (
          <span className="absolute -right-1 -top-1 grid size-4.5 place-items-center rounded-full bg-flow text-white ring-2 ring-[var(--pf-surface-strong)] [&_svg]:size-2.5">
            <Pin />
          </span>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <button onClick={() => run('open')} className="min-w-0 truncate text-left text-[14px] font-semibold tracking-[-0.01em] text-fg hover:text-accent">
            {b.name}
          </button>
          <span className="text-[11px] font-medium text-fg-3">{visual.label}</span>
          {broken && (
            <Tip content="O caminho não existe mais neste computador. Ele pode ter sido movido, renomeado ou estar em uma unidade desconectada.">
              <span>
                <Badge tone="warning" icon={<TriangleAlert />}>
                  Não encontrado neste computador
                </Badge>
              </span>
            </Tip>
          )}
        </div>

        <Tip content={<span className="break-all font-mono text-[11px]">{b.location}</span>}>
          <button
            onClick={() => void copyText(b.location, b.kind === 'url' ? 'Link' : 'Caminho')}
            className="mt-0.5 block max-w-full truncate text-left font-mono text-[11.5px] text-fg-3 transition hover:text-fg-2"
          >
            {b.location}
          </button>
        </Tip>

        {!compact && b.description && <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-fg-2">{b.description}</p>}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {b.webUrl && b.kind !== 'url' && (
            <Tip content={b.webUrl}>
              <button onClick={openWeb}>
                <Badge tone="info" icon={<Globe />} className="cursor-pointer transition hover:brightness-110">
                  Link web · {hostOf(b.webUrl)}
                </Badge>
              </button>
            </Tip>
          )}
          {project && (
            <Badge icon={<span className="size-2 rounded-full" style={{ background: project.color }} />}>{project.name}</Badge>
          )}
          {pautaTitle && b.pautaId && (
            <button onClick={() => openPauta(b.pautaId)}>
              <Badge tone="accent" icon={<ListTodo />} className="max-w-[240px] cursor-pointer truncate">
                {pautaTitle}
              </Badge>
            </button>
          )}
          {b.tags.map((t) => (
            <Badge key={t}>#{t}</Badge>
          ))}
          <span className="tabular text-[11px] text-fg-3">{meta.join(' · ')}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="secondary" onClick={() => run('open')} loading={pendingMode === 'open'} disabled={broken}>
          {pendingMode !== 'open' && <ExternalLink />}
          Abrir
        </Button>
        {b.kind !== 'url' && (
          <Tip content="Mostrar na pasta">
            <Button size="icon" variant="ghost" onClick={() => run('reveal')} loading={pendingMode === 'reveal'} disabled={broken} aria-label="Mostrar na pasta">
              {pendingMode !== 'reveal' && <FolderSearch />}
            </Button>
          </Tip>
        )}
        {b.webUrl && b.kind !== 'url' && (
          <Tip content="Abrir link web">
            <Button size="icon" variant="ghost" onClick={openWeb} aria-label="Abrir link web">
              <Globe />
            </Button>
          </Tip>
        )}
        <Menu>
          <MenuTrigger asChild>
            <Button size="icon" variant="ghost" aria-label="Mais ações">
              <Ellipsis />
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem icon={<ExternalLink />} onSelect={() => run('open')}>
              {b.kind === 'folder' ? 'Abrir no Explorador' : b.kind === 'url' ? 'Abrir link' : 'Abrir no aplicativo padrão'}
            </MenuItem>
            {b.kind !== 'url' && (
              <MenuItem icon={<FolderSearch />} onSelect={() => run('reveal')}>
                Mostrar na pasta
              </MenuItem>
            )}
            {b.webUrl && b.kind !== 'url' && (
              <MenuItem icon={<Globe />} onSelect={openWeb}>
                Abrir link web
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuItem icon={<Copy />} onSelect={() => void copyText(b.location, b.kind === 'url' ? 'Link' : 'Caminho')}>
              {b.kind === 'url' ? 'Copiar link' : 'Copiar caminho'}
            </MenuItem>
            {b.webUrl && b.kind !== 'url' && (
              <MenuItem icon={<Link2 />} onSelect={() => void copyText(b.webUrl!, 'Link web')}>
                Copiar link web
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuItem icon={b.pinned ? <PinOff /> : <Pin />} onSelect={() => pin.mutate({ id: b.id, pinned: !b.pinned })}>
              {b.pinned ? 'Desafixar' : 'Fixar no topo'}
            </MenuItem>
            <MenuItem icon={<Pencil />} onSelect={() => onEdit(b)}>
              Editar
            </MenuItem>
            <MenuItem icon={<Trash2 />} danger onSelect={() => onRemove(b)}>
              Remover da lista
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vínculos (pauta/projeto) reutilizados nos formulários               */
/* ------------------------------------------------------------------ */

function LinkSelects({ pautaId, projectId, onPauta, onProject }: { pautaId: string; projectId: string; onPauta: (v: string) => void; onProject: (v: string) => void }) {
  const { data: pautas = [] } = usePautas();
  const { data: projetos = [] } = useProjetos();
  const pautaOptions = useMemo(
    () => pautas.filter((p) => isOpenStatus(p.status) || p.id === pautaId).sort((a, b) => a.title.localeCompare(b.title, 'pt-BR')),
    [pautas, pautaId],
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Pauta vinculada">
        <NativeSelect value={pautaId} onChange={(e) => onPauta(e.target.value)}>
          <option value="">Nenhuma</option>
          {pautaOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Projeto">
        <NativeSelect value={projectId} onChange={(e) => onProject(e.target.value)}>
          <option value="">Nenhum</option>
          {projetos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Editar                                                              */
/* ------------------------------------------------------------------ */

export function BookmarkEditDialog({ bookmark, onClose }: { bookmark: Bookmark | null; onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [webUrl, setWebUrl] = useState('');
  const [pautaId, setPautaId] = useState('');
  const [projectId, setProjectId] = useState('');

  useEffect(() => {
    if (!bookmark) return;
    setName(bookmark.name);
    setDescription(bookmark.description);
    setTags(bookmark.tags);
    setWebUrl(bookmark.webUrl ?? '');
    setPautaId(bookmark.pautaId ?? '');
    setProjectId(bookmark.projectId ?? '');
  }, [bookmark]);

  const save = useApiMutation(
    (b: Bookmark) =>
      patch<Bookmark>(`/api/bookmarks/${b.id}`, {
        name: name.trim() || b.name,
        description: description.trim(),
        tags,
        ...(b.kind !== 'url' ? { webUrl: webUrl.trim() || null } : {}),
        pautaId: pautaId || null,
        projectId: projectId || null,
      }),
    { invalidate: ['bookmarks'], success: 'Item atualizado' },
  );
  const webInvalid = !!webUrl.trim() && !/^https?:\/\//i.test(webUrl.trim());

  return (
    <Dialog
      open={!!bookmark}
      onOpenChange={(o) => !o && onClose()}
      title="Editar item sinalizado"
      description={bookmark ? <span className="break-all font-mono text-xs">{bookmark.location}</span> : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={webInvalid} onClick={() => bookmark && save.mutate(bookmark, { onSuccess: onClose })}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Nome">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Descrição" hint="Para que serve este arquivo ou pasta? Ajuda a encontrá-lo pela busca.">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[72px]" />
        </Field>
        <Field label="Etiquetas">
          <ChipsInput value={tags} onChange={setTags} placeholder="ex.: contrato, 2026, cliente" />
        </Field>
        {bookmark?.kind !== 'url' && (
          <Field
            label="Link web (SharePoint/OneDrive/Teams)"
            hint="Preenchido automaticamente para pastas sincronizadas. Cole aqui um link manual se preferir."
            error={webInvalid ? 'Informe um endereço começando com http:// ou https://' : undefined}
          >
            <Input value={webUrl} onChange={(e) => setWebUrl(e.target.value)} placeholder="https://empresa.sharepoint.com/…" />
          </Field>
        )}
        <LinkSelects pautaId={pautaId} projectId={projectId} onPauta={setPautaId} onProject={setProjectId} />
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Adicionar link ou caminho                                           */
/* ------------------------------------------------------------------ */

export function AddLocationDialog({ open, onOpenChange, defaults }: { open: boolean; onOpenChange: (o: boolean) => void; defaults?: { projectId?: string | null; pautaId?: string | null } }) {
  const [location, setLocation] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [pautaId, setPautaId] = useState('');
  const [projectId, setProjectId] = useState('');

  useEffect(() => {
    if (!open) return;
    setLocation('');
    setName('');
    setDescription('');
    setTags([]);
    setPautaId(defaults?.pautaId ?? '');
    setProjectId(defaults?.projectId ?? '');
  }, [open, defaults?.pautaId, defaults?.projectId]);

  const clean = location.trim().replace(/^"(.*)"$/, '$1');
  const isUrl = /^https?:\/\//i.test(clean);
  const isPath = /^[a-zA-Z]:[\\/]/.test(clean) || /^\\\\/.test(clean);
  const kindHint = !clean ? null : isUrl ? 'Link web detectado' : isPath ? 'Caminho local detectado — o servidor confere se ele existe' : null;

  const add = useApiMutation(
    () =>
      post<Bookmark>('/api/bookmarks', {
        location: clean,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(tags.length ? { tags } : {}),
        pautaId: pautaId || null,
        projectId: projectId || null,
      }),
    { invalidate: ['bookmarks'], success: (b) => `“${b.name}” sinalizado` },
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Adicionar link ou caminho"
      description="Cole o caminho completo de um arquivo/pasta deste computador ou um endereço web."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="primary" loading={add.isPending} disabled={!clean || (!isUrl && !isPath)} onClick={() => add.mutate(undefined, { onSuccess: () => onOpenChange(false) })}>
            Adicionar
          </Button>
        </>
      }
    >
      <form
        className="space-y-4 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (clean && (isUrl || isPath)) add.mutate(undefined, { onSuccess: () => onOpenChange(false) });
        }}
      >
        <Field
          label="Caminho ou URL"
          hint={kindHint ?? 'Dica: no Explorador, segure Shift e clique com o botão direito no item → “Copiar como caminho”.'}
          error={clean && !isUrl && !isPath ? 'Use um caminho absoluto (C:\\Pasta\\arquivo.docx) ou uma URL (https://…)' : undefined}
        >
          <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={'C:\\Users\\você\\Documentos\\Relatório.docx  ou  https://…'} className="font-mono text-[13px]" autoFocus />
        </Field>
        <Field label="Nome (opcional)" hint="Se ficar vazio, usamos o nome do arquivo/pasta ou o domínio do link.">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Descrição (opcional)">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[64px]" />
        </Field>
        <Field label="Etiquetas">
          <ChipsInput value={tags} onChange={setTags} placeholder="Digite e pressione Enter" />
        </Field>
        <LinkSelects pautaId={pautaId} projectId={projectId} onPauta={setPautaId} onProject={setProjectId} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
