import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Archive, ArrowRight, CalendarDays, CheckCircle2, Inbox, KanbanSquare, ListChecks, Mail, Plug, Radar as RadarIcon, ScanSearch, Sparkles, Timer } from 'lucide-react';
import type { Pauta, RadarStatus, SourceStatus, Sugestao } from '@pautaflow/shared';
import { cn, fmtRelative } from '@/lib/utils';
import { post, useApiMutation, useRadarStatus, useSugestoes, useSuggestionAction } from '@/lib/queries';
import { useUi } from '@/stores/ui';
import { toast } from '@/stores/toast';
import { Button, EmptyState, GlassCard, Segmented, Skeleton } from '@/components/ui';
import { CountUp } from '@/components/charts/kit';
import { RadarVisual } from '@/components/radar/RadarVisual';
import { SuggestionCard, type SuggestionHandlers } from '@/components/radar/SuggestionCard';
import { ApproveDialog, EditDialog, LinkDialog, type ApproveOverrides } from '@/components/radar/dialogs';

type Tab = 'pending' | 'snoozed' | 'processed';
const TAB_QUERY: Record<Tab, string> = { pending: 'pending', snoozed: 'snoozed', processed: 'approved,linked,ignored' };

export default function Radar() {
  const [tab, setTab] = useState<Tab>('pending');
  const { data: status, isLoading: statusLoading } = useRadarStatus();
  const { data: list = [], isLoading } = useSugestoes(TAB_QUERY[tab]);
  const action = useSuggestionAction();
  const { openPauta } = useUi();
  const reduce = useReducedMotion();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [approving, setApproving] = useState<Sugestao | null>(null);
  const [editing, setEditing] = useState<Sugestao | null>(null);
  const [linking, setLinking] = useState<Sugestao | null>(null);

  const hide = (id: string, on: boolean) =>
    setHidden((h) => {
      const n = new Set(h);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  /** Executa a ação com saída animada otimista do card. */
  const run = (s: Sugestao, act: 'approve' | 'ignore' | 'snooze' | 'link' | 'restore', body: unknown, onDone?: (res: unknown) => void) => {
    setBusy(s.id);
    action.mutate(
      { id: s.id, action: act, body },
      {
        onSuccess: (res) => {
          // Restaurar a partir de "Desfazer" na aba Pendentes traz o card de volta
          hide(s.id, act !== 'restore' || tab !== 'pending');
          onDone?.(res);
        },
        onSettled: () => setBusy(null),
      },
    );
  };

  const restore = (s: Sugestao) => run(s, 'restore', {}, () => toast.success('Sugestão restaurada para pendentes'));

  const handlers: SuggestionHandlers = {
    onApprove: (s) => setApproving(s),
    onEdit: (s) => setEditing(s),
    onIgnore: (s) => run(s, 'ignore', {}, () => toast.info('Sugestão ignorada', { label: 'Desfazer', onClick: () => restore(s) })),
    onSnooze: (s, until, label) => run(s, 'snooze', { until }, () => toast.info(`Sugestão adiada (${label})`, { label: 'Desfazer', onClick: () => restore(s) })),
    onLinkPicker: (s) => setLinking(s),
    onLinkTo: (s, pautaId, title) => run(s, 'link', { pautaId }, () => toast.success(`Vinculada a “${title}”`, { label: 'Abrir pauta', onClick: () => openPauta(pautaId) })),
    onRestore: restore,
  };

  const approve = (s: Sugestao, body: ApproveOverrides) =>
    run(s, 'approve', body, (res) => {
      setApproving(null);
      const p = res as Pauta;
      toast.success('Pauta criada a partir da sugestão', { label: 'Abrir pauta', onClick: () => openPauta(p.id) });
    });

  const link = (s: Sugestao, p: Pauta) =>
    run(s, 'link', { pautaId: p.id }, () => {
      setLinking(null);
      toast.success(`Vinculada a “${p.title}”`, { label: 'Abrir pauta', onClick: () => openPauta(p.id) });
    });

  const visible = list.filter((s) => !hidden.has(s.id));
  const anySource = !!status && (status.sources.outlook.available || status.sources.planner.available || status.sources.calendar.available);

  return (
    <div className="pb-12">
      <RadarHeader status={status} loading={statusLoading} />

      {!statusLoading && status && !anySource && <ConnectCta />}

      <div className="mb-4 mt-8 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          id="radar-tab"
          value={tab}
          onChange={(t) => {
            setTab(t);
            setHidden(new Set());
          }}
          options={[
            { value: 'pending', label: <TabLabel text="Pendentes" count={status?.pending} />, icon: <Inbox /> },
            { value: 'snoozed', label: <TabLabel text="Adiadas" count={status?.snoozed} />, icon: <Timer /> },
            { value: 'processed', label: 'Processadas', icon: <Archive /> },
          ]}
        />
        <p className="text-[12.5px] text-fg-3">
          {tab === 'pending' && 'Revise o que o radar identificou. Nada vira pauta sem a sua aprovação.'}
          {tab === 'snoozed' && 'Sugestões adiadas voltam para pendentes automaticamente na data escolhida.'}
          {tab === 'processed' && 'Histórico de sugestões aprovadas, vinculadas ou ignoradas.'}
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-64 !rounded-[22px]" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <GlassCard>
          <TabEmpty tab={tab} anySource={anySource} />
        </GlassCard>
      ) : (
        <motion.div layout={!reduce} className="space-y-4">
          <AnimatePresence initial={false} mode="popLayout">
            {visible.map((s, i) => (
              <motion.div
                key={s.id}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 8) * 0.04, duration: 0.45, ease: [0.22, 1, 0.36, 1] } }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, x: 40, scale: 0.97, transition: { duration: 0.28 } }}
              >
                <SuggestionCard s={s} handlers={handlers} busy={busy === s.id} />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <ApproveDialog sugestao={approving} onClose={() => setApproving(null)} onConfirm={approve} loading={!!approving && busy === approving.id} />
      <EditDialog sugestao={editing} onClose={() => setEditing(null)} />
      <LinkDialog sugestao={linking} onClose={() => setLinking(null)} onPick={link} loading={!!linking && busy === linking.id} />
    </div>
  );
}

