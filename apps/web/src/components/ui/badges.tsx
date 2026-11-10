import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { CalendarClock, Flame, Mail, KanbanSquare, CalendarDays, Hand, Sparkles, Bot } from 'lucide-react';
import { PRIORITY_LABEL, SOURCE_LABEL, STATUS_LABEL, type PautaStatus, type PriorityLevel, type SourceKind } from '@pautaflow/shared';
import { cn, dueLabel, initials } from '@/lib/utils';
import { Tip } from './primitives';

const TONES = {
  neutral: 'bg-sunken text-fg-2 ring-line',
  accent: 'bg-accent-soft text-accent ring-accent/20',
  critical: 'bg-critical/12 text-critical ring-critical/25',
  high: 'bg-high/12 text-high ring-high/25',
  medium: 'bg-medium/12 text-medium ring-medium/25 dark:text-indigo-300',
  low: 'bg-low/12 text-low ring-low/25 dark:text-slate-300',
  success: 'bg-success/12 text-success ring-success/25',
  warning: 'bg-warning/14 text-amber-600 ring-warning/30 dark:text-amber-300',
  info: 'bg-sky-500/12 text-sky-600 ring-sky-500/25 dark:text-sky-300',
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = 'neutral', children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11.5px] font-medium ring-1 ring-inset [&_svg]:size-3', TONES[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export const PRIORITY_TONE: Record<PriorityLevel, Tone> = { critical: 'critical', high: 'high', medium: 'medium', low: 'low' };
export const PRIORITY_HEX: Record<PriorityLevel, string> = { critical: '#ef4444', high: '#f97316', medium: '#6366f1', low: '#64748b' };

export function PriorityBadge({ level, className }: { level: PriorityLevel; className?: string }) {
  return (
    <Badge tone={PRIORITY_TONE[level]} className={className} icon={level === 'critical' ? <Flame /> : <span className="size-1.5 rounded-full bg-current" />}>
      {PRIORITY_LABEL[level]}
    </Badge>
  );
}

const STATUS_TONE: Record<PautaStatus, Tone> = { backlog: 'neutral', todo: 'info', in_progress: 'accent', waiting: 'warning', review: 'medium', done: 'success', cancelled: 'neutral' };
export const STATUS_HEX: Record<PautaStatus, string> = { backlog: '#94a3b8', todo: '#0ea5e9', in_progress: '#6366f1', waiting: '#f59e0b', review: '#a855f7', done: '#10b981', cancelled: '#64748b' };

export function StatusBadge({ status }: { status: PautaStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

const SOURCE_ICON: Record<SourceKind, ReactNode> = {
  manual: <Hand />,
  outlook: <Mail />,
  planner: <KanbanSquare />,
  calendar: <CalendarDays />,
  radar: <Sparkles />,
  assistant: <Bot />,
};
export function SourceBadge({ source }: { source: SourceKind }) {
  return (
    <Badge tone={source === 'outlook' ? 'info' : source === 'planner' ? 'success' : 'neutral'} icon={SOURCE_ICON[source]}>
      {SOURCE_LABEL[source]}
    </Badge>
  );
}

export function DueChip({ due, done, className }: { due: string | null | undefined; done?: boolean; className?: string }) {
  const { text, tone } = dueLabel(due, done);
  const map = { overdue: 'critical', today: 'high', soon: 'warning', later: 'neutral', none: 'neutral', done: 'success' } as const;
  return (
    <Badge tone={map[tone]} icon={<CalendarClock />} className={cn('capitalize', tone === 'none' && 'opacity-70', className)}>
      {text}
    </Badge>
  );
}

/** Anel do score de prioridade (0–100). */
export function ScoreRing({ score, level, size = 40, factors }: { score: number; level: PriorityLevel; size?: number; factors?: ReactNode }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const ring = (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--pf-line-strong)" strokeWidth={4} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={PRIORITY_HEX[level]}
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c - (c * Math.max(0, Math.min(100, score))) / 100 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <span className="tabular absolute text-[11px] font-semibold text-fg" style={{ fontSize: size < 36 ? 10 : 12 }}>
        {score}
      </span>
    </div>
  );
  return factors ? <Tip content={factors}>{ring}</Tip> : ring;
}

export function Avatar({ name, className }: { name: string | null | undefined; className?: string }) {
  const hue = [...(name ?? '?')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
  return (
    <span
      title={name ?? undefined}
      className={cn('grid size-7 shrink-0 place-items-center rounded-full text-[10.5px] font-semibold text-white ring-2 ring-[var(--pf-surface-strong)]', className)}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 58%), hsl(${(hue + 40) % 360} 70% 48%))` }}
    >
      {initials(name)}
    </span>
  );
}

export function Progress({ value, className, color }: { value: number; className?: string; color?: string }) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-line', className)}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: color ?? 'linear-gradient(90deg, var(--pf-accent), var(--pf-accent-2))' }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}
