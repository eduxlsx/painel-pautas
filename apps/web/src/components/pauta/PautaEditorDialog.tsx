import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, GitBranch, Search, ShieldCheck, Tag, X } from 'lucide-react';
import type { Pauta, PautaInput, PautaKind, PautaStatus, PriorityLevel } from '@pautaflow/shared';
import { KIND_LABEL, STATUS_LABEL } from '@pautaflow/shared';
import { cn } from '@/lib/utils';
import { usePauta, usePautas, useCreatePauta, useUpdatePauta } from '@/lib/queries';
import { useUi } from '@/stores/ui';
import { toast } from '@/stores/toast';
import { Button, Dialog, Field, Input, Kbd, NativeSelect, Popover, PopoverContent, PopoverTrigger, Skeleton, Switch, Textarea, STATUS_HEX } from '@/components/ui';
import { useLookups } from './PautaCard';
import { COMPLEXITY_LABEL, IMPACT_LABEL, PriorityOptions, ScalePicker, dateInput, diffInput } from './helpers';

interface Form {
  title: string;
  description: string;
  kind: PautaKind;
  status: PautaStatus;
  categoryId: string;
  projectId: string;
  requester: string;
  owner: string;
  manualPriority: PriorityLevel | '';
  impact: number;
  complexity: number;
  estimatedHours: string;
  startDate: string;
  dueDate: string;
  approvalPending: boolean;
  dependencies: string[];
  tags: string[];
}

const EMPTY: Form = {
  title: '',
  description: '',
  kind: 'tarefa',
  status: 'todo',
  categoryId: '',
  projectId: '',
  requester: '',
  owner: '',
  manualPriority: '',
  impact: 3,
  complexity: 3,
  estimatedHours: '',
  startDate: '',
  dueDate: '',
  approvalPending: false,
  dependencies: [],
  tags: [],
};

const str = (v: unknown) => (typeof v === 'string' ? v : '');

function fromPauta(p: Pauta): Form {
  return {
    title: p.title,
    description: p.description,
    kind: p.kind,
    status: p.status,
    categoryId: p.categoryId ?? '',
    projectId: p.projectId ?? '',
    requester: p.requester ?? '',
    owner: p.owner ?? '',
    manualPriority: p.manualPriority ?? '',
    impact: p.impact,
    complexity: p.complexity,
    estimatedHours: p.estimatedHours === null ? '' : String(p.estimatedHours),
    startDate: dateInput(p.startDate),
    dueDate: dateInput(p.dueDate),
    approvalPending: p.approvalPending,
    dependencies: [...p.dependencies],
    tags: [...p.tags],
  };
}

function fromDefaults(d: Record<string, unknown> | undefined): Form {
  if (!d) return { ...EMPTY };
  const f: Form = { ...EMPTY };
  if (d.title) f.title = str(d.title);
  if (d.description) f.description = str(d.description);
  if (d.kind && str(d.kind) in KIND_LABEL) f.kind = d.kind as PautaKind;
  if (d.status && str(d.status) in STATUS_LABEL) f.status = d.status as PautaStatus;
  if (d.projectId) f.projectId = str(d.projectId);
  if (d.categoryId) f.categoryId = str(d.categoryId);
  if (d.requester) f.requester = str(d.requester);
  if (d.owner) f.owner = str(d.owner);
  if (d.manualPriority) f.manualPriority = d.manualPriority as PriorityLevel;
  if (d.dueDate) f.dueDate = dateInput(str(d.dueDate));
  if (d.startDate) f.startDate = dateInput(str(d.startDate));
  if (typeof d.impact === 'number') f.impact = d.impact;
  if (typeof d.complexity === 'number') f.complexity = d.complexity;
  if (Array.isArray(d.tags)) f.tags = d.tags.filter((t): t is string => typeof t === 'string');
  return f;
}

