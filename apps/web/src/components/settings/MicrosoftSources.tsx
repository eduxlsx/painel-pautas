import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Inbox, KanbanSquare, RefreshCw } from 'lucide-react';
import type { Configuracoes } from '@pautaflow/shared';
import { Button, NativeSelect, Skeleton, Switch } from '@/components/ui';
import { api, useConfig, useSaveConfig } from '@/lib/queries';
import { CheckTile, Note, NumberInput, RowGroup, SettingRow, useDraft } from './shared';

type MsCfg = Configuracoes['microsoft'];
type SourcesDraft = Pick<MsCfg, 'mailFolders' | 'plannerPlanIds' | 'lookbackDays' | 'calendarDaysAhead' | 'followPlannerDueDates' | 'autoCompleteFromPlanner'>;

const INBOX = { id: 'inbox', name: 'Caixa de Entrada' };
const isInboxName = (n: string) => /^(inbox|caixa de entrada)$/i.test(n.trim());
const isSentName = (n: string) => /^(sent items|itens enviados)$/i.test(n.trim());

export type RegisterSave = (fn: (() => Promise<void>) | null) => void;

/** Seleção de pastas do Outlook, planos do Planner e janelas de sincronização. */
export function MicrosoftSources({ showOptions = true, registerSave, connected }: { showOptions?: boolean; registerSave?: RegisterSave; connected: boolean }) {
  const cfg = useConfig();
  if (!cfg.data) return <Skeleton className="h-48" />;
  return <SourcesInner config={cfg.data} showOptions={showOptions} registerSave={registerSave} connected={connected} />;
}

