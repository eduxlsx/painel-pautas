import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Building2,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  Loader2,
  LockKeyhole,
  LogOut,
  MonitorSmartphone,
  ShieldCheck,
  Smartphone,
  UserRound,
} from 'lucide-react';
import type { Configuracoes, MicrosoftStatus } from '@pautaflow/shared';
import { Avatar, Badge, Button, Field, Input, Skeleton, useConfirm } from '@/components/ui';
import { post, useConfig, useMicrosoft, useSaveConfig } from '@/lib/queries';
import { queryClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toast';
import { Note, useDraft } from './shared';

export const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_RE = /^(organizations|common|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9-]+(\.[a-z0-9-]+)+)$/i;
const READ_SCOPES = ['User.Read', 'Mail.Read', 'Calendars.Read', 'Tasks.Read'];
const SCOPE_HINT: Record<string, string> = {
  'User.Read': 'Perfil básico',
  'Mail.Read': 'Ler e-mails',
  'Calendars.Read': 'Ler agenda',
  'Tasks.Read': 'Ler Planner/To Do',
};

export type MsState = 'unconfigured' | 'disconnected' | 'connected' | 'pending';

export function msState(s: MicrosoftStatus | undefined): MsState {
  if (!s) return 'unconfigured';
  if (s.pendingAuth) return 'pending';
  if (s.connected) return 'connected';
  if (!s.configured) return 'unconfigured';
  return 'disconnected';
}

export function MsStateChip({ state }: { state: MsState }) {
  if (state === 'connected')
    return (
      <Badge tone="success" icon={<span className="size-1.5 rounded-full bg-current" />}>
        Conectado
      </Badge>
    );
  if (state === 'pending')
    return (
      <Badge tone="accent" icon={<Loader2 className="animate-spin" />}>
        Login em andamento
      </Badge>
    );
  if (state === 'disconnected')
    return (
      <Badge tone="warning" icon={<span className="size-1.5 rounded-full bg-current" />}>
        Não conectado
      </Badge>
    );
  return (
    <Badge tone="neutral" icon={<span className="size-1.5 rounded-full bg-current" />}>
      Não configurado
    </Badge>
  );
}

/** Status Microsoft com polling automático enquanto houver login pendente. */
export function useMicrosoftLive() {
  const [poll, setPoll] = useState(false);
  const q = useMicrosoft(poll);
  const pending = !!q.data?.pendingAuth;
  const connected = !!q.data?.connected;
  useEffect(() => setPoll(pending), [pending]);
  const prev = useRef<{ pending: boolean; connected: boolean } | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = { pending, connected };
    if (!before) return;
    if (!before.connected && connected) {
      toast.success('Conta Microsoft conectada');
      for (const k of ['bootstrap', 'radar', 'health', 'automations']) void queryClient.invalidateQueries({ queryKey: [k] });
    }
  }, [pending, connected]);
  return q;
}

export function CopyButton({ text, label = 'Copiar', className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          toast.error('Não foi possível copiar para a área de transferência.');
        }
      }}
    >
      {done ? <Check className="text-success" /> : <Copy />}
      {done ? 'Copiado' : label}
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/* Guia de registro do aplicativo                                      */
/* ------------------------------------------------------------------ */

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-md bg-sunken px-1.5 py-0.5 font-mono text-[12px] text-fg ring-1 ring-line">{children}</code>;
}

