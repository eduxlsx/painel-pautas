import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, Cpu, Download, KeyRound, Loader2, PlugZap, Radar, ScanSearch, ShieldAlert, Sparkles, Trash2, Wand2, XCircle } from 'lucide-react';
import type { AiStatus, Configuracoes } from '@pautaflow/shared';
import { Badge, Button, Field, Input, NativeSelect, Segmented, Skeleton, Switch, Tip, useConfirm } from '@/components/ui';
import { api, post, useAiStatus, useConfig, useSaveConfig } from '@/lib/queries';
import { queryClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toast';
import type { RegisterSave } from './MicrosoftSources';
import { Note, NumberInput, RowGroup, SettingRow, useDraft } from './shared';

type AiCfg = Configuracoes['ai'];

const isLocalUrl = (u: string) => {
  try {
    const h = new URL(u).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
  } catch {
    return false;
  }
};

export function AiStatusLine({ status, loading }: { status: AiStatus | undefined; loading?: boolean }) {
  if (loading || !status) return <Skeleton className="h-10" />;
  const tone = status.provider === 'none' ? 'neutral' : status.available ? 'success' : 'warning';
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-2xl px-4 py-3 text-[13px] ring-1 ring-inset',
        tone === 'success' ? 'bg-success/8 ring-success/25' : tone === 'warning' ? 'bg-warning/10 ring-warning/30' : 'bg-sunken ring-line',
      )}
    >
      {tone === 'success' ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : tone === 'warning' ? <AlertTriangle className="size-4 shrink-0 text-amber-500" /> : <Cpu className="size-4 shrink-0 text-fg-3" />}
      <span className="min-w-0 flex-1 text-fg-2">{status.detail}</span>
      {status.model && status.provider !== 'none' && <Badge tone="accent">{status.model}</Badge>}
    </div>
  );
}

export function AiSettingsPanel({ registerSave, compact = false }: { registerSave?: RegisterSave; compact?: boolean }) {
  const cfg = useConfig();
  if (!cfg.data) return <Skeleton className="h-64" />;
  return <AiInner config={cfg.data} registerSave={registerSave} compact={compact} />;
}

