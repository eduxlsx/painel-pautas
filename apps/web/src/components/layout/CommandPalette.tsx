import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'motion/react';
import { CornerDownLeft, FolderKanban, ListTodo, Plus, Radar, Search, Sparkles } from 'lucide-react';
import { STATUS_LABEL, isOpenStatus } from '@pautaflow/shared';
import { post, usePautas, useProjetos } from '@/lib/queries';
import { cn, dueLabel } from '@/lib/utils';
import { toast } from '@/stores/toast';
import { useUi } from '@/stores/ui';
import { Kbd } from '@/components/ui';
import { NAV } from './Sidebar';

interface Row {
  id: string;
  group: string;
  label: string;
  hint?: ReactNode;
  icon: ReactNode;
  keywords?: string;
  run: () => void;
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

function matches(hay: string, q: string) {
  if (!q) return true;
  const h = norm(hay);
  return q.split(/\s+/).every((t) => h.includes(t));
}

export function CommandPalette() {
  const { commandOpen: open, setCommand } = useUi();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setCommand}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[60] bg-slate-950/25 backdrop-blur-[6px] dark:bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="glass glass-strong fixed inset-x-0 top-[12vh] z-[60] mx-auto flex max-h-[min(560px,76vh)] w-[calc(100vw-32px)] max-w-[640px] flex-col overflow-hidden !rounded-[26px]"
                initial={{ opacity: 0, scale: 0.96, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: -4 }}
                transition={{ type: 'spring', stiffness: 460, damping: 36 }}
              >
                <DialogPrimitive.Title className="sr-only">Paleta de comandos</DialogPrimitive.Title>
                <Palette close={() => setCommand(false)} />
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

function Palette({ close }: { close: () => void }) {
  const navigate = useNavigate();
  const { openEditor, openPauta, setAssistant } = useUi();
  const { data: pautas = [] } = usePautas();
  const { data: projetos = [] } = useProjetos();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const q = norm(query.trim());

  const rows = useMemo<Row[]>(() => {
    const go = (fn: () => void) => () => {
      close();
      fn();
    };
    const actions: Row[] = [
      { id: 'a-new', group: 'Ações', label: 'Nova pauta', icon: <Plus />, keywords: 'criar adicionar tarefa demanda', run: go(() => openEditor(null)) },
      { id: 'a-assist', group: 'Ações', label: 'Abrir assistente', icon: <Sparkles />, keywords: 'perguntar chat ia ajuda', run: go(() => setAssistant(true)) },
      {
        id: 'a-scan',
        group: 'Ações',
        label: 'Escanear radar agora',
        icon: <Radar />,
        keywords: 'sincronizar outlook planner varrer atualizar',
        run: go(() => {
          post('/api/radar/scan')
            .then(() => toast.success('Varredura iniciada — novas sugestões aparecem no Radar em instantes'))
            .catch((e: Error) => toast.error(e.message));
        }),
      },
    ].filter((r) => matches(`${r.label} ${r.keywords ?? ''}`, q));

    const pages: Row[] = NAV.filter((n) => matches(n.label, q)).map((n) => ({
      id: `p-${n.to}`,
      group: 'Páginas',
      label: n.label,
      icon: n.icon,
      run: go(() => navigate(n.to)),
    }));

    const pautaPool = q
      ? pautas
          .filter((p) => p.status !== 'cancelled')
          .filter((p) => matches(`${p.title} ${p.requester ?? ''} ${p.tags.join(' ')}`, q))
          .sort((a, b) => Number(isOpenStatus(b.status)) - Number(isOpenStatus(a.status)) || b.priorityScore - a.priorityScore)
      : pautas.filter((p) => isOpenStatus(p.status)).sort((a, b) => b.priorityScore - a.priorityScore);
    const pautaRows: Row[] = pautaPool.slice(0, q ? 8 : 5).map((p) => {
      const due = p.dueDate ? dueLabel(p.dueDate, p.status === 'done') : null;
      return {
        id: `t-${p.id}`,
        group: q ? 'Pautas' : 'Pautas prioritárias',
        label: p.title,
        icon: <ListTodo />,
        hint: (
          <span className="flex items-center gap-1.5">
            <span>{STATUS_LABEL[p.status]}</span>
            {due && (
              <span className={cn('capitalize', due.tone === 'overdue' && 'text-critical', due.tone === 'today' && 'text-high')}>· {due.text}</span>
            )}
            {p.requester && <span className="hidden max-w-[120px] truncate sm:inline">· {p.requester}</span>}
          </span>
        ),
        run: go(() => openPauta(p.id)),
      };
    });

    const projRows: Row[] = (q ? projetos.filter((p) => matches(`${p.name} ${p.keywords.join(' ')}`, q)) : [])
      .slice(0, 5)
      .map((p) => ({
        id: `j-${p.id}`,
        group: 'Projetos',
        label: p.name,
        icon: <FolderKanban style={{ color: p.color }} />,
        hint: p.status === 'active' ? 'Ativo' : p.status === 'paused' ? 'Pausado' : 'Concluído',
        run: go(() => navigate('/projetos')),
      }));

    return [...actions, ...pages, ...pautaRows, ...projRows];
  }, [q, pautas, projetos, close, navigate, openEditor, openPauta, setAssistant]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    if (active >= rows.length) setActive(Math.max(0, rows.length - 1));
  }, [rows.length, active]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (rows.length ? (i + 1) % rows.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      rows[active]?.run();
    } else if (e.key === 'Home') {
      setActive(0);
    } else if (e.key === 'End') {
      setActive(Math.max(0, rows.length - 1));
    }
  };