const GUIDE: { title: ReactNode; body: ReactNode }[] = [
  {
    title: 'Abra o Microsoft Entra ID',
    body: (
      <>
        Acesse <Code>entra.microsoft.com</Code> (ou o portal do Azure) com sua conta corporativa e abra <b>Identidade → Aplicativos → Registros de aplicativo</b>. Se você não tiver acesso, envie este guia para a equipe de TI.
      </>
    ),
  },
  {
    title: 'Crie um novo registro',
    body: (
      <>
        Clique em <b>Novo registro</b>, dê um nome (ex.: <Code>PautaFlow Intelligence</Code>) e escolha <b>Contas somente neste diretório organizacional</b>. Não preencha o URI de redirecionamento ainda e clique em <b>Registrar</b>.
      </>
    ),
  },
  {
    title: 'Configure a autenticação',
    body: (
      <>
        Em <b>Autenticação → Adicionar uma plataforma</b>, escolha <b>Aplicativos móveis e da área de trabalho</b> e informe o URI de redirecionamento <Code>http://localhost</Code>. Depois, em <b>Configurações avançadas</b>, ative <b>Permitir fluxos de cliente público</b> e salve.
      </>
    ),
  },
  {
    title: 'Adicione as permissões (somente leitura)',
    body: (
      <>
        Em <b>Permissões de API → Adicionar uma permissão → Microsoft Graph → Permissões delegadas</b>, marque <Code>User.Read</Code>, <Code>Mail.Read</Code>, <Code>Calendars.Read</Code> e <Code>Tasks.Read</Code>. Se a sua empresa exigir, peça à TI para <b>conceder consentimento do administrador</b>.
      </>
    ),
  },
  {
    title: 'Copie os identificadores',
    body: (
      <>
        Na página <b>Visão geral</b> do registro, copie o <b>ID do aplicativo (cliente)</b> e o <b>ID do diretório (locatário)</b> e cole-os nos campos abaixo.
      </>
    ),
  },
];