function TabLabel({ text, count }: { text: string; count?: number }) {
  return (
    <span className="flex items-center gap-1.5">
      {text}
      {!!count && <span className="tabular rounded-full bg-accent px-1.5 text-[10.5px] font-semibold leading-4 text-white">{count}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Cabeçalho com status                                                */
/* ------------------------------------------------------------------ */

function RadarHeader({ status, loading }: { status: RadarStatus | undefined; loading: boolean }) {
  const scan = useApiMutation(() => post<{ started: boolean }>('/api/radar/scan'), {
    invalidate: ['radar'],
    success: 'Varredura iniciada: sincronizando Outlook, Planner e Calendário e analisando novas mensagens.',
  });
  const enabled = status?.enabled ?? true;
  return (
    <div className="glass glass-strong relative overflow-hidden p-6 sm:p-7">
      <div className="pointer-events-none absolute -right-20 -top-24 -z-10 size-96 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--pf-accent-2)_22%,transparent),transparent_70%)] blur-2xl" />
      <div className="flex flex-col gap-6 md:flex-row md:items-center">
        <RadarVisual size={124} blips={status?.pending ?? 0} active={enabled} />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-fg-3">
            <Sparkles className="size-3.5 text-accent" /> Radar Inteligente
            {!enabled && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] text-amber-600 dark:text-amber-300">Desativado nas configurações</span>}
          </div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em] text-fg sm:text-[32px]">
            {loading ? 'Verificando fontes…' : status?.pending ? (
              <>
                <span className="text-gradient">
                  <CountUp value={status.pending} />
                </span>{' '}
                {status.pending === 1 ? 'demanda identificada' : 'demandas identificadas'}
              </>
            ) : status && !(status.sources.outlook.available || status.sources.planner.available || status.sources.calendar.available) ? (
              'Aguardando fontes conectadas'
            ) : (
              'Tudo revisado'
            )}
          </h1>
          <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-fg-2">
            O radar lê e-mails, tarefas do Planner e convites do calendário para detectar pedidos, prazos e aprovações — e sugere pautas com justificativa e evidência.
          </p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-fg-3">
            <Stat label="Fila de análise" value={status?.queueSize} />
            <Stat label="Processadas hoje" value={status?.processedToday} />
            <span>
              Última análise: <span className="font-medium text-fg-2">{status?.lastAnalysisAt ? fmtRelative(status.lastAnalysisAt) : 'nunca'}</span>
            </span>
            {status?.lastScanAt && (
              <span>
                Última varredura: <span className="font-medium text-fg-2">{fmtRelative(status.lastScanAt)}</span>
              </span>
            )}
          </div>
        </div>
        <Button variant="primary" size="lg" onClick={() => scan.mutate(undefined)} loading={scan.isPending} className="self-start md:self-center">
          {!scan.isPending && <ScanSearch />} Escanear agora
        </Button>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {loading || !status ? (
          Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[84px] !rounded-2xl" />)
        ) : (
          <>
            <SourceTile icon={<Mail />} name="Outlook" source={status.sources.outlook} unit="mensagens" />
            <SourceTile icon={<KanbanSquare />} name="Planner" source={status.sources.planner} unit="tarefas" />
            <SourceTile icon={<CalendarDays />} name="Calendário" source={status.sources.calendar} unit="eventos" />
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <span>
      {label}: <span className="tabular font-medium text-fg-2">{value ?? '—'}</span>
    </span>
  );
}

function SourceTile({ icon, name, source, unit }: { icon: ReactNode; name: string; source: SourceStatus; unit: string }) {
  return (
    <div className={cn('flex items-start gap-3 rounded-2xl bg-surface/70 p-3.5 ring-1 ring-inset ring-line', !source.available && 'opacity-80')}>
      <div className={cn('relative grid size-9 shrink-0 place-items-center rounded-xl [&_svg]:size-4', source.available ? 'bg-accent-soft text-accent' : 'bg-sunken text-fg-3')}>
        {icon}
        <span className={cn('absolute -right-0.5 -top-0.5 size-2.5 rounded-full ring-2 ring-[var(--pf-surface-strong)]', source.available ? 'bg-success' : 'bg-fg-3/60')} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13.5px] font-semibold text-fg">{name}</span>
          <span className={cn('text-[10.5px] font-semibold uppercase tracking-wide', source.available ? 'text-success' : 'text-fg-3')}>{source.available ? 'Ativo' : 'Indisponível'}</span>
        </div>
        <div className="tabular mt-0.5 text-[12px] text-fg-2">
          {source.items.toLocaleString('pt-BR')} {unit} · sinc. {source.lastSyncAt ? fmtRelative(source.lastSyncAt) : 'nunca'}
        </div>
        {source.detail && <div className="mt-0.5 line-clamp-2 text-[11.5px] text-fg-3">{source.detail}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* CTA de integração e estados vazios                                  */
/* ------------------------------------------------------------------ */

function ConnectCta() {
  const navigate = useNavigate();
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass relative mt-6 overflow-hidden p-6">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(120deg,color-mix(in_srgb,var(--pf-accent)_14%,transparent),transparent_60%)]" />
      <div className="flex flex-col gap-5 md:flex-row md:items-center">
        <div className="bg-flow grid size-12 shrink-0 place-items-center rounded-2xl text-white shadow-[0_10px_24px_-10px_var(--pf-accent)]">
          <Plug className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold tracking-[-0.015em] text-fg">Conecte o Microsoft 365 para o radar enxergar suas demandas</h2>
          <p className="mt-1 text-[13.5px] leading-relaxed text-fg-2">
            Para identificar pedidos em e-mails do Outlook, tarefas do Planner e convites do calendário, o radar precisa de acesso à sua conta Microsoft. A conexão é local e somente leitura.
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-fg-3">
            <ListChecks className="size-3.5 text-success" />
            Mesmo sem conexão, o PautaFlow já calcula prioridades e detecta pautas esquecidas ou paradas entre as suas pautas locais.
          </p>
        </div>
        <Button variant="primary" onClick={() => navigate('/integracoes')}>
          Conectar em Integrações <ArrowRight />
        </Button>
      </div>
    </motion.div>
  );
}

function TabEmpty({ tab, anySource }: { tab: Tab; anySource: boolean }) {
  const navigate = useNavigate();
  if (tab === 'pending')
    return (
      <EmptyState
        icon={anySource ? <CheckCircle2 /> : <RadarIcon />}
        title={anySource ? 'Nenhuma sugestão pendente' : 'O radar ainda não tem fontes conectadas'}
        description={
          anySource
            ? 'Você revisou tudo o que o radar encontrou. Novas demandas aparecem aqui assim que chegarem — ou clique em “Escanear agora”.'
            : 'Conecte o Microsoft 365 em Integrações para o radar analisar e-mails, tarefas do Planner e convites e sugerir novas pautas.'
        }
        action={
          !anySource ? (
            <Button variant="primary" onClick={() => navigate('/integracoes')}>
              <Plug /> Ir para Integrações
            </Button>
          ) : undefined
        }
      />
    );
  if (tab === 'snoozed') return <EmptyState icon={<Timer />} title="Nenhuma sugestão adiada" description="Use “Adiar” em uma sugestão pendente para revê-la mais tarde." />;
  return <EmptyState icon={<Archive />} title="Nada processado ainda" description="Sugestões aprovadas, vinculadas ou ignoradas ficam registradas aqui e podem ser restauradas." />;
}
