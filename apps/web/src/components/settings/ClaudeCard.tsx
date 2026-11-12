import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, PlayCircle, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import type { Configuracoes } from '@pautaflow/shared';
import { Badge, Button, Input, NativeSelect, Skeleton, Switch } from '@/components/ui';
import { api, post, useConfig, useSaveConfig } from '@/lib/queries';
import { queryClient } from '@/lib/api';
import { toast } from '@/stores/toast';
import { Note, RowGroup, SectionCard, SettingRow, useDraft } from './shared';

interface ClaudeStatus {
  hasKey: boolean;
  allowData: boolean;
  model: string;
  ready: boolean;
  detail: string;
}

type ClaudeCfg = Configuracoes['claude'];

const MODELS: { value: ClaudeCfg['model']; label: string }[] = [
  { value: 'claude-opus-5-5', label: 'Claude Opus 5.5 — mais capaz (recomendado)' },
  { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — rápido e equilibrado' },
  { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — o mais rápido e econômico' },
];

/** Integração com o Claude (API da Anthropic): assistente que consulta e executa ações nas pautas. */
export function ClaudeCard() {
  const { data: config } = useConfig();
  const status = useQuery({ queryKey: ['claude-status'], queryFn: ({ signal }) => api<ClaudeStatus>('/api/claude/status', { signal }) });
  const save = useSaveConfig();
  const draft = useDraft<ClaudeCfg>(config?.claude ?? { allowData: false, model: 'claude-opus-5-5', effort: 'medium', allowActions: true });
  const [key, setKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const s = status.data;
  const v = draft.value;

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['claude-status'] });

  const saveKey = async (value: string | null) => {
    setSavingKey(true);
    try {
      await post('/api/claude/key', { apiKey: value });
      setKey('');
      toast.success(value ? 'Chave salva (cifrada com DPAPI)' : 'Chave removida');
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingKey(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await post<{ ok: boolean; detail: string }>('/api/claude/test');
      if (r.ok) toast.success(r.detail);
      else toast.error(r.detail);
    } finally {
      setTesting(false);
    }
  };

  const chip = !s ? <Skeleton className="h-6 w-24" /> : s.ready ? <Badge tone="success">Ativo</Badge> : s.hasKey ? <Badge tone="warning">Aguardando autorização</Badge> : <Badge tone="neutral">Não configurado</Badge>;

  return (
    <SectionCard
      icon={<Sparkles />}
      title="Claude (Anthropic)"
      description="Assistente de IA no painel lateral: peça em linguagem natural para consultar pautas, e-mails e agenda, criar ou atualizar pautas e decidir sugestões do radar."
      action={chip}
      dirty={draft.dirty}
      saving={save.isPending}
      onSave={() => save.mutate({ claude: v }, { onSuccess: refresh })}
      onReset={draft.reset}
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-fg-2">
            <KeyRound className="size-3.5" /> Chave da API
          </div>
          {s?.hasKey ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="success" icon={<ShieldCheck />}>
                Chave armazenada (cifrada com DPAPI)
              </Badge>
              <Button size="sm" variant="ghost" onClick={() => void saveKey(null)} loading={savingKey}>
                {!savingKey && <Trash2 />} Remover
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input type="password" autoComplete="off" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} className="flex-1" />
              <Button variant="primary" disabled={!key.trim()} loading={savingKey} onClick={() => void saveKey(key)}>
                Salvar chave
              </Button>
            </div>
          )}
          <p className="mt-1.5 text-xs text-fg-3">
            Crie a chave em console.anthropic.com → API Keys (o uso é cobrado na conta da Anthropic). A chave fica só neste computador, cifrada com a proteção de dados do Windows.
          </p>
        </div>

        <Note tone="warning" title="Privacidade">
          Ao usar o Claude, o seu pedido e os dados que ele consultar para responder (títulos e descrições de pautas, trechos de e-mails, agenda) são enviados à API da Anthropic. Nada é enviado sem esta autorização.
        </Note>

        <RowGroup>
          <SettingRow title="Autorizo o envio desses dados à Anthropic" description="Necessário para ativar o Claude. Pode ser revogado a qualquer momento.">
            <Switch checked={v.allowData} onCheckedChange={(x) => draft.set('allowData', x)} label="Autorizar envio de dados à Anthropic" />
          </SettingRow>
          <SettingRow title="Permitir ações" description="Criar e atualizar pautas e decidir sugestões. Desligado: o Claude só consulta. Exclusões e envio de e-mails nunca são permitidos.">
            <Switch checked={v.allowActions} onCheckedChange={(x) => draft.set('allowActions', x)} label="Permitir ações" />
          </SettingRow>
          <SettingRow title="Modelo">
            <NativeSelect value={v.model} onChange={(e) => draft.set('model', e.target.value as ClaudeCfg['model'])} className="w-[300px]">
              {MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </NativeSelect>
          </SettingRow>
          <SettingRow title="Profundidade de raciocínio" description="Mais profundidade = respostas mais cuidadosas, porém mais lentas e caras.">
            <NativeSelect value={v.effort} onChange={(e) => draft.set('effort', e.target.value as ClaudeCfg['effort'])} className="w-[180px]">
              <option value="low">Rápida</option>
              <option value="medium">Equilibrada</option>
              <option value="high">Profunda</option>
            </NativeSelect>
          </SettingRow>
        </RowGroup>

        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={() => void test()} loading={testing} disabled={!s?.hasKey || draft.dirty}>
            {!testing && <PlayCircle />} Testar conexão
          </Button>
          <span className="text-xs text-fg-3">{s?.detail}</span>
        </div>
      </div>
    </SectionCard>
  );
}
