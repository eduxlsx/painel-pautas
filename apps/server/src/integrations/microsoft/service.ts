import path from 'node:path';
import type { MicrosoftStatus } from '@pautaflow/shared';
import type { AppContext } from '../../core/context';
import { CalendarEvent, MailMessage, PlannerTask } from '../../storage/internalSchemas';
import { GRAPH_SCOPES, MsAuth, NotConnectedError } from './auth';
import { GraphClient } from './graph';
import { toLocalDateKey } from '../../intelligence/dates';
import { truncate } from '../../intelligence/text';

/* Tipos mínimos das respostas do Graph */
interface GMessage {
  id: string;
  '@removed'?: unknown;
  subject?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  ccRecipients?: { emailAddress?: { address?: string } }[];
  receivedDateTime?: string;
  sentDateTime?: string;
  bodyPreview?: string;
  body?: { content?: string; contentType?: string };
  importance?: string;
  flag?: { flagStatus?: string; dueDateTime?: { dateTime?: string } };
  isRead?: boolean;
  conversationId?: string;
  webLink?: string;
  hasAttachments?: boolean;
  inferenceClassification?: string;
  categories?: string[];
  meetingMessageType?: string;
}
interface GEvent {
  id: string;
  '@removed'?: unknown;
  subject?: string;
  start?: { dateTime: string; timeZone: string };
  end?: { dateTime: string; timeZone: string };
  isAllDay?: boolean;
  location?: { displayName?: string };
  organizer?: { emailAddress?: { name?: string; address?: string } };
  isOrganizer?: boolean;
  responseStatus?: { response?: string };
  showAs?: string;
  isCancelled?: boolean;
  webLink?: string;
  onlineMeeting?: { joinUrl?: string } | null;
  bodyPreview?: string;
}
interface GTask {
  id: string;
  planId: string;
  bucketId?: string;
  title: string;
  percentComplete: number;
  priority?: number;
  startDateTime?: string | null;
  dueDateTime?: string | null;
  completedDateTime?: string | null;
  createdDateTime?: string | null;
  createdBy?: { user?: { displayName?: string | null; id?: string } };
  '@odata.etag'?: string;
}

const MAIL_SELECT = [
  'subject', 'from', 'toRecipients', 'ccRecipients', 'receivedDateTime', 'sentDateTime', 'bodyPreview', 'body', 'importance', 'flag',
  'isRead', 'conversationId', 'webLink', 'hasAttachments', 'inferenceClassification', 'categories',
].join(',');

