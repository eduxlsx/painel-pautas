import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react';
import { format, isToday, isTomorrow, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlarmClock,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Flame,
  FolderKanban,
  Gauge,
  Info,
  Layers,
  Lightbulb,
  MapPin,
  Minus,
  PieChart as PieIcon,
  Plug,
  Plus,
  Radar,
  RefreshCw,
  ScrollText,
  Sparkles,
  Target,
  TrendingUp,
  Video,
} from 'lucide-react';
import type { AttentionItem, DashboardResponse, Insight, KpiCard, Resumo } from '@pautaflow/shared';
import { cn, fmtDateTime, fmtTime } from '@/lib/utils';
import { post, useApiMutation, useDashboard } from '@/lib/queries';
import { useUi } from '@/stores/ui';
import { Button, CardHeader, DueChip, EmptyState, GlassCard, PriorityBadge, Skeleton, STATUS_HEX, StatusBadge, Tip } from '@/components/ui';
import { useLookups } from '@/components/pauta/PautaCard';
import { AreaGradient, AXIS, BAR_CURSOR, ChartBox, CountUp, CURSOR, Donut, GlassTooltip, GRID, InlineLegend } from '@/components/charts/kit';

/* ------------------------------------------------------------------ */
/* Animação                                                            */
/* ------------------------------------------------------------------ */

const container: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } } };
const item: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.985 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
};

type KpiMeta = { icon: ReactNode; to: string; goodWhenUp: boolean; danger?: boolean };
const KPI_META: Record<string, KpiMeta> = {
  active: { icon: <Layers />, to: '/pautas', goodWhenUp: false },
  done: { icon: <CheckCircle2 />, to: '/analytics', goodWhenUp: true },
  overdue: { icon: <AlarmClock />, to: '/pautas', goodWhenUp: false, danger: true },
  week: { icon: <CalendarRange />, to: '/pautas', goodWhenUp: false },
  critical: { icon: <Flame />, to: '/pautas', goodWhenUp: false, danger: true },
  suggestions: { icon: <Radar />, to: '/radar', goodWhenUp: false },
  projects: { icon: <FolderKanban />, to: '/projetos', goodWhenUp: true },
  rate: { icon: <Gauge />, to: '/analytics', goodWhenUp: true },
};

const shortDate = (d: string) => format(parseISO(d), 'dd/MM', { locale: ptBR });

/* ------------------------------------------------------------------ */
/* Página                                                              */
/* ------------------------------------------------------------------ */

