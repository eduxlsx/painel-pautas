import { forwardRef, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { motion } from 'motion/react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Cartões de vidro                                                    */
/* ------------------------------------------------------------------ */

export const GlassCard = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { interactive?: boolean; strong?: boolean; padded?: boolean }>(
  ({ className, interactive, strong, padded = true, ...props }, ref) => (
    <div ref={ref} className={cn('glass', strong && 'glass-strong', interactive && 'glass-hover cursor-pointer', padded && 'p-5', className)} {...props} />
  ),
);
GlassCard.displayName = 'GlassCard';

export function CardHeader({ title, subtitle, icon, action, className }: { title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent [&_svg]:size-4">{icon}</div>}
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-fg">{title}</h3>
          {subtitle && <p className="truncate text-xs text-fg-3">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-fg-3">{eyebrow}</div>}
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-fg">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-fg-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Formulários                                                         */
/* ------------------------------------------------------------------ */

const fieldBase =
  'w-full rounded-xl bg-sunken px-3 text-sm text-fg ring-1 ring-line placeholder:text-fg-3 transition focus:bg-surface-strong focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldBase, 'h-10', className)} {...props} />
));
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, 'min-h-[88px] resize-y py-2.5 leading-relaxed', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export const NativeSelect = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn(fieldBase, 'h-10 cursor-pointer appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-8', className)} style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a96a8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")` }} {...props}>
    {children}
  </select>
));
NativeSelect.displayName = 'NativeSelect';

export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="text-xs font-medium text-fg-2">{label}</span>
      {children}
      {error ? <span className="block text-xs text-critical">{error}</span> : hint ? <span className="block text-xs text-fg-3">{hint}</span> : null}
    </label>
  );
}

export function Switch({ checked, onCheckedChange, disabled, label }: { checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="relative h-6 w-10 shrink-0 cursor-pointer rounded-full bg-line-strong transition-colors duration-300 data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      <SwitchPrimitive.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.25)] transition-transform duration-300 ease-[var(--ease-fluid)] data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );
}

/* ------------------------------------------------------------------ */
/* Controle segmentado com indicador animado                           */
/* ------------------------------------------------------------------ */

export function Segmented<T extends string>({ value, onChange, options, id, size = 'md', className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; icon?: ReactNode }[]; id: string; size?: 'sm' | 'md'; className?: string }) {
  return (
    <div role="tablist" className={cn('inline-flex items-center gap-0.5 rounded-xl bg-sunken p-1 ring-1 ring-line', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn('relative flex items-center gap-1.5 rounded-lg font-medium transition-colors [&_svg]:size-3.5', size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]', active ? 'text-fg' : 'text-fg-3 hover:text-fg-2')}
          >
            {active && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-lg bg-surface-strong shadow-[var(--pf-shadow)]" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
            <span className="relative z-10 flex items-center gap-1.5">
              {o.icon}
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tooltip                                                             */
/* ------------------------------------------------------------------ */

export function Tip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  if (!content) return <>{children}</>;
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={8} className="glass glass-strong z-[80] max-w-xs !rounded-xl px-3 py-2 text-xs leading-relaxed text-fg data-[state=delayed-open]:animate-[fadeIn_.15s]">
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* ------------------------------------------------------------------ */
/* Estados                                                             */
/* ------------------------------------------------------------------ */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('pf-skeleton', className)} />;
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {icon && <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent [&_svg]:size-6">{icon}</div>}
      <p className="text-[15px] font-semibold text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-fg-3">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md bg-sunken px-1.5 py-0.5 font-sans text-[11px] font-medium text-fg-3 ring-1 ring-line">{children}</kbd>;
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px bg-line', className)} />;
}