  let lastGroup = '';
  return (
    <div onKeyDown={onKeyDown} className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-5">
        <Search className="size-[18px] shrink-0 text-fg-3" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar pautas, páginas, projetos ou ações…"
          className="h-14 flex-1 bg-transparent text-[15px] text-fg placeholder:text-fg-3 focus:outline-none"
          role="combobox"
          aria-expanded
          aria-controls="cmd-list"
          aria-activedescendant={rows[active] ? `cmd-${rows[active].id}` : undefined}
        />
        <Kbd>Esc</Kbd>
      </div>

      <div ref={listRef} id="cmd-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2">
        {rows.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm font-medium text-fg">Nada encontrado para “{query}”</p>
            <p className="mt-1 text-xs text-fg-3">Tente o título de uma pauta, o nome de quem pediu, uma etiqueta ou uma página.</p>
          </div>
        ) : (
          rows.map((r, i) => {
            const header = r.group !== lastGroup ? r.group : null;
            lastGroup = r.group;
            const isActive = i === active;
            return (
              <div key={r.id}>
                {header && <div className="px-3 pb-1.5 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-3 first:pt-1">{header}</div>}
                <div
                  id={`cmd-${r.id}`}
                  data-idx={i}
                  role="option"
                  aria-selected={isActive}
                  onMouseMove={() => !isActive && setActive(i)}
                  onClick={r.run}
                  className={cn('relative flex h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-[13.5px] transition-colors', isActive ? 'text-fg' : 'text-fg-2')}
                >
                  {isActive && (
                    <motion.span
                      layoutId="cmd-active"
                      className="absolute inset-0 rounded-xl bg-surface-solid/80 shadow-[var(--pf-shadow)] dark:bg-white/[0.08]"
                      transition={{ type: 'spring', stiffness: 600, damping: 42 }}
                    />
                  )}
                  <span className={cn('relative z-10 grid size-7 shrink-0 place-items-center rounded-lg bg-sunken [&_svg]:size-4', isActive && 'text-accent')}>{r.icon}</span>
                  <span className="relative z-10 min-w-0 flex-1 truncate font-medium">{r.label}</span>
                  {r.hint && <span className="relative z-10 shrink-0 text-xs text-fg-3">{r.hint}</span>}
                  {isActive && <CornerDownLeft className="relative z-10 size-3.5 shrink-0 text-fg-3" />}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex shrink-0 items-center gap-4 border-t border-line px-5 py-2.5 text-[11px] text-fg-3">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> navegar
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Enter</Kbd> abrir
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Esc</Kbd> fechar
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </span>
      </div>
    </div>
  );
}
