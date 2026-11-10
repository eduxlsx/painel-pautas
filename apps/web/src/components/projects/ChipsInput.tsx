import { useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Campo de "chips": Enter, vírgula ou Tab adicionam; Backspace remove o último. */
export function ChipsInput({ value, onChange, placeholder, className }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; className?: string }) {
  const [draft, setDraft] = useState('');

  const commit = (raw: string) => {
    const parts = raw
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const lower = new Set(value.map((v) => v.toLowerCase()));
    const next = [...value];
    for (const p of parts) {
      if (!lower.has(p.toLowerCase())) {
        next.push(p);
        lower.add(p.toLowerCase());
      }
    }
    onChange(next);
    setDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',' || (e.key === 'Tab' && draft.trim())) && draft.trim()) {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Enter') {
      e.preventDefault();
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div
      className={cn(
        'flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-xl bg-sunken px-2 py-1.5 ring-1 ring-line transition focus-within:bg-surface-strong focus-within:ring-2 focus-within:ring-accent/50',
        className,
      )}
    >
      <AnimatePresence initial={false}>
        {value.map((chip) => (
          <motion.span
            key={chip}
            layout
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ type: 'spring', stiffness: 500, damping: 34 }}
            className="inline-flex h-7 items-center gap-1 rounded-lg bg-accent-soft pl-2.5 pr-1 text-[12.5px] font-medium text-accent"
          >
            {chip}
            {/* span (não button): dentro de <label>, um botão seria acionado ao clicar no rótulo */}
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.preventDefault();
                onChange(value.filter((v) => v !== chip));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onChange(value.filter((v) => v !== chip));
                }
              }}
              className="grid size-5 cursor-pointer place-items-center rounded-md transition hover:bg-accent/15"
              aria-label={`Remover ${chip}`}
            >
              <X className="size-3" />
            </span>
          </motion.span>
        ))}
      </AnimatePresence>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() && commit(draft)}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (/[,;\n]/.test(text)) {
            e.preventDefault();
            commit(text);
          }
        }}
        placeholder={value.length ? '' : placeholder}
        className="h-7 min-w-[120px] flex-1 bg-transparent px-1 text-sm text-fg placeholder:text-fg-3 focus:outline-none"
      />
    </div>
  );
}
