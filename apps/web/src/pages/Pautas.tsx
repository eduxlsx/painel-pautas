import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarDays, Columns3, FilterX, GanttChartSquare, Grid2x2, Inbox, List, Plus, Search, X } from 'lucide-react';
import type { Pauta, PautaStatus, PriorityLevel, SourceKind } from '@pautaflow/shared';
import { PRIORITY_LABEL, SOURCE_LABEL, STATUS_LABEL, isOpenStatus } from '@pautaflow/shared';
import { usePautas } from '@/lib/queries';
import { useUi } from '@/stores/ui';
import { Button, EmptyState, NativeSelect, PageHeader, Segmented, Skeleton, Switch } from '@/components/ui';
import { useLookups } from '@/components/pauta/PautaCard';
import { PRIORITY_LEVELS, effectivePriority } from '@/components/pauta/helpers';
import { KanbanView } from '@/components/pauta/views/KanbanView';
import { ListView } from '@/components/pauta/views/ListView';
import { CalendarView } from '@/components/pauta/views/CalendarView';
import { TimelineView } from '@/components/pauta/views/TimelineView';
import { MatrixView } from '@/components/pauta/views/MatrixView';

type View = 'kanban' | 'lista' | 'calendario' | 'timeline' | 'matriz';
const VIEWS: { value: View; label: string; icon: React.ReactNode }[] = [
  { value: 'kanban', label: 'Kanban', icon: <Columns3 /> },
  { value: 'lista', label: 'Lista', icon: <List /> },
  { value: 'calendario', label: 'Calendário', icon: <CalendarDays /> },
  { value: 'timeline', label: 'Timeline', icon: <GanttChartSquare /> },
  { value: 'matriz', label: 'Matriz', icon: <Grid2x2 /> },
];

const RECENT_DAYS = 14;

interface Filters {
  q: string;
  project: string;
  category: string;
  priority: PriorityLevel | '';
  status: PautaStatus | '';
  origin: SourceKind | '';
  showDone: boolean;
}
const NO_FILTERS: Filters = { q: '', project: '', category: '', priority: '', status: '', origin: '', showDone: false };
const NONE = '__none';

