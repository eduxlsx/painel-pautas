import { useMemo, useState } from 'react';
import { addDays, format, nextMonday, parseISO, setHours, setMinutes, startOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { AlarmClock, CalendarClock, CalendarDays, Check, Link2, Search, Sun } from 'lucide-react';
import type { Pauta, PautaKind, PriorityLevel, Sugestao } from '@pautaflow/shared';
import { isOpenStatus, KIND_LABEL, PRIORITY_LABEL } from '@pautaflow/shared';
import { cn } from '@/lib/utils';
import { patch, useApiMutation, usePautas } from '@/lib/queries';
import { Button, DateInput, DueInput, Dialog, DueChip, EmptyState, Field, Input, NativeSelect, PriorityBadge, Skeleton, StatusBadge, Textarea } from '@/components/ui';
import { useLookups } from '@/components/pauta/PautaCard';

const PRIORITIES: PriorityLevel[] = ['critical', 'high', 'medium', 'low'];
const IMPACT_LABEL = ['', 'Muito baixo', 'Baixo', 'Médio', 'Alto', 'Muito alto'];

const dateOnly = (iso: string | null) => (iso ? (iso.length === 10 ? iso : format(parseISO(iso), 'yyyy-MM-dd')) : '');

function CatProjFields({ categoryId, projectId, onCategory, onProject }: { categoryId: string; projectId: string; onCategory: (v: string) => void; onProject: (v: string) => void }) {
  const { categorias, projetos } = useLookups();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Categoria">
        <NativeSelect value={categoryId} onChange={(e) => onCategory(e.target.value)}>
          <option value="">Sem categoria</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Projeto">
        <NativeSelect value={projectId} onChange={(e) => onProject(e.target.value)}>
          <option value="">Sem projeto</option>
          {projetos
            .filter((p) => p.status !== 'done' || p.id === projectId)
            .map((p) => (
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
/* Aprovar                                                             */
/* ------------------------------------------------------------------ */

export interface ApproveOverrides {
  title: string;
  dueDate: string | null;
  manualPriority: PriorityLevel;
  categoryId: string | null;
  projectId: string | null;
  impact: number;
}

export function ApproveDialog({ sugestao, onClose, onConfirm, loading }: { sugestao: Sugestao | null; onClose: () => void; onConfirm: (s: Sugestao, body: ApproveOverrides) => void; loading?: boolean }) {
  return (
    <Dialog open={!!sugestao} onOpenChange={(o) => !o && onClose()} title="Aprovar sugestão" description="Ajuste os detalhes antes de criar a pauta.">
      {sugestao && <ApproveForm key={sugestao.id} s={sugestao} onCancel={onClose} onConfirm={(b) => onConfirm(sugestao, b)} loading={loading} />}
    </Dialog>
  );
}

function ApproveForm({ s, onCancel, onConfirm, loading }: { s: Sugestao; onCancel: () => void; onConfirm: (b: ApproveOverrides) => void; loading?: boolean }) {
  const [title, setTitle] = useState(s.title);
  const [due, setDue] = useState(dateOnly(s.dueDate));
  const [priority, setPriority] = useState<PriorityLevel>(s.suggestedPriority);
  const [categoryId, setCategoryId] = useState(s.categoryId ?? '');
  const [projectId, setProjectId] = useState(s.projectId ?? '');
  const [impact, setImpact] = useState(3);
  // Mantém a hora original do prazo quando o dia não foi alterado
  const dueValue = due ? (s.dueDate && dateOnly(s.dueDate) === due ? s.dueDate : due) : null;
  return (
    <form
      className="space-y-4 pb-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        onConfirm({ title: title.trim(), dueDate: dueValue, manualPriority: priority, categoryId: categoryId || null, projectId: projectId || null, impact });
      }}
    >
      <Field label="Título">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Prazo" hint={s.dueDateEvidence ? `Detectado: “${s.dueDateEvidence}”` : undefined}>
          <DueInput value={due} onValueChange={(v) => setDue(v ?? "")} />
        </Field>
        <Field label="Prioridade">
          <NativeSelect value={priority} onChange={(e) => setPriority(e.target.value as PriorityLevel)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
                {p === s.suggestedPriority ? ' (sugerida)' : ''}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <CatProjFields categoryId={categoryId} projectId={projectId} onCategory={setCategoryId} onProject={setProjectId} />
      <Field label={`Impacto: ${IMPACT_LABEL[impact]}`}>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setImpact(n)}
              className={cn('tabular h-9 flex-1 rounded-xl text-sm font-medium ring-1 ring-inset transition', n <= impact ? 'bg-accent-soft text-accent ring-accent/30' : 'bg-sunken text-fg-3 ring-line hover:text-fg-2')}
              aria-pressed={n === impact}
            >
              {n}
            </button>
          ))}
        </div>
      </Field>
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" loading={loading} disabled={!title.trim()}>
          {!loading && <Check />} Aprovar e criar pauta
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Editar                                                              */
/* ------------------------------------------------------------------ */

export function EditDialog({ sugestao, onClose }: { sugestao: Sugestao | null; onClose: () => void }) {
  return (
    <Dialog open={!!sugestao} onOpenChange={(o) => !o && onClose()} title="Editar sugestão" description="As alterações ficam salvas na sugestão até você decidir." wide>
      {sugestao && <EditForm key={sugestao.id} s={sugestao} onDone={onClose} />}
    </Dialog>
  );
}

function EditForm({ s, onDone }: { s: Sugestao; onDone: () => void }) {
  const [title, setTitle] = useState(s.title);
  const [description, setDescription] = useState(s.description);
  const [due, setDue] = useState(dateOnly(s.dueDate));
  const [priority, setPriority] = useState<PriorityLevel>(s.suggestedPriority);
  const [kind, setKind] = useState<PautaKind>(s.kind);
  const [categoryId, setCategoryId] = useState(s.categoryId ?? '');
  const [projectId, setProjectId] = useState(s.projectId ?? '');
  const [requester, setRequester] = useState(s.requester ?? '');
  const save = useApiMutation((body: Record<string, unknown>) => patch<Sugestao>(`/api/sugestoes/${s.id}`, body), { invalidate: ['sugestoes'], success: 'Sugestão atualizada' });
  return (
    <form
      className="space-y-4 pb-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        const dueValue = due ? (s.dueDate && dateOnly(s.dueDate) === due ? s.dueDate : due) : null;
        save.mutate(
          { title: title.trim(), description, dueDate: dueValue, suggestedPriority: priority, kind, categoryId: categoryId || null, projectId: projectId || null, requester: requester.trim() || null },
          { onSuccess: onDone },
        );
      }}
    >
      <Field label="Título">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
      </Field>
      <Field label="Descrição">
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Prazo">
          <DueInput value={due} onValueChange={(v) => setDue(v ?? "")} />
        </Field>
        <Field label="Prioridade sugerida">
          <NativeSelect value={priority} onChange={(e) => setPriority(e.target.value as PriorityLevel)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Tipo">
          <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as PautaKind)}>
            {(Object.keys(KIND_LABEL) as PautaKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <CatProjFields categoryId={categoryId} projectId={projectId} onCategory={setCategoryId} onProject={setProjectId} />
      <Field label="Solicitante">
        <Input value={requester} onChange={(e) => setRequester(e.target.value)} placeholder="Nome de quem pediu" />
      </Field>
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" loading={save.isPending} disabled={!title.trim()}>
          Salvar alterações
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Adiar                                                               */
/* ------------------------------------------------------------------ */

export function SnoozeOptions({ onPick }: { onPick: (iso: string, label: string) => void }) {
  const now = new Date();
  const at8 = (d: Date) => setMinutes(setHours(startOfDay(d), 8), 0);
  const options = [
    { icon: <Sun />, label: 'Amanhã, 8h', date: at8(addDays(now, 1)) },
    { icon: <CalendarDays />, label: 'Em 3 dias', date: at8(addDays(now, 3)) },
    { icon: <CalendarClock />, label: 'Próxima segunda', date: at8(nextMonday(now)) },
  ];
  const [custom, setCustom] = useState(() => format(at8(addDays(now, 7)), "yyyy-MM-dd'T'HH:mm"));
  const customDate = custom ? new Date(custom) : null;
  const customValid = !!customDate && !Number.isNaN(customDate.getTime()) && customDate.getTime() > Date.now();
  return (
    <div className="w-64 space-y-1">
      <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-3">Adiar até</div>
      {options.map((o) => (
        <button key={o.label} type="button" onClick={() => onPick(o.date.toISOString(), o.label.toLowerCase())} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] text-fg hover:bg-sunken [&_svg]:size-4 [&_svg]:text-fg-3">
          {o.icon}
          <span className="flex-1">{o.label}</span>
          <span className="text-[11px] text-fg-3">{format(o.date, 'EEE d/MM', { locale: ptBR })}</span>
        </button>
      ))}
      <div className="mt-1 space-y-2 border-t border-line px-1 pt-2.5">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-fg-2">
          <AlarmClock className="size-3.5" /> Data personalizada
        </div>
        <Input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} className="h-9 text-[13px]" />
        <Button size="sm" variant="subtle" className="w-full" disabled={!customValid} onClick={() => customDate && onPick(customDate.toISOString(), format(customDate, "d 'de' MMM, HH:mm", { locale: ptBR }))}>
          Adiar até esta data
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vincular a pauta existente                                          */
/* ------------------------------------------------------------------ */

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function LinkDialog({ sugestao, onClose, onPick, loading }: { sugestao: Sugestao | null; onClose: () => void; onPick: (s: Sugestao, pauta: Pauta) => void; loading?: boolean }) {
  return (
    <Dialog open={!!sugestao} onOpenChange={(o) => !o && onClose()} title="Vincular a pauta existente" description="A sugestão será registrada como referência da pauta escolhida, sem criar uma nova.">
      {sugestao && <LinkPicker key={sugestao.id} s={sugestao} onPick={(p) => onPick(sugestao, p)} loading={loading} />}
    </Dialog>
  );
}

function LinkPicker({ s, onPick, loading }: { s: Sugestao; onPick: (p: Pauta) => void; loading?: boolean }) {
  const { data: pautas = [], isLoading } = usePautas();
  const { project } = useLookups();
  const [q, setQ] = useState('');
  const dupIds = useMemo(() => new Map(s.duplicates.filter((d) => d.type === 'pauta').map((d) => [d.id, d.similarity])), [s.duplicates]);
  const list = useMemo(() => {
    const nq = normalize(q.trim());
    return pautas
      .filter((p) => isOpenStatus(p.status) || dupIds.has(p.id))
      .filter((p) => !nq || normalize(`${p.title} ${p.requester ?? ''} ${p.description}`).includes(nq))
      .sort((a, b) => (dupIds.get(b.id) ?? 0) - (dupIds.get(a.id) ?? 0) || b.priorityScore - a.priorityScore)
      .slice(0, 60);
  }, [pautas, q, dupIds]);
  return (
    <div className="space-y-3 pb-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar pauta por título, solicitante…" className="pl-9" autoFocus />
      </div>
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={<Link2 />} title="Nenhuma pauta encontrada" description={q ? 'Tente outro termo de busca.' : 'Não há pautas em aberto para vincular. Aprove a sugestão para criar uma nova pauta.'} className="py-8" />
      ) : (
        <ul className="max-h-[50vh] space-y-1 overflow-y-auto pr-1">
          {list.map((p) => {
            const sim = dupIds.get(p.id);
            const proj = project(p.projectId);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => onPick(p)}
                  className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left ring-1 ring-inset ring-transparent transition hover:bg-sunken hover:ring-line disabled:opacity-60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13.5px] font-medium text-fg">{p.title}</span>
                      {sim !== undefined && <span className="tabular shrink-0 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-600 dark:text-amber-300">{Math.round(sim * 100)}% similar</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={p.status} />
                      <PriorityBadge level={p.manualPriority ?? p.recommendedPriority} />
                      <DueChip due={p.dueDate} done={p.status === 'done'} />
                      {proj && (
                        <span className="flex items-center gap-1 text-[11.5px] text-fg-3">
                          <span className="size-1.5 rounded-full" style={{ background: proj.color }} />
                          {proj.name}
                        </span>
                      )}
                    </div>
                  </div>
                  <Link2 className="mt-1 size-4 shrink-0 text-fg-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
