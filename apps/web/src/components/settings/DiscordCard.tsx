import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, Hash, MessageSquare, RefreshCw, ShieldAlert, Terminal, Users, X } from 'lucide-react';
import { Badge, Button, Skeleton } from '@/components/ui';
import { api, post } from '@/lib/queries';
import { queryClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toast';
import { Note, SectionCard } from './shared';

export interface DiscordStatus {
  configured: boolean;
  enabled: boolean;
  connected: boolean;
  botTag: string | null;
  guild: string | null;
  channels: { key: 'pautas' | 'geral' | 'painel' | 'logs'; id: string; name: string | null; ok: boolean }[];
  allowedUsers: number;
  lastError: string | null;
  startedAt: string | null;
}

const PURPOSE: Record<DiscordStatus['channels'][number]['key'], string> = {
  pautas: 'Novas pautas, mudanças e sugestões do radar com botões',
  painel: 'Painel fixado que se atualiza sozinho',
  geral: 'Resumos e alertas',
  logs: 'Automações, erros e auditoria',
};

const COMMANDS = ['/pautas', '/pauta ver|nova|concluir|status|prazo|prioridade|comentar', '/prioridades', '/radar', '/resumo', '/perguntar', '/painel'];

function Mono({ children }: { children: string }) {
  return <code className="rounded-md bg-sunken px-1.5 py-0.5 font-mono text-[12px] text-fg ring-1 ring-line">{children}</code>;
}

function DiscordIcon() {
  return <MessageSquare className="size-[18px]" />;
}

export function DiscordCard() {
  const q = useQuery({
    queryKey: ['discord'],
    queryFn: ({ signal }) => api<DiscordStatus>('/api/integrations/discord', { signal }),
    refetchInterval: 30_000,
  });
  const [refreshing, setRefreshing] = useState(false);
  const s = q.data;

  const refreshPanel = async () => {
    setRefreshing(true);
    try {
      const r = await post<DiscordStatus>('/api/integrations/discord/panel');
      queryClient.setQueryData(['discord'], r);
      toast.success('Painel atualizado no Discord');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const chip = !s ? (
    <Skeleton className="h-6 w-28" />
  ) : !s.configured ? (
    <Badge tone="neutral" icon={<span className="size-1.5 rounded-full bg-current" />}>
      Token não configurado
    </Badge>
  ) : s.connected ? (
    <Badge tone="success" icon={<span className="size-1.5 rounded-full bg-current" />} className="max-w-[320px] truncate">
      Conectado{s.botTag ? ` como ${s.botTag}` : ''}
      {s.guild ? ` em ${s.guild}` : ''}
    </Badge>
  ) : (
    <Badge tone="warning" icon={<span className="size-1.5 rounded-full bg-current" />}>
      Desconectado
    </Badge>
  );

  return (
    <SectionCard icon={<DiscordIcon />} title="Discord" description="Bot opcional para acompanhar e atualizar pautas pelo Discord. Somente status — o token fica apenas no arquivo .env local." action={chip}>
      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : q.isError || !s ? (
        <Note tone="critical" icon={<AlertTriangle />} title="Não foi possível obter o status do Discord">
          {q.error?.message}
        </Note>
      ) : (
        <div className="space-y-5">
          {s.lastError && (
            <Note tone="critical" icon={<AlertTriangle />} title="Último erro do bot">
              <p className="mt-0.5 whitespace-pre-line">{s.lastError}</p>
            </Note>
          )}

          {s.configured && (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                {s.channels.map((c) => (
                  <div key={c.key} className="flex items-start gap-3 rounded-2xl bg-sunken/60 px-4 py-3 ring-1 ring-line">
                    <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full', c.ok ? 'bg-success/15 text-success' : 'bg-critical/12 text-critical')}>
                      {c.ok ? <Check className="size-3" /> : <X className="size-3" />}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 text-sm font-medium text-fg">
                        <Hash className="size-3.5 text-fg-3" />
                        <span className="truncate">{c.name ?? c.id ?? c.key}</span>
                        {!c.name && <span className="text-xs font-normal text-fg-3">({c.key})</span>}
                      </div>
                      <div className="mt-0.5 text-xs text-fg-3">{PURPOSE[c.key]}</div>
                    </div>
                  </div>
                ))}
                {s.channels.length === 0 && <p className="text-xs text-fg-3">Nenhum canal configurado.</p>}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[13px] text-fg-2">
                  <Users className="size-4 text-fg-3" />
                  {s.allowedUsers === 0 ? 'Comandos permitidos: somente o dono do servidor' : `${s.allowedUsers} usuário(s) autorizado(s) a usar os comandos`}
                </div>
                {s.connected && (
                  <Button variant="secondary" size="sm" onClick={() => void refreshPanel()} loading={refreshing}>
                    {!refreshing && <RefreshCw />}
                    Atualizar painel no Discord
                  </Button>
                )}
              </div>
            </>
          )}

          {!s.configured && (
            <ol className="space-y-2.5 text-[13px] leading-relaxed text-fg-2">
              {[
                <>
                  Crie um bot no Discord Developer Portal e coloque o token em <Mono>DISCORD_BOT_TOKEN</Mono> no arquivo <Mono>.env</Mono> na raiz do projeto.
                </>,
                <>
                  Convide o bot com os escopos <Mono>bot</Mono> + <Mono>applications.commands</Mono> e as permissões Ver canais, Enviar mensagens, Inserir links, Ler histórico de mensagens e Gerenciar mensagens.
                </>,
                <>
                  Opcional: defina <Mono>DISCORD_ALLOWED_USER_IDS</Mono> com os IDs que podem usar os comandos (sem isso, somente o dono do servidor).
                </>,
                <>
                  Reinicie o PautaFlow com <Mono>scripts\restart.ps1</Mono>.
                </>,
              ].map((t, i) => (
                <li key={i} className="flex gap-3">
                  <span className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-flow text-[11px] font-semibold text-white">{i + 1}</span>
                  <span className="pt-0.5">{t}</span>
                </li>
              ))}
            </ol>
          )}

          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-fg-3">
              <Terminal className="size-3.5" /> Comandos disponíveis
            </div>
            <div className="flex flex-wrap gap-1.5">
              {COMMANDS.map((c) => (
                <Mono key={c}>{c}</Mono>
              ))}
            </div>
          </div>

          <Note tone="warning" icon={<ShieldAlert />}>
            Com o bot ativo, títulos, prazos e resumos das pautas são enviados ao Discord (servidores externos). Use apenas em um servidor privado e de acordo com a política da sua empresa.
          </Note>
        </div>
      )}
    </SectionCard>
  );
}
