import { useState, type ReactNode } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  AlertTriangle,
  ArchiveRestore,
  Bell,
  CalendarClock,
  Clock,
  Download,
  FolderOpen,
  GitCommitHorizontal,
  Hash,
  Monitor,
  Moon,
  Palette,
  Pencil,
  Plus,
  Power,
  Radar,
  RotateCcw,
  Sparkles,
  Sun,
  Tags,
  Trash2,
  UserRound,
  Wrench,
  Paintbrush,
  Timer,
} from 'lucide-react';
import type { BootstrapResponse, Categoria, Configuracoes, HistoryEntry, UserProfile, VersionInfo } from '@pautaflow/shared';
import { Avatar, Badge, Button, Dialog, EmptyState, Field, Input, NativeSelect, Segmented, Skeleton, Switch, Tip, useConfirm } from '@/components/ui';
import {
  api,
  patch,
  post,
  useActivity,
  useApiMutation,
  useCategorias,
  useDeleteCategoria,
  useSaveCategoria,
  useSaveConfig,
  useVersion,
} from '@/lib/queries';
import { queryClient } from '@/lib/api';
import { cn, download, fmtDateTime, fmtRelative } from '@/lib/utils';
import { applyTheme } from '@/stores/ui';
import { toast } from '@/stores/toast';
import { ChipsInput, Note, NumberInput, PercentSlider, RowGroup, SectionCard, SettingRow, TimeInput, WEEKDAYS_LONG, WeekdayPicker, useDraft } from './shared';

type Cfg = Configuracoes;
const swallow = () => undefined;

/* ------------------------------------------------------------------ */
/* Perfil                                                              */
/* ------------------------------------------------------------------ */

