import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppContext } from '../../core/context';
import { CalendarEvent, MailMessage } from '../../storage/internalSchemas';
import { IS_WINDOWS, PS_READ_STDIN, runPowerShell } from '../../system/powershell';
import { findJoinUrl, truncate } from '../../intelligence/text';

const SCRIPT = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'export.ps1'), 'utf8');

export interface RawMail {
  id: string;
  folderId: string;
  folderName: string;
  subject: string;
  fromName: string | null;
  fromEmail: string | null;
  to: string[] | string | null;
  cc: string[] | string | null;
  receivedAt: string | null;
  body: string;
  importance: number;
  flagged: boolean;
  flagDue: string | null;
  isRead: boolean;
  conversationId: string | null;
  hasAttachments: boolean;
  categories: string;
  messageClass: string;
}

export interface RawEvent {
  id: string;
  subject: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  location: string;
  organizer: string;
  busy: number;
  meetingStatus: number;
  responseStatus: number;
  body: string;
  joinUrl?: string | null;
}

export interface LocalOutlookStatus {
  installed: boolean;
  running: boolean;
  enabled: boolean;
  account: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

/** ConvertTo-Json do PowerShell 5 transforma arrays de 1 item em escalar. */
const arr = (v: string[] | string | null | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : []);

export function openLink(id: string): string {
  return `/api/integrations/outlook-local/open?id=${encodeURIComponent(id)}`;
}

/** Converte um e-mail lido via COM no formato interno. Puro — testável. */
export function mapMail(m: RawMail, now = new Date().toISOString()): MailMessage | null {
  if (!m.id || !m.receivedAt) return null;
  const meeting = /^IPM\.Schedule\.Meeting\.(Request|Canceled|Resp)/i.exec(m.messageClass);
  return MailMessage.parse({
    id: m.id,
    folderId: m.folderId,
    folderName: m.folderName,
    isSent: m.folderId === 'sentitems',
    subject: m.subject ?? '',
    fromName: m.fromName || null,
    fromEmail: m.fromEmail ? m.fromEmail.toLowerCase() : null,
    to: arr(m.to).map((x) => x.toLowerCase()),
    cc: arr(m.cc).map((x) => x.toLowerCase()),
    receivedAt: m.receivedAt,
    bodyPreview: truncate((m.body ?? '').replace(/\s+/g, ' ').trim(), 255),
    bodyText: m.body ?? '',
    importance: m.importance === 2 ? 'high' : m.importance === 0 ? 'low' : 'normal',
    flagged: !!m.flagged,
    flagDueAt: m.flagDue,
    isRead: !!m.isRead,
    conversationId: m.conversationId || null,
    webLink: openLink(m.id),
    hasAttachments: !!m.hasAttachments,
    inferenceClassification: null,
    categories: m.categories ? m.categories.split(/[;,]\s*/).filter(Boolean) : [],
    meetingMessageType: meeting ? meeting[1]!.toLowerCase() : null,
    syncedAt: now,
  });
}

const SHOW_AS = ['free', 'tentative', 'busy', 'oof', 'workingElsewhere'];

export function mapEvent(e: RawEvent, now = new Date().toISOString()): CalendarEvent | null {
  if (!e.id || !e.start || !e.end) return null;
  return CalendarEvent.parse({
    id: `local:${e.id}`,
    subject: e.subject || '(sem assunto)',
    start: e.start,
    end: e.end,
    isAllDay: !!e.allDay,
    location: e.location || null,
    organizer: e.organizer || null,
    isOrganizer: false,
    responseStatus: null,
    showAs: SHOW_AS[e.busy] ?? null,
    // olMeetingCanceled = 5, olMeetingReceivedAndCanceled = 7
    isCancelled: e.meetingStatus === 5 || e.meetingStatus === 7,
    webLink: openLink(e.id),
    onlineMeetingUrl: e.joinUrl || findJoinUrl(`${e.location ?? ''} ${e.body ?? ''}`),
    bodyPreview: e.body ?? '',
    syncedAt: now,
  });
}

/**
 * Fonte alternativa ao Microsoft Graph: lê o Outlook clássico instalado via automação COM
 * (interface oficial do Office). Não usa tokens, cookies nem registro de aplicativo.
 */
export class OutlookLocalService {
  private installedCache: boolean | null = null;

  constructor(private readonly app: AppContext) {}

  private run<T>(input: Record<string, unknown>, timeoutMs = 20 * 60_000): Promise<T> {
    return runPowerShell(`${PS_READ_STDIN}\n${SCRIPT}`, { stdin: JSON.stringify(input), timeoutMs }).then((out) => JSON.parse(out) as T);
  }

  async installed(): Promise<boolean> {
    if (this.installedCache !== null) return this.installedCache;
    if (!IS_WINDOWS) return (this.installedCache = false);
    try {
      const out = await runPowerShell(`[Console]::Out.Write([bool](Test-Path 'Registry::HKEY_CLASSES_ROOT\\Outlook.Application\\CLSID'))`);
      this.installedCache = out.trim() === 'True';
    } catch {
      this.installedCache = false;
    }
    return this.installedCache;
  }

