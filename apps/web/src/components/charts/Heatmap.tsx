import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

const LEVEL_MIX = [0, 22, 42, 66, 92];
const WEEKDAYS = ['Seg', '', 'Qua', '', 'Sex', '', ''];

function levelColor(level: number): string {
  if (level === 0) return 'var(--pf-surface-sunken)';
  return `color-mix(in srgb, var(--pf-accent) ${LEVEL_MIX[level]}%, transparent)`;
}

/** Mapa de calor estilo GitHub: colunas = semanas (segunda a domingo), células = dias. */
export function Heatmap({ data }: { data: { date: string; count: number }[] }) {
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<{ date: string; count: number } | null>(null);

  const { weeks, max, total, months } = useMemo(() => {
    const weeks: ({ date: string; count: number } | null)[][] = [];
    for (let i = 0; i < data.length; i += 7) {
      const w = data.slice(i, i + 7) as ({ date: string; count: number } | null)[];
      while (w.length < 7) w.push(null);
      weeks.push(w);
    }
    const max = Math.max(0, ...data.map((d) => d.count));
    const total = data.reduce((s, d) => s + d.count, 0);
    const months: { index: number; label: string }[] = [];
    let last = '';
    weeks.forEach((w, i) => {
      const first = w[0];
      if (!first) return;
      const m = first.date.slice(0, 7);
      if (m !== last) {
        if (i === 0 || months.length === 0 || i - (months.at(-1)?.index ?? 0) >= 3) months.push({ index: i, label: format(parseISO(first.date), 'MMM', { locale: ptBR }) });
        last = m;
      }
    });
    return { weeks, max, total, months };
  }, [data]);

  const level = (c: number) => (c <= 0 || max === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((c / max) * 4))));
  const today = format(new Date(), 'yyyy-MM-dd');

  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <div className="inline-flex min-w-full flex-col gap-1.5">
          <div className="relative ml-8 h-4 text-[10.5px] text-fg-3">
            {months.map((m) => (
              <span key={m.index} className="absolute" style={{ left: m.index * 16 }}>
                {m.label.replace('.', '').replace(/^./, (c) => c.toUpperCase())}
              </span>
            ))}
          </div>
          <div className="flex gap-1">
            <div className="flex w-7 flex-col gap-1 text-[10px] text-fg-3">
              {WEEKDAYS.map((d, i) => (
                <span key={i} className="h-3 leading-3">
                  {d}
                </span>
              ))}
            </div>
            {weeks.map((w, wi) => (
              <div key={wi} className="flex flex-col gap-1">
                {w.map((d, di) =>
                  d ? (
                    <motion.button
                      type="button"
                      key={d.date}
                      initial={reduce ? false : { opacity: 0, scale: 0.4 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: reduce ? 0 : wi * 0.012 + di * 0.004, duration: 0.25 }}
                      onMouseEnter={() => setHover(d)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(d)}
                      onBlur={() => setHover(null)}
                      aria-label={`${format(parseISO(d.date), "d 'de' MMMM", { locale: ptBR })}: ${d.count} atividade(s)`}
                      title={`${format(parseISO(d.date), "EEE, d 'de' MMM", { locale: ptBR })} · ${d.count} atividade(s)`}
                      className={cn('size-3 rounded-[4px] ring-1 ring-inset ring-line transition-transform hover:scale-125', d.date === today && 'ring-2 ring-accent')}
                      style={{ background: levelColor(level(d.count)) }}
                    />
                  ) : (
                    <span key={`e${di}`} className="size-3" />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-fg-3">
        <span className="tabular min-h-4">
          {hover ? (
            <>
              <span className="font-medium text-fg">{format(parseISO(hover.date), "EEEE, d 'de' MMMM", { locale: ptBR }).replace(/^./, (c) => c.toUpperCase())}</span> · {hover.count} {hover.count === 1 ? 'atividade' : 'atividades'}
            </>
          ) : (
            `${total.toLocaleString('pt-BR')} ${total === 1 ? 'atividade registrada' : 'atividades registradas'} nas últimas 26 semanas`
          )}
        </span>
        <span className="flex items-center gap-1">
          Menos
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className="size-3 rounded-[4px] ring-1 ring-inset ring-line" style={{ background: levelColor(l) }} />
          ))}
          Mais
        </span>
      </div>
    </div>
  );
}