export function PerfilSection({ id, profile }: { id: string; profile: UserProfile }) {
  const draft = useDraft({ name: profile.name, email: profile.email ?? '', role: profile.role ?? '' });
  const save = useApiMutation((b: { name: string; email: string | null; role: string | null }) => patch<UserProfile>('/api/profile', b), { invalidate: ['bootstrap'], success: 'Perfil atualizado' });
  const d = draft.value;
  const emailErr = d.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim()) ? 'E-mail inválido' : undefined;
  return (
    <SectionCard
      id={id}
      icon={<UserRound />}
      title="Perfil"
      description="Usado na saudação do painel e para reconhecer pedidos endereçados a você."
      dirty={draft.dirty}
      saving={save.isPending}
      onReset={draft.reset}
      onSave={() => {
        if (emailErr || !d.name.trim()) return toast.error(emailErr ?? 'Informe seu nome.');
        save.mutate({ name: d.name.trim(), email: d.email.trim() || null, role: d.role.trim() || null });
      }}
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <Avatar name={d.name || '?'} className="size-16 text-lg" />
        <div className="grid flex-1 gap-4 sm:grid-cols-2">
          <Field label="Nome" className="sm:col-span-2">
            <Input value={d.name} maxLength={80} onChange={(e) => draft.set('name', e.target.value)} placeholder="Como você quer ser chamado" />
          </Field>
          <Field label="E-mail corporativo" error={emailErr} hint="Opcional — ajuda o radar a identificar pedidos para você">
            <Input type="email" value={d.email} onChange={(e) => draft.set('email', e.target.value)} placeholder="voce@empresa.com" />
          </Field>
          <Field label="Cargo / função" hint="Opcional">
            <Input value={d.role} onChange={(e) => draft.set('role', e.target.value)} placeholder="Ex.: Analista de comunicação" />
          </Field>
        </div>
      </div>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Aparência                                                           */
/* ------------------------------------------------------------------ */

export function AparenciaSection({ id, config }: { id: string; config: Cfg }) {
  const draft = useDraft({ theme: config.theme, reduceTransparency: config.reduceTransparency });
  const save = useSaveConfig();
  const d = draft.value;
  return (
    <SectionCard
      id={id}
      icon={<Palette />}
      title="Aparência"
      description="Tema e materiais da interface."
      dirty={draft.dirty}
      saving={save.isPending}
      onReset={draft.reset}
      onSave={() =>
        void save
          .mutateAsync({ theme: d.theme, reduceTransparency: d.reduceTransparency })
          .then(() => {
            applyTheme(d.theme);
            document.documentElement.classList.toggle('pf-solid', d.reduceTransparency);
          })
          .catch(swallow)
      }
    >
      <div className="grid gap-4 md:grid-cols-3">
        {(
          [
            { v: 'system', label: 'Automático', hint: 'Segue a aparência do Windows', icon: <Monitor /> },
            { v: 'light', label: 'Claro', hint: 'Vidro luminoso', icon: <Sun /> },
            { v: 'dark', label: 'Escuro', hint: 'Vidro profundo', icon: <Moon /> },
          ] as const
        ).map((o) => {
          const on = d.theme === o.v;
          return (
            <button
              key={o.v}
              type="button"
              onClick={() => draft.set('theme', o.v)}
              aria-pressed={on}
              className={cn('group relative overflow-hidden rounded-2xl p-3 text-left ring-1 transition-all duration-300', on ? 'bg-accent-soft ring-2 ring-accent/60' : 'bg-sunken/60 ring-line hover:ring-line-strong')}
            >
              <ThemePreview mode={o.v} />
              <div className="mt-3 flex items-center gap-2">
                <span className={cn('[&_svg]:size-4', on ? 'text-accent' : 'text-fg-3')}>{o.icon}</span>
                <span className="text-sm font-semibold text-fg">{o.label}</span>
              </div>
              <div className="mt-0.5 text-xs text-fg-3">{o.hint}</div>
            </button>
          );
        })}
      </div>
      <RowGroup className="mt-5">
        <SettingRow title="Reduzir transparência" description="Troca o vidro por superfícies sólidas — mais contraste e menor uso de GPU.">
          <Switch checked={d.reduceTransparency} onCheckedChange={(v) => draft.set('reduceTransparency', v)} label="Reduzir transparência" />
        </SettingRow>
      </RowGroup>
    </SectionCard>
  );
}

function ThemePreview({ mode }: { mode: 'system' | 'light' | 'dark' }) {
  const pane = (dark: boolean) => (
    <div className={cn('relative h-full flex-1 overflow-hidden', dark ? 'bg-[#0b0f1a]' : 'bg-[#eef1f8]')}>
      <div className={cn('absolute -left-4 -top-6 size-16 rounded-full blur-xl', dark ? 'bg-indigo-600/50' : 'bg-indigo-300/70')} />
      <div className={cn('absolute -bottom-6 right-0 size-14 rounded-full blur-xl', dark ? 'bg-teal-600/40' : 'bg-teal-200/80')} />
      <div className={cn('absolute inset-x-2 top-2 h-3 rounded-md', dark ? 'bg-white/10' : 'bg-white/70')} />
      <div className={cn('absolute bottom-2 left-2 right-6 top-7 rounded-lg', dark ? 'bg-white/[0.07] ring-1 ring-white/10' : 'bg-white/60 ring-1 ring-white')} />
    </div>
  );
  return <div className="flex h-20 overflow-hidden rounded-xl ring-1 ring-line">{mode === 'system' ? <>{pane(false)}{pane(true)}</> : pane(mode === 'dark')}</div>;
}

/* ------------------------------------------------------------------ */
/* Expediente                                                          */
/* ------------------------------------------------------------------ */

export function ExpedienteSection({ id, config }: { id: string; config: Cfg }) {
  const draft = useDraft(config.workday);
  const save = useSaveConfig();
  const d = draft.value;
  const invalid = d.end <= d.start ? 'O fim do expediente deve ser depois do início.' : d.days.length === 0 ? 'Selecione pelo menos um dia útil.' : null;
  const [h1 = 0, m1 = 0] = d.start.split(':').map(Number);
  const [h2 = 0, m2 = 0] = d.end.split(':').map(Number);
  const span = Math.max(0, h2 * 60 + m2 - (h1 * 60 + m1)) / 60;
  return (
    <SectionCard
      id={id}
      icon={<CalendarClock />}
      title="Expediente"
      description="Define a sua capacidade diária — usada na Minha Semana, nos alertas de sobrecarga e no cálculo de prioridades."
      dirty={draft.dirty}
      saving={save.isPending}
      onReset={draft.reset}
      onSave={() => (invalid ? toast.error(invalid) : void save.mutateAsync({ workday: d }).catch(swallow))}
    >
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Início">
          <TimeInput value={d.start} onChange={(v) => draft.set('start', v)} />
        </Field>
        <Field label="Fim">
          <TimeInput value={d.end} onChange={(v) => draft.set('end', v)} />
        </Field>
        <Field label="Capacidade produtiva" hint={span ? `De ${span.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h de expediente` : undefined}>
          <NumberInput value={d.dailyCapacityHours} onChange={(v) => draft.set('dailyCapacityHours', v)} min={1} max={24} step={0.5} suffix="h/dia" />
        </Field>
      </div>
      <div className="mt-5">
        <div className="mb-2 text-xs font-medium text-fg-2">Dias úteis</div>
        <WeekdayPicker value={d.days} onChange={(v) => draft.set('days', v)} />
      </div>
      {invalid && <p className="mt-3 text-xs text-critical">{invalid}</p>}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Frequências                                                         */
/* ------------------------------------------------------------------ */

function GroupTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-fg-3 first:mt-0 [&_svg]:size-3.5">
      {icon}
      {children}
    </div>
  );
}

export function FrequenciasSection({ id, config }: { id: string; config: Cfg }) {
  const draft = useDraft(config.schedules);
  const save = useSaveConfig();
  const d = draft.value;
  const aggressive = d.outlookMinutes < 5 || d.plannerMinutes < 5 || d.calendarMinutes < 5;
  const min = (k: 'outlookMinutes' | 'plannerMinutes' | 'calendarMinutes' | 'radarMinutes' | 'prioritiesMinutes') => (
    <NumberInput value={d[k]} onChange={(v) => draft.set(k, Math.round(v))} min={1} max={1440} suffix="min" className="w-32" />
  );
  return (
    <SectionCard
      id={id}
      icon={<Timer />}
      title="Frequências"
      description="Com que frequência as automações rodam em segundo plano."
      dirty={draft.dirty}
      saving={save.isPending}
      onReset={draft.reset}
      onSave={() => void save.mutateAsync({ schedules: d }).catch(swallow)}
    >
      <Note tone={aggressive ? 'warning' : 'info'} icon={<AlertTriangle />} className="mb-5">
        O Microsoft Graph limita o volume de requisições por usuário. Intervalos menores que 5 minutos podem gerar bloqueios temporários (HTTP 429) — o PautaFlow respeita automaticamente os pedidos de espera, mas sincronizações muito frequentes não trazem ganho real.
      </Note>
      <GroupTitle icon={<ArchiveRestore />}>Sincronização Microsoft</GroupTitle>
      <RowGroup>
        <SettingRow title="Outlook (e-mails)">{min('outlookMinutes')}</SettingRow>
        <SettingRow title="Planner (tarefas)">{min('plannerMinutes')}</SettingRow>
        <SettingRow title="Calendário (eventos)">{min('calendarMinutes')}</SettingRow>
      </RowGroup>
      <GroupTitle icon={<Sparkles />}>Inteligência</GroupTitle>
      <RowGroup>
        <SettingRow title="Análise do radar" description="Processa a fila de itens novos e gera sugestões.">
          {min('radarMinutes')}
        </SettingRow>
        <SettingRow title="Recálculo de prioridades">{min('prioritiesMinutes')}</SettingRow>
      </RowGroup>
      <GroupTitle icon={<CalendarClock />}>Resumos</GroupTitle>
      <RowGroup>
        <SettingRow title="Resumo diário">
          <TimeInput value={d.dailySummaryTime} onChange={(v) => draft.set('dailySummaryTime', v)} className="w-32" />
        </SettingRow>
        <SettingRow title="Resumo semanal">
          <div className="flex gap-2">
            <NativeSelect value={d.weeklySummaryDay} onChange={(e) => draft.set('weeklySummaryDay', Number(e.target.value))} className="w-40">
              {WEEKDAYS_LONG.map((w, i) => (
                <option key={w} value={i}>
                  {w}
                </option>
              ))}
            </NativeSelect>
            <TimeInput value={d.weeklySummaryTime} onChange={(v) => draft.set('weeklySummaryTime', v)} className="w-32" />
          </div>
        </SettingRow>
        <SettingRow title="Resumo mensal" description="Dia do mês (1 a 28).">
          <NumberInput value={d.monthlySummaryDay} onChange={(v) => draft.set('monthlySummaryDay', Math.round(v))} min={1} max={28} suffix="dia" className="w-28" />
        </SettingRow>
      </RowGroup>
      <GroupTitle icon={<Wrench />}>Manutenção</GroupTitle>
      <RowGroup>
        <SettingRow title="Backup automático" description="Cópia diária dos dados locais.">
          <TimeInput value={d.backupTime} onChange={(v) => draft.set('backupTime', v)} className="w-32" />
        </SettingRow>
        <SettingRow title="Manutenção" description="Limpeza de históricos antigos e compactação.">
          <TimeInput value={d.maintenanceTime} onChange={(v) => draft.set('maintenanceTime', v)} className="w-32" />
        </SettingRow>
      </RowGroup>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Radar                                                               */
/* ------------------------------------------------------------------ */

export function RadarSection({ id, config }: { id: string; config: Cfg }) {
  const draft = useDraft(config.radar);
  const save = useSaveConfig();
  const d = draft.value;
  return (
    <SectionCard
      id={id}
      icon={<Radar />}
      title="Radar Inteligente"
      description="Como o radar identifica demandas em e-mails, tarefas e reuniões."
      dirty={draft.dirty}
      saving={save.isPending}
      onReset={draft.reset}
      onSave={() => void save.mutateAsync({ radar: d }).catch(swallow)}
    >
      <RowGroup>
        <SettingRow title="Radar ativo" description="Quando desligado, nenhuma sugestão nova é criada (as sincronizações continuam).">
          <Switch checked={d.enabled} onCheckedChange={(v) => draft.set('enabled', v)} label="Radar ativo" />
        </SettingRow>
        <SettingRow title="Analisar Itens Enviados" description="Detecta compromissos que você assumiu em respostas (ex.: “te envio até sexta”).">
          <Switch checked={d.analyzeSentItems} onCheckedChange={(v) => draft.set('analyzeSentItems', v)} label="Analisar Itens Enviados" />
        </SettingRow>
      </RowGroup>
      <div className="mt-5 grid gap-6 md:grid-cols-2">
        <Field label="Confiança mínima para sugerir" hint="Mais alto = menos sugestões, porém mais certeiras.">
          <PercentSlider value={d.minConfidence} onChange={(v) => draft.set('minConfidence', v)} />
        </Field>
        <Field label="Similaridade para apontar duplicata" hint="Acima deste valor, a sugestão é marcada como possível duplicata.">
          <PercentSlider value={d.duplicateThreshold} onChange={(v) => draft.set('duplicateThreshold', v)} />
        </Field>
      </div>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <Field label="Considerar esquecida após" hint="Sem atividade em uma pauta aberta.">
          <NumberInput value={d.forgottenAfterDays} onChange={(v) => draft.set('forgottenAfterDays', Math.round(v))} min={1} suffix="dias" />
        </Field>
        <Field label="Considerar parada após" hint="Pauta em andamento sem progresso.">
          <NumberInput value={d.staleAfterDays} onChange={(v) => draft.set('staleAfterDays', Math.round(v))} min={1} suffix="dias" />
        </Field>
      </div>
      <Field label="Remetentes ignorados" hint="E-mails ou domínios (ex.: noreply@, @newsletter.com). Pressione Enter para adicionar." className="mt-5">
        <ChipsInput value={d.ignoreSenders} onChange={(v) => draft.set('ignoreSenders', v)} placeholder="noreply@empresa.com" />
      </Field>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Notificações                                                        */
/* ------------------------------------------------------------------ */

const NOTIF_TYPES: { key: string; label: string; hint: string }[] = [
  { key: 'suggestion', label: 'Novas sugestões do radar', hint: 'Quando o radar identifica uma possível demanda.' },
  { key: 'critical', label: 'Pautas críticas', hint: 'Quando uma pauta passa a ser crítica.' },
  { key: 'deadline', label: 'Prazos próximos', hint: 'Antes do vencimento, conforme a antecedência abaixo.' },
  { key: 'overdue', label: 'Pautas atrasadas', hint: 'Quando um prazo vence sem conclusão.' },
  { key: 'approval', label: 'Aprovações pendentes', hint: 'Itens aguardando aprovação.' },
  { key: 'conflict', label: 'Conflitos de agenda', hint: 'Prazos que coincidem com reuniões ou sobrecarga.' },
  { key: 'integration_error', label: 'Erros de integração', hint: 'Falhas de sincronização com o Microsoft 365.' },
  { key: 'sync', label: 'Sincronizações', hint: 'Resumo de itens novos após sincronizar.' },
  { key: 'forgotten', label: 'Pautas esquecidas', hint: 'Pautas abertas sem atividade há dias.' },
  { key: 'meeting', label: 'Reuniões', hint: 'Aviso antes de cada reunião, com o link para entrar.' },
  { key: 'system', label: 'Sistema', hint: 'Backups, atualizações e avisos gerais.' },
];

export function NotificacoesSection({ id, config }: { id: string; config: Cfg }) {
  const n = config.notifications;
  const draft = useDraft({ inApp: n.inApp, quietHoursStart: n.quietHoursStart, quietHoursEnd: n.quietHoursEnd, deadlineWarningHours: n.deadlineWarningHours, meetingReminderMinutes: n.meetingReminderMinutes, maxNativePerHour: n.maxNativePerHour, types: n.types });
  const save = useSaveConfig();
  const d = draft.value;
  return (
    <SectionCard
      id={id}
      icon={<Bell />}
      title="Notificações"
      description={
        <>
          Avisos dentro do app e limites para alertas do Windows. As notificações nativas são ativadas em{' '}
          <Link to="/integracoes" className="font-medium text-accent hover:underline">
            Integrações
          </Link>
          .
        </>
      }
      dirty={draft.dirty}
      saving={save.isPending}
      onReset={draft.reset}
      onSave={() => void save.mutateAsync({ notifications: d }).catch(swallow)}
    >
      <RowGroup>
        <SettingRow title="Notificações no app" description="Central de notificações no topo da interface.">
          <Switch checked={d.inApp} onCheckedChange={(v) => draft.set('inApp', v)} label="Notificações no app" />
        </SettingRow>
        <SettingRow title="Horário de silêncio" description="Sem alertas do Windows neste intervalo.">
          <div className="flex items-center gap-2">
            <TimeInput value={d.quietHoursStart} onChange={(v) => draft.set('quietHoursStart', v)} className="w-28" />
            <span className="text-xs text-fg-3">até</span>
            <TimeInput value={d.quietHoursEnd} onChange={(v) => draft.set('quietHoursEnd', v)} className="w-28" />
          </div>
        </SettingRow>
        <SettingRow title="Antecedência de prazo">
          <NumberInput value={d.deadlineWarningHours} onChange={(v) => draft.set('deadlineWarningHours', Math.round(v))} min={1} max={168} suffix="horas" className="w-32" />
        </SettingRow>
        <SettingRow title="Aviso de reunião" description="Minutos antes do início (0 desliga). Aparece na tela, no sino e no Windows.">
          <NumberInput value={d.meetingReminderMinutes} onChange={(v) => draft.set('meetingReminderMinutes', Math.round(v))} min={0} max={120} suffix="min" className="w-32" />
        </SettingRow>
        <SettingRow title="Máximo de alertas do Windows" description="Evita interrupções em excesso.">
          <NumberInput value={d.maxNativePerHour} onChange={(v) => draft.set('maxNativePerHour', Math.round(v))} min={1} max={60} suffix="/hora" className="w-32" />
        </SettingRow>
      </RowGroup>
      <div className="mb-2 mt-6 text-xs font-semibold uppercase tracking-[0.12em] text-fg-3">Tipos de notificação</div>
      <div className="grid gap-2 md:grid-cols-2">
        {NOTIF_TYPES.map((t) => {
          const on = d.types[t.key] !== false;
          return (
            <div key={t.key} className="flex items-center justify-between gap-4 rounded-2xl bg-sunken/60 px-4 py-3 ring-1 ring-line">
              <div className="min-w-0">
                <div className="text-sm font-medium text-fg">{t.label}</div>
                <div className="text-xs text-fg-3">{t.hint}</div>
              </div>
              <Switch checked={on} onCheckedChange={(v) => draft.set('types', { ...d.types, [t.key]: v })} label={t.label} />
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Categorias                                                          */
/* ------------------------------------------------------------------ */

const SWATCHES = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#64748b', '#0ea5e9'];

export function CategoriasSection({ id }: { id: string }) {
  const cats = useCategorias();
  const del = useDeleteCategoria();
  const { confirm, element } = useConfirm();
  const [editing, setEditing] = useState<Partial<Categoria> | null>(null);

  const remove = async (c: Categoria) => {
    const ok = await confirm({ title: `Excluir “${c.name}”?`, body: 'As pautas desta categoria ficarão sem categoria. Esta ação não pode ser desfeita.', confirm: 'Excluir', danger: true });
    if (ok) del.mutate(c.id, { onSuccess: () => toast.success('Categoria excluída') });
  };

  return (
    <SectionCard
      id={id}
      icon={<Tags />}
      title="Categorias"
      description="Organizam as pautas. As palavras-chave ajudam o radar a classificar automaticamente as sugestões."
      action={
        <Button size="sm" variant="subtle" onClick={() => setEditing({ name: '', color: SWATCHES[0], keywords: [] })}>
          <Plus /> Nova categoria
        </Button>
      }
    >
      {element}
      {cats.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : !cats.data?.length ? (
        <EmptyState icon={<Tags />} title="Nenhuma categoria ainda" description="Crie categorias como “Eventos”, “Relatórios” ou “Comunicação interna” para agrupar suas pautas." />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-sunken/60 ring-1 ring-line">
          <AnimatePresence initial={false}>
            {cats.data.map((c) => (
              <motion.li key={c.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} className="group flex items-center gap-3 px-4 py-3">
                <span className="size-3 shrink-0 rounded-full ring-4" style={{ background: c.color, ['--tw-ring-color' as string]: `${c.color}33` }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-fg">{c.name}</div>
                  {c.keywords.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.keywords.slice(0, 8).map((k) => (
                        <span key={k} className="rounded-md bg-surface-strong px-1.5 py-0.5 text-[11px] text-fg-2 ring-1 ring-line">
                          {k}
                        </span>
                      ))}
                      {c.keywords.length > 8 && <span className="text-[11px] text-fg-3">+{c.keywords.length - 8}</span>}
                    </div>
                  ) : (
                    <div className="text-xs text-fg-3">Sem palavras-chave</div>
                  )}
                </div>
                <div className="flex gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                  <Tip content="Editar">
                    <Button variant="ghost" size="icon-sm" onClick={() => setEditing(c)} aria-label={`Editar ${c.name}`}>
                      <Pencil />
                    </Button>
                  </Tip>
                  <Tip content="Excluir">
                    <Button variant="ghost" size="icon-sm" onClick={() => void remove(c)} aria-label={`Excluir ${c.name}`}>
                      <Trash2 />
                    </Button>
                  </Tip>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      <CategoriaDialog value={editing} onClose={() => setEditing(null)} />
    </SectionCard>
  );
}

function CategoriaDialog({ value, onClose }: { value: Partial<Categoria> | null; onClose: () => void }) {
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()} title={value?.id ? 'Editar categoria' : 'Nova categoria'} description="As palavras-chave são comparadas com assunto e conteúdo dos itens analisados pelo radar.">
      {value && <CategoriaForm key={value.id ?? 'new'} initial={value} onClose={onClose} />}
    </Dialog>
  );
}

function CategoriaForm({ initial, onClose }: { initial: Partial<Categoria>; onClose: () => void }) {
  const [name, setName] = useState(initial.name ?? '');
  const [color, setColor] = useState(initial.color ?? '#6366f1');
  const [keywords, setKeywords] = useState<string[]>(initial.keywords ?? []);
  const save = useSaveCategoria();
  return (
    <form
      className="space-y-4 pb-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        save.mutate({ id: initial.id, name: name.trim(), color, keywords }, { onSuccess: onClose });
      }}
    >
      <Field label="Nome">
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Eventos" />
      </Field>
      <Field label="Cor">
        <div className="flex flex-wrap items-center gap-2">
          {SWATCHES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setColor(s)}
              aria-label={`Cor ${s}`}
              className={cn('size-7 rounded-full transition-transform hover:scale-110', color.toLowerCase() === s && 'ring-2 ring-fg/60 ring-offset-2 ring-offset-[var(--pf-surface-solid)]')}
              style={{ background: s }}
            />
          ))}
          <label className="relative grid size-7 cursor-pointer place-items-center overflow-hidden rounded-full ring-1 ring-line-strong" title="Cor personalizada">
            <Paintbrush className="size-3.5 text-fg-3" />
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
          </label>
        </div>
      </Field>
      <Field label="Palavras-chave" hint="Pressione Enter ou vírgula para adicionar.">
        <ChipsInput value={keywords} onChange={setKeywords} placeholder="evento, inscrição, palestra…" />
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" disabled={!name.trim()} loading={save.isPending}>
          Salvar categoria
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Inicialização com o Windows                                         */
/* ------------------------------------------------------------------ */

type Autostart = { supported: boolean; enabled: boolean; detail: string };

export function AutostartSection({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['autostart'], queryFn: ({ signal }) => api<Autostart>('/api/system/autostart', { signal }) });
  const { confirm, element } = useConfirm();
  const [busy, setBusy] = useState(false);

  const toggle = async (enable: boolean) => {
    const ok = await confirm({
      title: enable ? 'Iniciar o PautaFlow com o Windows?' : 'Parar de iniciar com o Windows?',
      body: enable ? (
        <div className="space-y-2">
          <p>
            Será criada uma tarefa no <b>Agendador de Tarefas</b> do Windows chamada <b>“PautaFlow Intelligence”</b>, que inicia o servidor local quando você faz logon.
          </p>
          <p>Não exige direitos de administrador e nenhum serviço é instalado. Você pode desativar a qualquer momento aqui.</p>
        </div>
      ) : (
        <p>
          A tarefa <b>“PautaFlow Intelligence”</b> será removida do Agendador de Tarefas. O PautaFlow continuará funcionando quando iniciado manualmente.
        </p>
      ),
      confirm: enable ? 'Ativar inicialização' : 'Remover tarefa',
      danger: !enable,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await post<Autostart>('/api/system/autostart', { enable, confirmed: true });
      queryClient.setQueryData(['autostart'], r);
      toast.success(enable ? 'Inicialização com o Windows ativada' : 'Inicialização com o Windows desativada');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard id={id} icon={<Power />} title="Inicialização com o Windows" description="Mantém o radar e as automações rodando desde o logon, sem você precisar abrir nada.">
      {element}
      {q.isLoading ? (
        <Skeleton className="h-16" />
      ) : q.isError ? (
        <Note tone="critical" icon={<AlertTriangle />}>
          {q.error.message}
        </Note>
      ) : q.data ? (
        <RowGroup>
          <SettingRow
            title={
              <span className="flex items-center gap-2">
                Iniciar com o Windows
                <Badge tone={q.data.enabled ? 'success' : 'neutral'}>{q.data.enabled ? 'Ativo' : 'Desativado'}</Badge>
              </span>
            }
            description={q.data.supported ? q.data.detail : 'Disponível apenas no Windows.'}
          >
            <Switch checked={q.data.enabled} disabled={!q.data.supported || busy} onCheckedChange={(v) => void toggle(v)} label="Iniciar com o Windows" />
          </SettingRow>
        </RowGroup>
      ) : null}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Versão                                                              */
/* ------------------------------------------------------------------ */

const CHANGE_TYPE: Record<string, { label: string; tone: 'accent' | 'success' | 'info' | 'neutral' }> = {
  feature: { label: 'Função nova', tone: 'accent' },
  fix: { label: 'Correção', tone: 'success' },
  visual: { label: 'Ajuste visual', tone: 'info' },
  manual: { label: 'Definida manualmente', tone: 'neutral' },
};

function nextVersion(p: VersionInfo['parts'], type: 'feature' | 'fix' | 'visual') {
  if (type === 'feature') return `${p.features + 1}.0.0`;
  if (type === 'fix') return `${p.features}.${p.fixes + 1}.0`;
  return `${p.features}.${p.fixes}.${p.visual + 1}`;
}

export function VersaoSection({ id }: { id: string }) {
  const v = useVersion();
  const { confirm, element } = useConfirm();
  const [message, setMessage] = useState('');
  const [manual, setManual] = useState('');
  const bump = useApiMutation((b: { type: 'feature' | 'fix' | 'visual'; message: string }) => post<VersionInfo>('/api/version/bump', b), {
    invalidate: ['version', 'bootstrap', 'history'],
    success: (r) => `Versão atualizada para ${r.version}`,
  });
  const set = useApiMutation((b: { version: string; message: string }) => post<VersionInfo>('/api/version/set', b), {
    invalidate: ['version', 'bootstrap', 'history'],
    success: (r) => `Versão definida: ${r.version}`,
  });
  const manualValid = /^\d+\.\d+\.\d+$/.test(manual.trim());

  const doBump = async (type: 'feature' | 'fix' | 'visual') => {
    if (!v.data) return;
    const next = nextVersion(v.data.parts, type);
    const ok = await confirm({ title: `Atualizar para ${next}?`, body: `A versão passará de ${v.data.version} para ${next} e o registro será adicionado ao histórico de alterações.`, confirm: 'Atualizar versão' });
    if (ok) bump.mutate({ type, message: message.trim() }, { onSuccess: () => setMessage('') });
  };

  const parts = v.data?.parts;
  return (
    <SectionCard id={id} icon={<Hash />} title="Versão" description="Versionamento próprio do PautaFlow no formato X.Y.Z.">
      {element}
      {v.isLoading || !v.data || !parts ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="space-y-6">
          <div className="grid items-center gap-6 md:grid-cols-[auto_1fr]">
            <div className="text-center md:text-left">
              <div className="tabular text-gradient text-[64px] font-semibold leading-none tracking-[-0.04em]">{v.data.version}</div>
              <div className="mt-1 text-xs text-fg-3">versão atual</div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  ['X', parts.features, 'Funções novas'],
                  ['Y', parts.fixes, 'Correções das funções atuais'],
                  ['Z', parts.visual, 'Correções visuais'],
                ] as const
              ).map(([l, n, t]) => (
                <div key={l} className="rounded-2xl bg-sunken/60 px-4 py-3 ring-1 ring-line">
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-xs font-semibold text-accent">{l}</span>
                    <span className="tabular text-xl font-semibold text-fg">{n}</span>
                  </div>
                  <div className="mt-1 text-xs text-fg-2">{t}</div>
                </div>
              ))}
            </div>
          </div>

          <Note tone="accent" icon={<GitCommitHorizontal />} title="Atualização automática a cada commit">
            O hook de commit lê a mensagem: prefixos <code className="font-mono text-[12px]">feat:</code> → X, <code className="font-mono text-[12px]">fix:</code> → Y, <code className="font-mono text-[12px]">style:</code> → Z. Também valem as marcações <code className="font-mono text-[12px]">[feature]</code>, <code className="font-mono text-[12px]">[fix]</code> e <code className="font-mono text-[12px]">[visual]</code>; use <code className="font-mono text-[12px]">[skip-version]</code> para não alterar a versão.
          </Note>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-2xl bg-sunken/60 p-4 ring-1 ring-line">
              <div className="text-sm font-semibold text-fg">Atualização manual</div>
              <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Descrição da alteração (opcional)" className="mt-3" />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => void doBump('feature')} loading={bump.isPending && bump.variables?.type === 'feature'}>
                  Função nova → {nextVersion(parts, 'feature')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void doBump('fix')} loading={bump.isPending && bump.variables?.type === 'fix'}>
                  Correção → {nextVersion(parts, 'fix')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void doBump('visual')} loading={bump.isPending && bump.variables?.type === 'visual'}>
                  Visual → {nextVersion(parts, 'visual')}
                </Button>
              </div>
            </div>
            <div className="rounded-2xl bg-sunken/60 p-4 ring-1 ring-line">
              <div className="text-sm font-semibold text-fg">Definir versão</div>
              <div className="mt-3 flex gap-2">
                <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="X.Y.Z" className="tabular w-32 font-mono" />
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-10"
                  disabled={!manualValid}
                  loading={set.isPending}
                  onClick={() => set.mutate({ version: manual.trim(), message: message.trim() }, { onSuccess: () => setManual('') })}
                >
                  Definir
                </Button>
              </div>
              <p className="mt-2 text-xs text-fg-3">{manual && !manualValid ? 'Use o formato X.Y.Z, por exemplo 2.3.1.' : 'Usa a descrição ao lado, se informada.'}</p>
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-fg-3">Histórico de alterações</div>
            {v.data.changelog.length === 0 ? (
              <p className="text-sm text-fg-3">Nenhuma alteração registrada ainda.</p>
            ) : (
              <ol className="max-h-80 space-y-1 overflow-y-auto pr-1">
                {v.data.changelog.map((c, i) => {
                  const t = CHANGE_TYPE[c.type] ?? { label: c.type, tone: 'neutral' as const };
                  return (
                    <li key={`${c.version}-${i}`} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-sunken">
                      <span className="tabular w-16 shrink-0 font-mono text-[13px] font-semibold text-fg">{c.version}</span>
                      <Badge tone={t.tone}>{t.label}</Badge>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-fg-2">{c.message || '—'}</span>
                      {c.commit && <span className="hidden shrink-0 font-mono text-[11px] text-fg-3 sm:block">{c.commit.slice(0, 7)}</span>}
                      <span className="shrink-0 text-xs text-fg-3">{fmtDateTime(c.date)}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Dados                                                               */
/* ------------------------------------------------------------------ */

export function DadosSection({ id, app }: { id: string; app: BootstrapResponse['app'] }) {
  const navigate = useNavigate();
  const save = useSaveConfig();
  const { confirm, element } = useConfirm();
  const redo = async () => {
    const ok = await confirm({ title: 'Refazer a configuração inicial?', body: 'O assistente de boas-vindas será aberto novamente. Seus dados, pautas e conexões são mantidos.', confirm: 'Abrir assistente' });
    if (!ok) return;
    try {
      const cfg = await save.mutateAsync({ onboardingCompleted: false, onboardingStep: 0 });
      queryClient.setQueryData<BootstrapResponse>(['bootstrap'], (old) => (old ? { ...old, config: cfg } : old));
      navigate('/onboarding');
    } catch {
      /* toast já exibido */
    }
  };
  return (
    <SectionCard id={id} icon={<FolderOpen />} title="Dados" description="Tudo fica em arquivos JSON locais, com backups automáticos.">
      {element}
      <div className="rounded-2xl bg-sunken/60 px-4 py-3 ring-1 ring-line">
        <div className="text-xs font-medium text-fg-3">Pasta de dados</div>
        <div className="mt-1 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg" title={app.dataDir}>
            {app.dataDir}
          </code>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void navigator.clipboard
                .writeText(app.dataDir)
                .then(() => toast.success('Caminho copiado'))
                .catch(() => toast.error('Não foi possível copiar'))
            }
          >
            Copiar
          </Button>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to="/automacoes">
          <Button variant="secondary" size="sm">
            <ArchiveRestore /> Backups e exportação
          </Button>
        </Link>
        <Button variant="secondary" size="sm" onClick={() => download('/api/export')}>
          <Download /> Exportar dados
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void redo()} loading={save.isPending}>
          {!save.isPending && <RotateCcw />} Refazer configuração inicial
        </Button>
      </div>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Atividade recente                                                   */
/* ------------------------------------------------------------------ */

const ACTOR: Record<HistoryEntry['actor'], string> = { user: 'Você', system: 'Sistema', radar: 'Radar', sync: 'Sincronização', assistant: 'Assistente' };
const ACTOR_DOT: Record<HistoryEntry['actor'], string> = { user: 'bg-accent', system: 'bg-slate-400', radar: 'bg-fuchsia-500', sync: 'bg-sky-500', assistant: 'bg-emerald-500' };

export function AtividadeSection({ id }: { id: string }) {
  const q = useActivity(50);
  return (
    <SectionCard id={id} icon={<Activity />} title="Atividade recente" description="As últimas 50 ações registradas no histórico local.">
      {q.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : !q.data?.length ? (
        <EmptyState icon={<Clock />} title="Nenhuma atividade registrada" description="Ações como criar pautas, aprovar sugestões e sincronizar aparecerão aqui." />
      ) : (
        <ol className="relative max-h-[480px] overflow-y-auto pr-1">
          {q.data.map((h, i) => (
            <li key={h.id} className="relative flex gap-3 pb-4 pl-1 last:pb-0">
              {i < q.data.length - 1 && <span className="absolute bottom-0 left-[8px] top-4 w-px bg-line" aria-hidden />}
              <span className={cn('relative z-10 mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-[var(--pf-surface)]', ACTOR_DOT[h.actor])} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-fg">{h.summary}</div>
                <div className="mt-0.5 text-xs text-fg-3">
                  {ACTOR[h.actor]} · <span title={fmtDateTime(h.at)}>{fmtRelative(h.at)}</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

