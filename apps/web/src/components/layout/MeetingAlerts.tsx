import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarClock, ExternalLink, MapPin, Video, X } from 'lucide-react';
import type { CalendarItem } from '@pautaflow/shared';
import { api } from '@/lib/api';
import { useBootstrap } from '@/lib/queries';
import { Button } from '@/components/ui';
import { toDateKey } from '@/lib/utils';

const DISMISS_KEY = 'pf-meeting-dismissed';

function loadDismissed(): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(DISMISS_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

/** Avisos em tela para reuniões que estão para começar, com acesso direto ao link da reunião. */
export function MeetingAlerts() {
  const { data: boot } = useBootstrap();
  const lead = boot?.config.notifications.meetingReminderMinutes ?? 10;
  const today = new Date();
  const from = toDateKey(today);
  const to = toDateKey(new Date(today.getTime() + 86_400_000));
  const { data = [] } = useQuery({
    queryKey: ['calendar', from, to],
    queryFn: ({ signal }) => api<CalendarItem[]>(`/api/calendar?from=${from}&to=${to}`, { signal }),
    refetchInterval: 60_000,
    enabled: lead > 0,
  });
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState(loadDismissed);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  const upcoming = useMemo(
    () =>
      data
        .filter((i) => i.kind === 'event' && !i.allDay)
        .map((i) => ({ item: i, start: new Date(i.start).getTime(), key: `${i.id}|${i.start}` }))
        .filter((x) => !Number.isNaN(x.start) && x.start - now <= lead * 60_000 && now - x.start <= 5 * 60_000 && !dismissed[x.key])
        .sort((a, b) => a.start - b.start)
        .slice(0, 3),
    [data, now, lead, dismissed],
  );

  const dismiss = (key: string) => {
    const next = { ...dismissed, [key]: Date.now() };
    setDismissed(next);
    try {
      sessionStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    } catch {
      /* armazenamento indisponível */
    }
  };

  if (lead <= 0) return null;

  return (
    <div className="pf-no-print pointer-events-none fixed right-5 top-20 z-[85] flex w-[min(380px,calc(100vw-40px))] flex-col gap-3">
      <AnimatePresence>
        {upcoming.map(({ item, start, key }) => {
          const mins = Math.round((start - now) / 60_000);
          const started = mins <= 0;
          const time = new Date(start).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          return (
            <motion.div
              key={key}
              layout
              initial={{ opacity: 0, x: 40, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              role="alert"
              className="glass glass-strong pointer-events-auto overflow-hidden !rounded-2xl"
            >
              <div className={started ? 'h-1 bg-critical' : 'h-1 bg-flow'} />
              <div className="flex gap-3 p-4">
                <div className={`grid size-10 shrink-0 place-items-center rounded-xl ${started ? 'bg-critical/12 text-critical' : 'bg-accent-soft text-accent'}`}>
                  <CalendarClock className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-3">
                    {started ? (mins === 0 ? 'Começando agora' : `Começou há ${-mins} min`) : `Reunião em ${mins} min`} · {time}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[14px] font-semibold leading-snug text-fg">{item.title}</div>
                  {item.location && (
                    <div className="mt-1 flex items-center gap-1 truncate text-xs text-fg-3">
                      <MapPin className="size-3 shrink-0" />
                      <span className="truncate">{item.location}</span>
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.joinUrl && (
                      <Button size="sm" variant="primary" onClick={() => window.open(item.joinUrl!, '_blank', 'noopener')}>
                        <Video /> Entrar na reunião
                      </Button>
                    )}
                    {item.openUrl && (
                      <Button size="sm" variant="secondary" onClick={() => window.open(item.openUrl!, '_blank', 'noopener')}>
                        <ExternalLink /> Abrir no Outlook
                      </Button>
                    )}
                  </div>
                </div>
                <button onClick={() => dismiss(key)} aria-label="Dispensar aviso" className="grid size-7 shrink-0 place-items-center rounded-lg text-fg-3 transition hover:bg-sunken hover:text-fg">
                  <X className="size-4" />
                </button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
