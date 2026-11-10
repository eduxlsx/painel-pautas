import { cn } from '@/lib/utils';

/** Marca PautaFlow: gota de vidro com ondas de fluxo. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn('size-9', className)} aria-hidden>
      <defs>
        <linearGradient id="pf-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--pf-accent)" />
          <stop offset="1" stopColor="var(--pf-accent-2)" />
        </linearGradient>
        <linearGradient id="pf-shine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" />
          <stop offset=".45" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="38" height="38" rx="12" fill="url(#pf-g)" />
      <rect x="1" y="1" width="38" height="38" rx="12" fill="url(#pf-shine)" />
      <path d="M10 25.5c4-6.5 8 2.5 12-4s7-5 8-5" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M10 18c4-6.5 8 2.5 12-4" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      {!collapsed && (
        <div className="leading-none">
          <div className="text-[15px] font-semibold tracking-[-0.02em] text-fg">PautaFlow</div>
          <div className="mt-0.5 text-[10.5px] font-medium uppercase tracking-[0.18em] text-gradient">Intelligence</div>
        </div>
      )}
    </div>
  );
}
