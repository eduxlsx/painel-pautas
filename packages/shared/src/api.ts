import type {
  Bookmark,
  Categoria,
  Configuracoes,
  JobState,
  Notificacao,
  Pauta,
  PriorityLevel,
  Projeto,
  Resumo,
  Sugestao,
  UserProfile,
} from './schemas';

/** Tipos de resposta da API HTTP local (/api/*). */

export interface AppInfo {
  name: string;
  version: string;
  versionParts: { features: number; fixes: number; visual: number };
  dataDir: string;
  startedAt: string;
  platform: string;
}

export interface BootstrapResponse {
  app: AppInfo;
  profile: UserProfile;
  config: Configuracoes;
  microsoft: MicrosoftStatus;
  ai: AiStatus;
}

export interface MicrosoftStatus {
  configured: boolean;
  connected: boolean;
  account: { username: string; name: string | null; tenantId: string | null } | null;
  scopes: string[];
  pendingAuth: null | { mode: 'interactive' | 'device_code'; message: string | null; userCode: string | null; verificationUri: string | null; startedAt: string };
  lastError: string | null;
  tokenStorage: 'dpapi' | 'memory';
}

export interface AiStatus {
  provider: 'none' | 'ollama' | 'openai-compatible';
  available: boolean;
  model: string | null;
  detail: string;
  hasApiKey: boolean;
}

export interface KpiCard {
  key: string;
  label: string;
  value: number;
  unit?: string;
  hint?: string;
  trend?: { delta: number; direction: 'up' | 'down' | 'flat'; label: string } | null;
}

export interface AttentionItem {
  pauta: Pauta;
  nextAction: string;
  reason: string;
}

export interface Insight {
  id: string;
  tone: 'info' | 'warning' | 'critical' | 'positive';
  text: string;
  pautaIds: string[];
}

export interface ChartDatum {
  label: string;
  value: number;
  color?: string;
  key?: string;
}

export interface SeriesPoint {
  date: string;
  [series: string]: number | string;
}

export interface DashboardResponse {
  greeting: { salutation: string; name: string; dateLabel: string; headline: string };
  kpis: KpiCard[];
  attention: AttentionItem[];
  insights: Insight[];
  dailySummary: Resumo | null;
  charts: {
    byCategory: ChartDatum[];
    byStatus: ChartDatum[];
    weeklyVolume: SeriesPoint[];
    completions: SeriesPoint[];
  };
  upcomingEvents: CalendarItem[];
  generatedAt: string;
}

export interface CalendarItem {
  id: string;
  kind: 'pauta' | 'event' | 'planner';
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  pautaId: string | null;
  status?: string;
  priority?: PriorityLevel;
  location?: string | null;
  url?: string | null;
  color?: string | null;
  /** Itens externos (Outlook/Planner) não são movidos localmente. */
  editable: boolean;
}

export interface PriorityListItem {
  pauta: Pauta;
  recommendedRank: number;
  manualRank: number | null;
  classification: PriorityLevel;
}

export interface MetricValue {
  key: string;
  label: string;
  value: number | null;
  unit?: string;
  kind: 'observed' | 'estimated';
  note?: string;
  previous?: number | null;
}

export interface AnalyticsResponse {
  period: { from: string; to: string; label: string };
  metrics: MetricValue[];
  series: {
    daily: SeriesPoint[];
    weekly: SeriesPoint[];
    monthly: SeriesPoint[];
  };
  byCategory: ChartDatum[];
  byOrigin: ChartDatum[];
  byStatus: ChartDatum[];
  avgTimeByCategory: ChartDatum[];
  topProjects: ChartDatum[];
  suggestionFunnel: ChartDatum[];
  heatmap: { date: string; count: number }[];
  generatedAt: string;
}

export interface RadarStatus {
  enabled: boolean;
  queueSize: number;
  lastScanAt: string | null;
  lastAnalysisAt: string | null;
  pending: number;
  snoozed: number;
  processedToday: number;
  sources: { outlook: SourceStatus; planner: SourceStatus; calendar: SourceStatus };
}

export interface SourceStatus {
  available: boolean;
  lastSyncAt: string | null;
  items: number;
  detail: string;
}

export interface AutomationInfo extends JobState {
  name: string;
  description: string;
  schedule: string;
  requires: string | null;
  available: boolean;
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  uptimeSeconds: number;
  checks: { key: string; label: string; status: 'ok' | 'warning' | 'error'; detail: string }[];
}

export interface BackupInfo {
  id: string;
  createdAt: string;
  reason: string;
  files: number;
  bytes: number;
}

export interface AssistantAnswer {
  answer: string;
  items: { type: 'pauta' | 'sugestao' | 'projeto'; id: string; title: string; meta?: string }[];
  source: 'rules' | string;
}

export interface WeekResponse {
  start: string;
  days: { date: string; items: CalendarItem[]; plannedHours: number; capacityHours: number }[];
}

export interface VersionInfo {
  version: string;
  parts: { features: number; fixes: number; visual: number };
  changelog: { version: string; date: string; type: string; message: string; commit: string | null }[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
}

export type { Pauta, Projeto, Categoria, Sugestao, Notificacao, Resumo, Bookmark, Configuracoes };
