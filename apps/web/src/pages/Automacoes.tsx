import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  ArrowRight,
  ArrowUpWideNarrow,
  CalendarDays,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleX,
  Clock,
  DatabaseBackup,
  Download,
  FileText,
  HardDrive,
  HeartPulse,
  Info,
  KanbanSquare,
  Mail,
  Play,
  Plus,
  Radar,
  RotateCcw,
  Timer,
  TriangleAlert,
  Workflow,
  Wrench,
} from 'lucide-react';
import { differenceInMilliseconds, parseISO } from 'date-fns';
import type { AutomationInfo, BackupInfo, HealthResponse, JobRun, JobState } from '@pautaflow/shared';
import { patch, post, useApiMutation, useAutomations, useBackups, useHealth } from '@/lib/queries';
import { cn, bytes, download, fmtDateTime, fmtRelative } from '@/lib/utils';
import { toast } from '@/stores/toast';
import { Badge, Button, CardHeader, EmptyState, GlassCard, PageHeader, Skeleton, Switch, Tip, useConfirm, type Tone } from '@/components/ui';

/* ------------------------------------------------------------------ */
/* Rótulos                                                             */
/* ------------------------------------------------------------------ */

const JOB_ICON: Record<string, ReactNode> = {
  'outlook-sync': <Mail />,
  'planner-sync': <KanbanSquare />,
  'calendar-sync': <CalendarDays />,
  'radar-analysis': <Radar />,
  'priority-radar': <ArrowUpWideNarrow />,
  'daily-summary': <FileText />,
  'weekly-summary': <FileText />,
  'monthly-summary': <FileText />,
  backup: <DatabaseBackup />,
  maintenance: <Wrench />,
};

const JOB_STATUS: Record<JobState['lastStatus'], { label: string; tone: Tone; icon: ReactNode }> = {
  idle: { label: 'Aguardando', tone: 'neutral', icon: <CircleDashed /> },
  running: { label: 'Executando', tone: 'accent', icon: <span className="size-1.5 animate-ping rounded-full bg-current" /> },
  success: { label: 'Sucesso', tone: 'success', icon: <CircleCheck /> },
  error: { label: 'Erro', tone: 'critical', icon: <CircleX /> },
  skipped: { label: 'Ignorada', tone: 'warning', icon: <CircleMinus /> },
};

const TRIGGER_LABEL: Record<JobRun['trigger'], string> = { schedule: 'Agendada', manual: 'Manual', startup: 'Inicialização', chain: 'Encadeada' };

const BACKUP_REASON: Record<string, string> = {
  daily: 'Diário automático',
  manual: 'Manual',
  'pre-op': 'Antes de operação',
  'pre-restore': 'Antes de restauração',
};

const HEALTH: Record<HealthResponse['status'], { label: string; text: string; cls: string; dot: string }> = {
  ok: { label: 'Tudo funcionando', text: 'Todos os serviços locais estão operando normalmente.', cls: 'bg-success/12 text-success ring-success/25', dot: 'bg-success' },
  degraded: { label: 'Requer atenção', text: 'Alguns componentes precisam de atenção — veja os detalhes abaixo.', cls: 'bg-warning/14 text-amber-600 ring-warning/30 dark:text-amber-300', dot: 'bg-warning' },
  error: { label: 'Com problemas', text: 'Há componentes com erro. As automações afetadas podem não estar rodando.', cls: 'bg-critical/12 text-critical ring-critical/25', dot: 'bg-critical' },
};
const CHECK_DOT: Record<'ok' | 'warning' | 'error', string> = { ok: 'bg-success', warning: 'bg-warning', error: 'bg-critical' };

function uptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}min`;
  return `${m}min`;
}

function duration(run: JobRun): string {
  if (!run.finishedAt) return '—';
  const ms = differenceInMilliseconds(parseISO(run.finishedAt), parseISO(run.startedAt));
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`;
  return `${Math.floor(ms / 60_000)}min ${Math.round((ms % 60_000) / 1000)}s`;
}

function When({ iso, empty = 'nunca' }: { iso: string | null; empty?: string }) {
  if (!iso) return <span className="text-fg-3">{empty}</span>;
  return (
    <Tip content={fmtDateTime(iso)}>
      <span className="cursor-default">{fmtRelative(iso)}</span>
    </Tip>
  );
}

/* ------------------------------------------------------------------ */
/* Saúde                                                               */
/* ------------------------------------------------------------------ */

