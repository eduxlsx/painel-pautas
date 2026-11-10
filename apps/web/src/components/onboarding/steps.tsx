import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import {
  ArrowUpWideNarrow,
  CalendarRange,
  CheckCircle2,
  Circle,
  Command,
  Database,
  FileJson,
  HardDrive,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  ListTodo,
  Loader2,
  LockKeyhole,
  MinusCircle,
  Radar,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  XCircle,
  CalendarDays,
  Building2,
} from 'lucide-react';
import type { AutomationInfo, BootstrapResponse, Configuracoes, UserProfile } from '@pautaflow/shared';
import { Button, Field, Input, Kbd, Skeleton, Switch } from '@/components/ui';
import { LogoMark } from '@/components/layout/Logo';
import { api, patch, post, useBootstrap, useConfig, usePautas, useRadarStatus, useSugestoes } from '@/lib/queries';
import { queryClient } from '@/lib/api';
import { cn, fmtRelative } from '@/lib/utils';
import { toast } from '@/stores/toast';
import { MicrosoftConnectPanel, MsStateChip, msState, useMicrosoftLive } from '@/components/settings/MicrosoftConnect';
import { MicrosoftSources, type RegisterSave } from '@/components/settings/MicrosoftSources';
import { AiSettingsPanel } from '@/components/settings/AiSettings';
import { Note, NumberInput, PercentSlider, RowGroup, SettingRow, TimeInput, WeekdayPicker, useDraft } from '@/components/settings/shared';

/** Salva configurações sem toast (o assistente salva a cada etapa). */
export async function saveConfigSilently(p: Record<string, unknown>) {
  const cfg = await patch<Configuracoes>('/api/config', p);
  queryClient.setQueryData(['config'], cfg);
  queryClient.setQueryData<BootstrapResponse>(['bootstrap'], (old) => (old ? { ...old, config: cfg } : old));
  return cfg;
}

const rise = (i: number) => ({ initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.08 + i * 0.06, duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } });

export function StepHeader({ icon, eyebrow, title, subtitle }: { icon?: ReactNode; eyebrow: string; title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="mb-7">
      <motion.div {...rise(0)} className="mb-3 inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-accent [&_svg]:size-3.5">
        {icon}
        {eyebrow}
      </motion.div>
      <motion.h1 {...rise(1)} className="text-[30px] font-semibold leading-[1.1] tracking-[-0.03em] text-fg sm:text-[34px]">
        {title}
      </motion.h1>
      {subtitle && (
        <motion.p {...rise(2)} className="mt-3 max-w-xl text-[15px] leading-relaxed text-fg-2">
          {subtitle}
        </motion.p>
      )}
    </div>
  );
}

