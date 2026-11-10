import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Laptop, Mail, PlayCircle, RefreshCw, XCircle } from 'lucide-react';
import type { Configuracoes } from '@pautaflow/shared';
import { Badge, Button, Skeleton, Switch } from '@/components/ui';
import { api, post, useConfig, useSaveConfig } from '@/lib/queries';
import { queryClient } from '@/lib/api';
import { fmtRelative } from '@/lib/utils';
import { toast } from '@/stores/toast';
import { NumberInput, Note, RowGroup, SectionCard, SettingRow, useDraft } from './shared';

interface LocalStatus {
  installed: boolean;
  running: boolean;
  enabled: boolean;
  account: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

type LocalCfg = Configuracoes['outlookLocal'];

/** Fonte alternativa ao Microsoft Graph: o Outlook clássico instalado neste computador. */
export function OutlookLocalCard({ graphConnected }: { graphConnected: boolean }) {
  const { data: config } = useConfig();
  const status = useQuery({ queryKey: ['outlook-local'], queryFn: ({ signal }) => api<LocalStatus>('/api/integrations/outlook-local', { signal }), refetchInterval: 20_000 });
  const save = useSaveConfig();
  const draft = useDraft<LocalCfg>(config?.outlookLocal ?? { enabled: false, startIfClosed: false, includeSent: true, calendar: true, maxPerFolder: 400 });
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const s = status.data;
  const v = draft.value;

  const test = async () => {
    setTesting(true);
    try {
      const r = await post<{ status: string; account?: string; version?: string; inboxCount?: number }>('/api/integrations/outlook-local/probe', { start: v.startIfClosed });
      if (r.status === 'closed') toast.info('O Outlook está fechado. Abra o Outlook ou ative "Abrir o Outlook em segundo plano".');
      else toast.success(`Outlook ${r.version ?? ''} conectado: ${r.account ?? 'conta'} · ${r.inboxCount ?? 0} itens na Caixa de Entrada`);
      void queryClient.invalidateQueries({ queryKey: ['outlook-local'] });
    } catch (err) {
      toast.error(`Falha ao acessar o Outlook: ${(err as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await post<{ lastStatus: string; lastMessage: string }>('/api/automations/outlook-sync/run');
      if (r.lastStatus === 'success') toast.success(r.lastMessage);
      else if (r.lastStatus === 'skipped') toast.info(r.lastMessage);
      else toast.error(r.lastMessage);
      if (v.calendar) await post('/api/automations/calendar-sync/run');
      void queryClient.invalidateQueries();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const chip = !s ? (
    <Skeleton className="h-6 w-28" />
  ) : !s.installed ? (
    <Badge tone="neutral">Outlook não encontrado</Badge>
  ) : graphConnected ? (
    <Badge tone="neutral">Em espera (Microsoft 365 ativo)</Badge>
  ) : s.enabled ? (
    <Badge tone={s.running || v.startIfClosed ? 'success' : 'warning'}>{s.running ? 'Ativo' : v.startIfClosed ? 'Ativo (abre o Outlook)' : 'Aguardando o Outlook abrir'}</Badge>
  ) : (
    <Badge tone="neutral">Desativado</Badge>
  );

  return (
    <SectionCard
      icon={<Laptop />}
      title="Outlook deste computador"
      description="Alternativa sem registro de aplicativo: o radar lê e-mails e calendário do Outlook clássico instalado aqui, de forma local e somente leitura."
      action={chip}
      dirty={draft.dirty}
      saving={save.isPending}
      onSave={() => save.mutate({ outlookLocal: v }, { onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['outlook-local'] }) })}
      onReset={draft.reset}
    >
      {s && !s.installed ? (
        <Note tone="warning" title="Outlook clássico não encontrado">
          Este recurso usa a automação oficial do Outlook clássico (Microsoft 365 Apps). O "novo Outlook" não oferece essa interface.
        </Note>
      ) : (
        <div className="space-y-4">
          {graphConnected && (
            <Note tone="info" title="Microsoft 365 conectado">
              Enquanto o Microsoft 365 estiver conectado, ele é usado como fonte. O Outlook local volta a ser usado automaticamente se você desconectar.
            </Note>
          )}
          <RowGroup>
            <SettingRow title="Usar o Outlook deste computador" description="Lê Caixa de Entrada, e-mails sinalizados, itens enviados e calendário. Nenhum dado sai do computador e nada é alterado no Outlook.">
              <Switch checked={v.enabled} onCheckedChange={(x) => draft.set('enabled', x)} label="Usar o Outlook deste computador" />
            </SettingRow>
            <SettingRow title="Abrir o Outlook em segundo plano" description="Desligado: só sincroniza quando o Outlook estiver aberto. Ligado: o PautaFlow abre o Outlook quando precisar.">
              <Switch checked={v.startIfClosed} onCheckedChange={(x) => draft.set('startIfClosed', x)} label="Abrir o Outlook em segundo plano" />
            </SettingRow>
            <SettingRow title="Analisar itens enviados" description="Detecta compromissos que você assumiu (“vou enviar até…”).">
              <Switch checked={v.includeSent} onCheckedChange={(x) => draft.set('includeSent', x)} label="Analisar itens enviados" />
            </SettingRow>
            <SettingRow title="Sincronizar calendário" description="Reuniões e compromissos aparecem na Semana, no Calendário e nos alertas de conflito.">
              <Switch checked={v.calendar} onCheckedChange={(x) => draft.set('calendar', x)} label="Sincronizar calendário" />
            </SettingRow>
            <SettingRow title="Limite por ciclo" description="Máximo de e-mails lidos por pasta em cada sincronização (a primeira leitura cobre o período de busca configurado).">
              <NumberInput value={v.maxPerFolder} onChange={(x) => draft.set('maxPerFolder', x)} min={50} max={2000} step={50} suffix="e-mails" />
            </SettingRow>
          </RowGroup>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-fg-2">
            <span className="flex items-center gap-1.5">
              {s?.running ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-fg-3" />}
              Outlook {s?.running ? 'aberto' : 'fechado'}
            </span>
            {s?.account && (
              <span className="flex items-center gap-1.5">
                <Mail className="size-4 text-fg-3" />
                {s.account}
              </span>
            )}
            <span className="text-fg-3">Última leitura: {fmtRelative(s?.lastSyncAt)}</span>
          </div>
          {s?.lastError && <Note tone="warning" title="Aviso da última leitura">{s.lastError}</Note>}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void test()} loading={testing}>
              {!testing && <PlayCircle />} Testar acesso ao Outlook
            </Button>
            <Button size="sm" variant="primary" onClick={() => void syncNow()} loading={syncing} disabled={!config?.outlookLocal.enabled || draft.dirty || graphConnected}>
              {!syncing && <RefreshCw />} Sincronizar agora
            </Button>
          </div>
          <p className="text-xs leading-relaxed text-fg-3">
            O Planner não tem leitura local: as tarefas atribuídas a você chegam ao radar pelos e-mails de notificação do Planner. A sincronização completa do Planner exige o Microsoft 365 conectado. Na primeira leitura, o Office pode exibir um aviso de segurança pedindo permissão de acesso.
          </p>
        </div>
      )}
    </SectionCard>
  );
}