function HealthPanel() {
  const { data, isLoading } = useHealth();
  if (isLoading || !data) {
    return (
      <GlassCard className="mb-6 !rounded-[28px]">
        <Skeleton className="mb-5 h-8 w-64" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20 !rounded-2xl" />
          ))}
        </div>
      </GlassCard>
    );
  }
  const h = HEALTH[data.status];
  return (
    <GlassCard strong className="relative mb-6 overflow-hidden !rounded-[28px] p-6">
      <div className={cn('pointer-events-none absolute -left-20 -top-28 size-72 rounded-full opacity-20 blur-3xl', h.dot)} />
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="grid size-12 place-items-center rounded-2xl bg-flow text-white shadow-[0_12px_30px_-12px_var(--pf-accent)] [&_svg]:size-6">
            <HeartPulse />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-fg">Saúde do sistema</h2>
              <span className={cn('inline-flex h-7 items-center gap-2 rounded-full px-3 text-[12.5px] font-semibold ring-1 ring-inset', h.cls)}>
                <span className="relative flex size-2">
                  <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', h.dot)} />
                  <span className={cn('relative size-2 rounded-full', h.dot)} />
                </span>
                {h.label}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-fg-2">{h.text}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-2xl bg-sunken px-4 py-2.5 text-sm ring-1 ring-line">
          <Timer className="size-4 text-fg-3" />
          <span className="text-fg-3">Em execução há</span>
          <span className="tabular font-semibold text-fg">{uptime(data.uptimeSeconds)}</span>
        </div>
      </div>
      <div className="relative mt-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {data.checks.map((c, i) => (
          <motion.div
            key={c.key}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, duration: 0.35 }}
            className={cn('rounded-2xl bg-sunken p-3.5 ring-1 ring-line', c.status === 'error' && 'bg-critical/8 ring-critical/25', c.status === 'warning' && 'bg-warning/8 ring-warning/25')}
          >
            <div className="flex items-center gap-2">
              <span className={cn('size-2 shrink-0 rounded-full', CHECK_DOT[c.status])} />
              <span className="truncate text-[13px] font-semibold text-fg">{c.label}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-fg-2" title={c.detail}>
              {c.detail}
            </p>
          </motion.div>
        ))}
      </div>
    </GlassCard>
  );
}

/* ------------------------------------------------------------------ */
/* Cartão de automação                                                 */
/* ------------------------------------------------------------------ */

