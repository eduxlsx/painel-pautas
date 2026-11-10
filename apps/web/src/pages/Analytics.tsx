import { useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react';
import { addDays, format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  ChevronDown,
  CircleAlert,
  Clock,
  FileJson,
  FileSpreadsheet,
  Filter,
  FolderKanban,
  Grid3x3,
  Info,
  Layers,
  LineChart as LineIcon,
  Minus,
  PieChart as PieIcon,
  Printer,
  RefreshCw,
  ScrollText,
  Share2,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import type { AnalyticsResponse, ChartDatum, MetricValue, Resumo } from '@pautaflow/shared';
import { cn, download, fmtDate, fmtDateTime, toDateKey } from '@/lib/utils';
import { post, useAnalytics, useApiMutation, useResumos } from '@/lib/queries';
import { useUi } from '@/stores/ui';
import { Button, CardHeader, DateInput, EmptyState, GlassCard, Input, PageHeader, Segmented, Skeleton, STATUS_HEX, Tip } from '@/components/ui';
import { AreaGradient, AXIS, BAR_CURSOR, ChartBox, CountUp, CURSOR, Donut, GlassTooltip, GRID, InlineLegend, seriesColor } from '@/components/charts/kit';
import { Heatmap } from '@/components/charts/Heatmap';

type Period = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom';
type ResumoType = 'daily' | 'weekly' | 'monthly';

const container: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.045 } } };
const item: Variants = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } } };

/** Métricas em que "subir" é ruim. */
const LOWER_IS_BETTER = new Set(['overdue', 'leadTime', 'sugIgnored', 'backlogDays']);

const dayTick = (d: string) => format(parseISO(d), 'dd/MM', { locale: ptBR });
const monthTick = (d: string) => format(parseISO(`${d}-01`), 'MMM yy', { locale: ptBR }).replace('.', '');
const hasValues = (d: ChartDatum[]) => d.some((x) => x.value > 0);

export default function Analytics() {
  const [period, setPeriod] = useState<Period>('month');
  const [from, setFrom] = useState(() => toDateKey(addDays(new Date(), -30)));
  const [to, setTo] = useState(() => toDateKey(new Date()));
  const custom = period === 'custom';
  const validCustom = custom && from && to && from <= to;
  const { data, isLoading, isError, refetch, isFetching } = useAnalytics(period, validCustom ? from : undefined, validCustom ? to : undefined);
  const reduce = useReducedMotion();

  const qs = useMemo(() => {
    const p = new URLSearchParams({ period });
    if (validCustom) {
      p.set('from', from);
      p.set('to', to);
    }
    return p.toString();
  }, [period, from, to, validCustom]);

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow="Intelligence Analytics"
        title="Indicadores e tendências"
        subtitle={data ? `${data.period.label} · ${fmtDate(data.period.from)} a ${fmtDate(data.period.to)}` : 'Produtividade observada a partir das suas pautas'}
        actions={
          <div className="pf-no-print flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => download(`/api/analytics/export?format=json&${qs}`)}>
              <FileJson /> JSON
            </Button>
            <Button size="sm" variant="secondary" onClick={() => download(`/api/analytics/export?format=csv&dataset=pautas&${qs}`)}>
              <FileSpreadsheet /> CSV de pautas
            </Button>
            <Button size="sm" variant="secondary" onClick={() => download(`/api/analytics/export?format=csv&dataset=metrics&${qs}`)}>
              <FileSpreadsheet /> CSV de indicadores
            </Button>
            <Button size="sm" variant="primary" onClick={() => window.print()}>
              <Printer /> PDF (imprimir)
            </Button>
          </div>
        }
      />

      <div className="pf-no-print mb-6 flex flex-wrap items-center gap-3">
        <Segmented
          id="analytics-period"
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'today', label: 'Hoje' },
            { value: 'week', label: 'Semana' },
            { value: 'month', label: 'Mês' },
            { value: 'quarter', label: 'Trimestre' },
            { value: 'year', label: 'Ano' },
            { value: 'custom', label: 'Personalizado', icon: <CalendarDays /> },
          ]}
        />
        <AnimatePresence initial={false}>
          {custom && (
            <motion.div key="custom" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className="flex items-center gap-2">
              <DateInput value={from} onValueChange={setFrom} className="w-[150px]" aria-label="Data inicial" />
              <span className="text-sm text-fg-3">até</span>
              <DateInput value={to} onValueChange={setTo} className="w-[150px]" aria-label="Data final" />
              {!validCustom && <span className="text-xs text-critical">Período inválido</span>}
            </motion.div>
          )}
        </AnimatePresence>
        {isFetching && !isLoading && <RefreshCw className="size-4 animate-spin text-fg-3" />}
      </div>

      {isLoading ? (
        <AnalyticsSkeleton />
      ) : isError || !data ? (
        <GlassCard>
          <EmptyState
            icon={<CircleAlert />}
            title="Não foi possível calcular os indicadores"
            description="O servidor local não respondeu. Tente novamente em instantes."
            action={
              <Button variant="primary" onClick={() => void refetch()}>
                <RefreshCw /> Tentar novamente
              </Button>
            }
          />
        </GlassCard>
      ) : (
        <motion.div key={qs} variants={container} initial={reduce ? false : 'hidden'} animate="show" className="space-y-6">
          {data.metrics.every((m) => !m.value) && (
            <motion.div variants={item} className="flex items-start gap-3 rounded-2xl bg-accent-soft/60 px-4 py-3 text-[13px] text-fg-2 ring-1 ring-inset ring-accent/20">
              <Info className="mt-0.5 size-4 shrink-0 text-accent" />
              Os indicadores são calculados apenas com dados reais: crie e conclua pautas, ou conecte o Microsoft 365 em Integrações para o radar trazer demandas. Nada aqui é simulado.
            </motion.div>
          )}
          <motion.div variants={container} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {data.metrics.map((m) => (
              <MetricCard key={m.key} metric={m} />
            ))}
          </motion.div>
          <ChartsGrid data={data} />
        </motion.div>
      )}

      <ReportsSection />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Métricas                                                            */