function graphDate(d: { dateTime: string; timeZone: string } | undefined): string {
  if (!d) return new Date().toISOString();
  const dt = d.dateTime.replace(/\.\d+$/, '');
  return d.timeZone === 'UTC' && !/Z$/.test(dt) ? `${dt}Z` : new Date(dt).toISOString();
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

export interface MicrosoftOptions {
  fetchImpl?: typeof fetch;
  sandbox?: boolean;
  /** Substitui a autenticação MSAL (testes). */
  tokenProvider?: () => Promise<string>;
}

export class MicrosoftService {
  readonly auth: MsAuth;
  readonly graph: GraphClient;
  private connectPromise: Promise<unknown> | null = null;
  private cachedConnected = false;

  constructor(
    private readonly app: AppContext,
    private readonly opts: MicrosoftOptions = {},
  ) {
    this.auth = new MsAuth(path.join(app.env.dataDir, 'secure'), () => app.db.config.get().microsoft, app.log);
    const getToken = opts.tokenProvider ?? ((force?: boolean) => this.auth.token(force));
    this.graph = new GraphClient(getToken, app.log, opts.fetchImpl);
  }

  /** Estado sem I/O (usa o último resultado conhecido). */
  statusSync(): { connected: boolean } {
    return { connected: this.opts.tokenProvider ? true : this.cachedConnected };
  }

  async status(): Promise<MicrosoftStatus> {
    const st = this.app.db.integracoes.get().microsoft;
    let connected = false;
    if (this.opts.tokenProvider) connected = true;
    else if (this.auth.configured) {
      try {
        connected = (await this.auth.account()) !== null;
      } catch (err) {
        this.app.log.warn({ err }, 'Falha ao ler cache de tokens');
      }
    }
    this.cachedConnected = connected;
    return {
      configured: this.auth.configured || !!this.opts.tokenProvider,
      connected,
      account: connected && st.username ? { username: st.username, name: st.name, tenantId: st.tenantId } : null,
      scopes: GRAPH_SCOPES,
      pendingAuth: this.auth.pending,
      lastError: this.auth.lastError ?? st.lastError,
      tokenStorage: this.opts.sandbox ? 'memory' : process.platform === 'win32' ? 'dpapi' : 'memory',
    };
  }

  /** Inicia a conexão em segundo plano; a interface acompanha via status().pendingAuth. */
  startConnect(mode: 'interactive' | 'device_code'): void {
    if (this.connectPromise) throw new Error('Já existe um login em andamento.');
    const run = mode === 'interactive' ? this.auth.connectInteractive() : this.auth.connectDeviceCode();
    this.connectPromise = run
      .then(async (result) => {
        if (!result) return;
        const acc = result.account;
        await this.app.db.integracoes.update((s) => {
          s.microsoft.homeAccountId = acc?.homeAccountId ?? null;
          s.microsoft.username = acc?.username ?? null;
          s.microsoft.name = acc?.name ?? null;
          s.microsoft.tenantId = acc?.tenantId ?? null;
          s.microsoft.grantedScopes = result.scopes;
          s.microsoft.connectedAt = new Date().toISOString();
          s.microsoft.lastError = null;
        });
        await this.app.db.users.update((u) => {
          if (!u.name && acc?.name) u.name = acc.name.split(/[\s,]+/)[0] ?? acc.name;
          if (!u.email && acc?.username) u.email = acc.username;
        });
        this.cachedConnected = true;
        await this.app.history.record({ entity: 'integracao', entityId: 'microsoft', action: 'connected', summary: `Microsoft 365 conectado (${acc?.username})`, actor: 'user' });
        this.app.bus.changed('integracoes', 'config');
        // Primeira sincronização imediata
        void this.app.scheduler.runChain(['outlook-sync', 'planner-sync', 'calendar-sync', 'radar-analysis'], 'manual');
      })
      .catch(async (err) => {
        await this.recordError((err as Error).message);
      })
      .finally(() => {
        this.connectPromise = null;
        this.app.bus.changed('integracoes');
      });
  }

  async disconnect(): Promise<void> {
    await this.auth.disconnect();
    await this.app.db.integracoes.update((s) => {
      s.microsoft = { ...s.microsoft, homeAccountId: null, username: null, name: null, tenantId: null, grantedScopes: [], connectedAt: null };
    });
    await this.app.db.sincronizacao.update((s) => {
      s.outlook.deltaLinks = {};
      s.calendar.deltaLink = null;
    });
    this.cachedConnected = false;
    await this.app.history.record({ entity: 'integracao', entityId: 'microsoft', action: 'disconnected', summary: 'Microsoft 365 desconectado (tokens removidos)', actor: 'user' });
    this.app.bus.changed('integracoes');
  }

  async recordError(message: string) {
    await this.app.db.integracoes.update((s) => {
      s.microsoft.lastError = message;
      s.microsoft.lastErrorAt = new Date().toISOString();
    });
    await this.app.notify.notify({ type: 'integration_error', severity: 'warning', title: 'Erro na integração Microsoft', body: truncate(message, 240), link: '/integracoes', dedupeKey: `ms-error:${message.slice(0, 60)}`, dedupeHours: 6 });
  }

  async ensureConnected(): Promise<boolean> {
    const st = await this.status();
    return st.connected;
  }

  async listMailFolders(): Promise<{ id: string; name: string; total: number }[]> {
    const r = await this.graph.collect<{ id: string; displayName: string; totalItemCount: number }>('/me/mailFolders?$top=100&$select=id,displayName,totalItemCount');
    return r.items.map((f) => ({ id: f.id, name: f.displayName, total: f.totalItemCount }));
  }

  async listPlans(): Promise<{ id: string; title: string }[]> {
    const r = await this.graph.collect<{ id: string; title: string }>('/me/planner/plans');
    const plans = r.items.map((p) => ({ id: p.id, title: p.title }));
    await this.app.db.sincronizacao.update((s) => {
      s.planner.plans = plans;
    });
    return plans;
  }

  /* --------------------------------- Outlook --------------------------------- */

  async syncOutlook(): Promise<{ processed: number; enqueued: number; removed: number }> {
    const { db } = this.app;
    const cfg = db.config.get();
    const sync = db.sincronizacao.get();
    const folders = [...cfg.microsoft.mailFolders];
    if (cfg.radar.analyzeSentItems && !folders.some((f) => f.id === 'sentitems')) folders.push({ id: 'sentitems', name: 'Itens Enviados' });
    // Mudança da janela de busca reinicia o delta
    const resetDelta = sync.outlook.lookbackDays !== cfg.microsoft.lookbackDays;
    const since = new Date(Date.now() - cfg.microsoft.lookbackDays * 86_400_000).toISOString();
    let processed = 0;
    let removed = 0;
    const toEnqueue: string[] = [];
    const newLinks: Record<string, string> = {};
    for (const f of folders) {
      const existing = resetDelta ? undefined : sync.outlook.deltaLinks[f.id];
      const start =
        existing ??
        `/me/mailFolders/${encodeURIComponent(f.id)}/messages/delta?$select=${MAIL_SELECT}&$filter=receivedDateTime+ge+${since}&$orderby=receivedDateTime+desc`;
      const { items, deltaLink } = await this.graph.collect<GMessage>(start, { Prefer: 'odata.maxpagesize=50, outlook.body-content-type="text"' });
      const upserts: MailMessage[] = [];
      const now = new Date().toISOString();
      for (const m of items) {
        if (m['@removed']) {
          if (await db.mensagens.remove(m.id)) removed++;
          continue;
        }
        const isNew = !db.mensagens.get(m.id);
        const body = m.body?.contentType === 'html' ? htmlToText(m.body.content ?? '') : (m.body?.content ?? '');
        upserts.push(
          MailMessage.parse({
            id: m.id,
            folderId: f.id,
            folderName: f.name,
            isSent: f.id === 'sentitems',
            subject: m.subject ?? '',
            fromName: m.from?.emailAddress?.name ?? null,
            fromEmail: m.from?.emailAddress?.address?.toLowerCase() ?? null,
            to: (m.toRecipients ?? []).map((r) => r.emailAddress?.address?.toLowerCase()).filter(Boolean),
            cc: (m.ccRecipients ?? []).map((r) => r.emailAddress?.address?.toLowerCase()).filter(Boolean),
            receivedAt: m.receivedDateTime ?? m.sentDateTime ?? now,
            bodyPreview: m.bodyPreview ?? '',
            bodyText: truncate(body, 8000),
            importance: m.importance ?? 'normal',
            flagged: m.flag?.flagStatus === 'flagged',
            flagDueAt: m.flag?.dueDateTime?.dateTime ? `${m.flag.dueDateTime.dateTime.replace(/\.\d+$/, '')}Z` : null,
            isRead: m.isRead ?? false,
            conversationId: m.conversationId ?? null,
            webLink: m.webLink ?? null,
            hasAttachments: m.hasAttachments ?? false,
            inferenceClassification: m.inferenceClassification ?? null,
            categories: m.categories ?? [],
            meetingMessageType: m.meetingMessageType ?? null,
            syncedAt: now,
          }),
        );
        // Novos e-mails, ou e-mails que passaram a estar sinalizados, vão para a fila do radar
        const prev = db.mensagens.get(m.id);
        if (isNew || (prev && !prev.flagged && m.flag?.flagStatus === 'flagged')) toEnqueue.push(m.id);
      }
      await db.mensagens.upsertMany(upserts);
      processed += items.length;
      if (deltaLink) newLinks[f.id] = deltaLink;
    }
    const enqueued = await this.app.radar.enqueue(toEnqueue.map((id) => ({ source: 'outlook' as const, externalId: id, reason: 'new' as const })));
    await db.sincronizacao.update((s) => {
      s.outlook.deltaLinks = { ...(resetDelta ? {} : s.outlook.deltaLinks), ...newLinks };
      s.outlook.lastSyncAt = new Date().toISOString();
      s.outlook.lookbackDays = cfg.microsoft.lookbackDays;
      s.radar.lastScanAt = new Date().toISOString();
    });
    if (processed) this.app.bus.changed('sugestoes');
    return { processed, enqueued, removed };
  }

  /* --------------------------------- Calendário --------------------------------- */

  async syncCalendar(): Promise<{ processed: number; removed: number }> {
    const { db } = this.app;
    const cfg = db.config.get().microsoft;
    const sync = db.sincronizacao.get().calendar;
    const now = new Date();
    const windowStart = new Date(now.getTime() - 14 * 86_400_000);
    const windowEnd = new Date(now.getTime() + cfg.calendarDaysAhead * 86_400_000);
    // A janela do delta é fixa: reinicia quando a janela salva fica defasada (> 2 dias)
    const stale = !sync.windowStart || Math.abs(new Date(sync.windowStart).getTime() - windowStart.getTime()) > 2 * 86_400_000 || !sync.deltaLink;
    const start = stale
      ? `/me/calendarView/delta?startDateTime=${windowStart.toISOString()}&endDateTime=${windowEnd.toISOString()}`
      : sync.deltaLink!;
    const { items, deltaLink } = await this.graph.collect<GEvent>(start, { Prefer: 'odata.maxpagesize=50, outlook.timezone="UTC"' });
    if (stale) await db.eventos.replaceAll([]);
    let removed = 0;
    const ts = now.toISOString();
    const upserts: CalendarEvent[] = [];
    for (const e of items) {
      if (e['@removed']) {
        if (await db.eventos.remove(e.id)) removed++;
        continue;
      }
      upserts.push(
        CalendarEvent.parse({
          id: e.id,
          subject: e.subject ?? '(sem assunto)',
          start: graphDate(e.start),
          end: graphDate(e.end),
          isAllDay: e.isAllDay ?? false,
          location: e.location?.displayName || null,
          organizer: e.organizer?.emailAddress?.name ?? e.organizer?.emailAddress?.address ?? null,
          isOrganizer: e.isOrganizer ?? false,
          responseStatus: e.responseStatus?.response ?? null,
          showAs: e.showAs ?? null,
          isCancelled: e.isCancelled ?? false,
          webLink: e.webLink ?? null,
          onlineMeetingUrl: e.onlineMeeting?.joinUrl ?? null,
          bodyPreview: truncate(e.bodyPreview ?? '', 500),
          syncedAt: ts,
        }),
      );
    }
    await db.eventos.upsertMany(upserts);
    // Remove eventos fora da janela
    removed += await db.eventos.removeWhere((e) => new Date(e.end) < windowStart);
    await db.sincronizacao.update((s) => {
      s.calendar.deltaLink = deltaLink ?? s.calendar.deltaLink;
      if (stale) {
        s.calendar.windowStart = windowStart.toISOString();
        s.calendar.windowEnd = windowEnd.toISOString();
      }
      s.calendar.lastSyncAt = ts;
    });
    if (items.length) this.app.bus.changed('calendar');
    return { processed: items.length, removed };
  }

  /* --------------------------------- Planner --------------------------------- */

  async syncPlanner(): Promise<{ processed: number; enqueued: number; changes: number }> {
    const { db } = this.app;
    const cfg = db.config.get().microsoft;
    const tenantId = db.integracoes.get().microsoft.tenantId ?? '';
    const { items } = await this.graph.collect<GTask>('/me/planner/tasks');
    const selected = new Set(cfg.plannerPlanIds);
    const tasks = selected.size ? items.filter((t) => selected.has(t.planId)) : items;

    // Títulos dos planos (cache em sincronizacao.json)
    let plans = db.sincronizacao.get().planner.plans;
    const missing = [...new Set(tasks.map((t) => t.planId))].filter((id) => !plans.some((p) => p.id === id));
    if (missing.length) {
      try {
        plans = await this.listPlans();
      } catch {
        /* sem permissão para listar planos: usa o id */
      }
      for (const id of missing.filter((id) => !plans.some((p) => p.id === id)).slice(0, 10)) {
        try {
          const p = await this.graph.request<{ id: string; title: string }>(`/planner/plans/${id}`);
          plans = [...plans, { id: p.id, title: p.title }];
        } catch {
          /* ignora */
        }
      }
      await db.sincronizacao.update((s) => {
        s.planner.plans = plans;
      });
    }
    const planTitle = (id: string) => plans.find((p) => p.id === id)?.title ?? '';

    const now = new Date().toISOString();
    const toEnqueue: string[] = [];
    const upserts: PlannerTask[] = [];
    let changes = 0;
    let detailsFetched = 0;
    for (const t of tasks) {
      const prev = db.plannerTasks.get(t.id);
      if (prev && prev.etag && prev.etag === t['@odata.etag']) continue; // sem alteração
      let description = prev?.description ?? '';
      if (!prev && detailsFetched < 25) {
        try {
          const d = await this.graph.request<{ description?: string }>(`/planner/tasks/${t.id}/details`);
          description = d.description ?? '';
          detailsFetched++;
        } catch {
          /* detalhes são opcionais */
        }
      }
      const task = PlannerTask.parse({
        id: t.id,
        planId: t.planId,
        planTitle: planTitle(t.planId),
        bucketId: t.bucketId ?? null,
        title: t.title,
        description,
        percentComplete: t.percentComplete,
        priority: t.priority ?? null,
        startDateTime: t.startDateTime ?? null,
        dueDateTime: t.dueDateTime ?? null,
        completedDateTime: t.completedDateTime ?? null,
        createdDateTime: t.createdDateTime ?? null,
        createdBy: t.createdBy?.user?.displayName ?? null,
        etag: t['@odata.etag'] ?? null,
        url: tenantId ? `https://tasks.office.com/${tenantId}/Home/Task/${t.id}` : null,
        syncedAt: now,
      });
      upserts.push(task);
      if (!prev) {
        if (task.percentComplete < 100) toEnqueue.push(t.id);
      } else {
        changes += await this.applyPlannerChange(prev, task);
      }
    }
    await db.plannerTasks.upsertMany(upserts);
    // Tarefas que deixaram de estar atribuídas a você
    const current = new Set(tasks.map((t) => t.id));
    await db.plannerTasks.removeWhere((t) => !current.has(t.id));
    const enqueued = await this.app.radar.enqueue(toEnqueue.map((id) => ({ source: 'planner' as const, externalId: id, reason: 'new' as const })));
    await db.sincronizacao.update((s) => {
      s.planner.lastSyncAt = now;
    });
    return { processed: tasks.length, enqueued, changes };
  }

  /** Propaga mudanças do Planner para pautas vinculadas, sem sobrescrever decisões manuais. */
  private async applyPlannerChange(prev: PlannerTask, next: PlannerTask): Promise<number> {
    const { db, pautas, notify } = this.app;
    const cfg = db.config.get().microsoft;
    const linked = db.pautas.filter((p) => p.sourceRefs.some((r) => r.source === 'planner' && r.externalId === next.id));
    let changes = 0;
    for (const p of linked) {
      if (prev.dueDateTime !== next.dueDateTime) {
        const newDue = next.dueDateTime ? toLocalDateKey(new Date(next.dueDateTime)) : null;
        if (cfg.followPlannerDueDates && !p.dueLocked) {
          await pautas.update(p.id, { dueDate: newDue }, 'sync');
        }
        await notify.notify({
          type: 'deadline',
          severity: 'warning',
          title: `Prazo alterado no Planner: ${truncate(p.title, 60)}`,
          body: `${prev.dueDateTime ? toLocalDateKey(new Date(prev.dueDateTime)) : 'sem prazo'} → ${newDue ?? 'sem prazo'}${p.dueLocked ? ' (sua pauta mantém o prazo definido manualmente)' : ''}`,
          link: `/pautas?id=${p.id}`,
          dedupeKey: `planner-due:${next.id}:${next.dueDateTime}`,
        });
        changes++;
      }
      if (prev.percentComplete < 100 && next.percentComplete >= 100 && p.status !== 'done') {
        if (cfg.autoCompleteFromPlanner) await pautas.update(p.id, { status: 'done' }, 'sync');
        await notify.notify({
          type: 'sync',
          severity: 'success',
          title: `Concluída no Planner: ${truncate(p.title, 60)}`,
          body: cfg.autoCompleteFromPlanner ? 'A pauta foi marcada como concluída.' : 'Marque a pauta como concluída se aplicável.',
          link: `/pautas?id=${p.id}`,
          dedupeKey: `planner-done:${next.id}`,
        });
        changes++;
      }
      await db.pautas.patch(p.id, (d) => {
        const ref = d.sourceRefs.find((r) => r.source === 'planner' && r.externalId === next.id);
        if (ref) ref.snapshot = { dueDateTime: next.dueDateTime, percentComplete: next.percentComplete, planId: next.planId };
      });
    }
    return changes;
  }
}

export { NotConnectedError };
