import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { CalendarDays, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

const fieldBase =
  'h-10 w-full rounded-xl bg-sunken pl-3 pr-9 text-sm text-fg ring-1 ring-line placeholder:text-fg-3 transition focus:bg-surface-strong focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-60 tabular';

/** "2026-11-03" → "03/11/2026" */
export function isoToBr(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** "3/11/26", "03/11/2026", "03112026" → "2026-11-03" (ou null se inválida). */
export function brToIso(text: string): string | null {
  const t = text.trim();
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t);
  if (!m) {
    const d = /^(\d{2})(\d{2})(\d{4})$/.exec(t);
    if (d) m = d;
  }
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (m[3]!.length === 2) year += 2000;
  if (year < 1990 || year > 2200) return null;
  const dt = new Date(year, month - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function maskDate(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

type BaseProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'min' | 'max'>;

/**
 * Campo de data no padrão brasileiro (dd/mm/aaaa) com seletor de calendário.
 * Valor externo em ISO (YYYY-MM-DD) ou '' quando vazio.
 */
export function DateInput({ value, onValueChange, className, ...rest }: BaseProps & { value: string | null | undefined; onValueChange: (iso: string) => void }) {
  const [text, setText] = useState(isoToBr(value));
  const [invalid, setInvalid] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(isoToBr(value));
    setInvalid(false);
  }, [value]);

  const commit = (t: string) => {
    if (t.trim() === '') {
      setInvalid(false);
      if (value) onValueChange('');
      return;
    }
    const iso = brToIso(t);
    setInvalid(!iso);
    if (iso && iso !== (value ?? '').slice(0, 10)) onValueChange(iso);
  };

  return (
    <div className={cn('relative', className)}>
      <input
        {...rest}
        inputMode="numeric"
        placeholder="dd/mm/aaaa"
        value={text}
        onChange={(e) => {
          const t = maskDate(e.target.value);
          setText(t);
          if (t.length === 10) commit(t);
          else setInvalid(false);
        }}
        onBlur={() => commit(text)}
        onKeyDown={(e) => e.key === 'Enter' && commit(text)}
        aria-invalid={invalid}
        className={cn(fieldBase, invalid && 'ring-critical/60 focus:ring-critical/60')}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Abrir calendário"
        onClick={() => {
          try {
            picker.current?.showPicker();
          } catch {
            picker.current?.focus();
          }
        }}
        className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-fg-3 transition hover:bg-surface-strong hover:text-fg [&_svg]:size-4"
      >
        <CalendarDays />
      </button>
      {/* seletor nativo invisível, usado só para o calendário visual */}
      <input
        ref={picker}
        type="date"
        min="2000-01-01"
        max="2100-12-31"
        tabIndex={-1}
        aria-hidden
        value={(value ?? '').slice(0, 10)}
        onChange={(e) => e.target.value && onValueChange(e.target.value)}
        className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0"
      />
      {invalid && <span className="absolute -bottom-4 left-1 text-[10.5px] text-critical">Data inválida</span>}
    </div>
  );
}

function maskTime(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`;
}

export function normalizeTime(t: string): string | null {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : null;
}

/** Campo de horário 24h (HH:mm). Valor '' quando vazio. */
export function TimeField({ value, onValueChange, className, ...rest }: BaseProps & { value: string | null | undefined; onValueChange: (hhmm: string) => void }) {
  const [text, setText] = useState(value ?? '');
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(value ?? '');
    setInvalid(false);
  }, [value]);
  const commit = (t: string) => {
    if (!t.trim()) {
      setInvalid(false);
      if (value) onValueChange('');
      return;
    }
    const n = normalizeTime(t);
    setInvalid(!n);
    if (n) {
      setText(n);
      if (n !== value) onValueChange(n);
    }
  };
  return (
    <div className={cn('relative', className)}>
      <input
        {...rest}
        inputMode="numeric"
        placeholder="hh:mm"
        value={text}
        onChange={(e) => {
          const t = maskTime(e.target.value);
          setText(t);
          if (t.length === 5) commit(t);
        }}
        onBlur={() => commit(text)}
        onKeyDown={(e) => e.key === 'Enter' && commit(text)}
        aria-invalid={invalid}
        className={cn(fieldBase, invalid && 'ring-critical/60')}
      />
      <Clock className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Prazo com horário opcional: armazenado como "YYYY-MM-DD" ou        */
/* "YYYY-MM-DDTHH:mm" (horário local).                                 */
/* ------------------------------------------------------------------ */

export function splitDue(due: string | null | undefined): { date: string; time: string } {
  if (!due) return { date: '', time: '' };
  const date = due.slice(0, 10);
  const t = /T(\d{2}:\d{2})/.exec(due);
  if (!t) return { date, time: '' };
  // ISO em UTC (ex.: vindo do Planner) → horário local
  if (/Z|[+-]\d{2}:?\d{2}$/.test(due)) {
    const d = new Date(due);
    const p = (n: number) => String(n).padStart(2, '0');
    return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
  }
  return { date, time: t[1]! };
}

export function joinDue(date: string, time: string): string | null {
  if (!date) return null;
  return time ? `${date}T${time}` : date;
}

/** Campo combinado de prazo: data (dd/mm/aaaa) + hora de entrega opcional. */
export function DueInput({ value, onValueChange, className }: { value: string | null | undefined; onValueChange: (due: string | null) => void; className?: string }) {
  const { date, time } = splitDue(value);
  return (
    <div className={cn('flex gap-2', className)}>
      <DateInput className="min-w-0 flex-1" value={date} onValueChange={(d) => onValueChange(joinDue(d, d ? time : ''))} aria-label="Data de entrega" />
      <TimeField className="w-[104px] shrink-0" value={time} onValueChange={(t) => date && onValueChange(joinDue(date, t))} aria-label="Hora de entrega (opcional)" disabled={!date} />
    </div>
  );
}
