import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

/** Posições fixas (pseudoaleatórias) para os "blips" de sugestões pendentes. */
const BLIPS = [
  { x: 68, y: 30 },
  { x: 30, y: 62 },
  { x: 74, y: 70 },
  { x: 42, y: 24 },
  { x: 58, y: 52 },
  { x: 24, y: 40 },
];

/** Radar com varredura cônica sutil; estático quando o usuário prefere menos movimento. */
export function RadarVisual({ size = 132, blips = 0, active = true, className }: { size?: number; blips?: number; active?: boolean; className?: string }) {
  const reduce = useReducedMotion();
  const spin = active && !reduce;
  return (
    <div className={cn('relative shrink-0 overflow-hidden rounded-full', className)} style={{ width: size, height: size }} aria-hidden>
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--pf-accent)_14%,transparent)_0%,transparent_72%)] ring-1 ring-inset ring-accent/25" />
      {[0.33, 0.66].map((s) => (
        <div key={s} className="absolute rounded-full ring-1 ring-inset ring-accent/20" style={{ inset: `${(size * (1 - s)) / 2}px` }} />
      ))}
      <div className="absolute inset-x-0 top-1/2 h-px bg-accent/15" />
      <div className="absolute inset-y-0 left-1/2 w-px bg-accent/15" />
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{ background: 'conic-gradient(from 0deg, transparent 0deg, transparent 280deg, color-mix(in srgb, var(--pf-accent-2) 10%, transparent) 320deg, color-mix(in srgb, var(--pf-accent) 55%, transparent) 360deg)' }}
        animate={spin ? { rotate: 360 } : { rotate: 45 }}
        transition={spin ? { repeat: Infinity, duration: 4.5, ease: 'linear' } : { duration: 0 }}
      />
      {BLIPS.slice(0, Math.min(blips, BLIPS.length)).map((b, i) => (
        <motion.span
          key={i}
          className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-2 shadow-[0_0_10px_var(--pf-accent-2)]"
          style={{ left: `${b.x}%`, top: `${b.y}%` }}
          initial={{ opacity: 0, scale: 0 }}
          animate={spin ? { opacity: [0.35, 1, 0.35], scale: [0.85, 1.15, 0.85] } : { opacity: 0.9, scale: 1 }}
          transition={spin ? { repeat: Infinity, duration: 2.4, delay: i * 0.4 } : { duration: 0.3 }}
        />
      ))}
      <div className="absolute left-1/2 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_12px_var(--pf-accent)]" />
    </div>
  );
}