export function RegistrationGuide({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-2xl bg-sunken/60 ring-1 ring-line">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left" aria-expanded={open}>
        <span className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-lg bg-accent-soft text-accent">
            <Building2 className="size-4" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-fg">Como registrar o aplicativo no Entra ID</span>
            <span className="block text-xs text-fg-3">Passo a passo — cerca de 5 minutos, ou envie para a TI</span>
          </span>
        </span>
        <ChevronDown className={cn('size-4 text-fg-3 transition-transform duration-300', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}>
            <ol className="space-y-0 px-4 pb-4">
              {GUIDE.map((s, i) => (
                <li key={i} className="relative flex gap-3.5 pb-4 last:pb-0">
                  {i < GUIDE.length - 1 && <span className="absolute left-[13px] top-8 bottom-1 w-px bg-line-strong" aria-hidden />}
                  <span className="tabular grid size-7 shrink-0 place-items-center rounded-full bg-flow text-xs font-semibold text-white shadow-[0_6px_14px_-6px_var(--pf-accent)]">{i + 1}</span>
                  <div className="min-w-0 pt-0.5">
                    <div className="text-sm font-semibold text-fg">{s.title}</div>
                    <p className="mt-1 text-[13px] leading-relaxed text-fg-2">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 text-xs text-fg-3">
              URI de redirecionamento: <Code>http://localhost</Code>
              <CopyButton text="http://localhost" />
              <span className="mx-1 hidden h-4 w-px bg-line sm:block" />
              <a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                Abrir Registros de aplicativo <ExternalLink className="size-3" />
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Painel de conexão                                                   */
/* ------------------------------------------------------------------ */

export function MicrosoftConnectPanel({ compact = false }: { compact?: boolean }) {
  const ms = useMicrosoftLive();
  const cfg = useConfig();
  if (ms.isLoading || cfg.isLoading || !cfg.data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-28" />
      </div>
    );
  }
  if (ms.isError || !ms.data) return <Note tone="critical" icon={<AlertTriangle />} title="Não foi possível obter o status da conexão Microsoft">{ms.error?.message}</Note>;
  return <ConnectInner status={ms.data} config={cfg.data} compact={compact} />;
}

function ConnectInner({ status, config, compact }: { status: MicrosoftStatus; config: Configuracoes; compact: boolean }) {
  const state = msState(status);
  const save = useSaveConfig();
  const { confirm, element } = useConfirm();
  const draft = useDraft({ clientId: config.microsoft.clientId, tenantId: config.microsoft.tenantId });
  const [connecting, setConnecting] = useState<null | 'interactive' | 'device_code'>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const clientId = draft.value.clientId.trim();
  const tenantId = draft.value.tenantId.trim() || 'organizations';
  const clientErr = clientId && !GUID_RE.test(clientId) ? 'O ID do aplicativo é um GUID no formato 00000000-0000-0000-0000-000000000000.' : undefined;
  const tenantErr = !TENANT_RE.test(tenantId) ? 'Use "organizations", o GUID do diretório ou um domínio (ex.: empresa.onmicrosoft.com).' : undefined;
  const valid = !!clientId && !clientErr && !tenantErr;

  const saveCreds = async () => {
    await save.mutateAsync({ microsoft: { clientId, tenantId } });
    await queryClient.invalidateQueries({ queryKey: ['microsoft'] });
  };

  const connect = async (mode: 'interactive' | 'device_code') => {
    setConnecting(mode);
    try {
      if (draft.dirty) await saveCreds();
      const res = await post<MicrosoftStatus>('/api/integrations/microsoft/connect', { mode });
      queryClient.setQueryData(['microsoft'], res);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setConnecting(null);
    }
  };

  const disconnect = async () => {
    const ok = await confirm({
      title: 'Desconectar a conta Microsoft?',
      body: 'O token armazenado neste computador será removido e as sincronizações com Outlook, Planner e Calendário serão pausadas. Suas pautas e sugestões continuam salvas localmente.',
      confirm: 'Desconectar',
      danger: true,
    });
    if (!ok) return;
    setDisconnecting(true);
    try {
      const res = await post<MicrosoftStatus>('/api/integrations/microsoft/disconnect');
      queryClient.setQueryData(['microsoft'], res);
      for (const k of ['bootstrap', 'radar', 'health']) void queryClient.invalidateQueries({ queryKey: [k] });
      toast.success('Conta Microsoft desconectada');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="space-y-5">
      {element}

      {status.lastError && state !== 'connected' && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
          <Note tone="critical" icon={<AlertTriangle />} title="A última tentativa de conexão falhou">
            <p className="mt-0.5 whitespace-pre-line">{status.lastError}</p>
          </Note>
        </motion.div>
      )}

      {state === 'connected' ? (
        <ConnectedCard status={status} clientId={config.microsoft.clientId} onDisconnect={disconnect} disconnecting={disconnecting} />
      ) : (
        <>
          {!compact && (
            <Note tone="info" icon={<ShieldCheck />} title="Por que é preciso um registro de aplicativo?">
              Estar conectado ao Windows ou ao Outlook <b>não</b> dá acesso automático ao Microsoft Graph. Para ler seus e-mails, agenda e Planner, o PautaFlow precisa de um <b>registro de aplicativo</b> (ID do cliente) no Entra ID da sua empresa. Dependendo das políticas da organização, a TI pode precisar <b>conceder consentimento do administrador</b>.
            </Note>
          )}

          <RegistrationGuide defaultOpen={!compact && state === 'unconfigured'} />

          <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr]">
            <Field label="ID do aplicativo (cliente)" error={clientErr} hint="Copiado da Visão geral do registro">
              <Input value={draft.value.clientId} onChange={(e) => draft.set('clientId', e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" spellCheck={false} className="font-mono text-[13px]" />
            </Field>
            <Field label="ID do diretório (locatário)" error={tenantErr} hint='Use "organizations" se não souber'>
              <Input value={draft.value.tenantId} onChange={(e) => draft.set('tenantId', e.target.value)} placeholder="organizations" spellCheck={false} className="font-mono text-[13px]" />
            </Field>
          </div>

          {draft.dirty && (
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={draft.reset}>
                Descartar
              </Button>
              <Button size="sm" variant="secondary" disabled={!valid} loading={save.isPending} onClick={() => void saveCreds()}>
                Salvar identificadores
              </Button>
            </div>
          )}

          <AnimatePresence mode="wait" initial={false}>
            {status.pendingAuth ? (
              <motion.div key="pending" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.25 }}>
                <PendingAuth pending={status.pendingAuth} />
              </motion.div>
            ) : (
              <motion.div key="buttons" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" disabled={!valid || !!connecting} loading={connecting === 'interactive'} onClick={() => void connect('interactive')}>
                    {connecting !== 'interactive' && <Globe />}
                    Entrar com o navegador
                  </Button>
                  <Button variant="secondary" disabled={!valid || !!connecting} loading={connecting === 'device_code'} onClick={() => void connect('device_code')}>
                    {connecting !== 'device_code' && <Smartphone />}
                    Usar código de dispositivo
                  </Button>
                </div>
                <p className="text-xs text-fg-3">
                  {!clientId ? 'Informe o ID do aplicativo para habilitar a conexão.' : 'O código de dispositivo é útil quando o navegador padrão não consegue concluir o login.'}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      <div className="flex items-start gap-2.5 text-xs leading-relaxed text-fg-3">
        <LockKeyhole className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Acesso <b className="text-fg-2">somente leitura</b>: o PautaFlow nunca envia, altera ou exclui nada no Outlook, Calendário ou Planner. Os dados ficam neste computador.
        </span>
      </div>
    </div>
  );
}

function PendingAuth({ pending }: { pending: NonNullable<MicrosoftStatus['pendingAuth']> }) {
  if (pending.mode === 'device_code' && pending.userCode) {
    return (
      <div className="relative overflow-hidden rounded-[22px] bg-surface-strong p-6 text-center shadow-[var(--pf-shadow)]">
        <div className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-48 w-2/3 rounded-full bg-accent/20 blur-3xl" aria-hidden />
        <div className="relative">
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-fg-3">Seu código de acesso</div>
          <div className="tabular mt-3 select-all font-mono text-[44px] font-semibold leading-none tracking-[0.18em] text-fg">{pending.userCode}</div>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <CopyButton text={pending.userCode} label="Copiar código" />
            {pending.verificationUri && (
              <a href={pending.verificationUri} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-flow px-3 text-[13px] font-medium text-white hover:brightness-110">
                Abrir {pending.verificationUri.replace(/^https?:\/\//, '')}
                <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
          {pending.message && <p className="mx-auto mt-4 max-w-md text-[13px] leading-relaxed text-fg-2">{pending.message}</p>}
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-fg-3">
            <Loader2 className="size-3.5 animate-spin" /> Aguardando você concluir o login…
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-4 rounded-[22px] bg-surface-strong p-5 shadow-[var(--pf-shadow)]">
      <div className="relative grid size-12 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent">
        <MonitorSmartphone className="size-5" />
        <span className="absolute -right-1 -top-1 flex size-3">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex size-3 rounded-full bg-accent" />
        </span>
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-fg">Conclua o login na janela do navegador</div>
        <p className="mt-0.5 text-[13px] text-fg-2">{pending.message ?? 'Uma janela foi aberta para você entrar com sua conta corporativa. Esta tela atualiza sozinha quando terminar.'}</p>
      </div>
    </div>
  );
}

function ConnectedCard({ status, clientId, onDisconnect, disconnecting }: { status: MicrosoftStatus; clientId: string; onDisconnect: () => void; disconnecting: boolean }) {
  const acc = status.account;
  const scopes = status.scopes.length ? status.scopes : READ_SCOPES;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 rounded-[22px] bg-surface-strong p-5 shadow-[var(--pf-shadow)]">
        {acc ? <Avatar name={acc.name ?? acc.username} className="size-12 text-sm" /> : <UserRound className="size-10 text-fg-3" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold tracking-[-0.01em] text-fg">{acc?.name ?? acc?.username ?? 'Conta conectada'}</div>
          {acc?.username && <div className="truncate text-[13px] text-fg-2">{acc.username}</div>}
        </div>
        <Button variant="outline" size="sm" onClick={onDisconnect} loading={disconnecting}>
          {!disconnecting && <LogOut />}
          Desconectar
        </Button>
      </div>
      <div>
        <div className="mb-2 text-xs font-medium text-fg-2">Permissões concedidas</div>
        <div className="flex flex-wrap gap-1.5">
          {scopes.map((s) => (
            <Badge key={s} tone="accent" icon={<Check />}>
              {s}
              {SCOPE_HINT[s] && <span className="font-normal opacity-70">· {SCOPE_HINT[s]}</span>}
            </Badge>
          ))}
        </div>
      </div>
      <div className="grid gap-2 text-xs text-fg-3 sm:grid-cols-2">
        <div className="flex items-center gap-2">
          <KeyRound className="size-3.5" />
          {status.tokenStorage === 'dpapi' ? 'Token cifrado com DPAPI (Windows)' : 'Token mantido apenas em memória (perdido ao reiniciar)'}
        </div>
        {clientId && (
          <div className="flex items-center gap-2 truncate">
            <Building2 className="size-3.5 shrink-0" />
            <span className="truncate">
              App: <span className="font-mono">{clientId}</span>
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
