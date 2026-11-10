import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, Video, Plus, Search, Sparkles, Sun, Moon, Monitor, CheckCheck, AlertTriangle, CalendarClock, Inbox, Info, PlugZap, Flame, History } from 'lucide-react';
import type { Notificacao } from '@pautaflow/shared';
import { Button, Kbd, Popover, PopoverContent, PopoverTrigger, Tip, EmptyState } from '@/components/ui';
import { useBootstrap, useNotifications, useSaveConfig } from '@/lib/queries';
import { post, queryClient } from '@/lib/api';
import { applyTheme, useUi, type ThemePref } from '@/stores/ui';
import { cn, fmtRelative } from '@/lib/utils';

const NOTIF_ICON: Record<Notificacao['type'], React.ReactNode> = {
  suggestion: <Inbox />,
  critical: <Flame />,
  deadline: <CalendarClock />,
  overdue: <AlertTriangle />,
  approval: <CheckCheck />,
  conflict: <CalendarClock />,
  integration_error: <PlugZap />,
  sync: <Info />,
  forgotten: <History />,
  system: <Info />,
  meeting: <Video />,
};
const SEV: Record<Notificacao['severity'], string> = {
  info: 'bg-accent-soft text-accent',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/15 text-amber-600 dark:text-amber-300',
  critical: 'bg-critical/12 text-critical',
};

function Notifications() {
  const { data = [] } = useNotifications();
  const navigate = useNavigate();
  const { openPauta } = useUi();
  const unread = data.filter((n) => !n.readAt).length;

  const open = async (n: Notificacao) => {
    if (!n.readAt) await post(`/api/notifications/${n.id}/read`);
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    if (!n.link) return;
    if (/^https?:/.test(n.link)) window.open(n.link, '_blank', 'noopener');
    else {
      const m = /\/pautas\?id=([\w-]+)/.exec(n.link);
      if (m) openPauta(m[1]!);
      else navigate(n.link);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notificações" className="relative">
          <Bell />
          <AnimatePresence>
            {unread > 0 && (
              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="tabular absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-critical px-1 text-[9.5px] font-bold text-white">
                {unread > 99 ? '99+' : unread}
              </motion.span>
            )}
          </AnimatePresence>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] !p-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="text-sm font-semibold">Notificações</div>
          {unread > 0 && (
            <Button size="sm" variant="ghost" onClick={async () => { await post('/api/notifications/read-all'); void queryClient.invalidateQueries({ queryKey: ['notifications'] }); }}>
              <CheckCheck /> Marcar todas como lidas
            </Button>
          )}
        </div>
        <div className="max-h-[420px] overflow-y-auto p-1.5">
          {data.length === 0 && <EmptyState icon={<Bell />} title="Tudo em dia" description="Alertas de prazos, sugestões e integrações aparecem aqui." className="py-8" />}
          {data.slice(0, 40).map((n) => (
            <button key={n.id} onClick={() => void open(n)} className={cn('flex w-full gap-3 rounded-xl px-2.5 py-2.5 text-left transition hover:bg-sunken', !n.readAt && 'bg-accent-soft/40')}>
              <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4', SEV[n.severity])}>{NOTIF_ICON[n.type]}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-start justify-between gap-2">
                  <span className={cn('text-[13px] leading-snug', n.readAt ? 'text-fg-2' : 'font-medium text-fg')}>{n.title}</span>
                  {!n.readAt && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />}
                </span>
                {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-fg-3">{n.body}</span>}
                <span className="mt-1 block text-[11px] text-fg-3">{fmtRelative(n.createdAt)}</span>
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ThemeToggle() {
  const { data } = useBootstrap();
  const save = useSaveConfig();
  const pref = (data?.config.theme ?? 'system') as ThemePref;
  const next: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };
  const icon = { system: <Monitor />, light: <Sun />, dark: <Moon /> }[pref];
  const label = { system: 'Tema automático (Windows)', light: 'Tema claro', dark: 'Tema escuro' }[pref];
  return (
    <Tip content={`${label} — clique para alternar`} side="bottom">
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        onClick={() => {
          applyTheme(next[pref]);
          save.mutate({ theme: next[pref] });
        }}
      >
        {icon}
      </Button>
    </Tip>
  );
}

export function Topbar() {
  const { openEditor, setAssistant, setCommand } = useUi();
  return (
    <header className="pf-no-print sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between gap-3 px-6 pt-3">
      <button
        onClick={() => setCommand(true)}
        className="glass flex h-10 w-full max-w-[380px] items-center gap-2.5 !rounded-xl px-3.5 text-sm text-fg-3 transition hover:text-fg-2"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Buscar pautas, projetos, páginas…</span>
        <Kbd>Ctrl K</Kbd>
      </button>
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <Notifications />
        <Tip content="Assistente PautaFlow" side="bottom">
          <Button variant="ghost" size="icon" onClick={() => setAssistant(true)} aria-label="Abrir assistente">
            <Sparkles />
          </Button>
        </Tip>
        <Button variant="primary" className="ml-2" onClick={() => openEditor(null)}>
          <Plus /> Nova pauta
        </Button>
      </div>
    </header>
  );
}