/* ------------------------------------------------------------------ */

function MetricCard({ metric: m }: { metric: MetricValue }) {
  const decimals = m.value !== null && m.value % 1 !== 0 ? 1 : 0;
  const hasPrev = m.previous !== undefined;
  const prev = m.previous ?? null;
  const delta = m.value !== null && prev !== null ? Math.round((m.value - prev) * 10) / 10 : null;
  const pct = delta !== null && prev ? Math.round((delta / prev) * 100) : null;
  const good = delta === null || delta === 0 ? null : delta > 0 !== LOWER_IS_BETTER.has(m.key);
  const estimated = m.kind === 'estimated';
  return (
    <motion.div variants={item} className={cn('glass flex flex-col justify-between p-4', estimated && 'bg-[repeating-linear-gradient(135deg,transparent_0_10px,var(--pf-surface-sunken)_10px_11px)]')}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12.5px] font-medium leading-snug text-fg-2">{m.label}</span>
        <Tip content={m.note ?? (estimated ? 'Valor estimado a partir do ritmo observado.' : 'Valor observado nos seus dados.')}>
          <span
            className={cn(
              'inline-flex h-5 shrink-0 cursor-help items-center gap-1 rounded-full px-1.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset',
              estimated ? 'bg-warning/12 text-amber-600 ring-warning/30 dark:text-amber-300' : 'bg-success/10 text-success ring-success/25',
            )}
          >
            {estimated ? 'Estimativa' : 'Observado'}
            {m.note && <Info className="size-2.5" />}
          </span>
        </Tip>
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="tabular text-[28px] font-semibold leading-none tracking-[-0.035em] text-fg">{m.value === null ? '—' : <CountUp value={m.value} decimals={decimals} />}</span>
        {m.unit && m.value !== null && <span className="text-[13px] font-medium text-fg-3">{m.unit}</span>}
      </div>
      <div className="mt-2 min-h-5 text-[11.5px]">
        {hasPrev &&
          (prev === null || m.value === null ? (
            <span className="text-fg-3">Sem base de comparação</span>
          ) : (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className={cn('tabular inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold', good === null ? 'bg-sunken text-fg-3' : good ? 'bg-success/12 text-success' : 'bg-critical/12 text-critical')}>
                {delta! > 0 ? <ArrowUpRight className="size-3" /> : delta! < 0 ? <ArrowDownRight className="size-3" /> : <Minus className="size-3" />}
                {delta! > 0 ? '+' : ''}
                {delta!.toLocaleString('pt-BR')}
                {pct !== null && ` (${pct > 0 ? '+' : ''}${pct}%)`}
              </span>
              <span className="tabular text-fg-3">
                vs. {prev.toLocaleString('pt-BR')}
                {m.unit ? ` ${m.unit}` : ''} antes
              </span>
            </span>
          ))}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Gráficos                                                            */
/* ------------------------------------------------------------------ */

function ChartCard({ icon, title, subtitle, action, children, className }: { icon: ReactNode; title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <motion.div variants={item} className={className}>
      <GlassCard className="h-full break-inside-avoid">
        <CardHeader icon={icon} title={title} subtitle={subtitle} action={action} />
        {children}
      </GlassCard>
    </motion.div>
  );
}

const CREATED_DONE = [
  { label: 'Criadas', color: 'var(--pf-accent)' },
  { label: 'Concluídas', color: 'var(--pf-accent-2)' },
];
const NAMES = { criadas: 'Criadas', concluidas: 'Concluídas', noPrazo: 'No prazo (%)', value: 'Quantidade' };

function ChartsGrid({ data }: { data: AnalyticsResponse }) {
  const { daily, weekly, monthly } = data.series;
  const sum = (arr: AnalyticsResponse['series']['daily'], k: string) => arr.reduce((s, p) => s + Number(p[k] ?? 0), 0);
  const dailyEmpty = sum(daily, 'criadas') + sum(daily, 'concluidas') === 0;
  const weeklyEmpty = sum(weekly, 'criadas') + sum(weekly, 'concluidas') === 0;
  const monthlyEmpty = sum(monthly, 'criadas') + sum(monthly, 'concluidas') === 0;
  const statusData = data.byStatus.map((d) => ({ ...d, color: STATUS_HEX[d.key as keyof typeof STATUS_HEX] ?? 'var(--pf-accent)' }));
  const originData = data.byOrigin.map((d, i) => ({ ...d, color: seriesColor(i, d.color) }));
  const avgData = data.avgTimeByCategory.map((d, i) => ({ ...d, color: seriesColor(i, d.color) })).sort((a, b) => b.value - a.value);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard icon={<LineIcon />} title="Ritmo diário" subtitle="Pautas criadas e concluídas por dia no período" action={<InlineLegend items={CREATED_DONE} />} className="lg:col-span-2">
        <ChartBox height={240} empty={dailyEmpty} emptyText="Nenhuma pauta criada ou concluída no período.">
          <LineChart data={daily} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="date" {...AXIS} tickFormatter={dayTick} minTickGap={24} />
            <YAxis {...AXIS} allowDecimals={false} />
            <Tooltip cursor={CURSOR} content={<GlassTooltip names={NAMES} labelFormat={(l) => fmtDate(l, "EEE, d 'de' MMM")} />} />
            <Line type="monotone" dataKey="criadas" stroke="var(--pf-accent)" strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} animationDuration={1000} />
            <Line type="monotone" dataKey="concluidas" stroke="var(--pf-accent-2)" strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} animationDuration={1200} />
          </LineChart>
        </ChartBox>
      </ChartCard>

      <ChartCard icon={<TrendingUp />} title="Evolução semanal" subtitle="Últimas 12 semanas" action={<InlineLegend items={CREATED_DONE} />}>
        <ChartBox height={230} empty={weeklyEmpty} emptyText="Sem movimentação nas últimas 12 semanas.">
          <AreaChart data={weekly} margin={{ top: 8, right: 6, left: -22, bottom: 0 }}>
            <defs>
              <AreaGradient id="an-criadas" color="var(--pf-accent)" />
              <AreaGradient id="an-concluidas" color="var(--pf-accent-2)" />
            </defs>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="date" {...AXIS} tickFormatter={dayTick} minTickGap={18} />
            <YAxis {...AXIS} allowDecimals={false} />
            <Tooltip cursor={CURSOR} content={<GlassTooltip names={NAMES} labelFormat={(l) => `Semana de ${dayTick(l)}`} />} />
            <Area type="monotone" dataKey="criadas" stroke="var(--pf-accent)" strokeWidth={2.2} fill="url(#an-criadas)" animationDuration={1000} />
            <Area type="monotone" dataKey="concluidas" stroke="var(--pf-accent-2)" strokeWidth={2.2} fill="url(#an-concluidas)" animationDuration={1200} />
          </AreaChart>
        </ChartBox>
      </ChartCard>

      <ChartCard
        icon={<BarChart3 />}
        title="Visão mensal"
        subtitle="Volume e % concluídas no prazo (12 meses)"
        action={<InlineLegend items={[...CREATED_DONE, { label: 'No prazo %', color: '#f59e0b' }]} />}
      >
        <ChartBox height={230} empty={monthlyEmpty} emptyText="Sem histórico mensal ainda.">
          <ComposedChart data={monthly} margin={{ top: 8, right: -8, left: -22, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="date" {...AXIS} tickFormatter={monthTick} minTickGap={8} />
            <YAxis yAxisId="n" {...AXIS} allowDecimals={false} />
            <YAxis yAxisId="p" orientation="right" {...AXIS} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip cursor={BAR_CURSOR} content={<GlassTooltip names={NAMES} labelFormat={(l) => format(parseISO(`${l}-01`), "MMMM 'de' yyyy", { locale: ptBR })} valueFormat={(v, k) => (k === 'noPrazo' ? `${v}%` : v)} />} />
            <Bar yAxisId="n" dataKey="criadas" fill="var(--pf-accent)" radius={[6, 6, 2, 2]} maxBarSize={16} animationDuration={900} />
            <Bar yAxisId="n" dataKey="concluidas" fill="var(--pf-accent-2)" radius={[6, 6, 2, 2]} maxBarSize={16} animationDuration={1100} />
            <Line yAxisId="p" type="monotone" dataKey="noPrazo" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2.5, fill: '#f59e0b' }} animationDuration={1300} />
          </ComposedChart>
        </ChartBox>
      </ChartCard>

      <ChartCard icon={<PieIcon />} title="Por categoria" subtitle="Pautas abertas ou movimentadas no período">
        <Donut data={data.byCategory} height={210} centerLabel="pautas" />
      </ChartCard>

      <ChartCard icon={<Share2 />} title="Por origem" subtitle="De onde vêm as demandas">
        <ChartBox height={230} empty={!hasValues(originData)} emptyText="Sem pautas no período.">
          <BarChart data={originData} margin={{ top: 8, right: 4, left: -22, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="label" {...AXIS} interval={0} />
            <YAxis {...AXIS} allowDecimals={false} />
            <Tooltip cursor={BAR_CURSOR} content={<GlassTooltip names={NAMES} />} />
            <Bar dataKey="value" name="Pautas" radius={[8, 8, 3, 3]} maxBarSize={48} animationDuration={900}>
              {originData.map((d) => (
                <Cell key={d.key ?? d.label} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ChartBox>
      </ChartCard>

      <ChartCard icon={<Layers />} title="Por status" subtitle="Todas as pautas registradas">
        <ChartBox height={230} empty={!hasValues(statusData)} emptyText="Nenhuma pauta registrada. Crie uma pauta para começar.">
          <BarChart data={statusData} margin={{ top: 8, right: 4, left: -22, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="label" {...AXIS} interval={0} tickFormatter={(v: string) => (v.length > 10 ? `${v.slice(0, 9)}…` : v)} />
            <YAxis {...AXIS} allowDecimals={false} />
            <Tooltip cursor={BAR_CURSOR} content={<GlassTooltip names={NAMES} />} />
            <Bar dataKey="value" name="Pautas" radius={[8, 8, 3, 3]} maxBarSize={44} animationDuration={900}>
              {statusData.map((d) => (
                <Cell key={d.key ?? d.label} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ChartBox>
      </ChartCard>

      <ChartCard icon={<Clock />} title="Tempo médio por categoria" subtitle="Dias entre criação e conclusão (concluídas no período)">
        <ChartBox height={Math.max(160, avgData.length * 38 + 20)} empty={!hasValues(avgData)} emptyText="Nenhuma pauta concluída no período.">
          <BarChart data={avgData} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid {...GRID} vertical horizontal={false} />
            <XAxis type="number" {...AXIS} tickFormatter={(v: number) => `${v}d`} />
            <YAxis type="category" dataKey="label" {...AXIS} width={110} tickFormatter={(v: string) => (v.length > 15 ? `${v.slice(0, 14)}…` : v)} />
            <Tooltip cursor={BAR_CURSOR} content={<GlassTooltip names={{ value: 'Dias em média' }} valueFormat={(v) => `${v.toLocaleString('pt-BR')} dias`} />} />
            <Bar dataKey="value" radius={[3, 8, 8, 3]} maxBarSize={20} animationDuration={900}>
              {avgData.map((d) => (
                <Cell key={d.key ?? d.label} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ChartBox>
      </ChartCard>

      <ChartCard icon={<FolderKanban />} title="Projetos mais ativos" subtitle="Atividade registrada no período">
        <TopProjects data={data.topProjects} />
      </ChartCard>

      <ChartCard icon={<Filter />} title="Funil de sugestões do radar" subtitle="Sugestões identificadas no período">
        <Funnel data={data.suggestionFunnel} />
      </ChartCard>

      <ChartCard icon={<Grid3x3 />} title="Mapa de produtividade" subtitle="Ações registradas por dia nas últimas 26 semanas" className="lg:col-span-2">
        <Heatmap data={data.heatmap} />
      </ChartCard>
    </div>
  );
}

function TopProjects({ data }: { data: ChartDatum[] }) {
  if (!hasValues(data))
    return <div className="grid h-40 place-items-center rounded-2xl bg-sunken/60 px-6 text-center text-sm text-fg-3 ring-1 ring-inset ring-line">Nenhuma atividade em projetos no período. Associe pautas a projetos para ver o ranking.</div>;
  const max = Math.max(...data.map((d) => d.value));
  return (
    <ol className="space-y-2.5">
      {data.map((d, i) => (
        <li key={d.key ?? d.label} className="flex items-center gap-3">
          <span className={cn('tabular grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold', i === 0 ? 'bg-flow text-white' : 'bg-sunken text-fg-2')}>{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center justify-between gap-2 text-[13px]">
              <span className="truncate font-medium text-fg">{d.label}</span>
              <span className="tabular text-fg-2">{d.value}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-line">
              <motion.div
                className="h-full rounded-full"
                style={{ background: d.color ?? 'linear-gradient(90deg,var(--pf-accent),var(--pf-accent-2))' }}
                initial={{ width: 0 }}
                whileInView={{ width: `${(d.value / max) * 100}%` }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

const FUNNEL_COLORS: Record<string, string> = { identified: 'var(--pf-accent)', approved: '#10b981', ignored: '#94a3b8', pending: '#f59e0b' };

function Funnel({ data }: { data: ChartDatum[] }) {
  const top = data.find((d) => d.key === 'identified')?.value ?? Math.max(0, ...data.map((d) => d.value));
  if (!top)
    return (
      <div className="grid h-40 place-items-center rounded-2xl bg-sunken/60 px-6 text-center text-sm text-fg-3 ring-1 ring-inset ring-line">
        O radar ainda não identificou sugestões no período. Conecte o Microsoft 365 em Integrações para analisar e-mails e tarefas do Planner.
      </div>
    );
  return (
    <div className="space-y-2.5">
      {data.map((d, i) => {
        const pct = Math.round((d.value / top) * 100);
        return (
          <div key={d.key ?? d.label}>
            <div className="mb-1 flex items-center justify-between text-[12.5px]">
              <span className="font-medium text-fg">{d.label}</span>
              <span className="tabular text-fg-2">
                {d.value} {i > 0 && <span className="text-fg-3">· {pct}%</span>}
              </span>
            </div>
            <div className="flex h-8 justify-center overflow-hidden rounded-xl bg-sunken">
              <motion.div
                className="h-full rounded-xl"
                style={{ background: FUNNEL_COLORS[d.key ?? ''] ?? seriesColor(i) }}
                initial={{ width: 0 }}
                whileInView={{ width: `${Math.max(d.value ? 4 : 0, pct)}%` }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Relatórios e resumos                                                */
/* ------------------------------------------------------------------ */

const TYPE_LABEL: Record<ResumoType, string> = { daily: 'Diário', weekly: 'Semanal', monthly: 'Mensal' };

function ReportsSection() {
  const [type, setType] = useState<ResumoType>('daily');
  const { data = [], isLoading } = useResumos(type);
  const [pending, setPending] = useState<ResumoType | null>(null);
  const gen = useApiMutation((t: ResumoType) => post<Resumo>('/api/resumos/generate', { type: t }), {
    invalidate: ['resumos', 'dashboard'],
    success: (r) => `Resumo ${TYPE_LABEL[r.type].toLowerCase()} gerado`,
  });
  const generate = (t: ResumoType) => {
    setPending(t);
    setType(t);
    gen.mutate(t, { onSettled: () => setPending(null) });
  };
  return (
    <section className="mt-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-fg">Relatórios e resumos</h2>
          <p className="text-sm text-fg-3">Resumos gerados automaticamente a partir das suas pautas</p>
        </div>
        <div className="pf-no-print flex flex-wrap items-center gap-2">
          {(Object.keys(TYPE_LABEL) as ResumoType[]).map((t) => (
            <Button key={t} size="sm" variant="secondary" loading={pending === t} disabled={!!pending && pending !== t} onClick={() => generate(t)}>
              {pending !== t && <Sparkles />} Gerar {TYPE_LABEL[t].toLowerCase()}
            </Button>
          ))}
        </div>
      </div>
      <GlassCard>
        <Segmented
          id="resumo-type"
          value={type}
          onChange={setType}
          className="pf-no-print mb-4"
          options={[
            { value: 'daily', label: 'Diários' },
            { value: 'weekly', label: 'Semanais' },
            { value: 'monthly', label: 'Mensais' },
          ]}
        />
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <EmptyState
            icon={<ScrollText />}
            title={`Nenhum resumo ${TYPE_LABEL[type].toLowerCase()} ainda`}
            description="Os resumos são gerados automaticamente nos horários configurados em Automações, ou agora mesmo pelo botão abaixo."
            action={
              <Button variant="primary" loading={pending === type} onClick={() => generate(type)}>
                {pending !== type && <Sparkles />} Gerar resumo {TYPE_LABEL[type].toLowerCase()}
              </Button>
            }
            className="py-8"
          />
        ) : (
          <ul className="divide-y divide-line">
            <AnimatePresence initial={false}>
              {data.map((r) => (
                <motion.li key={r.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <ResumoRow resumo={r} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </GlassCard>
    </section>
  );
}

function periodLabel(r: Resumo): string {
  const s = r.periodStart.length > 10 ? toDateKey(parseISO(r.periodStart)) : r.periodStart;
  const e = r.periodEnd.length > 10 ? toDateKey(parseISO(r.periodEnd)) : r.periodEnd;
  if (r.type === 'daily' || s === e) return fmtDate(s, "EEEE, d 'de' MMMM");
  if (r.type === 'monthly') return fmtDate(s, "MMMM 'de' yyyy");
  return `${fmtDate(s)} – ${fmtDate(e)}`;
}

function ResumoRow({ resumo: r }: { resumo: Resumo }) {
  const [open, setOpen] = useState(false);
  const { openPauta } = useUi();
  const total = r.sections.reduce((s, x) => s + x.items.length, 0);
  return (
    <div className="py-1">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 rounded-xl px-2 py-3 text-left transition-colors hover:bg-sunken/60" aria-expanded={open}>
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <ScrollText className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] font-medium text-fg-3">{periodLabel(r).replace(/^./, (c) => c.toUpperCase())}</div>
          <div className="mt-0.5 text-[14px] font-medium leading-snug text-fg">{r.headline}</div>
          <div className="mt-1 text-[11.5px] text-fg-3">
            {total} {total === 1 ? 'item' : 'itens'} em {r.sections.length} seções · gerado {fmtDateTime(r.generatedAt)} · {r.generatedBy === 'rules' ? 'Regras' : 'IA'}
          </div>
        </div>
        <ChevronDown className={cn('mt-2 size-4 shrink-0 text-fg-3 transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-4 px-2 pb-4 pl-14">
              {r.narrative && <p className="whitespace-pre-line rounded-2xl bg-sunken/60 px-4 py-3 text-[13.5px] leading-relaxed text-fg-2">{r.narrative}</p>}
              {Object.keys(r.metrics).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(r.metrics).map(([k, v]) => (
                    <span key={k} className="tabular rounded-full bg-sunken px-2.5 py-1 text-[11.5px] text-fg-2 ring-1 ring-inset ring-line">
                      {k}: <span className="font-semibold text-fg">{v.toLocaleString('pt-BR')}</span>
                    </span>
                  ))}
                </div>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                {r.sections.map((s) => (
                  <div key={s.key}>
                    <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-3">
                      {s.title}
                      <span className="tabular rounded-full bg-sunken px-1.5 text-[10px]">{s.items.length}</span>
                    </div>
                    {s.items.length === 0 ? (
                      <p className="text-[12.5px] text-fg-3">Nenhum item.</p>
                    ) : (
                      <ul className="space-y-0.5">
                        {s.items.map((it, i) => (
                          <li key={i}>
                            <button
                              type="button"
                              disabled={!it.pautaId}
                              onClick={() => it.pautaId && openPauta(it.pautaId)}
                              className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left text-[13px] text-fg enabled:hover:bg-sunken disabled:cursor-default"
                            >
                              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-fg-3" />
                              <span className="min-w-0 flex-1">{it.text}</span>
                              {it.meta && <span className="shrink-0 text-[11.5px] text-fg-3">{it.meta}</span>}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-[118px] !rounded-[22px]" />
        ))}
      </div>
      <Skeleton className="h-80 !rounded-[22px]" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 !rounded-[22px]" />
        <Skeleton className="h-72 !rounded-[22px]" />
      </div>
    </div>
  );
}