function SourcesInner({ config, showOptions, registerSave, connected }: { config: Configuracoes; showOptions: boolean; registerSave?: RegisterSave; connected: boolean }) {
  const m = config.microsoft;
  const draft = useDraft<SourcesDraft>({
    mailFolders: m.mailFolders,
    plannerPlanIds: m.plannerPlanIds,
    lookbackDays: m.lookbackDays,
    calendarDaysAhead: m.calendarDaysAhead,
    followPlannerDueDates: m.followPlannerDueDates,
    autoCompleteFromPlanner: m.autoCompleteFromPlanner,
  });
  const save = useSaveConfig();
  const folders = useQuery({
    queryKey: ['ms-folders'],
    queryFn: ({ signal }) => api<{ id: string; name: string; total: number }[]>('/api/integrations/microsoft/folders', { signal }),
    enabled: connected,
    staleTime: 5 * 60_000,
    retry: 0,
  });
  const plans = useQuery({
    queryKey: ['ms-plans'],
    queryFn: ({ signal }) => api<{ id: string; title: string }[]>('/api/integrations/microsoft/plans', { signal }),
    enabled: connected,
    staleTime: 5 * 60_000,
    retry: 0,
  });

  const d = draft.value;
  const doSave = async () => {
    const payload: Partial<SourcesDraft> = showOptions ? d : { mailFolders: d.mailFolders, plannerPlanIds: d.plannerPlanIds };
    await save.mutateAsync({ microsoft: payload });
  };

  const draftKey = JSON.stringify(d);
  useEffect(() => {
    if (!registerSave) return;
    registerSave(draft.dirty ? doSave : null);
    return () => registerSave(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.dirty, draftKey, registerSave]);

  const folderList = (folders.data ?? []).filter((f) => !isInboxName(f.name) && !isSentName(f.name));
  // pastas salvas que não aparecem na listagem (ex.: inbox) continuam visíveis
  const toggleFolder = (f: { id: string; name: string }) => {
    const on = d.mailFolders.some((x) => x.id === f.id);
    draft.set('mailFolders', on ? d.mailFolders.filter((x) => x.id !== f.id) : [...d.mailFolders, { id: f.id, name: f.name }]);
  };
  const togglePlan = (id: string) => draft.set('plannerPlanIds', d.plannerPlanIds.includes(id) ? d.plannerPlanIds.filter((x) => x !== id) : [...d.plannerPlanIds, id]);
  const inboxTotal = folders.data?.find((f) => isInboxName(f.name))?.total;

  if (!connected) {
    return (
      <Note tone="info" icon={<Inbox />} title="Conecte sua conta Microsoft para escolher as fontes">
        Depois de conectar, você poderá selecionar quais pastas do Outlook e quais planos do Planner o radar deve acompanhar. Isso pode ser feito a qualquer momento em Integrações.
      </Note>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-fg">
              <Inbox className="size-4 text-accent" /> Pastas do Outlook
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => void folders.refetch()} aria-label="Atualizar pastas" disabled={folders.isFetching}>
              <RefreshCw className={folders.isFetching ? 'animate-spin' : ''} />
            </Button>
          </div>
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            <CheckTile checked={d.mailFolders.some((x) => x.id === INBOX.id)} onToggle={() => toggleFolder(INBOX)} title="Caixa de Entrada" meta={inboxTotal !== undefined ? `${inboxTotal.toLocaleString('pt-BR')} itens` : 'padrão'} />
            {folders.isLoading && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10" />)}
            {folderList.map((f) => (
              <CheckTile key={f.id} checked={d.mailFolders.some((x) => x.id === f.id)} onToggle={() => toggleFolder(f)} title={f.name} meta={`${f.total.toLocaleString('pt-BR')} itens`} />
            ))}
            {d.mailFolders
              .filter((x) => x.id !== INBOX.id && !folderList.some((f) => f.id === x.id) && !folders.isLoading)
              .map((x) => (
                <CheckTile key={x.id} checked onToggle={() => toggleFolder(x)} title={x.name} meta="salva" />
              ))}
          </div>
          {folders.isError && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-critical">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {folders.error.message}
            </p>
          )}
          <p className="mt-2 text-xs text-fg-3">Itens Enviados são analisados conforme a opção do Radar (detecta compromissos que você assumiu).</p>
        </div>

        <div>
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-fg">
              <KanbanSquare className="size-4 text-accent" /> Planos do Planner
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => void plans.refetch()} aria-label="Atualizar planos" disabled={plans.isFetching}>
              <RefreshCw className={plans.isFetching ? 'animate-spin' : ''} />
            </Button>
          </div>
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            <CheckTile checked={d.plannerPlanIds.length === 0} onToggle={() => draft.set('plannerPlanIds', [])} title="Todos os planos" meta="padrão" />
            {plans.isLoading && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-10" />)}
            {plans.data?.map((p) => <CheckTile key={p.id} checked={d.plannerPlanIds.includes(p.id)} onToggle={() => togglePlan(p.id)} title={p.title || 'Plano sem nome'} />)}
            {plans.data && plans.data.length === 0 && <p className="px-1 py-2 text-xs text-fg-3">Nenhum plano encontrado para a sua conta.</p>}
          </div>
          {plans.isError && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-critical">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {plans.error.message}
            </p>
          )}
          <p className="mt-2 text-xs text-fg-3">Sem seleção, o PautaFlow acompanha as tarefas atribuídas a você em todos os planos.</p>
        </div>
      </div>

      {showOptions && (
        <RowGroup>
          <SettingRow title="Janela de busca de e-mails" description="Quantos dias para trás o radar analisa na primeira sincronização e após mudanças.">
            <NativeSelect value={d.lookbackDays} onChange={(e) => draft.set('lookbackDays', Number(e.target.value))} className="w-36">
              {[3, 7, 14, 30, 60, 90].map((n) => (
                <option key={n} value={n}>
                  {n} dias
                </option>
              ))}
            </NativeSelect>
          </SettingRow>
          <SettingRow title="Agenda à frente" description="Período futuro do calendário trazido para a Semana e o Calendário.">
            <NumberInput value={d.calendarDaysAhead} onChange={(v) => draft.set('calendarDaysAhead', v)} min={7} max={180} suffix="dias" className="w-32" />
          </SettingRow>
          <SettingRow title="Seguir prazos do Planner" description="Atualiza o prazo das pautas vinculadas quando ele muda no Planner. Prazos definidos manualmente nunca são sobrescritos.">
            <Switch checked={d.followPlannerDueDates} onCheckedChange={(v) => draft.set('followPlannerDueDates', v)} label="Seguir prazos do Planner" />
          </SettingRow>
          <SettingRow title="Concluir automaticamente pelo Planner" description="Marca a pauta como concluída quando a tarefa vinculada for concluída no Planner.">
            <Switch checked={d.autoCompleteFromPlanner} onCheckedChange={(v) => draft.set('autoCompleteFromPlanner', v)} label="Concluir pelo Planner" />
          </SettingRow>
        </RowGroup>
      )}

      {!registerSave && (
        <div className="flex items-center justify-end gap-2">
          {draft.dirty && <span className="mr-auto text-xs font-medium text-accent">Alterações não salvas</span>}
          <Button variant="ghost" size="sm" onClick={draft.reset} disabled={!draft.dirty}>
            Descartar
          </Button>
          <Button variant={draft.dirty ? 'primary' : 'secondary'} size="sm" onClick={() => void doSave()} disabled={!draft.dirty || (d.mailFolders.length === 0)} loading={save.isPending}>
            Salvar fontes
          </Button>
        </div>
      )}
      {d.mailFolders.length === 0 && <p className="text-xs text-warning">Selecione pelo menos uma pasta para o radar analisar e-mails.</p>}
    </div>
  );
}