  async running(): Promise<boolean> {
    if (!IS_WINDOWS) return false;
    try {
      return (await runPowerShell(`[Console]::Out.Write([bool](Get-Process OUTLOOK -ErrorAction SilentlyContinue))`)).trim() === 'True';
    } catch {
      return false;
    }
  }

  enabled(): boolean {
    return this.app.db.config.get().outlookLocal.enabled;
  }

  async status(): Promise<LocalOutlookStatus> {
    const s = this.app.db.sincronizacao.get().outlook;
    return {
      installed: await this.installed(),
      running: await this.running(),
      enabled: this.enabled(),
      account: s.localAccount,
      lastSyncAt: s.localCursor ? s.lastSyncAt : null,
      lastError: s.localLastError,
    };
  }

  /** Teste rápido: conta da caixa e total de itens (sem ler conteúdo). */
  async probe(start = false): Promise<{ status: string; account?: string; version?: string; inboxCount?: number }> {
    return this.run({ mode: 'probe', startIfClosed: start }, 120_000);
  }

  async open(id: string): Promise<void> {
    await this.run({ mode: 'open', id, startIfClosed: true }, 60_000);
  }

  /** Sincronização incremental de e-mails (e opcionalmente calendário). */
  async sync(opts: { mail: boolean; calendar: boolean }): Promise<{ status: 'ok' | 'closed'; mails: number; enqueued: number; events: number; errors: string[] }> {
    const { db } = this.app;
    const cfg = db.config.get();
    const sync = db.sincronizacao.get().outlook;
    const now = new Date();
    const lookback = new Date(now.getTime() - cfg.microsoft.lookbackDays * 86_400_000);
    // Sobreposição de 2h para não perder itens que chegaram durante a leitura anterior
    const since = sync.localCursor ? new Date(Math.max(lookback.getTime(), new Date(sync.localCursor).getTime() - 2 * 3_600_000)) : lookback;
    const calFrom = new Date(now.getTime() - 14 * 86_400_000);
    const calTo = new Date(now.getTime() + cfg.microsoft.calendarDaysAhead * 86_400_000);
    const res = await this.run<{ status: string; account?: string; mails?: RawMail[] | RawMail; events?: RawEvent[] | RawEvent; errors?: string[] | string }>({
      mode: 'sync',
      since: opts.mail ? since.toISOString() : now.toISOString(),
      startIfClosed: cfg.outlookLocal.startIfClosed,
      includeSent: opts.mail && cfg.outlookLocal.includeSent && cfg.radar.analyzeSentItems,
      calendar: opts.calendar,
      calFrom: calFrom.toISOString(),
      calTo: calTo.toISOString(),
      max: cfg.outlookLocal.maxPerFolder,
    });
    if (res.status === 'closed') return { status: 'closed', mails: 0, enqueued: 0, events: 0, errors: [] };
    const ts = now.toISOString();
    const errors = Array.isArray(res.errors) ? res.errors : res.errors ? [res.errors] : [];
    let enqueued = 0;
    let mailsCount = 0;
    if (opts.mail) {
      const raw = Array.isArray(res.mails) ? res.mails : res.mails ? [res.mails] : [];
      const mapped = new Map<string, MailMessage>();
      for (const r of raw) {
        const m = mapMail(r, ts);
        if (m) mapped.set(m.id, m);
      }
      const toEnqueue: string[] = [];
      for (const m of mapped.values()) {
        const prev = db.mensagens.get(m.id);
        if (!prev || (!prev.flagged && m.flagged)) toEnqueue.push(m.id);
      }
      await db.mensagens.upsertMany([...mapped.values()]);
      enqueued = await this.app.radar.enqueue(toEnqueue.map((id) => ({ source: 'outlook' as const, externalId: id, reason: 'new' as const })));
      mailsCount = mapped.size;
      const newest = [...mapped.values()].map((m) => m.receivedAt).sort().at(-1);
      await db.sincronizacao.update((s) => {
        s.outlook.localCursor = newest && (!s.outlook.localCursor || newest > s.outlook.localCursor) ? newest : (s.outlook.localCursor ?? since.toISOString());
        s.outlook.lastSyncAt = ts;
        s.outlook.localAccount = res.account ?? s.outlook.localAccount;
        s.outlook.localLastError = errors.length ? errors.join(' · ') : null;
        s.radar.lastScanAt = ts;
      });
    }
    let eventsCount = 0;
    if (opts.calendar) {
      const raw = Array.isArray(res.events) ? res.events : res.events ? [res.events] : [];
      const events = raw.map((e) => mapEvent(e, ts)).filter((e): e is CalendarEvent => !!e);
      // A janela local é lida inteira a cada ciclo: substitui os eventos (inclui removidos/cancelados)
      await db.eventos.replaceAll(events);
      eventsCount = events.length;
      await db.sincronizacao.update((s) => {
        s.calendar.lastSyncAt = ts;
      });
      this.app.bus.changed('calendar');
    }
    if (mailsCount) this.app.bus.changed('sugestoes');
    return { status: 'ok', mails: mailsCount, enqueued, events: eventsCount, errors };
  }
}