export default function Dashboard() {
  const { data, isLoading, isError, refetch, isFetching } = useDashboard();
  const reduce = useReducedMotion();

  if (isLoading) return <DashboardSkeleton />;
  if (isError || !data)
    return (
      <GlassCard className="mt-10">
        <EmptyState
          icon={<CircleAlert />}
          title="Não foi possível carregar o dashboard"
          description="O servidor local do PautaFlow não respondeu. Verifique se o aplicativo está em execução e tente novamente."
          action={
            <Button variant="primary" onClick={() => void refetch()} loading={isFetching}>
              <RefreshCw /> Tentar novamente
            </Button>
          }
        />
      </GlassCard>
    );

  return (
    <motion.div variants={container} initial={reduce ? false : 'hidden'} animate="show" className="space-y-6 pb-10">
      <Hero greeting={data.greeting} />

      <motion.div variants={container} className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {data.kpis.map((k) => (
          <KpiTile key={k.key} kpi={k} />
        ))}
      </motion.div>

      <div className="grid gap-6 xl:grid-cols-12">
        <motion.div variants={item} className="xl:col-span-7">
          <AttentionCard items={data.attention} />
        </motion.div>
        <div className="space-y-6 xl:col-span-5">
          <motion.div variants={item}>
            <InsightsCard insights={data.insights} />
          </motion.div>
          <motion.div variants={item}>
            <DailySummaryCard summary={data.dailySummary} />
          </motion.div>
        </div>
      </div>

      <Charts charts={data.charts} />

      <motion.div variants={item}>
        <UpcomingEvents events={data.upcomingEvents} />
      </motion.div>

      <p className="text-center text-[11px] text-fg-3">Atualizado {fmtDateTime(data.generatedAt)}</p>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

function Hero({ greeting }: { greeting: DashboardResponse['greeting'] }) {
  const name = greeting.name.trim();
  return (
    <motion.header variants={item} className="relative px-1 pt-2">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-fg-3">
        <Sparkles className="size-3.5 text-accent" />
        {greeting.dateLabel}
      </div>
      <h1 className="text-[34px] font-semibold leading-[1.08] tracking-[-0.035em] text-fg sm:text-[44px]">
        {greeting.salutation}
        {name ? (
          <>
            , <span className="text-gradient">{name}</span>.
          </>
        ) : (
          '.'
        )}
      </h1>
      <p className="mt-3 max-w-3xl text-[15.5px] leading-relaxed text-fg-2 sm:text-[17px]">{greeting.headline}</p>
    </motion.header>
  );
}

/* ------------------------------------------------------------------ */
/* KPIs                                                                */
/* ------------------------------------------------------------------ */

function KpiTile({ kpi }: { kpi: KpiCard }) {
  const navigate = useNavigate();
  const meta: KpiMeta = KPI_META[kpi.key] ??{ icon: <Target />, to: '/analytics', goodWhenUp: true };
  const alert = !!meta.danger && kpi.value > 0;
  const tone = kpi.key === 'overdue' ? 'critical' : 'high';
  const trend = kpi.trend;
  const good = trend ? (trend.direction === 'flat' ? null : (trend.direction === 'up') === meta.goodWhenUp) : null;
  return (
    <motion.button
      type="button"
      variants={item}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.985 }}
      onClick={() => navigate(meta.to)}
      className={cn(
        'glass glass-hover group flex min-h-[132px] flex-col justify-between p-4 text-left outline-none sm:p-5',
        alert && (tone === 'critical' ? 'bg-critical/[0.07] ring-1 ring-critical/25 ring-inset' : 'bg-high/[0.07] ring-1 ring-high/25 ring-inset'),
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className={cn(
            'grid size-9 place-items-center rounded-xl [&_svg]:size-[18px]',
            alert ? (tone === 'critical' ? 'bg-critical/15 text-critical' : 'bg-high/15 text-high') : 'bg-accent-soft text-accent',
          )}
        >
          {meta.icon}
        </div>
        <div className="flex items-center gap-1">
          {kpi.hint && (
            <Tip content={kpi.hint}>
              <span className="grid size-6 place-items-center rounded-full text-fg-3 hover:text-fg-2" onClick={(e) => e.stopPropagation()}>
                <Info className="size-3.5" />
              </span>
            </Tip>
          )}
          <ArrowUpRight className="size-4 text-fg-3 opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </div>
      <div className="mt-3">
        <div className="flex items-baseline gap-1">
          <span className={cn('tabular text-[30px] font-semibold leading-none tracking-[-0.035em] sm:text-[34px]', alert ? (tone === 'critical' ? 'text-critical' : 'text-high') : 'text-fg')}>
            <CountUp value={kpi.value} />
          </span>
          {kpi.unit && <span className="text-sm font-medium text-fg-3">{kpi.unit}</span>}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1.5">
          <span className="text-[12.5px] font-medium text-fg-2">{kpi.label}</span>
          {trend && (
            <span
              className={cn(
                'tabular inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold',
                good === null ? 'bg-sunken text-fg-3' : good ? 'bg-success/12 text-success' : 'bg-critical/12 text-critical',
              )}
              title={trend.label}
            >
              {trend.direction === 'up' ? <ArrowUpRight className="size-3" /> : trend.direction === 'down' ? <ArrowDownRight className="size-3" /> : <Minus className="size-3" />}
              {trend.delta > 0 ? '+' : ''}
              {trend.delta}
            </span>
          )}
        </div>
      </div>
    </motion.button>
  );
}

/* ------------------------------------------------------------------ */
/* Minha atenção hoje                                                  */
/* ------------------------------------------------------------------ */

function AttentionCard({ items }: { items: AttentionItem[] }) {
  const { openPauta, openEditor } = useUi();
  const { project } = useLookups();
  return (
    <GlassCard className="h-full">
      <CardHeader
        icon={<Target />}
        title="Minha atenção hoje"
        subtitle={items.length ? `${items.length} ${items.length === 1 ? 'pauta pede' : 'pautas pedem'} sua atenção, em ordem recomendada` : 'O que merece seu foco agora'}
        action={
          <Button size="sm" variant="ghost" onClick={() => openEditor(null)}>
            <Plus /> Nova pauta
          </Button>
        }
      />
      {items.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 />}
          title="Nada pedindo atenção agora"
          description="Quando houver pautas com prazo próximo, atrasadas ou críticas, elas aparecem aqui com a próxima ação recomendada. Crie uma pauta ou conecte o Microsoft 365 em Integrações para o radar trazer demandas."
          action={
            <Button variant="primary" onClick={() => openEditor(null)}>
              <Plus /> Criar pauta
            </Button>
          }
        />
      ) : (
        <ul className="-mx-2 space-y-1">
          <AnimatePresence initial={false}>
            {items.map(({ pauta, nextAction, reason }, i) => {
              const proj = project(pauta.projectId);
              const level = pauta.manualPriority ?? pauta.recommendedPriority;
              return (
                <motion.li key={pauta.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: i * 0.03 } }} exit={{ opacity: 0, x: -12 }}>
                  <button
                    type="button"
                    onClick={() => openPauta(pauta.id)}
                    className="group flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-sunken focus-visible:bg-sunken"
                  >
                    <span className="tabular mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-sunken text-[11.5px] font-semibold text-fg-2 ring-1 ring-line ring-inset">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="min-w-0 truncate text-[14px] font-medium text-fg">{pauta.title}</span>
                        {proj && (
                          <span className="flex items-center gap-1 text-[11.5px] text-fg-3">
                            <span className="size-1.5 rounded-full" style={{ background: proj.color }} />
                            {proj.name}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <PriorityBadge level={level} />
                        <DueChip due={pauta.dueDate} done={pauta.status === 'done'} />
                        <StatusBadge status={pauta.status} />
                      </div>
                      <div className="mt-2 flex items-start gap-1.5 text-[13px] text-fg">
                        <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-accent" />
                        <span>
                          <span className="font-medium">{nextAction}</span>
                          {reason && <span className="text-fg-3"> · {reason}</span>}
                        </span>
                      </div>
                    </div>
                  </button>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </GlassCard>
  );
}

/* ------------------------------------------------------------------ */
/* Insights                                                            */
/* ------------------------------------------------------------------ */

const INSIGHT_TONE: Record<Insight['tone'], { dot: string; icon: ReactNode; text: string }> = {
  info: { dot: 'bg-accent-soft text-accent', icon: <Lightbulb />, text: 'text-fg' },
  warning: { dot: 'bg-warning/15 text-amber-600 dark:text-amber-300', icon: <CircleAlert />, text: 'text-fg' },
  critical: { dot: 'bg-critical/15 text-critical', icon: <Flame />, text: 'text-fg' },
  positive: { dot: 'bg-success/15 text-success', icon: <TrendingUp />, text: 'text-fg' },
};

function InsightsCard({ insights }: { insights: Insight[] }) {
  const { openPauta } = useUi();
  return (
    <div className="glass relative overflow-hidden p-5">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--pf-accent)_16%,transparent),transparent_55%,color-mix(in_srgb,var(--pf-accent-2)_14%,transparent))]" />
      <div className="mb-4 flex items-center gap-2.5">
        <div className="bg-flow grid size-8 place-items-center rounded-xl text-white shadow-[0_8px_18px_-8px_var(--pf-accent)]">
          <Sparkles className="size-4" />
        </div>
        <div>
          <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">Insights do PautaFlow</h3>
          <p className="text-xs text-fg-3">Leituras automáticas sobre sua carga de trabalho</p>
        </div>
      </div>
      {insights.length === 0 ? (
        <p className="rounded-2xl bg-sunken/70 px-4 py-5 text-center text-sm text-fg-3">
          Sem insights no momento. Eles surgem à medida que você registra pautas com prazos, prioridades e projetos.
        </p>
      ) : (
        <ul className="space-y-2">
          {insights.map((ins, i) => {
            const t = INSIGHT_TONE[ins.tone];
            const clickable = ins.pautaIds.length > 0;
            const body = (
              <>
                <span className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg [&_svg]:size-3.5', t.dot)}>{t.icon}</span>
                <span className={cn('min-w-0 flex-1 text-[13.5px] leading-snug', t.text)}>
                  {ins.text}
                  {ins.pautaIds.length > 1 && <span className="ml-1 text-[11.5px] text-fg-3">({ins.pautaIds.length} pautas)</span>}
                </span>
                {clickable && <ArrowUpRight className="mt-1 size-3.5 shrink-0 text-fg-3 opacity-0 transition-opacity group-hover:opacity-100" />}
              </>
            );
            return (
              <motion.li key={ins.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0, transition: { delay: 0.1 + i * 0.05 } }}>
                {clickable ? (
                  <button type="button" onClick={() => openPauta(ins.pautaIds[0]!)} className="group flex w-full items-start gap-3 rounded-xl bg-surface/60 px-3 py-2.5 text-left ring-1 ring-line ring-inset transition hover:bg-surface-strong">
                    {body}
                  </button>
                ) : (
                  <div className="flex items-start gap-3 rounded-xl bg-surface/60 px-3 py-2.5 ring-1 ring-line ring-inset">{body}</div>
                )}
              </motion.li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Resumo do dia                                                       */
/* ------------------------------------------------------------------ */

function DailySummaryCard({ summary }: { summary: Resumo | null }) {
  const [expanded, setExpanded] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const { openPauta } = useUi();
  const gen = useApiMutation(() => post<Resumo>('/api/resumos/generate', { type: 'daily' }), { invalidate: ['resumos', 'dashboard'], success: 'Resumo do dia gerado' });
  return (
    <GlassCard>
      <CardHeader
        icon={<ScrollText />}
        title="Resumo do dia"
        subtitle={summary ? `Gerado ${fmtDateTime(summary.generatedAt)} · ${summary.generatedBy === 'rules' ? 'Regras' : 'IA'}` : 'Ainda não gerado hoje'}
        action={
          <Button size="sm" variant="subtle" onClick={() => gen.mutate(undefined)} loading={gen.isPending}>
            {!gen.isPending && <RefreshCw />} Gerar agora
          </Button>
        }
      />
      {!summary ? (
        <p className="rounded-2xl bg-sunken/70 px-4 py-5 text-center text-sm text-fg-3">O resumo diário é gerado automaticamente no horário configurado. Clique em “Gerar agora” para criá-lo a partir das suas pautas.</p>
      ) : (
        <div>
          <p className="text-[14.5px] font-medium leading-snug text-fg">{summary.headline}</p>
          {summary.narrative && <p className={cn('mt-2 whitespace-pre-line text-[13px] leading-relaxed text-fg-2', !expanded && 'line-clamp-3')}>{summary.narrative}</p>}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {summary.sections.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => {
                  setExpanded(true);
                  setOpenSection((o) => (o === s.key ? null : s.key));
                }}
                className={cn('inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium ring-1 ring-inset transition', openSection === s.key ? 'bg-accent-soft text-accent ring-accent/25' : 'bg-sunken text-fg-2 ring-line hover:text-fg')}
              >
                {s.title}
                <span className="tabular rounded-full bg-surface-strong px-1.5 text-[10.5px] text-fg-2">{s.items.length}</span>
              </button>
            ))}
          </div>
          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div key="details" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="mt-3 space-y-3">
                  {summary.sections
                    .filter((s) => !openSection || s.key === openSection)
                    .map((s) => (
                      <div key={s.key}>
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-3">{s.title}</div>
                        {s.items.length === 0 ? (
                          <p className="text-[12.5px] text-fg-3">Nenhum item.</p>
                        ) : (
                          <ul className="space-y-0.5">
                            {s.items.map((it, idx) => (
                              <li key={idx}>
                                <button
                                  type="button"
                                  disabled={!it.pautaId && !it.url}
                                  title={it.url ? 'Abrir' : undefined}
                                  onClick={() => (it.pautaId ? openPauta(it.pautaId) : it.url && window.open(it.url, '_blank', 'noopener'))}
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
              </motion.div>
            )}
          </AnimatePresence>
          <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline">
            {expanded ? 'Mostrar menos' : 'Ver resumo completo'}
            <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />
          </button>
        </div>
      )}
    </GlassCard>
  );
}

/* ------------------------------------------------------------------ */
/* Gráficos                                                            */
/* ------------------------------------------------------------------ */

function Charts({ charts }: { charts: DashboardResponse['charts'] }) {
  const navigate = useNavigate();
  const statusData = charts.byStatus.map((d) => ({ ...d, color: STATUS_HEX[d.key as keyof typeof STATUS_HEX] ?? 'var(--pf-accent)' }));
  const hasStatus = statusData.some((d) => d.value > 0);
  const hasVolume = charts.weeklyVolume.some((p) => Number(p.criadas ?? 0) + Number(p.concluidas ?? 0) > 0);
  const hasCompletions = charts.completions.some((p) => Number(p.concluidas ?? 0) > 0);
  return (
    <div className="space-y-4">
      <motion.div variants={item} className="flex items-end justify-between px-1">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-fg">Distribuição de trabalho</h2>
          <p className="text-sm text-fg-3">Pautas em aberto e ritmo das últimas 12 semanas</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => navigate('/analytics')}>
          Ver analytics <ArrowRight />
        </Button>
      </motion.div>
      <div className="grid gap-4 lg:grid-cols-2">
        <motion.div variants={item}>
          <GlassCard className="h-full">
            <CardHeader icon={<PieIcon />} title="Por categoria" subtitle="Pautas abertas" />
            <Donut data={charts.byCategory} height={200} centerLabel="abertas" />
          </GlassCard>
        </motion.div>
        <motion.div variants={item}>
          <GlassCard className="h-full">
            <CardHeader icon={<Layers />} title="Por status" subtitle="Onde suas pautas estão agora" />
            <ChartBox height={220} empty={!hasStatus} emptyText="Nenhuma pauta em aberto. Crie uma pauta para começar.">
              <BarChart data={statusData} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="label" {...AXIS} interval={0} tickFormatter={(v: string) => (v.length > 10 ? `${v.slice(0, 9)}…` : v)} />
                <YAxis {...AXIS} allowDecimals={false} />
                <Tooltip cursor={BAR_CURSOR} content={<GlassTooltip names={{ value: 'Pautas' }} />} />
                <Bar dataKey="value" name="Pautas" radius={[8, 8, 3, 3]} maxBarSize={44} animationDuration={900}>
                  {statusData.map((d) => (
                    <Cell key={d.key ?? d.label} fill={d.color} />
                  ))}
                </Bar>
              </BarChart>
            </ChartBox>
          </GlassCard>
        </motion.div>
        <motion.div variants={item}>
          <GlassCard className="h-full">
            <CardHeader icon={<TrendingUp />} title="Volume semanal" subtitle="Criadas vs. concluídas" action={<InlineLegend items={[{ label: 'Criadas', color: 'var(--pf-accent)' }, { label: 'Concluídas', color: 'var(--pf-accent-2)' }]} />} />
            <ChartBox height={220} empty={!hasVolume} emptyText="O volume aparece aqui assim que você criar e concluir pautas.">
              <AreaChart data={charts.weeklyVolume} margin={{ top: 8, right: 6, left: -24, bottom: 0 }}>
                <defs>
                  <AreaGradient id="dash-criadas" color="var(--pf-accent)" />
                  <AreaGradient id="dash-concluidas" color="var(--pf-accent-2)" />
                </defs>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="date" {...AXIS} tickFormatter={shortDate} minTickGap={16} />
                <YAxis {...AXIS} allowDecimals={false} />
                <Tooltip cursor={CURSOR} content={<GlassTooltip labelFormat={(l) => `Semana de ${shortDate(l)}`} names={{ criadas: 'Criadas', concluidas: 'Concluídas' }} />} />
                <Area type="monotone" dataKey="criadas" stroke="var(--pf-accent)" strokeWidth={2.2} fill="url(#dash-criadas)" animationDuration={1000} />
                <Area type="monotone" dataKey="concluidas" stroke="var(--pf-accent-2)" strokeWidth={2.2} fill="url(#dash-concluidas)" animationDuration={1200} />
              </AreaChart>
            </ChartBox>
          </GlassCard>
        </motion.div>
        <motion.div variants={item}>
          <GlassCard className="h-full">
            <CardHeader icon={<CheckCircle2 />} title="Conclusões" subtitle="Pautas concluídas por semana" />
            <ChartBox height={220} empty={!hasCompletions} emptyText="Nenhuma pauta concluída nas últimas 12 semanas.">
              <LineChart data={charts.completions} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="date" {...AXIS} tickFormatter={shortDate} minTickGap={16} />
                <YAxis {...AXIS} allowDecimals={false} />
                <Tooltip cursor={CURSOR} content={<GlassTooltip labelFormat={(l) => `Semana de ${shortDate(l)}`} names={{ concluidas: 'Concluídas' }} />} />
                <Line
                  type="monotone"
                  dataKey="concluidas"
                  stroke="var(--pf-accent)"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: 'var(--pf-surface-solid)', stroke: 'var(--pf-accent)', strokeWidth: 2 }}
                  activeDot={{ r: 5, fill: 'var(--pf-accent)', stroke: 'var(--pf-surface-solid)', strokeWidth: 2 }}
                  animationDuration={1100}
                />
              </LineChart>
            </ChartBox>
          </GlassCard>
        </motion.div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Próximos compromissos                                               */
/* ------------------------------------------------------------------ */

function UpcomingEvents({ events }: { events: DashboardResponse['upcomingEvents'] }) {
  const navigate = useNavigate();
  return (
    <GlassCard>
      <CardHeader
        icon={<CalendarClock />}
        title="Próximos compromissos"
        subtitle="Reuniões de hoje e amanhã no Outlook"
        action={
          <Button size="sm" variant="ghost" onClick={() => navigate('/calendario')}>
            Calendário <ArrowRight />
          </Button>
        }
      />
      {events.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-sunken/60 px-6 py-8 text-center sm:flex-row sm:text-left">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent">
            <CalendarClock className="size-5" />
          </div>
          <p className="flex-1 text-sm text-fg-3">Nenhum compromisso nas próximas 48 horas. As reuniões aparecem aqui quando o calendário do Microsoft 365 está conectado em Integrações.</p>
          <Button size="sm" variant="secondary" onClick={() => navigate('/integracoes')}>
            <Plug /> Integrações
          </Button>
        </div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {events.map((e, i) => {
            const start = parseISO(e.start);
            const day = isToday(start) ? 'Hoje' : isTomorrow(start) ? 'Amanhã' : format(start, 'EEE, d MMM', { locale: ptBR });
            return (
              <motion.li key={e.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { delay: i * 0.04 } }} className="flex gap-3 rounded-2xl bg-surface/60 p-3 ring-1 ring-line ring-inset">
                <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-sky-500/10 py-1.5 text-sky-600 dark:text-sky-300">
                  <span className="text-[10px] font-semibold uppercase tracking-wide">{day}</span>
                  <span className="tabular text-[14px] font-semibold">{e.allDay ? 'Dia' : fmtTime(e.start)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium text-fg">{e.title}</div>
                  <div className="tabular mt-0.5 text-[11.5px] text-fg-3">{e.allDay ? 'Dia inteiro' : `${fmtTime(e.start)}${e.end ? ` – ${fmtTime(e.end)}` : ''}`}</div>
                  {e.location && (
                    <div className="mt-0.5 flex items-center gap-1 truncate text-[11.5px] text-fg-3">
                      <MapPin className="size-3 shrink-0" />
                      <span className="truncate">{e.location}</span>
                    </div>
                  )}
                </div>
                {e.url && (
                  <a href={e.url} target="_blank" rel="noopener noreferrer" className="grid size-8 shrink-0 place-items-center self-center rounded-xl bg-accent-soft text-accent transition hover:brightness-110" title={e.joinUrl ? "Entrar na reunião" : "Abrir no Outlook"}>
                    <Video className="size-4" />
                  </a>
                )}
              </motion.li>
            );
          })}
        </ul>
      )}
    </GlassCard>
  );
}

/* ------------------------------------------------------------------ */
/* Carregando                                                          */
/* ------------------------------------------------------------------ */

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-3 pt-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-11 w-80" />
        <Skeleton className="h-5 w-[min(560px,90%)]" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-[132px] !rounded-[22px]" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-12">
        <Skeleton className="h-96 !rounded-[22px] xl:col-span-7" />
        <div className="space-y-6 xl:col-span-5">
          <Skeleton className="h-52 !rounded-[22px]" />
          <Skeleton className="h-40 !rounded-[22px]" />
        </div>
      </div>
    </div>
  );
}