function toInput(f: Form): PautaInput & { title: string } {
  const hours = f.estimatedHours.trim() === '' ? null : Number(f.estimatedHours.replace(',', '.'));
  return {
    title: f.title.trim(),
    description: f.description,
    kind: f.kind,
    status: f.status,
    categoryId: f.categoryId || null,
    projectId: f.projectId || null,
    requester: f.requester.trim() || null,
    owner: f.owner.trim() || null,
    manualPriority: f.manualPriority || null,
    impact: f.impact,
    complexity: f.complexity,
    estimatedHours: hours !== null && Number.isFinite(hours) && hours >= 0 ? hours : null,
    startDate: f.startDate || null,
    dueDate: f.dueDate || null,
    approvalPending: f.approvalPending,
    dependencies: f.dependencies,
    tags: f.tags,
  };
}

export function PautaEditorDialog() {
  const { editor, closeEditor, openPauta } = useUi();
  const editingId = editor.pautaId;
  const { data: existing, isLoading } = usePauta(editor.open ? editingId : null);
  const create = useCreatePauta();
  const update = useUpdatePauta();
  const [form, setForm] = useState<Form>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const initKey = useRef<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Inicializa o formulário uma vez por abertura (e quando a pauta editada carregar).
  useEffect(() => {
    if (!editor.open) {
      initKey.current = null;
      return;
    }
    const key = editingId ?? `new:${JSON.stringify(editor.defaults ?? {})}`;
    if (initKey.current === key) return;
    if (editingId) {
      if (!existing || existing.id !== editingId) return;
      setForm(fromPauta(existing));
    } else {
      setForm(fromDefaults(editor.defaults));
    }
    setError(null);
    initKey.current = key;
    requestAnimationFrame(() => titleRef.current?.focus());
  }, [editor.open, editingId, editor.defaults, existing]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const saving = create.isPending || update.isPending;
  const ready = !editingId || (existing && initKey.current === editingId);

  const save = async () => {
    if (saving) return;
    if (!form.title.trim()) {
      setError('Informe o título da pauta');
      titleRef.current?.focus();
      return;
    }
    if (form.startDate && form.dueDate && form.startDate > form.dueDate) {
      setError('A data de início não pode ser depois do prazo');
      return;
    }
    const input = toInput(form);
    try {
      if (editingId && existing) {
        const { startDate, dueDate, ...rest } = input;
        const changes = diffInput(existing, rest);
        if (dateInput(existing.startDate) !== form.startDate) changes.startDate = startDate;
        if (dateInput(existing.dueDate) !== form.dueDate) changes.dueDate = dueDate;
        if (Object.keys(changes).length) {
          await update.mutateAsync({ id: editingId, ...changes });
          toast.success('Pauta atualizada');
        }
        closeEditor();
      } else {
        const created = await create.mutateAsync(input);
        closeEditor();
        openPauta(created.id);
      }
    } catch {
      /* erro já exibido em toast */
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void save();
    }
  };

  return (
    <Dialog
      open={editor.open}
      onOpenChange={(o) => !o && closeEditor()}
      wide
      title={editingId ? 'Editar pauta' : 'Nova pauta'}
      description={editingId ? 'Ajuste os dados; o score de prioridade é recalculado ao salvar.' : 'Registre a demanda. O PautaFlow calcula a prioridade recomendada automaticamente.'}
      footer={
        <>
          <span className="mr-auto hidden items-center gap-1 text-xs text-fg-3 sm:flex">
            <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> para salvar
          </span>
          <Button variant="ghost" onClick={closeEditor}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!ready}>
            {editingId ? 'Salvar alterações' : 'Criar pauta'}
          </Button>
        </>
      }
    >
      {!ready && isLoading ? (
        <div className="space-y-4 pb-4">
          <Skeleton className="h-12" />
          <Skeleton className="h-24" />
          <div className="grid grid-cols-3 gap-3">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        </div>
      ) : (
        <div className="space-y-5 pb-3" onKeyDown={onKeyDown}>
          <div>
            <input
              ref={titleRef}
              value={form.title}
              onChange={(e) => {
                set('title', e.target.value);
                if (error) setError(null);
              }}
              placeholder="Título da pauta"
              aria-label="Título"
              className="w-full rounded-2xl bg-transparent px-1 py-1 text-xl font-semibold tracking-[-0.02em] text-fg outline-none placeholder:text-fg-3/70 focus:bg-sunken/60"
            />
            <AnimatePresence>
              {error && (
                <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="px-1 pt-1 text-xs text-critical">
                  {error}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
          <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Descrição, contexto, combinados…" />

          <Section title="Classificação">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Tipo">
                <NativeSelect value={form.kind} onChange={(e) => set('kind', e.target.value as PautaKind)}>
                  {(Object.keys(KIND_LABEL) as PautaKind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={<span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full" style={{ background: STATUS_HEX[form.status] }} />Status</span>}>
                <NativeSelect value={form.status} onChange={(e) => set('status', e.target.value as PautaStatus)}>
                  {(Object.keys(STATUS_LABEL) as PautaStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Prioridade manual" hint="Automática segue a recomendação">
                <NativeSelect value={form.manualPriority} onChange={(e) => set('manualPriority', e.target.value as PriorityLevel | '')}>
                  <PriorityOptions />
                </NativeSelect>
              </Field>
              <ProjectCategoryFields form={form} set={set} />
            </div>
          </Section>

          <Section title="Pessoas">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Solicitante">
                <Input value={form.requester} onChange={(e) => set('requester', e.target.value)} placeholder="Quem pediu" />
              </Field>
              <Field label="Responsável">
                <Input value={form.owner} onChange={(e) => set('owner', e.target.value)} placeholder="Quem executa" />
              </Field>
            </div>
          </Section>

          <Section title="Esforço e impacto">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Impacto">
                <ScalePicker id="impact" value={form.impact} onChange={(v) => set('impact', v)} labels={IMPACT_LABEL} />
              </Field>
              <Field label="Complexidade">
                <ScalePicker id="complexity" value={form.complexity} onChange={(v) => set('complexity', v)} labels={COMPLEXITY_LABEL} color="var(--pf-accent-2)" />
              </Field>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Estimativa (horas)">
                <Input type="number" min={0} step={0.5} inputMode="decimal" className="tabular" value={form.estimatedHours} onChange={(e) => set('estimatedHours', e.target.value)} placeholder="—" />
              </Field>
              <Field label="Início">
                <Input type="date" className="tabular dark:[color-scheme:dark]" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
              </Field>
              <Field label="Prazo" hint={editingId && existing?.sourceRefs.length ? 'Alterar o prazo trava contra sincronizações' : undefined}>
                <Input type="date" className="tabular dark:[color-scheme:dark]" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
              </Field>
            </div>
            <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-2xl bg-sunken px-4 py-3 ring-1 ring-line">
              <span className="flex items-center gap-2.5 text-sm text-fg">
                <ShieldCheck className="size-4 text-warning" />
                Aprovação pendente
                <span className="text-xs text-fg-3">aguardando aval de alguém</span>
              </span>
              <Switch checked={form.approvalPending} onCheckedChange={(v) => set('approvalPending', v)} label="Aprovação pendente" />
            </label>
          </Section>

          <Section title="Relações">
            <div className="grid grid-cols-1 gap-3">
              <Field label="Depende de">
                <DependencyPicker value={form.dependencies} selfId={editingId} onChange={(v) => set('dependencies', v)} />
              </Field>
              <Field label="Tags">
                <TagsInput value={form.tags} onChange={(v) => set('tags', v)} />
              </Field>
            </div>
          </Section>
        </div>
      )}
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-3">{title}</h4>
      {children}
    </section>
  );
}

function ProjectCategoryFields({ form, set }: { form: Form; set: <K extends keyof Form>(k: K, v: Form[K]) => void }) {
  const { projetos, categorias } = useLookups();
  return (
    <>
      <Field label="Projeto" className="sm:col-span-1">
        <NativeSelect value={form.projectId} onChange={(e) => set('projectId', e.target.value)}>
          <option value="">Sem projeto</option>
          {projetos
            .filter((p) => p.status !== 'done' || p.id === form.projectId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </NativeSelect>
      </Field>
      <Field label="Categoria" className="sm:col-span-2">
        <NativeSelect value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
          <option value="">Sem categoria</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </>
  );
}

/** Multisseleção pesquisável de outras pautas. */
function DependencyPicker({ value, onChange, selfId }: { value: string[]; onChange: (v: string[]) => void; selfId: string | null }) {
  const { data: pautas = [] } = usePautas();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const byId = useMemo(() => new Map(pautas.map((p) => [p.id, p])), [pautas]);
  const options = useMemo(() => {
    const term = q.trim().toLowerCase();
    return pautas
      .filter((p) => p.id !== selfId && (!term || p.title.toLowerCase().includes(term)))
      .sort((a, b) => Number(b.status !== 'done' && b.status !== 'cancelled') - Number(a.status !== 'done' && a.status !== 'cancelled') || b.priorityScore - a.priorityScore)
      .slice(0, 60);
  }, [pautas, q, selfId]);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <AnimatePresence initial={false}>
            {value.map((id) => (
              <motion.span
                key={id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="inline-flex max-w-[280px] items-center gap-1.5 rounded-full bg-accent-soft py-1 pl-2.5 pr-1 text-xs font-medium text-accent"
              >
                <GitBranch className="size-3 shrink-0" />
                <span className="truncate">{byId.get(id)?.title ?? 'Pauta removida'}</span>
                <button type="button" onClick={() => toggle(id)} className="grid size-4 place-items-center rounded-full hover:bg-accent/20" aria-label="Remover dependência">
                  <X className="size-3" />
                </button>
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <GitBranch />
            {value.length ? 'Alterar dependências' : 'Adicionar dependência'}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(420px,calc(100vw-48px))] p-2">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar pauta…" className="h-9 pl-9" />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {options.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-fg-3">{pautas.length <= 1 ? 'Ainda não há outras pautas cadastradas.' : 'Nenhuma pauta encontrada.'}</p>
            ) : (
              options.map((p) => {
                const sel = value.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggle(p.id)}
                    className={cn('flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-sunken', sel && 'bg-accent-soft/60')}
                  >
                    <span className={cn('grid size-4 shrink-0 place-items-center rounded-md ring-1 transition-colors', sel ? 'bg-accent text-white ring-accent' : 'ring-line-strong')}>{sel && <Check className="size-3" />}</span>
                    <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS_HEX[p.status] }} />
                    <span className={cn('min-w-0 flex-1 truncate text-fg', (p.status === 'done' || p.status === 'cancelled') && 'text-fg-3 line-through')}>{p.title}</span>
                    <span className="tabular text-[11px] text-fg-3">{p.priorityScore}</span>
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Entrada de tags em chips: Enter/vírgula adiciona, Backspace remove a última. */
function TagsInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const t = raw.trim().replace(/^#/, '');
    if (t && !value.some((v) => v.toLowerCase() === t.toLowerCase())) onChange([...value, t]);
    setDraft('');
  };
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl bg-sunken px-2 py-1.5 ring-1 ring-line transition focus-within:bg-surface-strong focus-within:ring-2 focus-within:ring-accent/50">
      <Tag className="ml-1 size-3.5 text-fg-3" />
      <AnimatePresence initial={false}>
        {value.map((t) => (
          <motion.span key={t} layout initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }} className="inline-flex items-center gap-1 rounded-full bg-surface-strong py-0.5 pl-2 pr-1 text-xs font-medium text-fg ring-1 ring-line">
            {t}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} className="grid size-4 place-items-center rounded-full text-fg-3 hover:bg-sunken hover:text-fg" aria-label={`Remover tag ${t}`}>
              <X className="size-3" />
            </button>
          </motion.span>
        ))}
      </AnimatePresence>
      <input
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          if (v.endsWith(',')) add(v.slice(0, -1));
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && draft.trim()) {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => draft.trim() && add(draft)}
        placeholder={value.length ? '' : 'Digite e pressione Enter'}
        className="h-7 min-w-[120px] flex-1 bg-transparent px-1 text-sm text-fg outline-none placeholder:text-fg-3"
      />
    </div>
  );
}
