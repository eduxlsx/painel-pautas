import { useEffect, useRef, useState, type ReactNode } from 'react';
import { animate, motion, useInView, useReducedMotion } from 'motion/react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Paleta e eixos                                                      */
/* ------------------------------------------------------------------ */

/** Cores de série (fallback quando o dado não traz cor própria). */
export const SERIES_COLORS = ['var(--pf-accent)', 'var(--pf-accent-2)', '#f472b6', '#f59e0b', '#10b981', '#a855f7', '#64748b', '#0ea5e9'];
export const seriesColor = (i: number, own?: string | null) => own || SERIES_COLORS[i % SERIES_COLORS.length]!;

/** Props comuns de eixos discretos (sem linhas pesadas). */
export const AXIS = {
  tick: { fill: 'var(--pf-fg-3)', fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;
export const GRID = { stroke: 'var(--pf-line)', strokeDasharray: '3 6', vertical: false } as const;
export const CURSOR = { stroke: 'var(--pf-line-strong)', strokeWidth: 1 } as const;
export const BAR_CURSOR = { fill: 'var(--pf-surface-sunken)', radius: 8 } as const;

/** Definição de gradiente vertical para áreas. */
export function AreaGradient({ id, color }: { id: string; color: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={0.38} />
      <stop offset="95%" stopColor={color} stopOpacity={0} />
    </linearGradient>
  );
}

/* ------------------------------------------------------------------ */
/* Tooltip de vidro                                                    */
/* ------------------------------------------------------------------ */

interface TipEntry {
  name?: unknown;
  value?: unknown;
  color?: string;
  fill?: string;
  stroke?: string;
  dataKey?: unknown;
  payload?: unknown;
}

export interface GlassTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<TipEntry>;
  label?: unknown;
  /** Formata o rótulo (eixo X) exibido no topo. */
  labelFormat?: (label: string, payload: unknown) => ReactNode;
  /** Formata o valor de cada série. */
  valueFormat?: (value: number, name: string) => ReactNode;
  /** Nomes amigáveis por dataKey. */
  names?: Record<string, string>;
}

export function GlassTooltip({ active, payload, label, labelFormat, valueFormat, names }: GlassTooltipProps) {
  if (!active || !payload?.length) return null;
  const first = payload[0]?.payload;
  const head = labelFormat ? labelFormat(String(label ?? ''), first) : label !== undefined && label !== '' ? String(label) : null;
  return (
    <div className="glass glass-strong !rounded-xl px-3 py-2 text-xs text-fg">
      {head && <div className="mb-1 font-medium text-fg">{head}</div>}
      <div className="space-y-0.5">
        {payload.map((p, i) => {
          const key = String(p.dataKey ?? p.name ?? i);
          const name = names?.[key] ?? String(p.name ?? key);
          const raw = typeof p.value === 'number' ? p.value : Number(p.value ?? 0);
          const own = (p.payload as { color?: string } | undefined)?.color;
          const color = own ?? p.color ?? p.stroke ?? p.fill ?? 'var(--pf-accent)';
          return (
            <div key={key + i} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-fg-2">
                <span className="size-2 rounded-full" style={{ background: color }} />
                {name}
              </span>
              <span className="tabular font-semibold">{valueFormat ? valueFormat(raw, key) : raw.toLocaleString('pt-BR')}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Contêiner com revelação animada                                     */
/* ------------------------------------------------------------------ */

export function ChartBox({ height = 220, children, className, empty, emptyText = 'Sem dados no período.' }: { height?: number; children?: ReactNode; className?: string; empty?: boolean; emptyText?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const reduce = useReducedMotion();
  return (
    <motion.div
      ref={ref}
      className={cn('relative w-full', className)}
      style={{ height }}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
    >
      {empty ? (
        <div className="grid h-full place-items-center rounded-2xl bg-sunken/60 px-6 text-center text-sm text-fg-3 ring-1 ring-line ring-inset">{emptyText}</div>
      ) : inView ? (
        <ResponsiveContainer width="100%" height="100%">
          {children as React.ReactElement}
        </ResponsiveContainer>
      ) : null}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Donut com rótulo central                                            */
/* ------------------------------------------------------------------ */

export interface DonutDatum {
  key?: string;
  label: string;
  value: number;
  color?: string;
}

export function Donut({ data, height = 220, centerLabel = 'total', legend = true, onSelect }: { data: DonutDatum[]; height?: number; centerLabel?: string; legend?: boolean; onSelect?: (d: DonutDatum) => void }) {
  const items = data.filter((d) => d.value > 0).map((d, i) => ({ ...d, color: seriesColor(i, d.color) }));
  const total = items.reduce((s, d) => s + d.value, 0);
  const [hover, setHover] = useState<number | null>(null);
  const active = hover !== null ? items[hover] : undefined;
  if (!total) return <ChartBox height={height} empty emptyText="Nenhuma pauta para distribuir por categoria." />;
  return (
    <div className={cn('flex flex-col gap-4', legend && 'sm:flex-row sm:items-center')}>
      <div className="relative shrink-0 sm:w-[55%]" style={{ height }}>
        <ChartBox height={height} empty={!total}>
          <PieChart>
            <Tooltip content={<GlassTooltip />} />
            <Pie
              data={items}
              dataKey="value"
              nameKey="label"
              innerRadius="64%"
              outerRadius="92%"
              paddingAngle={items.length > 1 ? 2.5 : 0}
              cornerRadius={6}
              stroke="none"
              onMouseEnter={(_, i) => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={(_, i) => {
                const d = items[i];
                if (d && onSelect) onSelect(d);
              }}
              animationDuration={900}
            >
              {items.map((d, i) => (
                <Cell key={d.key ?? d.label} fill={d.color} opacity={hover === null || hover === i ? 1 : 0.45} style={{ cursor: onSelect ? 'pointer' : 'default', outline: 'none' }} />
              ))}
            </Pie>
          </PieChart>
        </ChartBox>
        {total > 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="text-center">
              <div className="tabular text-[26px] font-semibold leading-none tracking-[-0.03em] text-fg">
                <CountUp value={active ? active.value : total} />
              </div>
              <div className="mt-1 max-w-[110px] truncate text-[11px] text-fg-3">{active ? active.label : centerLabel}</div>
            </div>
          </div>
        )}
      </div>
      {legend && total > 0 && (
        <ul className="min-w-0 flex-1 space-y-1.5">
          {items.slice(0, 7).map((d, i) => (
            <li key={d.key ?? d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className={cn('flex items-center gap-2 rounded-lg px-1.5 py-0.5 text-[12.5px] transition-opacity', hover !== null && hover !== i && 'opacity-50')}>
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
              <span className="min-w-0 flex-1 truncate text-fg-2">{d.label}</span>
              <span className="tabular font-medium text-fg">{d.value}</span>
              <span className="tabular w-9 text-right text-[11px] text-fg-3">{Math.round((d.value / total) * 100)}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Contagem animada                                                    */
/* ------------------------------------------------------------------ */

export function CountUp({ value, decimals = 0, duration = 1.1 }: { value: number; decimals?: number; duration?: number }) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(reduce ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reduce) {
      setDisplay(value);
      from.current = value;
      return;
    }
    const controls = animate(from.current, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(v),
    });
    from.current = value;
    return () => controls.stop();
  }, [value, duration, reduce]);
  return <>{display.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}</>;
}

/** Legenda simples em linha. */
export function InlineLegend({ items, className }: { items: { label: string; color: string; dashed?: boolean }[]; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-fg-3', className)}>
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className={cn('h-1.5 w-3 rounded-full', i.dashed && 'opacity-60')} style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}