function JobCard({ job, index }: { job: AutomationInfo; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useApiMutation((enabled: boolean) => patch<JobState>(`/api/automations/${job.id}`, { enabled }), {
    invalidate: ['automations', 'health'],
    success: (r) => (r.enabled ? `${job.name} ativada` : `${job.name} pausada`),
  });
  const run = useApiMutation(() => post<JobState>(`/api/automations/${job.id}/run`), { invalidate: ['automations', 'health'] });

  const running = job.lastStatus === 'running' || run.isPending;
  const st = JOB_STATUS[running ? 'running' : job.lastStatus];
  const history = [...job.history].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 12);
  const msHint = job.requires && /microsoft|integra/i.test(job.requires);

  const runNow = () =>
    run.mutate(undefined, {
      onSuccess: (r) => {
        const msg = r.lastMessage ? `${job.name}: ${r.lastMessage}` : `${job.name} concluída`;
        if (r.lastStatus === 'error') toast.error(msg);
        else if (r.lastStatus === 'skipped') toast.info(msg);
        else toast.success(msg);
      },
    });

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: Math.min(index, 10) * 0.04, ease: [0.22, 1, 0.36, 1] }}>
      <GlassCard className={cn('flex h-full flex-col !rounded-[24px]', !job.enabled && 'opacity-75')}>
        <div className="flex items-start gap-3">
          <span className={cn('grid size-10 shrink-0 place-items-center rounded-[14px] [&_svg]:size-[18px]', job.available ? 'bg-accent-soft text-accent' : 'bg-sunken text-fg-3')}>
            {JOB_ICON[job.id] ?? <Workflow />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">{job.name}</h3>
              <Badge tone={st.tone} icon={st.icon}>
                {st.label}
              </Badge>
              {job.consecutiveErrors > 1 && <Badge tone="critical">{job.consecutiveErrors} falhas seguidas</Badge>}
            </div>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-2">{job.description}</p>
          </div>
          <Switch checked={job.enabled} onCheckedChange={(v) => toggle.mutate(v)} disabled={toggle.isPending} label={job.enabled ? `Pausar ${job.name}` : `Ativar ${job.name}`} />
        </div>

        {!job.available && job.requires && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-warning/10 px-3 py-2.5 text-[12.5px] text-amber-700 ring-1 ring-inset ring-warning/25 dark:text-amber-300">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span className="flex-1">{job.requires}</span>
            {msHint && (
              <Link to="/integracoes" className="inline-flex shrink-0 items-center gap-1 font-semibold hover:underline">
                Integrações <ArrowRight className="size-3" />
              </Link>
            )}
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12.5px] sm:grid-cols-4">
          <div>
            <div className="text-[11px] text-fg-3">Agenda</div>
            <div className="mt-0.5 flex items-center gap-1 font-medium text-fg">
              <Clock className="size-3 text-fg-3" />
              {job.schedule}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-fg-3">Última execução</div>
            <div className="mt-0.5 font-medium text-fg">
              <When iso={job.lastRunAt} />
            </div>
          </div>
          <div>
            <div className="text-[11px] text-fg-3">Próxima</div>
            <div className="mt-0.5 font-medium text-fg">{job.enabled ? <When iso={job.nextRunAt} empty="—" /> : <span className="text-fg-3">pausada</span>}</div>
          </div>
          <div>
            <div className="text-[11px] text-fg-3">Último sucesso</div>
            <div className="mt-0.5 font-medium text-fg">
              <When iso={job.lastSuccessAt} />
            </div>
          </div>
        </div>

        {job.lastMessage && (
          <p className={cn('mt-3 rounded-xl bg-sunken px-3 py-2 text-[12.5px] leading-relaxed ring-1 ring-line', job.lastStatus === 'error' ? 'text-critical' : 'text-fg-2')}>{job.lastMessage}</p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-3 pt-4">
          <div className="tabular flex items-center gap-3 text-[12px] text-fg-3">
            <span>
              <strong className="font-semibold text-fg">{job.totalRuns.toLocaleString('pt-BR')}</strong> execuções
            </span>
            <span>
              <strong className="font-semibold text-fg">{job.totalProcessed.toLocaleString('pt-BR')}</strong> processados
            </span>
            <span>
              <strong className={cn('font-semibold', job.totalErrors ? 'text-critical' : 'text-fg')}>{job.totalErrors.toLocaleString('pt-BR')}</strong> erros
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            {history.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
                Histórico
                <ChevronDown className={cn('transition-transform duration-300', expanded && 'rotate-180')} />
              </Button>
            )}
            <Tip content={!job.available ? (job.requires ?? 'Indisponível no momento') : undefined}>
              <span>
                <Button size="sm" variant="subtle" onClick={runNow} loading={run.isPending} disabled={!job.available || job.lastStatus === 'running'}>
                  {!run.isPending && <Play />}
                  {run.isPending ? 'Executando…' : 'Executar agora'}
                </Button>
              </span>
            </Tip>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
              <div className="mt-3 divide-y divide-line overflow-hidden rounded-2xl bg-sunken ring-1 ring-line">
                {history.map((r) => {
                  const s = JOB_STATUS[r.status];
                  return (
                    <div key={r.startedAt} className="flex items-start gap-3 px-3.5 py-2.5 text-[12px]">
                      <span className={cn('mt-1 size-2 shrink-0 rounded-full', r.status === 'success' ? 'bg-success' : r.status === 'error' ? 'bg-critical' : r.status === 'running' ? 'bg-accent' : 'bg-warning')} title={s.label} />
                      <div className="min-w-0 flex-1">
                        <div className="tabular flex flex-wrap items-center gap-x-2 text-fg-2">
                          <span className="font-medium text-fg">{fmtDateTime(r.startedAt)}</span>
                          <span>· {TRIGGER_LABEL[r.trigger]}</span>
                          <span>· {duration(r)}</span>
                          <span>· {r.processed} proc.</span>
                        </div>
                        {r.message && <p className={cn('mt-0.5 break-words', r.status === 'error' ? 'text-critical' : 'text-fg-3')}>{r.message}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Backups                                                             */
/* ------------------------------------------------------------------ */

function BackupsPanel() {
  const { data: backups, isLoading } = useBackups();
  const { confirm, element } = useConfirm();
  const create = useApiMutation(() => post<BackupInfo>('/api/backups'), { invalidate: ['backups'], success: (b) => `Backup criado (${b.files} arquivos, ${bytes(b.bytes)})` });
  const [restoring, setRestoring] = useState<string | null>(null);
  const restore = useApiMutation((id: string) => post<{ restoredFiles: number; safetyBackup: string }>(`/api/backups/${id}/restore`), {
    invalidate: ['backups'],
    success: (r) => `Backup restaurado (${r.restoredFiles} arquivos). Cópia de segurança: ${r.safetyBackup}`,
  });

  const onRestore = async (b: BackupInfo) => {
    const ok = await confirm({
      title: 'Restaurar este backup?',
      body: (
        <div className="space-y-2">
          <p>
            Os dados atuais serão substituídos pelo backup de <strong className="text-fg">{fmtDateTime(b.createdAt)}</strong> ({BACKUP_REASON[b.reason] ?? b.reason}).
          </p>
          <p>Antes de restaurar, um backup de segurança do estado atual é criado automaticamente — você pode voltar a ele se precisar.</p>
        </div>
      ),
      confirm: 'Restaurar',
      danger: true,
    });
    if (!ok) return;
    setRestoring(b.id);
    restore.mutate(b.id, { onSettled: () => setRestoring(null) });
  };

  return (
    <GlassCard className="!rounded-[24px]">
      <CardHeader
        icon={<HardDrive />}
        title="Backups"
        subtitle="Cópias JSON locais dos seus dados"
        action={
          <>
            <Button size="sm" variant="ghost" onClick={() => download('/api/export')}>
              <Download />
              Exportar todos os dados (JSON)
            </Button>
            <Button size="sm" variant="primary" onClick={() => create.mutate(undefined)} loading={create.isPending}>
              {!create.isPending && <Plus />}
              Criar backup agora
            </Button>
          </>
        }
      />
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14 !rounded-xl" />
          ))}
        </div>
      ) : !backups?.length ? (
        <EmptyState
          icon={<DatabaseBackup />}
          title="Nenhum backup ainda"
          description="O backup diário roda automaticamente no horário configurado. Você também pode criar um agora."
          className="py-8"
        />
      ) : (
        <div className="max-h-[420px] divide-y divide-line overflow-y-auto rounded-2xl bg-sunken ring-1 ring-line">
          {backups.map((b, i) => (
            <div key={b.id} className="flex items-center gap-3 px-4 py-3">
              <span className={cn('grid size-8 shrink-0 place-items-center rounded-xl [&_svg]:size-4', i === 0 ? 'bg-accent-soft text-accent' : 'bg-surface text-fg-3')}>
                <DatabaseBackup />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular text-[13px] font-semibold text-fg">{fmtDateTime(b.createdAt)}</span>
                  <Badge tone={b.reason === 'manual' ? 'accent' : b.reason === 'daily' ? 'neutral' : 'info'}>{BACKUP_REASON[b.reason] ?? b.reason}</Badge>
                  {i === 0 && <span className="text-[11px] text-fg-3">mais recente</span>}
                </div>
                <div className="tabular mt-0.5 text-[11.5px] text-fg-3">
                  {fmtRelative(b.createdAt)} · {b.files} arquivo(s) · {bytes(b.bytes)}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => void onRestore(b)} loading={restoring === b.id} disabled={!!restoring && restoring !== b.id}>
                {restoring !== b.id && <RotateCcw />}
                Restaurar
              </Button>
            </div>
          ))}
        </div>
      )}
      {element}
    </GlassCard>
  );
}

/* ------------------------------------------------------------------ */
/* Página                                                              */
/* ------------------------------------------------------------------ */

export default function Automacoes() {
  const { data: jobs, isLoading } = useAutomations();
  const active = jobs?.filter((j) => j.enabled && j.available).length ?? 0;
  const errors = jobs?.filter((j) => j.lastStatus === 'error').length ?? 0;

  return (
    <div>
      <PageHeader
        eyebrow="Sistema"
        title="Central de Automações"
        subtitle={jobs ? `${active} de ${jobs.length} automações ativas${errors ? ` · ${errors} com erro na última execução` : ''}` : 'Rotinas que mantêm suas pautas, radar e resumos sempre atualizados.'}
      />

      <HealthPanel />

      <div className="mb-6 flex items-start gap-3 rounded-2xl bg-accent-soft px-4 py-3 text-[13px] leading-relaxed text-fg-2 ring-1 ring-inset ring-accent/15">
        <Info className="mt-0.5 size-4 shrink-0 text-accent" />
        <p>
          As automações rodam no <strong className="font-semibold text-fg">serviço local</strong> do PautaFlow, não no navegador. O radar continua monitorando Outlook, Planner e calendário mesmo com esta aba fechada, enquanto o processo estiver em execução no computador.
        </p>
      </div>

      <div className="mb-3 flex items-center gap-2 px-1">
        <Activity className="size-4 text-fg-3" />
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-fg-3">Rotinas</h2>
      </div>
      {isLoading ? (
        <div className="mb-8 grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[230px] !rounded-[24px]" />
          ))}
        </div>
      ) : !jobs?.length ? (
        <GlassCard className="mb-8">
          <EmptyState icon={<Workflow />} title="Nenhuma automação registrada" description="O serviço local registra as rotinas ao iniciar. Reinicie o PautaFlow se esta lista continuar vazia." />
        </GlassCard>
      ) : (
        <div className="mb-8 grid items-start gap-4 lg:grid-cols-2">
          {jobs.map((j, i) => (
            <JobCard key={j.id} job={j} index={i} />
          ))}
        </div>
      )}

      <BackupsPanel />
    </div>
  );
}