function applyFilters(list: Pauta[], f: Filters): Pauta[] {
  const term = f.q.trim().toLowerCase();
  const cutoff = Date.now() - RECENT_DAYS * 86_400_000;
  return list.filter((p) => {
    if (f.status) {
      if (p.status !== f.status) return false;
    } else if (!isOpenStatus(p.status) && !f.showDone) {
      const closedAt = Date.parse(p.completedAt ?? p.updatedAt);
      if (Number.isFinite(closedAt) && closedAt < cutoff) return false;
    }
    if (f.project && (f.project === NONE ? p.projectId !== null : p.projectId !== f.project)) return false;
    if (f.category && (f.category === NONE ? p.categoryId !== null : p.categoryId !== f.category)) return false;
    if (f.priority && effectivePriority(p) !== f.priority) return false;
    if (f.origin && p.origin !== f.origin) return false;
    if (term) {
      const hay = [p.title, p.description, p.requester ?? '', ...p.tags].join(' ').toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });
}

export default function Pautas() {
  const { data: pautas, isLoading } = usePautas();
  const { pautasView, setPautasView, openEditor, openPauta } = useUi();
  const { projetos, categorias } = useLookups();
  const [params, setParams] = useSearchParams();
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));

  // ?id=<pautaId> abre o painel de detalhes.
  useEffect(() => {
    const id = params.get('id');
    if (!id) return;
    openPauta(id);
    const next = new URLSearchParams(params);
    next.delete('id');
    setParams(next, { replace: true });
  }, [params, setParams, openPauta]);

  const filtered = useMemo(() => applyFilters(pautas ?? [], f), [pautas, f]);
  const total = pautas?.length ?? 0;
  const openCount = useMemo(() => (pautas ?? []).filter((p) => isOpenStatus(p.status)).length, [pautas]);
  const active = f.q || f.project || f.category || f.priority || f.status || f.origin || f.showDone;
  const hiddenOld = useMemo(() => {
    if (f.status || f.showDone || !pautas) return 0;
    const cutoff = Date.now() - RECENT_DAYS * 86_400_000;
    return pautas.filter((p) => !isOpenStatus(p.status) && Date.parse(p.completedAt ?? p.updatedAt) < cutoff).length;
  }, [pautas, f.status, f.showDone]);

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-baseline gap-3">
            Pautas
            {pautas && <span className="tabular text-lg font-medium text-fg-3">{openCount} abertas</span>}
          </span>
        }
        subtitle={pautas && total > 0 ? (active ? `${filtered.length} de ${total} pautas correspondem aos filtros` : `${total} no total · concluídas há mais de ${RECENT_DAYS} dias ficam ocultas`) : 'Todas as demandas em um só lugar'}
        actions={
          <>
            <Segmented id="pautas-view" value={pautasView} onChange={setPautasView} options={VIEWS} />
            <Button variant="primary" onClick={() => openEditor(null)}>
              <Plus />
              Nova pauta
            </Button>
          </>
        }
      />

      <div className="glass mb-5 flex flex-wrap items-center gap-2 !rounded-[20px] p-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
          <input
            value={f.q}
            onChange={(e) => set('q', e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && set('q', '')}
            placeholder="Buscar por título, descrição, solicitante ou tag"
            className="h-9 w-full rounded-xl bg-sunken pl-9 pr-8 text-sm text-fg outline-none ring-1 ring-line placeholder:text-fg-3 focus:bg-surface-strong focus:ring-2 focus:ring-accent/50"
          />
          {f.q && (
            <button onClick={() => set('q', '')} className="absolute right-2 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full text-fg-3 hover:bg-sunken hover:text-fg" aria-label="Limpar busca">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <FilterSelect value={f.project} onChange={(v) => set('project', v)} label="Projeto">
          <option value="">Todos os projetos</option>
          <option value={NONE}>Sem projeto</option>
          {projetos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect value={f.category} onChange={(v) => set('category', v)} label="Categoria">
          <option value="">Todas as categorias</option>
          <option value={NONE}>Sem categoria</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect value={f.priority} onChange={(v) => set('priority', v as PriorityLevel | '')} label="Prioridade">
          <option value="">Qualquer prioridade</option>
          {PRIORITY_LEVELS.map((l) => (
            <option key={l} value={l}>
              {PRIORITY_LABEL[l]}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect value={f.status} onChange={(v) => set('status', v as PautaStatus | '')} label="Status">
          <option value="">Qualquer status</option>
          {(Object.keys(STATUS_LABEL) as PautaStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect value={f.origin} onChange={(v) => set('origin', v as SourceKind | '')} label="Origem">
          <option value="">Todas as origens</option>
          {(Object.keys(SOURCE_LABEL) as SourceKind[]).map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABEL[s]}
            </option>
          ))}
        </FilterSelect>
        <label className="flex h-9 cursor-pointer items-center gap-2 rounded-xl px-2.5 text-[13px] text-fg-2 hover:bg-sunken" title={hiddenOld ? `${hiddenOld} concluídas/canceladas antigas ocultas` : undefined}>
          <Switch checked={f.showDone} onCheckedChange={(v) => set('showDone', v)} label="Mostrar concluídas" />
          Mostrar concluídas
          {hiddenOld > 0 && <span className="tabular rounded-full bg-sunken px-1.5 text-[11px] text-fg-3 ring-1 ring-line">{hiddenOld}</span>}
        </label>
        <AnimatePresence>
          {active && (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
              <Button size="sm" variant="ghost" onClick={() => setF(NO_FILTERS)}>
                <FilterX />
                Limpar
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {isLoading ? (
        <div className="flex gap-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex-1 space-y-2.5">
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
              <Skeleton className="h-20" />
            </div>
          ))}
        </div>
      ) : total === 0 ? (
        <div className="glass !rounded-[26px]">
          <EmptyState
            icon={<Inbox />}
            title="Nenhuma pauta ainda"
            description="Crie a primeira manualmente ou aprove sugestões do Radar — ele lê seus e-mails do Outlook e tarefas do Planner quando a integração com a Microsoft está conectada."
            action={
              <Button variant="primary" onClick={() => openEditor(null)}>
                <Plus />
                Nova pauta
              </Button>
            }
          />
        </div>
      ) : filtered.length === 0 && pautasView !== 'kanban' && pautasView !== 'calendario' ? (
        <div className="glass !rounded-[26px]">
          <EmptyState
            icon={<FilterX />}
            title="Nada corresponde aos filtros"
            description="Ajuste a busca ou limpe os filtros para ver todas as pautas."
            action={
              <Button variant="secondary" onClick={() => setF(NO_FILTERS)}>
                Limpar filtros
              </Button>
            }
          />
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div key={pautasView} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}>
            {pautasView === 'kanban' && <KanbanView pautas={filtered} />}
            {pautasView === 'lista' && <ListView pautas={filtered} />}
            {pautasView === 'calendario' && <CalendarView pautas={filtered} />}
            {pautasView === 'timeline' && <TimelineView pautas={filtered} />}
            {pautasView === 'matriz' && <MatrixView pautas={filtered} />}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

function FilterSelect({ value, onChange, label, children }: { value: string; onChange: (v: string) => void; label: string; children: React.ReactNode }) {
  return (
    <NativeSelect aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={`h-9 w-auto min-w-[140px] text-[13px] ${value ? 'bg-accent-soft text-accent ring-accent/30' : ''}`}>
      {children}
    </NativeSelect>
  );
}
