import { useState, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { AnimatePresence, motion } from 'motion/react';
import { X, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToasts } from '@/stores/toast';
import { Button } from './button';

const spring = { type: 'spring', stiffness: 420, damping: 34 } as const;

/* ------------------------------------------------------------------ */
/* Dialog (modal central)                                              */
/* ------------------------------------------------------------------ */

export function Dialog({ open, onOpenChange, title, description, children, footer, className, wide }: { open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string; wide?: boolean }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-50 bg-slate-950/25 backdrop-blur-[6px] dark:bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className={cn('glass glass-strong fixed inset-x-0 top-[7vh] z-50 mx-auto flex max-h-[86vh] w-[calc(100vw-32px)] flex-col !rounded-[26px]', wide ? 'max-w-3xl' : 'max-w-lg', className)}
                initial={{ opacity: 0, scale: 0.95, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 6 }}
                transition={spring}
              >
                <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-5">
                  <div>
                    <DialogPrimitive.Title className="text-lg font-semibold tracking-[-0.02em] text-fg">{title}</DialogPrimitive.Title>
                    {description && <DialogPrimitive.Description className="mt-0.5 text-sm text-fg-2">{description}</DialogPrimitive.Description>}
                  </div>
                  <DialogPrimitive.Close asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Fechar">
                      <X />
                    </Button>
                  </DialogPrimitive.Close>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">{children}</div>
                {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

/* ------------------------------------------------------------------ */
/* Sheet (painel lateral flutuante)                                    */
/* ------------------------------------------------------------------ */

export function Sheet({ open, onOpenChange, children, title, width = 560 }: { open: boolean; onOpenChange: (o: boolean) => void; children: ReactNode; title: string; width?: number }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-40 bg-slate-950/15 backdrop-blur-[2px] dark:bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount aria-describedby={undefined}>
              <motion.aside
                className="glass glass-strong fixed bottom-3 right-3 top-3 z-40 flex flex-col overflow-hidden !rounded-[26px]"
                style={{ width: `min(${width}px, calc(100vw - 24px))` }}
                initial={{ x: '105%' }}
                animate={{ x: 0 }}
                exit={{ x: '105%' }}
                transition={{ type: 'spring', stiffness: 360, damping: 38 }}
              >
                <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
                {children}
              </motion.aside>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

/* ------------------------------------------------------------------ */
/* Confirmação                                                         */
/* ------------------------------------------------------------------ */

export function useConfirm() {
  const [state, setState] = useState<{ title: string; body: ReactNode; confirm: string; danger?: boolean; resolve: (v: boolean) => void } | null>(null);
  const confirm = (opts: { title: string; body: ReactNode; confirm?: string; danger?: boolean }) =>
    new Promise<boolean>((resolve) => setState({ ...opts, confirm: opts.confirm ?? 'Confirmar', resolve }));
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  const element = (
    <Dialog
      open={!!state}
      onOpenChange={(o) => !o && close(false)}
      title={state?.title ?? ''}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancelar
          </Button>
          <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
            {state?.confirm}
          </Button>
        </>
      }
    >
      <div className="pb-2 text-sm leading-relaxed text-fg-2">{state?.body}</div>
    </Dialog>
  );
  return { confirm, element };
}

/* ------------------------------------------------------------------ */
/* Menu suspenso e popover                                             */
/* ------------------------------------------------------------------ */

export const Menu = DropdownPrimitive.Root;
export const MenuTrigger = DropdownPrimitive.Trigger;
export function MenuContent({ children, align = 'end' }: { children: ReactNode; align?: 'start' | 'end' | 'center' }) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content align={align} sideOffset={6} className="glass glass-strong z-[70] min-w-[200px] !rounded-2xl p-1.5">
        {children}
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  );
}
export function MenuItem({ children, onSelect, danger, icon }: { children: ReactNode; onSelect?: () => void; danger?: boolean; icon?: ReactNode }) {
  return (
    <DropdownPrimitive.Item
      onSelect={onSelect}
      className={cn('flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] outline-none data-[highlighted]:bg-sunken [&_svg]:size-4', danger ? 'text-critical' : 'text-fg')}
    >
      {icon && <span className="text-fg-3">{icon}</span>}
      {children}
    </DropdownPrimitive.Item>
  );
}
export const MenuSeparator = () => <DropdownPrimitive.Separator className="my-1 h-px bg-line" />;

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export function PopoverContent({ children, className, align = 'end' }: { children: ReactNode; className?: string; align?: 'start' | 'end' | 'center' }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content align={align} sideOffset={8} className={cn('glass glass-strong z-[70] !rounded-2xl p-3 outline-none', className)}>
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

/* ------------------------------------------------------------------ */
/* Toaster                                                             */
/* ------------------------------------------------------------------ */

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[90] flex -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={spring}
            className="glass glass-strong pointer-events-auto flex max-w-[min(520px,calc(100vw-32px))] items-center gap-3 !rounded-2xl py-2.5 pl-3.5 pr-2 text-sm text-fg"
          >
            {t.tone === 'success' ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : t.tone === 'error' ? <AlertTriangle className="size-4 shrink-0 text-critical" /> : <Info className="size-4 shrink-0 text-accent" />}
            <span className="min-w-0 flex-1">{t.text}</span>
            {t.action && (
              <Button size="sm" variant="subtle" onClick={() => { t.action!.onClick(); dismiss(t.id); }}>
                {t.action.label}
              </Button>
            )}
            <Button size="icon-sm" variant="ghost" onClick={() => dismiss(t.id)} aria-label="Fechar">
              <X />
            </Button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
