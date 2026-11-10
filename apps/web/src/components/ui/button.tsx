import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium transition-all duration-200 ease-[var(--ease-fluid)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-flow text-white shadow-[0_1px_0_0_rgba(255,255,255,0.35)_inset,0_8px_20px_-8px_color-mix(in_srgb,var(--pf-accent)_70%,transparent)] hover:brightness-110 hover:shadow-[0_1px_0_0_rgba(255,255,255,0.35)_inset,0_12px_28px_-8px_color-mix(in_srgb,var(--pf-accent)_80%,transparent)]',
        secondary: 'bg-surface-strong text-fg shadow-[var(--pf-shadow)] backdrop-blur-xl hover:bg-surface-solid',
        ghost: 'text-fg-2 hover:bg-sunken hover:text-fg',
        subtle: 'bg-accent-soft text-accent hover:brightness-110',
        danger: 'bg-critical/90 text-white hover:bg-critical shadow-[0_8px_20px_-10px_rgba(239,68,68,0.8)]',
        outline: 'text-fg ring-1 ring-line-strong hover:bg-sunken',
      },
      size: {
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-[15px]',
        icon: 'size-9',
        'icon-sm': 'size-7 rounded-lg [&_svg]:size-3.5',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, loading, children, disabled, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
    {loading && <Loader2 className="animate-spin" />}
    {children}
  </button>
));
Button.displayName = 'Button';