function AiInner({ config, registerSave, compact }: { config: Configuracoes; registerSave?: RegisterSave; compact: boolean }) {
  const draft = useDraft<AiCfg>(config.ai);
  const d = draft.value;
  const save = useSaveConfig();
  const status = useAiStatus();
  const { confirm, element } = useConfirm();
  const [models, setModels] = useState<{ available: boolean; models: string[] } | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; detail: string } | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);

  const external = d.provider === 'openai-compatible' && !!d.baseUrl && !isLocalUrl(d.baseUrl);

  const doSave = async () => {
    await save.mutateAsync({ ai: d });
    setTest(null);
    await queryClient.invalidateQueries({ queryKey: ['ai-status'] });
  };

  const draftKey = JSON.stringify(d);
  useEffect(() => {
    if (!registerSave) return;
    registerSave(draft.dirty ? doSave : null);
    return () => registerSave(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.dirty, draftKey, registerSave]);

  const detect = async () => {
    setDetecting(true);
    try {
      // a detecção usa a URL salva no servidor
      if (d.ollamaUrl !== config.ai.ollamaUrl) await save.mutateAsync({ ai: { ollamaUrl: d.ollamaUrl } });
      const r = await api<{ available: boolean; models: string[] }>('/api/ai/ollama/models');
      setModels(r);
      if (r.available && r.models.length && !r.models.includes(d.model)) draft.set('model', r.models[0] ?? '');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDetecting(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await post<{ ok: boolean; detail: string }>('/api/ai/test'));
      void queryClient.invalidateQueries({ queryKey: ['ai-status'] });
    } catch (err) {
      setTest({ ok: false, detail: (err as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const setKey = async (value: string | null) => {
    if (value === null) {
      const ok = await confirm({ title: 'Remover a chave de API?', body: 'A chave armazenada neste computador será apagada. O provedor externo deixará de funcionar até você informar outra.', confirm: 'Remover', danger: true });
      if (!ok) return;
    }
    setKeyBusy(true);
    try {
      const st = await post<AiStatus>('/api/ai/key', { apiKey: value });
      queryClient.setQueryData(['ai-status'], st);
      setApiKey('');
      toast.success(value ? 'Chave armazenada com segurança' : 'Chave removida');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setKeyBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {element}
      <div className="space-y-3">
        <Segmented
          id={compact ? 'ai-provider-ob' : 'ai-provider'}
          value={d.provider}
          onChange={(v) => {
            draft.set('provider', v);
            setTest(null);
          }}
          options={[
            { value: 'none', label: 'Sem IA', icon: <Cpu /> },
            { value: 'ollama', label: 'Ollama (local)', icon: <Sparkles /> },
            { value: 'openai-compatible', label: 'Compatível com OpenAI', icon: <PlugZap /> },
          ]}
        />
        <p className="max-w-2xl text-[13px] leading-relaxed text-fg-2">
          O <b>motor determinístico</b> do PautaFlow sempre funciona — sem IA, o radar, as prioridades e os resumos continuam ativos com regras locais. A IA apenas <b>enriquece</b> a análise do radar, a redação dos resumos e as respostas do assistente.
        </p>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={d.provider} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.22 }} className="space-y-4">
          {d.provider === 'none' && (
            <Note tone="success" icon={<CheckCircle2 />} title="Tudo é processado localmente por regras">
              Nenhum dado é enviado a modelos de linguagem. Você pode ativar uma IA a qualquer momento.
            </Note>
          )}

          {d.provider === 'ollama' && (
            <>
              <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
                <Field label="Endereço do Ollama" hint="Padrão: http://127.0.0.1:11434">
                  <Input value={d.ollamaUrl} onChange={(e) => draft.set('ollamaUrl', e.target.value)} spellCheck={false} className="font-mono text-[13px]" />
                </Field>
                <Button variant="secondary" onClick={() => void detect()} loading={detecting} className="mb-[22px]">
                  {!detecting && <ScanSearch />}
                  Detectar modelos
                </Button>
              </div>
              {models && !models.available && (
                <Note tone="warning" icon={<Download />} title="Ollama não encontrado neste endereço">
                  Para usar IA local, instale o Ollama em <a className="font-medium text-accent hover:underline" href="https://ollama.com/download" target="_blank" rel="noreferrer">ollama.com</a>, abra-o e baixe um modelo no terminal, por exemplo <code className="rounded bg-sunken px-1 font-mono text-[12px]">ollama pull llama3.2</code>. Depois clique em “Detectar modelos” novamente.
                </Note>
              )}
              {models?.available && models.models.length === 0 && (
                <Note tone="warning" icon={<Download />} title="O Ollama está ativo, mas sem modelos">
                  Baixe um modelo no terminal, por exemplo <code className="rounded bg-sunken px-1 font-mono text-[12px]">ollama pull llama3.2</code>, e detecte novamente.
                </Note>
              )}
              <Field label="Modelo" hint={models?.available ? `${models.models.length} modelo(s) instalado(s)` : 'Clique em “Detectar modelos” para listar os modelos instalados'}>
                {models?.available && models.models.length > 0 ? (
                  <NativeSelect value={d.model} onChange={(e) => draft.set('model', e.target.value)}>
                    {!models.models.includes(d.model) && d.model && <option value={d.model}>{d.model} (não instalado)</option>}
                    {models.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <Input value={d.model} onChange={(e) => draft.set('model', e.target.value)} placeholder="llama3.2" spellCheck={false} className="font-mono text-[13px]" />
                )}
              </Field>
            </>
          )}

          {d.provider === 'openai-compatible' && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="URL base da API" hint="Ex.: http://127.0.0.1:1234/v1 (LM Studio) ou o endpoint do seu provedor">
                  <Input value={d.baseUrl} onChange={(e) => draft.set('baseUrl', e.target.value)} placeholder="https://…/v1" spellCheck={false} className="font-mono text-[13px]" />
                </Field>
                <Field label="Modelo">
                  <Input value={d.model} onChange={(e) => draft.set('model', e.target.value)} placeholder="nome-do-modelo" spellCheck={false} className="font-mono text-[13px]" />
                </Field>
              </div>
              <div className={cn('rounded-2xl p-4 ring-1 ring-inset transition-colors', d.allowExternal ? 'bg-warning/10 ring-warning/30' : 'bg-sunken/60 ring-line')}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex gap-3">
                    <ShieldAlert className={cn('mt-0.5 size-4 shrink-0', d.allowExternal ? 'text-amber-500' : 'text-fg-3')} />
                    <div>
                      <div className="text-sm font-semibold text-fg">Permitir envio para serviço externo</div>
                      <p className="mt-0.5 text-[13px] leading-relaxed text-fg-2">
                        Com um endereço fora deste computador, trechos de e-mails, tarefas e pautas <b>saem do seu computador</b> para o provedor informado. Verifique se isso é permitido pela política de dados da sua empresa.
                      </p>
                    </div>
                  </div>
                  <Switch checked={d.allowExternal} onCheckedChange={(v) => draft.set('allowExternal', v)} label="Permitir serviço externo" />
                </div>
                {external && !d.allowExternal && <p className="mt-3 pl-7 text-xs font-medium text-amber-600 dark:text-amber-300">Este endereço é externo: a IA ficará bloqueada até você permitir o envio.</p>}
              </div>
              <Field label="Chave de API" hint="Guardada cifrada com DPAPI do Windows; nunca é exibida novamente.">
                <div className="flex flex-wrap items-center gap-2">
                  {status.data?.hasApiKey && (
                    <Badge tone="success" icon={<KeyRound />}>
                      Chave armazenada (DPAPI)
                    </Badge>
                  )}
                  <Input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={status.data?.hasApiKey ? 'Substituir chave…' : 'Cole a chave aqui'} className="min-w-[200px] flex-1" />
                  <Button variant="secondary" disabled={!apiKey.trim()} loading={keyBusy && !!apiKey} onClick={() => void setKey(apiKey)}>
                    Salvar chave
                  </Button>
                  {status.data?.hasApiKey && (
                    <Tip content="Remover chave">
                      <Button variant="ghost" size="icon" onClick={() => void setKey(null)} aria-label="Remover chave">
                        <Trash2 />
                      </Button>
                    </Tip>
                  )}
                </div>
              </Field>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      {d.provider !== 'none' && (
        <RowGroup>
          <SettingRow title={<span className="flex items-center gap-2"><Radar className="size-3.5 text-fg-3" />Usar no radar</span>} description="Refina título, prazo e prioridade das sugestões detectadas.">
            <Switch checked={d.useForRadar} onCheckedChange={(v) => draft.set('useForRadar', v)} label="Usar no radar" />
          </SettingRow>
          <SettingRow title={<span className="flex items-center gap-2"><Wand2 className="size-3.5 text-fg-3" />Usar nos resumos</span>} description="Escreve uma narrativa curta nos resumos diário, semanal e mensal.">
            <Switch checked={d.useForSummaries} onCheckedChange={(v) => draft.set('useForSummaries', v)} label="Usar nos resumos" />
          </SettingRow>
          <SettingRow title={<span className="flex items-center gap-2"><Sparkles className="size-3.5 text-fg-3" />Usar no assistente</span>} description="Respostas em linguagem natural sobre suas pautas.">
            <Switch checked={d.useForAssistant} onCheckedChange={(v) => draft.set('useForAssistant', v)} label="Usar no assistente" />
          </SettingRow>
          <SettingRow title="Tempo limite" description="Após esse tempo, o PautaFlow volta ao motor determinístico.">
            <NumberInput value={d.timeoutSeconds} onChange={(v) => draft.set('timeoutSeconds', v)} min={5} max={300} suffix="s" className="w-28" />
          </SettingRow>
        </RowGroup>
      )}

      <div className="space-y-3">
        <AiStatusLine status={status.data} loading={status.isLoading} />
        <div className="flex flex-wrap items-center gap-2">
          {d.provider !== 'none' && (
            <Tip content={draft.dirty ? 'Salve as alterações antes de testar' : null}>
              <span>
                <Button variant="secondary" size="sm" onClick={() => void runTest()} loading={testing} disabled={draft.dirty}>
                  {!testing && <PlugZap />}
                  Testar conexão
                </Button>
              </span>
            </Tip>
          )}
          <AnimatePresence>
            {test && (
              <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className={cn('flex items-center gap-1.5 text-[13px]', test.ok ? 'text-success' : 'text-critical')}>
                {test.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
                {test.detail}
              </motion.span>
            )}
          </AnimatePresence>
          {testing && <span className="flex items-center gap-1.5 text-xs text-fg-3"><Loader2 className="size-3.5 animate-spin" /> Aguardando resposta do modelo…</span>}
          {!registerSave && (
            <div className="ml-auto flex items-center gap-2">
              {draft.dirty && <span className="text-xs font-medium text-accent">Alterações não salvas</span>}
              <Button variant="ghost" size="sm" onClick={draft.reset} disabled={!draft.dirty}>
                Descartar
              </Button>
              <Button variant={draft.dirty ? 'primary' : 'secondary'} size="sm" onClick={() => void doSave()} disabled={!draft.dirty} loading={save.isPending}>
                Salvar IA
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
