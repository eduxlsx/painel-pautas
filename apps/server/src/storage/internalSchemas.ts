import { z } from 'zod';
import { JobState } from '@pautaflow/shared';

/** Mensagem do Outlook normalizada (somente os campos necessários). */
export const MailMessage = z.object({
  id: z.string(),
  folderId: z.string(),
  folderName: z.string().default(''),
  isSent: z.boolean().default(false),
  subject: z.string().default(''),
  fromName: z.string().nullable().default(null),
  fromEmail: z.string().nullable().default(null),
  to: z.array(z.string()).default([]),
  cc: z.array(z.string()).default([]),
  receivedAt: z.string(),
  bodyPreview: z.string().default(''),
  bodyText: z.string().default(''),
  importance: z.string().default('normal'),
  flagged: z.boolean().default(false),
  flagDueAt: z.string().nullable().default(null),
  isRead: z.boolean().default(false),
  conversationId: z.string().nullable().default(null),
  webLink: z.string().nullable().default(null),
  hasAttachments: z.boolean().default(false),
  inferenceClassification: z.string().nullable().default(null),
  categories: z.array(z.string()).default([]),
  meetingMessageType: z.string().nullable().default(null),
  syncedAt: z.string(),
});
export type MailMessage = z.infer<typeof MailMessage>;

export const PlannerTask = z.object({
  id: z.string(),
  planId: z.string(),
  planTitle: z.string().default(''),
  bucketId: z.string().nullable().default(null),
  title: z.string(),
  description: z.string().default(''),
  percentComplete: z.number().default(0),
  priority: z.number().nullable().default(null),
  startDateTime: z.string().nullable().default(null),
  dueDateTime: z.string().nullable().default(null),
  completedDateTime: z.string().nullable().default(null),
  createdDateTime: z.string().nullable().default(null),
  createdBy: z.string().nullable().default(null),
  etag: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  syncedAt: z.string(),
});
export type PlannerTask = z.infer<typeof PlannerTask>;

export const CalendarEvent = z.object({
  id: z.string(),
  subject: z.string().default(''),
  start: z.string(),
  end: z.string(),
  isAllDay: z.boolean().default(false),
  location: z.string().nullable().default(null),
  organizer: z.string().nullable().default(null),
  isOrganizer: z.boolean().default(false),
  responseStatus: z.string().nullable().default(null),
  showAs: z.string().nullable().default(null),
  isCancelled: z.boolean().default(false),
  webLink: z.string().nullable().default(null),
  onlineMeetingUrl: z.string().nullable().default(null),
  bodyPreview: z.string().default(''),
  syncedAt: z.string(),
});
export type CalendarEvent = z.infer<typeof CalendarEvent>;

export const QueueItem = z.object({
  id: z.string(), // `${source}:${externalId}`
  source: z.enum(['outlook', 'planner']),
  externalId: z.string(),
  reason: z.enum(['new', 'updated']).default('new'),
  enqueuedAt: z.string(),
  attempts: z.number().default(0),
  lastError: z.string().nullable().default(null),
});
export type QueueItem = z.infer<typeof QueueItem>;

export const QueueFile = z.object({ items: z.array(QueueItem).default([]) });
export type QueueFile = z.infer<typeof QueueFile>;

export const SyncState = z.object({
  outlook: z
    .object({
      deltaLinks: z.record(z.string(), z.string()).default({}),
      lastSyncAt: z.string().nullable().default(null),
      lookbackDays: z.number().nullable().default(null),
      /** Cursor incremental do Outlook local (data do último e-mail lido). */
      localCursor: z.string().nullable().default(null),
      localAccount: z.string().nullable().default(null),
      localLastError: z.string().nullable().default(null),
    })
    .prefault({}),
  calendar: z
    .object({
      deltaLink: z.string().nullable().default(null),
      windowStart: z.string().nullable().default(null),
      windowEnd: z.string().nullable().default(null),
      lastSyncAt: z.string().nullable().default(null),
    })
    .prefault({}),
  planner: z
    .object({
      lastSyncAt: z.string().nullable().default(null),
      plans: z.array(z.object({ id: z.string(), title: z.string() })).default([]),
    })
    .prefault({}),
  radar: z
    .object({
      processed: z.record(z.string(), z.string()).default({}), // id -> processedAt
      lastAnalysisAt: z.string().nullable().default(null),
      lastScanAt: z.string().nullable().default(null),
    })
    .prefault({}),
});
export type SyncState = z.infer<typeof SyncState>;

export const IntegrationState = z.object({
  microsoft: z
    .object({
      homeAccountId: z.string().nullable().default(null),
      username: z.string().nullable().default(null),
      name: z.string().nullable().default(null),
      tenantId: z.string().nullable().default(null),
      grantedScopes: z.array(z.string()).default([]),
      connectedAt: z.string().nullable().default(null),
      lastError: z.string().nullable().default(null),
      lastErrorAt: z.string().nullable().default(null),
    })
    .prefault({}),
});
export type IntegrationState = z.infer<typeof IntegrationState>;

export const AutomationFile = z.object({ jobs: z.record(z.string(), JobState).default({}) });
export type AutomationFile = z.infer<typeof AutomationFile>;

export const MetricSnapshot = z.object({
  id: z.string(), // YYYY-MM-DD
  date: z.string(),
  open: z.number(),
  done: z.number(),
  overdue: z.number(),
  createdToday: z.number(),
  completedToday: z.number(),
  pendingSuggestions: z.number(),
  capturedAt: z.string(),
});
export type MetricSnapshot = z.infer<typeof MetricSnapshot>;
