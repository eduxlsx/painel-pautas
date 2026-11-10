import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Plus, RotateCcw, Save, X } from 'lucide-react';
import { Button, GlassCard, Input , TimeField } from '@/components/ui';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Rascunho local com estado "sujo"                                    */
/* ------------------------------------------------------------------ */

const key = (v: unknown) => JSON.stringify(v ?? null);

/**
 * Mantém uma cópia editável de um objeto vindo do servidor.
 * Enquanto não houver edição local, acompanha as atualizações do servidor;
 * depois de editado, preserva o rascunho até salvar ou descartar.
 */
export function useDraft<T extends object>(source: T) {
  const srcKey = key(source);
  const [state, setState] = useState<{ base: string; value: T }>(() => ({ base: srcKey, value: source }));
  let current = state;
  if (srcKey !== state.base) {
    const wasDirty = key(state.value) !== state.base;
    current = { base: srcKey, value: wasDirty ? state.value : source };
    setState(current);
  }
  const dirty = key(current.value) !== srcKey;
  return {
    value: current.value,
    dirty,
    set<K extends keyof T>(k: K, v: T[K]) {
      setState((s) => ({ ...s, value: { ...s.value, [k]: v } }));
    },
    patch(p: Partial<T>) {
      setState((s) => ({ ...s, value: { ...s.value, ...p } }));
    },
    reset() {
      setState({ base: srcKey, value: source });
    },
  };
}

/* ------------------------------------------------------------------ */
/* Cartão de seção com barra de salvar                                 */
/* ------------------------------------------------------------------ */

export function SectionCard({
  id,
  icon,
  title,
  description,
  children,
  dirty,
  saving,
  onSave,
  onReset,
  saveLabel = 'Salvar',
  action,
  className,
}: {
  id?: string;
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  dirty?: boolean;
  saving?: boolean;
  onSave?: () => void;
  onReset?: () => void;
  saveLabel?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <GlassCard id={id} padded={false} className={cn('scroll-mt-6 overflow-hidden', className)}>
      <div className="flex items-start justify-between gap-4 px-6 pb-1 pt-6">
        <div className="flex min-w-0 items-start gap-3">
          {icon && <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent [&_svg]:size-[18px]">{icon}</div>}
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-fg">{title}</h2>
            {description && <p className="mt-0.5 max-w-2xl text-[13px] leading-relaxed text-fg-3">{description}</p>}
          </div>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      <div className="px-6 pb-6 pt-4">{children}</div>
      {onSave && (
        <div className={cn('flex items-center justify-between gap-3 border-t px-6 py-3.5 transition-colors duration-300', dirty ? 'border-accent/20 bg-accent-soft/60' : 'border-line bg-sunken/40')}>
          <AnimatePresence mode="wait" initial={false}>
            {dirty ? (
              <motion.span key="dirty" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-2 text-xs font-medium text-accent">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-50" />
                  <span className="relative inline-flex size-2 rounded-full bg-accent" />
                </span>
                Alterações não salvas
              </motion.span>
            ) : (
              <motion.span key="clean" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-xs text-fg-3">
                Tudo salvo
              </motion.span>
            )}
          </AnimatePresence>
          <div className="flex items-center gap-2">
            {onReset && (
              <Button variant="ghost" size="sm" onClick={onReset} disabled={!dirty || saving}>
                <RotateCcw />
                Descartar
              </Button>
            )}
            <Button variant={dirty ? 'primary' : 'secondary'} size="sm" onClick={onSave} disabled={!dirty} loading={saving}>
              {!saving && <Save />}
              {saveLabel}
            </Button>
          </div>
        </div>
      )}
    </GlassCard>
  );
}

/* ------------------------------------------------------------------ */
/* Linha de configuração (rótulo + explicação + controle)              */
/* ------------------------------------------------------------------ */

export function SettingRow({ title, description, children, className }: { title: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-6 py-3.5', className)}>
      <div className="min-w-0">
        <div className="text-sm font-medium text-fg">{title}</div>
        {description && <div className="mt-0.5 text-xs leading-relaxed text-fg-3">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function RowGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('divide-y divide-line rounded-2xl bg-sunken/60 px-4 ring-1 ring-line', className)}>{children}</div>;
}

/* ------------------------------------------------------------------ */
/* Campos numéricos e de horário                                       */
/* ------------------------------------------------------------------ */

export function NumberInput({ value, onChange, min, max, step = 1, suffix, className }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string; className?: string }) {
  return (
    <div className={cn('relative', className)}>
      <Input
        type="number"
        inputMode="decimal"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = e.target.value === '' ? NaN : Number(e.target.value);
          onChange(Number.isFinite(n) ? n : (min ?? 0));
        }}
        onBlur={() => {
          let v = value;
          if (min !== undefined && v < min) v = min;
          if (max !== undefined && v > max) v = max;
          if (v !== value) onChange(v);
        }}
        className={cn('tabular', suffix && 'pr-12')}
      />
      {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fg-3">{suffix}</span>}
    </div>
  );
}

