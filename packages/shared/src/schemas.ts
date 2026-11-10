import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Primitivos                                                          */
/* ------------------------------------------------------------------ */

export const IsoDate = z.string().min(10); // ISO 8601 (data ou data/hora)
export const Id = z.string().min(1);

export const PautaStatus = z.enum(['backlog', 'todo', 'in_progress', 'waiting', 'review', 'done', 'cancelled']);
export type PautaStatus = z.infer<typeof PautaStatus>;

export const PriorityLevel = z.enum(['low', 'medium', 'high', 'critical']);
export type PriorityLevel = z.infer<typeof PriorityLevel>;

export const SourceKind = z.enum(['manual', 'outlook', 'planner', 'calendar', 'radar', 'assistant']);
export type SourceKind = z.infer<typeof SourceKind>;

export const PautaKind = z.enum(['tarefa', 'entrega', 'publicacao', 'reuniao', 'aprovacao']);
export type PautaKind = z.infer<typeof PautaKind>;

/* ------------------------------------------------------------------ */
/* Pauta                                                               */
/* ------------------------------------------------------------------ */

export const ChecklistItem = z.object({ id: Id, text: z.string(), done: z.boolean().default(false) });
export const Subtask = z.object({
  id: Id,
  title: z.string(),
  done: z.boolean().default(false),
  dueDate: IsoDate.nullable().default(null),
});
export const Comment = z.object({ id: Id, text: z.string(), createdAt: IsoDate, author: z.string().default('Você') });
export const LinkRef = z.object({ id: Id, label: z.string(), url: z.string() });

export const SourceRef = z.object({
  source: SourceKind,
  externalId: z.string(),
  url: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
  conversationId: z.string().nullable().default(null),
  linkedAt: IsoDate,
  /** Último estado observado na fonte (ex.: prazo/percentual do Planner). */
  snapshot: z.record(z.string(), z.unknown()).default({}),
});
export type SourceRef = z.infer<typeof SourceRef>;

export const PriorityFactor = z.object({
  key: z.string(),
  label: z.string(),
  points: z.number(),
  max: z.number(),
  detail: z.string(),
});
export type PriorityFactor = z.infer<typeof PriorityFactor>;

export const Pauta = z.object({
  id: Id,
  title: z.string().min(1),
  description: z.string().default(''),
  kind: PautaKind.default('tarefa'),
  categoryId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  requester: z.string().nullable().default(null),
  owner: z.string().nullable().default(null),
  origin: SourceKind.default('manual'),
  status: PautaStatus.default('todo'),
  manualPriority: PriorityLevel.nullable().default(null),
  /** Impacto 1–5 (1 = baixo, 5 = muito alto). */
  impact: z.number().int().min(1).max(5).default(3),
  /** Complexidade 1–5. */
  complexity: z.number().int().min(1).max(5).default(3),
  estimatedHours: z.number().min(0).nullable().default(null),
  approvalPending: z.boolean().default(false),
  /** Ajuste manual somado ao score recomendado (-30..+30). */
  scoreAdjustment: z.number().min(-30).max(30).default(0),
  /** Ordem manual definida pelo usuário (menor = primeiro). null = segue a recomendação. */
  manualRank: z.number().nullable().default(null),
  recommendedPriority: PriorityLevel.default('medium'),
  priorityScore: z.number().min(0).max(100).default(0),
  priorityFactors: z.array(PriorityFactor).default([]),
  priorityJustification: z.string().default(''),
  priorityComputedAt: IsoDate.nullable().default(null),
  createdAt: IsoDate,
  updatedAt: IsoDate,
  startDate: IsoDate.nullable().default(null),
  dueDate: IsoDate.nullable().default(null),
  /** Quando true, sincronizações não alteram o prazo (o usuário definiu manualmente). */
  dueLocked: z.boolean().default(false),
  completedAt: IsoDate.nullable().default(null),
  checklist: z.array(ChecklistItem).default([]),
  subtasks: z.array(Subtask).default([]),
  comments: z.array(Comment).default([]),
  links: z.array(LinkRef).default([]),
  /** Anexos são arquivos/pastas sinalizados (Bookmark) com pautaId = esta pauta. */
  dependencies: z.array(Id).default([]),
  tags: z.array(z.string()).default([]),
  sourceRefs: z.array(SourceRef).default([]),
  suggestionId: z.string().nullable().default(null),
  lastActivityAt: IsoDate.nullable().default(null),
});
export type Pauta = z.infer<typeof Pauta>;