function Reveal({ i, children, className }: { i: number; children: ReactNode; className?: string }) {
  return (
    <motion.div {...rise(i)} className={className}>
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* 1 · Boas-vindas                                                     */
/* ------------------------------------------------------------------ */

export function WelcomeStep() {
  const pillars = [
    { icon: <Radar />, title: 'Identifica', text: 'O radar lê e-mails, reuniões e o Planner e encontra demandas que chegaram até você.' },
    { icon: <ListTodo />, title: 'Organiza', text: 'Cada demanda vira uma pauta com prazo, origem, categoria e histórico.' },
    { icon: <ArrowUpWideNarrow />, title: 'Prioriza', text: 'Um score transparente diz o que fazer primeiro — e por quê.' },
  ];
  return (
    <div className="text-center">
      <motion.div initial={{ opacity: 0, scale: 0.8, filter: 'blur(10px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} className="relative mx-auto mb-7 w-fit">
        <div className="absolute inset-0 -z-10 scale-150 rounded-full bg-accent/30 blur-3xl" aria-hidden />
        <LogoMark className="size-20 drop-shadow-[0_18px_30px_color-mix(in_srgb,var(--pf-accent)_45%,transparent)]" />
      </motion.div>
      <Reveal i={1}>
        <div className="text-[11.5px] font-semibold uppercase tracking-[0.2em] text-gradient">PautaFlow Intelligence</div>
      </Reveal>
      <Reveal i={2}>
        <h1 className="mx-auto mt-3 max-w-lg text-[34px] font-semibold leading-[1.08] tracking-[-0.035em] text-fg sm:text-[40px]">Suas demandas, encontradas e priorizadas.</h1>
      </Reveal>
      <Reveal i={3}>
        <p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-fg-2">Identificar, organizar e priorizar o seu trabalho com o mínimo de esforço manual — para você focar no que importa.</p>
      </Reveal>
      <div className="mt-8 grid gap-3 text-left sm:grid-cols-3">
        {pillars.map((p, i) => (
          <Reveal key={p.title} i={4 + i}>
            <div className="h-full rounded-2xl bg-sunken/70 p-4 ring-1 ring-line">
              <div className="mb-3 grid size-9 place-items-center rounded-xl bg-flow text-white shadow-[0_8px_18px_-8px_var(--pf-accent)] [&_svg]:size-4">{p.icon}</div>
              <div className="text-sm font-semibold text-fg">{p.title}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-fg-3">{p.text}</p>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal i={7}>
        <div className="mx-auto mt-6 flex w-fit items-center gap-2 rounded-full bg-success/10 px-3.5 py-1.5 text-xs font-medium text-success ring-1 ring-inset ring-success/25">
          <ShieldCheck className="size-3.5" /> Local-first: seus dados ficam neste computador
        </div>
      </Reveal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2 · Configuração local                                              */
/* ------------------------------------------------------------------ */

export function LocalStep({ registerSave }: { registerSave: RegisterSave }) {
  const boot = useBootstrap();
  const profile = boot.data?.profile;
  const [name, setName] = useState<string | null>(null);
  const value = name ?? profile?.name ?? '';

  useEffect(() => {
    registerSave(async () => {
      const n = value.trim();
      if (!n) {
        toast.error('Informe como você quer ser chamado.');
        throw new Error('nome');
      }
      if (n !== profile?.name) {
        const p = await patch<UserProfile>('/api/profile', { name: n });
        queryClient.setQueryData<BootstrapResponse>(['bootstrap'], (old) => (old ? { ...old, profile: p } : old));
      }
    });
    return () => registerSave(null);
  }, [value, profile?.name, registerSave]);

  const items = [
    { icon: <FileJson />, title: 'Arquivos JSON locais', text: 'Pautas, sugestões e configurações ficam em arquivos legíveis, na sua máquina.' },
    { icon: <HardDrive />, title: 'Backups automáticos', text: 'Uma cópia diária é feita automaticamente, com restauração em um clique.' },
    { icon: <LockKeyhole />, title: 'Nada sai sem autorização', text: 'Nenhum dado é enviado para fora do computador sem você permitir explicitamente.' },
  ];

  return (
    <div>
      <StepHeader icon={<HardDrive />} eyebrow="Configuração local" title="Vamos começar por você" subtitle="O PautaFlow roda inteiramente neste computador. Diga como quer ser chamado." />
      <Reveal i={3}>
        <Field label="Seu nome">
          <Input autoFocus value={value} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Ex.: Ana Souza" className="h-12 text-[15px]" />
        </Field>
      </Reveal>
      <Reveal i={4} className="mt-5">
        <div className="rounded-2xl bg-sunken/70 px-4 py-3 ring-1 ring-line">
          <div className="flex items-center gap-2 text-xs font-medium text-fg-3">
            <Database className="size-3.5" /> Pasta de dados
          </div>
          {boot.data ? <code className="mt-1 block truncate font-mono text-[13px] text-fg" title={boot.data.app.dataDir}>{boot.data.app.dataDir}</code> : <Skeleton className="mt-1 h-5" />}
        </div>
      </Reveal>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {items.map((it, i) => (
          <Reveal key={it.title} i={5 + i}>
            <div className="h-full rounded-2xl p-4 ring-1 ring-line">
              <div className="mb-2 text-accent [&_svg]:size-[18px]">{it.icon}</div>
              <div className="text-sm font-semibold text-fg">{it.title}</div>
              <p className="mt-1 text-xs leading-relaxed text-fg-3">{it.text}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3 · Conexão Microsoft                                               */
/* ------------------------------------------------------------------ */

export function MicrosoftStep() {
  const ms = useMicrosoftLive();
  return (
    <div>
      <StepHeader icon={<Building2 />} eyebrow="Conexão Microsoft" title="Conecte o Microsoft 365" subtitle="Com acesso somente leitura ao Outlook, Calendário e Planner, o radar passa a encontrar demandas sozinho." />
      <Reveal i={3} className="mb-4 flex items-center gap-2">
        <span className="text-xs text-fg-3">Status:</span>
        {ms.data ? <MsStateChip state={msState(ms.data)} /> : <Skeleton className="h-6 w-28" />}
      </Reveal>
      <Reveal i={4}>
        <Note tone="warning" icon={<ShieldCheck />} title="Depende da permissão da sua empresa" className="mb-5">
          Estar logado no Windows ou no Outlook não dá acesso automático. É preciso um registro de aplicativo no Entra ID e, em muitas empresas, o <b>consentimento do administrador</b> da TI. Se ainda não for possível, pule esta etapa — o PautaFlow funciona com pautas manuais e você pode conectar depois em Integrações.
        </Note>
      </Reveal>
      <Reveal i={5}>
        <MicrosoftConnectPanel compact />
      </Reveal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 4 · Seleção de fontes                                               */
/* ------------------------------------------------------------------ */

export function SourcesStep({ registerSave }: { registerSave: RegisterSave }) {
  const ms = useMicrosoftLive();
  const connected = !!ms.data?.connected;
  return (
    <div>
      <StepHeader icon={<Inbox />} eyebrow="Fontes" title="O que o radar deve acompanhar?" subtitle={connected ? 'Escolha as pastas do Outlook e os planos do Planner. Você pode mudar isso a qualquer momento.' : undefined} />
      <Reveal i={3}>{ms.isLoading ? <Skeleton className="h-40" /> : <MicrosoftSources connected={connected} showOptions={false} registerSave={registerSave} />}</Reveal>
      {!connected && !ms.isLoading && (
        <Reveal i={4} className="mt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { icon: <Inbox />, t: 'Pastas do Outlook', d: 'Caixa de Entrada por padrão' },
              { icon: <KanbanSquare />, t: 'Planos do Planner', d: 'Todos, ou apenas os escolhidos' },
              { icon: <CalendarDays />, t: 'Calendário', d: 'Reuniões e prazos próximos' },
            ].map((x) => (
              <div key={x.t} className="rounded-2xl p-4 opacity-70 ring-1 ring-line">
                <div className="mb-2 text-fg-3 [&_svg]:size-[18px]">{x.icon}</div>
                <div className="text-sm font-medium text-fg">{x.t}</div>
                <div className="text-xs text-fg-3">{x.d}</div>
              </div>
            ))}
          </div>
        </Reveal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 5 · Configuração do radar                                           */
/* ------------------------------------------------------------------ */

export function RadarStep({ registerSave }: { registerSave: RegisterSave }) {
  const cfg = useConfig();
  if (!cfg.data) return <Skeleton className="h-72" />;
  return <RadarStepInner config={cfg.data} registerSave={registerSave} />;
}

function RadarStepInner({ config, registerSave }: { config: Configuracoes; registerSave: RegisterSave }) {
  const draft = useDraft({
    outlookMinutes: config.schedules.outlookMinutes,
    plannerMinutes: config.schedules.plannerMinutes,
    radarMinutes: config.schedules.radarMinutes,
    minConfidence: config.radar.minConfidence,
    analyzeSentItems: config.radar.analyzeSentItems,
  });
  const d = draft.value;
  const key = JSON.stringify(d);
  useEffect(() => {
    registerSave(
      draft.dirty
        ? async () => {
            await saveConfigSilently({
              schedules: { outlookMinutes: d.outlookMinutes, plannerMinutes: d.plannerMinutes, radarMinutes: d.radarMinutes },
              radar: { minConfidence: d.minConfidence, analyzeSentItems: d.analyzeSentItems },
            });
          }
        : null,
    );
    return () => registerSave(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, draft.dirty, registerSave]);

  const sensitivity = d.minConfidence < 0.35 ? 'Mais sugestões, com mais ruído' : d.minConfidence > 0.65 ? 'Poucas sugestões, bem certeiras' : 'Equilíbrio recomendado';

  return (
    <div>
      <StepHeader icon={<Radar />} eyebrow="Radar" title="Ajuste o radar ao seu ritmo" subtitle="Os valores padrão funcionam bem para a maioria das pessoas." />
      <Reveal i={3}>
        <RowGroup>
          <SettingRow title="Verificar e-mails a cada">
            <NumberInput value={d.outlookMinutes} onChange={(v) => draft.set('outlookMinutes', Math.round(v))} min={1} max={1440} suffix="min" className="w-32" />
          </SettingRow>
          <SettingRow title="Verificar o Planner a cada">
            <NumberInput value={d.plannerMinutes} onChange={(v) => draft.set('plannerMinutes', Math.round(v))} min={1} max={1440} suffix="min" className="w-32" />
          </SettingRow>
          <SettingRow title="Analisar novos itens a cada">
            <NumberInput value={d.radarMinutes} onChange={(v) => draft.set('radarMinutes', Math.round(v))} min={1} max={1440} suffix="min" className="w-32" />
          </SettingRow>
          <SettingRow title="Analisar Itens Enviados" description="Detecta compromissos que você assumiu nas respostas.">
            <Switch checked={d.analyzeSentItems} onCheckedChange={(v) => draft.set('analyzeSentItems', v)} label="Analisar Itens Enviados" />
          </SettingRow>
        </RowGroup>
      </Reveal>
      <Reveal i={4} className="mt-5 rounded-2xl bg-sunken/70 p-4 ring-1 ring-line">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-sm font-medium text-fg">Confiança mínima para sugerir</div>
          <span className="text-xs text-fg-3">{sensitivity}</span>
        </div>
        <PercentSlider value={d.minConfidence} onChange={(v) => draft.set('minConfidence', v)} />
      </Reveal>
      <Reveal i={5}>
        <p className="mt-4 text-xs text-fg-3">Intervalos abaixo de 5 minutos podem esbarrar nos limites do Microsoft Graph.</p>
      </Reveal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 6 · IA                                                              */
/* ------------------------------------------------------------------ */

export function AiStep({ registerSave }: { registerSave: RegisterSave }) {
  return (
    <div>
      <StepHeader icon={<Sparkles />} eyebrow="Inteligência" title="IA opcional, privacidade em primeiro lugar" subtitle="Sem IA, tudo funciona com o motor determinístico local. Com IA, o radar e os resumos ficam mais ricos." />
      <Reveal i={3}>
        <AiSettingsPanel compact registerSave={registerSave} />
      </Reveal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 7 · Produtividade                                                   */
/* ------------------------------------------------------------------ */

export function ProductivityStep({ registerSave }: { registerSave: RegisterSave }) {
  const cfg = useConfig();
  if (!cfg.data) return <Skeleton className="h-72" />;
  return <ProductivityInner config={cfg.data} registerSave={registerSave} />;
}

function ProductivityInner({ config, registerSave }: { config: Configuracoes; registerSave: RegisterSave }) {
  const draft = useDraft({ ...config.workday, dailySummaryTime: config.schedules.dailySummaryTime });
  const d = draft.value;
  const key = JSON.stringify(d);
  useEffect(() => {
    registerSave(async () => {
      if (d.end <= d.start) {
        toast.error('O fim do expediente deve ser depois do início.');
        throw new Error('expediente');
      }
      if (!d.days.length) {
        toast.error('Selecione pelo menos um dia útil.');
        throw new Error('dias');
      }
      if (!draft.dirty) return;
      await saveConfigSilently({
        workday: { start: d.start, end: d.end, days: d.days, dailyCapacityHours: d.dailyCapacityHours },
        schedules: { dailySummaryTime: d.dailySummaryTime },
      });
    });
    return () => registerSave(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, draft.dirty, registerSave]);

  return (
    <div>
      <StepHeader icon={<CalendarRange />} eyebrow="Produtividade" title="Como é a sua semana?" subtitle="Usamos seu expediente para calcular capacidade, alertar sobrecarga e agendar o resumo diário." />
      <Reveal i={3} className="grid gap-4 sm:grid-cols-3">
        <Field label="Início do expediente">
          <TimeInput value={d.start} onChange={(v) => draft.set('start', v)} />
        </Field>
        <Field label="Fim do expediente">
          <TimeInput value={d.end} onChange={(v) => draft.set('end', v)} />
        </Field>
        <Field label="Horas produtivas por dia" hint="Sem contar reuniões e pausas">
          <NumberInput value={d.dailyCapacityHours} onChange={(v) => draft.set('dailyCapacityHours', v)} min={1} max={24} step={0.5} suffix="h" />
        </Field>
      </Reveal>
      <Reveal i={4} className="mt-5">
        <div className="mb-2 text-xs font-medium text-fg-2">Dias úteis</div>
        <WeekdayPicker value={d.days} onChange={(v) => draft.set('days', v)} />
      </Reveal>
      <Reveal i={5} className="mt-5">
        <RowGroup>
          <SettingRow title="Resumo diário às" description="Um panorama do dia: prioridades, prazos e novidades do radar.">
            <TimeInput value={d.dailySummaryTime} onChange={(v) => draft.set('dailySummaryTime', v)} className="w-32" />
          </SettingRow>
        </RowGroup>
      </Reveal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 8 · Primeira sincronização                                          */
/* ------------------------------------------------------------------ */

const SYNC_JOBS = [
  { id: 'outlook-sync', label: 'E-mails do Outlook', icon: <Inbox /> },
  { id: 'planner-sync', label: 'Tarefas do Planner', icon: <KanbanSquare /> },
  { id: 'calendar-sync', label: 'Eventos do Calendário', icon: <CalendarDays /> },
  { id: 'radar-analysis', label: 'Análise do radar', icon: <Radar /> },
];

type JobPhase = 'queued' | 'running' | 'success' | 'error' | 'skipped';

function jobPhase(job: AutomationInfo | undefined, startedAt: number): JobPhase {
  if (!job) return 'queued';
  const ran = job.lastRunAt ? Date.parse(job.lastRunAt) >= startedAt - 3000 : false;
  if (job.lastStatus === 'running' && ran) return 'running';
  if (!ran) return 'queued';
  if (job.lastStatus === 'success') return 'success';
  if (job.lastStatus === 'error') return 'error';
  if (job.lastStatus === 'skipped') return 'skipped';
  return 'running';
}

export function FirstSyncStep({ startedAt, onStart }: { startedAt: number | null; onStart: (t: number) => void }) {
  const ms = useMicrosoftLive();
  const connected = !!ms.data?.connected;
  const [starting, setStarting] = useState(false);
  const [phases, setPhases] = useState<JobPhase[]>([]);
  const allDone = startedAt !== null && phases.length === SYNC_JOBS.length && phases.every((p) => p !== 'queued' && p !== 'running');
  const jobs = useQuery({
    queryKey: ['automations'],
    queryFn: ({ signal }) => api<AutomationInfo[]>('/api/automations', { signal }),
    refetchInterval: startedAt !== null && !allDone ? 1500 : false,
  });

  useEffect(() => {
    if (startedAt === null) return;
    const next = SYNC_JOBS.map((j) => jobPhase(jobs.data?.find((x) => x.id === j.id), startedAt));
    setPhases((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [jobs.data, startedAt]);

  useEffect(() => {
    if (allDone) for (const k of ['sugestoes', 'radar', 'pautas', 'dashboard']) void queryClient.invalidateQueries({ queryKey: [k] });
  }, [allDone]);

  const start = async () => {
    setStarting(true);
    try {
      const t = Date.now();
      await post('/api/radar/scan');
      onStart(t);
      void jobs.refetch();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  if (ms.isLoading) return <Skeleton className="h-72" />;

  if (!connected) {
    return (
      <div>
        <StepHeader icon={<RefreshCw />} eyebrow="Primeira sincronização" title="Sem conta conectada, por enquanto" subtitle="A sincronização busca e-mails, tarefas e eventos do Microsoft 365 — ela começa assim que você conectar sua conta." />
        <Reveal i={3}>
          <Note tone="info" icon={<Sparkles />} title="Você pode continuar normalmente">
            Crie pautas manualmente, use as prioridades, a Minha Semana e o assistente. Quando a conexão estiver liberada pela TI, conecte em <b>Integrações</b> e a primeira sincronização acontece automaticamente.
          </Note>
        </Reveal>
      </div>
    );
  }

  const done = phases.filter((p) => p !== 'queued' && p !== 'running').length;
  return (
    <div>
      <StepHeader icon={<RefreshCw />} eyebrow="Primeira sincronização" title={allDone ? 'Sincronização concluída' : startedAt ? 'Sincronizando…' : 'Tudo pronto para a primeira leitura'} subtitle="O PautaFlow lê suas fontes (somente leitura) e o radar procura demandas. Pode levar alguns minutos em caixas grandes." />
      {startedAt === null ? (
        <Reveal i={3}>
          <Button variant="primary" size="lg" onClick={() => void start()} loading={starting}>
            {!starting && <RefreshCw />}
            Iniciar primeira sincronização
          </Button>
        </Reveal>
      ) : (
        <div className="space-y-2">
          <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-line">
            <motion.div className="h-full rounded-full bg-flow" initial={{ width: 0 }} animate={{ width: `${(done / SYNC_JOBS.length) * 100}%` }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
          </div>
          {SYNC_JOBS.map((j, i) => {
            const ph = phases[i] ?? 'queued';
            const job = jobs.data?.find((x) => x.id === j.id);
            return (
              <motion.div key={j.id} {...rise(i)} className={cn('flex items-center gap-3 rounded-2xl px-4 py-3 ring-1 transition-colors', ph === 'running' ? 'bg-accent-soft ring-accent/30' : 'bg-sunken/70 ring-line')}>
                <span className="text-fg-3 [&_svg]:size-4">{j.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-fg">{j.label}</div>
                  {ph !== 'queued' && ph !== 'running' && job?.lastMessage && <div className="truncate text-xs text-fg-3">{job.lastMessage}</div>}
                </div>
                <PhaseBadge phase={ph} />
              </motion.div>
            );
          })}
          {allDone && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pt-2 text-[13px] text-fg-2">
              Pronto! Continue para ver o que foi encontrado.
            </motion.p>
          )}
          {!allDone && <p className="pt-2 text-xs text-fg-3">Você pode continuar enquanto isso — a sincronização segue em segundo plano.</p>}
        </div>
      )}
    </div>
  );
}

function PhaseBadge({ phase }: { phase: JobPhase }) {
  const map: Record<JobPhase, { icon: ReactNode; text: string; cls: string }> = {
    queued: { icon: <Circle />, text: 'Na fila', cls: 'text-fg-3' },
    running: { icon: <Loader2 className="animate-spin" />, text: 'Em andamento', cls: 'text-accent' },
    success: { icon: <CheckCircle2 />, text: 'Concluído', cls: 'text-success' },
    error: { icon: <XCircle />, text: 'Erro', cls: 'text-critical' },
    skipped: { icon: <MinusCircle />, text: 'Ignorado', cls: 'text-fg-3' },
  };
  const m = map[phase];
  return <span className={cn('flex shrink-0 items-center gap-1.5 text-xs font-medium [&_svg]:size-4', m.cls)}>{m.icon}{m.text}</span>;
}

/* ------------------------------------------------------------------ */
/* 9 · Análise inicial                                                 */
/* ------------------------------------------------------------------ */

export function AnalysisStep() {
  const sug = useSugestoes('pending');
  const pautas = usePautas();
  const radar = useRadarStatus();
  const loading = sug.isLoading || pautas.isLoading || radar.isLoading;
  const pending = sug.data?.length ?? 0;
  const totalPautas = pautas.data?.length ?? 0;
  const queue = radar.data?.queueSize ?? 0;
  const sources = radar.data?.sources;

  const tiles = [
    { label: 'Sugestões pendentes', value: pending, icon: <Sparkles /> },
    { label: 'Pautas registradas', value: totalPautas, icon: <ListTodo /> },
    { label: 'Itens na fila do radar', value: queue, icon: <Radar /> },
  ];

  return (
    <div>
      <StepHeader icon={<Radar />} eyebrow="Análise inicial" title="O que encontramos até agora" subtitle="Números reais do seu ambiente neste momento." />
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {tiles.map((t, i) => (
              <Reveal key={t.label} i={3 + i}>
                <div className="rounded-2xl bg-sunken/70 p-4 ring-1 ring-line">
                  <div className="flex items-center justify-between text-fg-3 [&_svg]:size-4">
                    <span className="text-xs font-medium">{t.label}</span>
                    {t.icon}
                  </div>
                  <div className="tabular mt-2 text-[38px] font-semibold leading-none tracking-[-0.03em] text-fg">{t.value}</div>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal i={6} className="mt-5">
            {pending === 0 && totalPautas === 0 ? (
              <Note tone="info" icon={<Sparkles />} title="Ainda não há demandas identificadas">
                {queue > 0
                  ? `O radar ainda está analisando ${queue} item(ns) na fila. As sugestões aparecerão no Radar Inteligente assim que ficarem prontas.`
                  : 'Isso é normal se a conta ainda não foi conectada ou se não há pedidos recentes nas fontes escolhidas. Você pode criar pautas manualmente a qualquer momento.'}
              </Note>
            ) : pending > 0 ? (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-fg-3">Primeiras sugestões para revisar</div>
                <div className="space-y-1.5">
                  {(sug.data ?? [])
                    .slice()
                    .sort((a, b) => b.confidence - a.confidence)
                    .slice(0, 3)
                    .map((s) => (
                      <div key={s.id} className="flex items-center gap-3 rounded-xl bg-sunken/70 px-3.5 py-2.5 ring-1 ring-line">
                        <Sparkles className="size-4 shrink-0 text-accent" />
                        <span className="min-w-0 flex-1 truncate text-sm text-fg">{s.title}</span>
                        <span className="tabular shrink-0 text-xs text-fg-3">{Math.round(s.confidence * 100)}%</span>
                      </div>
                    ))}
                </div>
                <p className="mt-2 text-xs text-fg-3">Nada vira pauta sem a sua aprovação no Radar Inteligente.</p>
              </div>
            ) : (
              <Note tone="success" icon={<CheckCircle2 />}>
                Nenhuma sugestão pendente no momento — suas {totalPautas} pauta(s) já estão organizadas.
              </Note>
            )}
          </Reveal>
          {sources && (
            <Reveal i={7} className="mt-4 grid gap-2 sm:grid-cols-3">
              {(
                [
                  ['Outlook', sources.outlook],
                  ['Planner', sources.planner],
                  ['Calendário', sources.calendar],
                ] as const
              ).map(([n, s]) => (
                <div key={n} className="rounded-xl px-3 py-2 text-xs ring-1 ring-line">
                  <div className="flex items-center gap-1.5 font-medium text-fg">
                    <span className={cn('size-1.5 rounded-full', s.available ? 'bg-success' : 'bg-fg-3')} />
                    {n}
                  </div>
                  <div className="mt-0.5 text-fg-3">{s.available ? `${s.items} itens · ${fmtRelative(s.lastSyncAt)}` : s.detail || 'Indisponível'}</div>
                </div>
              ))}
            </Reveal>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 10 · Apresentação do painel                                         */
/* ------------------------------------------------------------------ */

export function TourStep() {
  const areas = [
    { icon: <LayoutDashboard />, title: 'Dashboard', text: 'Saudação, foco do dia, indicadores e o que pede atenção agora.' },
    { icon: <Radar />, title: 'Radar Inteligente', text: 'Sugestões detectadas — aprove, ignore ou adie com um clique.' },
    { icon: <ListTodo />, title: 'Pautas', text: 'Kanban, lista, calendário, linha do tempo e matriz.' },
    { icon: <ArrowUpWideNarrow />, title: 'Prioridades', text: 'Ranking recomendado com a justificativa de cada posição.' },
    { icon: <CalendarRange />, title: 'Minha Semana', text: 'Carga por dia comparada à sua capacidade.' },
    {
      icon: <Command />,
      title: 'Busca rápida',
      text: (
        <>
          Pressione <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> em qualquer tela para navegar e agir.
        </>
      ),
    },
  ];
  return (
    <div>
      <StepHeader icon={<LayoutDashboard />} eyebrow="Tudo pronto" title="Seu painel está pronto" subtitle="Um tour rápido pelas áreas principais — você pode refazer este assistente em Configurações." />
      <div className="grid gap-3 sm:grid-cols-2">
        {areas.map((a, i) => (
          <Reveal key={a.title} i={3 + i}>
            <div className="flex h-full gap-3 rounded-2xl bg-sunken/70 p-4 ring-1 ring-line">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent [&_svg]:size-[18px]">{a.icon}</div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-fg">{a.title}</div>
                <p className="mt-0.5 text-[13px] leading-relaxed text-fg-3">{a.text}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
