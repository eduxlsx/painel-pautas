import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Check, Pipette } from 'lucide-react';
import type { Projeto } from '@pautaflow/shared';
import { useSaveProjeto } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { Button, DateInput, Dialog, Field, Input, Segmented, Textarea } from '@/components/ui';
import { ChipsInput } from './ChipsInput';

export const PROJECT_COLORS = ['#6366f1', '#8b5cf6', '#d946ef', '#ec4899', '#ef4444', '#f97316', '#f59e0b', '#10b981', '#14b8a6', '#0ea5e9', '#64748b'];

export const PROJECT_STATUS_LABEL: Record<Projeto['status'], string> = { active: 'Ativo', paused: 'Pausado', done: 'Concluído' };

const HEX = /^#[0-9a-fA-F]{6}$/;

export function ProjectEditorDialog({ open, onOpenChange, projeto, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; projeto: Projeto | null; onSaved?: (p: Projeto) => void }) {
  const save = useSaveProjeto();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(PROJECT_COLORS[0]!);
  const [hexDraft, setHexDraft] = useState(PROJECT_COLORS[0]!);
  const [status, setStatus] = useState<Projeto['status']>('active');
  const [owner, setOwner] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    const c = projeto?.color ?? PROJECT_COLORS[0]!;
    setName(projeto?.name ?? '');
    setDescription(projeto?.description ?? '');
    setColor(c);
    setHexDraft(c);
    setStatus(projeto?.status ?? 'active');
    setOwner(projeto?.owner ?? '');
    setDueDate(projeto?.dueDate?.slice(0, 10) ?? '');
    setKeywords(projeto?.keywords ?? []);
    setTouched(false);
  }, [open, projeto]);

  const pickColor = (c: string) => {
    setColor(c);
    setHexDraft(c);
  };

  const submit = () => {
    setTouched(true);
    if (!name.trim()) return;
    save.mutate(
      {
        ...(projeto ? { id: projeto.id } : {}),
        name: name.trim(),
        description: description.trim(),
        color,
        status,
        owner: owner.trim() || null,
        dueDate: dueDate || null,
        keywords,
      },
      {
        onSuccess: (p) => {
          onOpenChange(false);
          onSaved?.(p);
        },
      },
    );
  };

  const custom = !PROJECT_COLORS.includes(color.toLowerCase());

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={projeto ? 'Editar projeto' : 'Novo projeto'}
      description="Projetos agrupam pautas, arquivos e prazos de uma mesma frente de trabalho."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={submit} loading={save.isPending}>
            {projeto ? 'Salvar alterações' : 'Criar projeto'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-5 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-center gap-4">
          <motion.span
            key={color}
            initial={{ scale: 0.85, opacity: 0.6 }}
            animate={{ scale: 1, opacity: 1 }}
            className="grid size-14 shrink-0 place-items-center rounded-[18px] text-xl font-semibold text-white shadow-[0_12px_28px_-12px_var(--c)]"
            style={{ background: `linear-gradient(140deg, ${color}, color-mix(in srgb, ${color} 70%, #000))`, ['--c' as string]: color }}
          >
            {(name.trim()[0] ?? 'P').toUpperCase()}
          </motion.span>
          <Field label="Nome do projeto" error={touched && !name.trim() ? 'Informe o nome' : undefined} className="flex-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: Campanha institucional 2026" autoFocus />
          </Field>
        </div>

        <Field label="Descrição">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Objetivo, escopo e contexto do projeto" className="min-h-[72px]" />
        </Field>

        <div>
          <span className="mb-2 block text-xs font-medium text-fg-2">Cor</span>
          <div className="flex flex-wrap items-center gap-2">
            {PROJECT_COLORS.map((c) => {
              const active = color.toLowerCase() === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => pickColor(c)}
                  className={cn('relative grid size-8 place-items-center rounded-full transition-transform hover:scale-110', active && 'scale-110')}
                  style={{ background: c, boxShadow: active ? `0 0 0 2px var(--pf-surface-strong), 0 0 0 4px ${c}` : 'inset 0 0 0 1px rgba(0,0,0,0.08)' }}
                  aria-label={`Cor ${c}`}
                >
                  {active && <Check className="size-4 text-white" />}
                </button>
              );
            })}
            <span className="mx-1 h-6 w-px bg-line" />
            <label
              className={cn('relative grid size-8 cursor-pointer place-items-center rounded-full ring-1 ring-line-strong transition-transform hover:scale-110', custom && 'scale-110')}
              style={{ background: custom ? color : 'conic-gradient(#ef4444, #f59e0b, #10b981, #0ea5e9, #8b5cf6, #ec4899, #ef4444)', boxShadow: custom ? `0 0 0 2px var(--pf-surface-strong), 0 0 0 4px ${color}` : undefined }}
              title="Cor personalizada"
            >
              <Pipette className="size-3.5 text-white drop-shadow" />
              <input type="color" value={HEX.test(color) ? color : '#6366f1'} onChange={(e) => pickColor(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
            <Input
              value={hexDraft}
              onChange={(e) => {
                const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
                setHexDraft(v);
                if (HEX.test(v)) setColor(v.toLowerCase());
              }}
              className="h-8 w-[104px] font-mono text-xs uppercase"
              aria-label="Cor em hexadecimal"
              maxLength={7}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-fg-2">Status</span>
            <Segmented
              id="proj-status"
              size="sm"
              value={status}
              onChange={setStatus}
              options={(['active', 'paused', 'done'] as const).map((s) => ({ value: s, label: PROJECT_STATUS_LABEL[s] }))}
            />
          </div>
          <Field label="Responsável">
            <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Nome" />
          </Field>
          <Field label="Prazo">
            <DateInput value={dueDate} onValueChange={setDueDate} />
          </Field>
        </div>

        <Field
          label="Palavras-chave"
          hint="O radar usa estas palavras para associar automaticamente e-mails, tarefas do Planner e sugestões a este projeto. Inclua nomes de clientes, siglas e termos recorrentes."
        >
          <ChipsInput value={keywords} onChange={setKeywords} placeholder="Digite e pressione Enter (ex.: campanha, ACME, lançamento)" />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