export function TimeInput({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  return <TimeField value={value} onValueChange={(v) => v && onChange(v)} className={className} />;
}

/** Controle deslizante 0–1 exibido em porcentagem. */
export function PercentSlider({ value, onChange, min = 0, max = 1, step = 0.01 }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex items-center gap-4">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full accent-accent"
        style={{ background: `linear-gradient(90deg, var(--pf-accent) 0%, var(--pf-accent-2) ${pct}%, var(--pf-line-strong) ${pct}%)` }}
      />
      <span className="tabular w-12 shrink-0 text-right text-sm font-semibold text-fg">{Math.round(value * 100)}%</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lista de etiquetas editável                                         */
/* ------------------------------------------------------------------ */

export function ChipsInput({ value, onChange, placeholder, className }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; className?: string }) {
  const [text, setText] = useState('');
  const add = () => {
    const parts = text
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()));
    if (parts.length) onChange([...value, ...parts]);
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    <div className={cn('flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl bg-sunken p-1.5 ring-1 ring-line transition focus-within:bg-surface-strong focus-within:ring-2 focus-within:ring-accent/50', className)}>
      <AnimatePresence initial={false}>
        {value.map((v) => (
          <motion.span
            key={v}
            layout
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            className="inline-flex h-7 items-center gap-1 rounded-lg bg-surface-strong pl-2.5 pr-1 text-xs font-medium text-fg shadow-[var(--pf-shadow)]"
          >
            {v}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== v))} className="grid size-5 place-items-center rounded-md text-fg-3 hover:bg-sunken hover:text-fg" aria-label={`Remover ${v}`}>
              <X className="size-3" />
            </button>
          </motion.span>
        ))}
      </AnimatePresence>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        onBlur={add}
        placeholder={value.length ? '' : placeholder}
        className="h-7 min-w-[140px] flex-1 bg-transparent px-1.5 text-sm text-fg outline-none placeholder:text-fg-3"
      />
      {text.trim() && (
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={add} className="grid size-7 place-items-center rounded-lg text-accent hover:bg-accent-soft" aria-label="Adicionar">
          <Plus className="size-4" />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dias da semana                                                      */
/* ------------------------------------------------------------------ */

export const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const WEEKDAYS_LONG = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

export function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {WEEKDAYS_SHORT.map((label, i) => {
        const on = value.includes(i);
        return (
          <button
            key={label}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((d) => d !== i) : [...value, i].sort((a, b) => a - b))}
            className={cn(
              'h-9 w-12 rounded-xl text-[13px] font-medium transition-all duration-200 active:scale-95',
              on ? 'bg-flow text-white shadow-[0_6px_16px_-8px_var(--pf-accent)]' : 'bg-sunken text-fg-2 ring-1 ring-line hover:text-fg',
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Caixa de aviso                                                      */
/* ------------------------------------------------------------------ */

const NOTE_TONES = {
  info: 'bg-sky-500/8 text-fg-2 ring-sky-500/20 [&_.note-icon]:text-sky-500',
  warning: 'bg-warning/10 text-fg-2 ring-warning/30 [&_.note-icon]:text-amber-500',
  critical: 'bg-critical/8 text-fg-2 ring-critical/25 [&_.note-icon]:text-critical',
  success: 'bg-success/8 text-fg-2 ring-success/25 [&_.note-icon]:text-success',
  accent: 'bg-accent-soft text-fg-2 ring-accent/20 [&_.note-icon]:text-accent',
} as const;

export function Note({ tone = 'info', icon, title, children, className }: { tone?: keyof typeof NOTE_TONES; icon?: ReactNode; title?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex gap-3 rounded-2xl px-4 py-3 text-[13px] leading-relaxed ring-1 ring-inset', NOTE_TONES[tone], className)}>
      {icon && <span className="note-icon mt-0.5 shrink-0 [&_svg]:size-4">{icon}</span>}
      <div className="min-w-0">
        {title && <div className="font-semibold text-fg">{title}</div>}
        {children}
      </div>
    </div>
  );
}

/** Caixa de seleção estilizada usada nas listas de pastas/planos. */
export function CheckTile({ checked, onToggle, title, meta }: { checked: boolean; onToggle: () => void; title: ReactNode; meta?: ReactNode }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all duration-200',
        checked ? 'bg-accent-soft text-fg ring-1 ring-accent/30' : 'bg-sunken/60 text-fg-2 ring-1 ring-line hover:text-fg',
      )}
    >
      <span className={cn('grid size-[18px] shrink-0 place-items-center rounded-md transition-colors', checked ? 'bg-flow text-white' : 'bg-surface-strong ring-1 ring-line-strong')}>
        {checked && (
          <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
            <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
      {meta && <span className="tabular shrink-0 text-xs text-fg-3">{meta}</span>}
    </button>
  );
}