/** Campos que o usuário pode informar ao criar/editar. */
export const PautaInput = Pauta.pick({
  title: true,
  description: true,
  kind: true,
  categoryId: true,
  projectId: true,
  requester: true,
  owner: true,
  status: true,
  manualPriority: true,
  impact: true,
  complexity: true,
  estimatedHours: true,
  approvalPending: true,
  scoreAdjustment: true,
  startDate: true,
  dueDate: true,
  dueLocked: true,
  checklist: true,
  subtasks: true,
  comments: true,
  links: true,
  dependencies: true,
  tags: true,
}).partial();
export type PautaInput = z.infer<typeof PautaInput>;

/* ------------------------------------------------------------------ */
/* Projetos e categorias                                               */
/* ------------------------------------------------------------------ */

export const Projeto = z.object({
  id: Id,
  name: z.string().min(1),
  description: z.string().default(''),
  color: z.string().default('#6366f1'),
  status: z.enum(['active', 'paused', 'done']).default('active'),
  owner: z.string().nullable().default(null),
  dueDate: IsoDate.nullable().default(null),
  /** Palavras-chave usadas pelo radar para associar demandas ao projeto. */
  keywords: z.array(z.string()).default([]),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type Projeto = z.infer<typeof Projeto>;
export const ProjetoInput = Projeto.pick({
  name: true,
  description: true,
  color: true,
  status: true,
  owner: true,
  dueDate: true,
  keywords: true,
}).partial();
export type ProjetoInput = z.infer<typeof ProjetoInput>;

export const Categoria = z.object({
  id: Id,
  name: z.string().min(1),
  color: z.string().default('#64748b'),
  icon: z.string().default('tag'),
  keywords: z.array(z.string()).default([]),
  createdAt: IsoDate,
});
export type Categoria = z.infer<typeof Categoria>;
export const CategoriaInput = Categoria.pick({ name: true, color: true, icon: true, keywords: true }).partial();
export type CategoriaInput = z.infer<typeof CategoriaInput>;

/* ------------------------------------------------------------------ */
/* Sugestões do radar                                                  */
/* ------------------------------------------------------------------ */

export const SuggestionStatus = z.enum(['pending', 'approved', 'ignored', 'snoozed', 'linked']);
export type SuggestionStatus = z.infer<typeof SuggestionStatus>;

export const DuplicateHint = z.object({
  type: z.enum(['pauta', 'sugestao']),
  id: Id,
  title: z.string(),
  similarity: z.number(),
  reason: z.string(),
});
export type DuplicateHint = z.infer<typeof DuplicateHint>;

export const Sugestao = z.object({
  id: Id,
  title: z.string(),
  description: z.string().default(''),
  source: SourceKind,
  sourceRefs: z.array(SourceRef).default([]),
  sourceUrl: z.string().nullable().default(null),
  requester: z.string().nullable().default(null),
  requesterEmail: z.string().nullable().default(null),
  dueDate: IsoDate.nullable().default(null),
  dueDateEvidence: z.string().nullable().default(null),
  suggestedPriority: PriorityLevel.default('medium'),
  kind: PautaKind.default('tarefa'),
  approvalPending: z.boolean().default(false),
  categoryId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  justification: z.string().default(''),
  evidence: z.string().default(''),
  signals: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  analyzedBy: z.string().default('rules'),
  status: SuggestionStatus.default('pending'),
  snoozeUntil: IsoDate.nullable().default(null),
  duplicates: z.array(DuplicateHint).default([]),
  linkedPautaId: z.string().nullable().default(null),
  receivedAt: IsoDate.nullable().default(null),
  createdAt: IsoDate,
  updatedAt: IsoDate,
  decidedAt: IsoDate.nullable().default(null),
});
export type Sugestao = z.infer<typeof Sugestao>;

/* ------------------------------------------------------------------ */
/* Notificações e histórico                                            */
/* ------------------------------------------------------------------ */

export const NotificationType = z.enum([
  'suggestion',
  'critical',
  'deadline',
  'overdue',
  'approval',
  'conflict',
  'integration_error',
  'sync',
  'forgotten',
  'system',
]);
export type NotificationType = z.infer<typeof NotificationType>;

export const Notificacao = z.object({
  id: Id,
  type: NotificationType,
  severity: z.enum(['info', 'success', 'warning', 'critical']).default('info'),
  title: z.string(),
  body: z.string().default(''),
  link: z.string().nullable().default(null),
  dedupeKey: z.string().nullable().default(null),
  createdAt: IsoDate,
  readAt: IsoDate.nullable().default(null),
  nativeSent: z.boolean().default(false),
});
export type Notificacao = z.infer<typeof Notificacao>;

export const HistoryEntry = z.object({
  id: Id,
  at: IsoDate,
  entity: z.enum(['pauta', 'projeto', 'categoria', 'sugestao', 'sistema', 'integracao', 'config']),
  entityId: z.string().nullable().default(null),
  action: z.string(),
  summary: z.string(),
  actor: z.enum(['user', 'system', 'radar', 'sync', 'assistant']).default('user'),
  changes: z.record(z.string(), z.object({ from: z.unknown(), to: z.unknown() })).default({}),
});
export type HistoryEntry = z.infer<typeof HistoryEntry>;

/* ------------------------------------------------------------------ */
/* Resumos                                                             */
/* ------------------------------------------------------------------ */

export const SummarySection = z.object({
  key: z.string(),
  title: z.string(),
  items: z.array(
    z.object({
      text: z.string(),
      pautaId: z.string().nullable().default(null),
      meta: z.string().nullable().default(null),
    }),
  ),
});
export type SummarySection = z.infer<typeof SummarySection>;

export const Resumo = z.object({
  id: Id,
  type: z.enum(['daily', 'weekly', 'monthly']),
  periodStart: IsoDate,
  periodEnd: IsoDate,
  generatedAt: IsoDate,
  generatedBy: z.string().default('rules'),
  headline: z.string(),
  narrative: z.string().nullable().default(null),
  sections: z.array(SummarySection),
  metrics: z.record(z.string(), z.number()).default({}),
});
export type Resumo = z.infer<typeof Resumo>;

/* ------------------------------------------------------------------ */
/* Configurações                                                       */
/* ------------------------------------------------------------------ */

export const AiProviderKind = z.enum(['none', 'ollama', 'openai-compatible']);
export type AiProviderKind = z.infer<typeof AiProviderKind>;

export const Configuracoes = z.object({
  version: z.number().default(1),
  onboardingCompleted: z.boolean().default(false),
  onboardingStep: z.number().default(0),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  reduceTransparency: z.boolean().default(false),
  workday: z
    .object({
      start: z.string().default('08:00'),
      end: z.string().default('18:00'),
      days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
      dailyCapacityHours: z.number().min(1).max(24).default(6),
    })
    .prefault({}),
  schedules: z
    .object({
      outlookMinutes: z.number().int().min(1).max(1440).default(5),
      plannerMinutes: z.number().int().min(1).max(1440).default(10),
      calendarMinutes: z.number().int().min(1).max(1440).default(10),
      radarMinutes: z.number().int().min(1).max(1440).default(5),
      prioritiesMinutes: z.number().int().min(1).max(1440).default(15),
      dailySummaryTime: z.string().default('08:00'),
      weeklySummaryDay: z.number().int().min(0).max(6).default(1),
      weeklySummaryTime: z.string().default('08:15'),
      monthlySummaryDay: z.number().int().min(1).max(28).default(1),
      backupTime: z.string().default('12:30'),
      maintenanceTime: z.string().default('12:45'),
    })
    .prefault({}),
  radar: z
    .object({
      enabled: z.boolean().default(true),
      minConfidence: z.number().min(0).max(1).default(0.45),
      duplicateThreshold: z.number().min(0).max(1).default(0.55),
      analyzeSentItems: z.boolean().default(true),
      ignoreSenders: z.array(z.string()).default([]),
      forgottenAfterDays: z.number().int().min(1).default(3),
      staleAfterDays: z.number().int().min(1).default(5),
    })
    .prefault({}),
  microsoft: z
    .object({
      clientId: z.string().default(''),
      tenantId: z.string().default('organizations'),
      mailFolders: z.array(z.object({ id: z.string(), name: z.string() })).default([{ id: 'inbox', name: 'Caixa de Entrada' }]),
      plannerPlanIds: z.array(z.string()).default([]),
      lookbackDays: z.number().int().min(1).max(90).default(14),
      calendarDaysAhead: z.number().int().min(7).max(180).default(45),
      followPlannerDueDates: z.boolean().default(true),
      autoCompleteFromPlanner: z.boolean().default(false),
    })
    .prefault({}),
  /** Fonte alternativa ao Graph: Outlook clássico instalado neste computador (automação COM, somente leitura). */
  outlookLocal: z
    .object({
      enabled: z.boolean().default(false),
      /** Abre o Outlook em segundo plano se estiver fechado. Desligado = só sincroniza com o Outlook aberto. */
      startIfClosed: z.boolean().default(false),
      includeSent: z.boolean().default(true),
      calendar: z.boolean().default(true),
      maxPerFolder: z.number().int().min(50).max(2000).default(400),
    })
    .prefault({}),
  ai: z
    .object({
      provider: AiProviderKind.default('none'),
      ollamaUrl: z.string().default('http://127.0.0.1:11434'),
      baseUrl: z.string().default(''),
      model: z.string().default(''),
      allowExternal: z.boolean().default(false),
      useForRadar: z.boolean().default(true),
      useForSummaries: z.boolean().default(true),
      useForAssistant: z.boolean().default(true),
      timeoutSeconds: z.number().int().min(5).max(300).default(60),
    })
    .prefault({}),
  notifications: z
    .object({
      inApp: z.boolean().default(true),
      native: z.boolean().default(false),
      quietHoursStart: z.string().default('20:00'),
      quietHoursEnd: z.string().default('07:30'),
      deadlineWarningHours: z.number().int().min(1).max(168).default(24),
      maxNativePerHour: z.number().int().min(1).max(60).default(6),
      types: z.record(z.string(), z.boolean()).default({}),
    })
    .prefault({}),
});
export type Configuracoes = z.infer<typeof Configuracoes>;

export const UserProfile = z.object({
  id: Id,
  name: z.string().default(''),
  email: z.string().nullable().default(null),
  role: z.string().nullable().default(null),
  createdAt: IsoDate,
});
export type UserProfile = z.infer<typeof UserProfile>;

/* ------------------------------------------------------------------ */
/* Arquivos e pastas sinalizados                                       */
/* ------------------------------------------------------------------ */

export const BookmarkKind = z.enum(['file', 'folder', 'url']);
export type BookmarkKind = z.infer<typeof BookmarkKind>;

export const Bookmark = z.object({
  id: Id,
  name: z.string().min(1),
  kind: BookmarkKind,
  /** Caminho absoluto no computador (file/folder) ou URL (url). */
  location: z.string().min(1),
  /** Link web opcional (SharePoint/OneDrive/Teams) do mesmo item. */
  webUrl: z.string().nullable().default(null),
  description: z.string().default(''),
  tags: z.array(z.string()).default([]),
  pautaId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  pinned: z.boolean().default(false),
  createdAt: IsoDate,
  updatedAt: IsoDate,
  lastOpenedAt: IsoDate.nullable().default(null),
});
export type Bookmark = z.infer<typeof Bookmark>;
export const BookmarkInput = Bookmark.pick({
  name: true,
  kind: true,
  location: true,
  webUrl: true,
  description: true,
  tags: true,
  pautaId: true,
  projectId: true,
  pinned: true,
}).partial();
export type BookmarkInput = z.infer<typeof BookmarkInput>;

/* ------------------------------------------------------------------ */
/* Automações                                                          */
/* ------------------------------------------------------------------ */

export const JobRun = z.object({
  startedAt: IsoDate,
  finishedAt: IsoDate.nullable(),
  status: z.enum(['success', 'error', 'skipped', 'running']),
  processed: z.number().default(0),
  message: z.string().default(''),
  trigger: z.enum(['schedule', 'manual', 'startup', 'chain']).default('schedule'),
});
export type JobRun = z.infer<typeof JobRun>;

export const JobState = z.object({
  id: z.string(),
  enabled: z.boolean().default(true),
  lastRunAt: IsoDate.nullable().default(null),
  lastSuccessAt: IsoDate.nullable().default(null),
  nextRunAt: IsoDate.nullable().default(null),
  lastStatus: z.enum(['idle', 'running', 'success', 'error', 'skipped']).default('idle'),
  lastMessage: z.string().default(''),
  consecutiveErrors: z.number().default(0),
  totalRuns: z.number().default(0),
  totalProcessed: z.number().default(0),
  totalErrors: z.number().default(0),
  history: z.array(JobRun).default([]),
});
export type JobState = z.infer<typeof JobState>;
