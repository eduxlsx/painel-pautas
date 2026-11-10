import { useMutation, useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type {
  AnalyticsResponse,
  AssistantAnswer,
  AutomationInfo,
  BackupInfo,
  Bookmark,
  BootstrapResponse,
  CalendarItem,
  Categoria,
  Configuracoes,
  DashboardResponse,
  HealthResponse,
  HistoryEntry,
  MicrosoftStatus,
  AiStatus,
  Notificacao,
  Pauta,
  PautaInput,
  PriorityListItem,
  Projeto,
  RadarStatus,
  Resumo,
  Sugestao,
  VersionInfo,
  WeekResponse,
} from '@pautaflow/shared';
import { api, del, patch, post, queryClient } from './api';
import { toast } from '@/stores/toast';

type Opts<T> = Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>;
const q = <T>(key: unknown[], path: string, opts?: Opts<T>) => useQuery<T>({ queryKey: key, queryFn: ({ signal }) => api<T>(path, { signal }), ...opts });

/* ------------------------------ Consultas ------------------------------ */

export const useBootstrap = () => q<BootstrapResponse>(['bootstrap'], '/api/bootstrap', { staleTime: 60_000 });
export const useDashboard = () => q<DashboardResponse>(['dashboard'], '/api/dashboard', { refetchInterval: 120_000 });
export const usePautas = () => q<Pauta[]>(['pautas'], '/api/pautas');
export const usePauta = (id: string | null) => q<Pauta>(['pauta', id], `/api/pautas/${id}`, { enabled: !!id });
export const usePautaHistory = (id: string | null) => q<HistoryEntry[]>(['history', id], `/api/pautas/${id}/history`, { enabled: !!id });
export const useProjetos = () => q<Projeto[]>(['projetos'], '/api/projetos');
export const useCategorias = () => q<Categoria[]>(['categorias'], '/api/categorias', { staleTime: 120_000 });
export const useSugestoes = (status?: string) => q<Sugestao[]>(['sugestoes', status ?? 'all'], `/api/sugestoes${status ? `?status=${status}` : ''}`);
export const useRadarStatus = () => q<RadarStatus>(['radar'], '/api/radar/status', { refetchInterval: 30_000 });
export const usePriorities = () => q<PriorityListItem[]>(['priorities'], '/api/priorities');
export const useWeek = (date?: string) => q<WeekResponse>(['week', date ?? 'now'], `/api/week${date ? `?date=${date}` : ''}`);
export const useCalendar = (from: string, to: string) => q<CalendarItem[]>(['calendar', from, to], `/api/calendar?from=${from}&to=${to}`);
export const useAnalytics = (period: string, from?: string, to?: string) =>
  q<AnalyticsResponse>(['analytics', period, from, to], `/api/analytics?period=${period}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`);
export const useResumos = (type?: string) => q<Resumo[]>(['resumos', type ?? 'all'], `/api/resumos${type ? `?type=${type}` : ''}`);
export const useAutomations = () => q<AutomationInfo[]>(['automations'], '/api/automations', { refetchInterval: 15_000 });
export const useHealth = () => q<HealthResponse>(['health'], '/api/health', { refetchInterval: 30_000 });
export const useBackups = () => q<BackupInfo[]>(['backups'], '/api/backups');
export const useNotifications = () => q<Notificacao[]>(['notifications'], '/api/notifications', { refetchInterval: 60_000 });
export const useMicrosoft = (poll = false) => q<MicrosoftStatus>(['microsoft'], '/api/integrations/microsoft', { refetchInterval: poll ? 2000 : false });
export const useAiStatus = () => q<AiStatus>(['ai-status'], '/api/ai/status');
export const useConfig = () => q<Configuracoes>(['config'], '/api/config');
export const useBookmarks = (filter?: { pautaId?: string; projectId?: string }) => {
  const qs = new URLSearchParams(Object.entries(filter ?? {}).filter(([, v]) => v) as [string, string][]).toString();
  return q<Bookmark[]>(['bookmarks', qs], `/api/bookmarks${qs ? `?${qs}` : ''}`);
};
export const useBookmarkStatus = () => q<Record<string, { exists: boolean; size: number | null; modifiedAt: string | null }>>(['bookmarks', 'status'], '/api/bookmarks/status', { staleTime: 60_000 });
export const useVersion = () => q<VersionInfo>(['version'], '/api/version');
export const useActivity = (limit = 100) => q<HistoryEntry[]>(['history', 'all', limit], `/api/history?limit=${limit}`);

/* ------------------------------ Mutações ------------------------------ */

/** Mutação com toast de erro padrão; invalida as chaves indicadas ao concluir. */
export function useApiMutation<TVars, TRes = unknown>(fn: (v: TVars) => Promise<TRes>, opts: { invalidate?: string[]; success?: string | ((r: TRes) => string) } = {}) {
  return useMutation<TRes, Error, TVars>({
    mutationFn: fn,
    onSuccess: (r) => {
      for (const k of opts.invalidate ?? []) void queryClient.invalidateQueries({ queryKey: [k] });
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
    },
    onError: (err) => toast.error(err.message),
  });
}

const PAUTA_KEYS = ['pautas', 'pauta', 'dashboard', 'priorities', 'calendar', 'week', 'analytics', 'history'];

export const useCreatePauta = () => useApiMutation((input: PautaInput & { title: string }) => post<Pauta>('/api/pautas', input), { invalidate: PAUTA_KEYS, success: 'Pauta criada' });
export const useUpdatePauta = () => useApiMutation(({ id, ...input }: PautaInput & { id: string }) => patch<Pauta>(`/api/pautas/${id}`, input), { invalidate: PAUTA_KEYS });
export const useDeletePauta = () => useApiMutation((id: string) => del(`/api/pautas/${id}`), { invalidate: PAUTA_KEYS, success: 'Pauta excluída' });

export const useSaveProjeto = () =>
  useApiMutation(({ id, ...input }: Partial<Projeto> & { id?: string }) => (id ? patch<Projeto>(`/api/projetos/${id}`, input) : post<Projeto>('/api/projetos', input)), {
    invalidate: ['projetos', 'dashboard'],
    success: 'Projeto salvo',
  });
export const useDeleteProjeto = () => useApiMutation((id: string) => del(`/api/projetos/${id}`), { invalidate: ['projetos', 'pautas'], success: 'Projeto excluído' });

export const useSaveCategoria = () =>
  useApiMutation(({ id, ...input }: Partial<Categoria> & { id?: string }) => (id ? patch<Categoria>(`/api/categorias/${id}`, input) : post<Categoria>('/api/categorias', input)), {
    invalidate: ['categorias'],
    success: 'Categoria salva',
  });
export const useDeleteCategoria = () => useApiMutation((id: string) => del(`/api/categorias/${id}`), { invalidate: ['categorias', 'pautas'] });

export const useSaveConfig = () =>
  useApiMutation((p: Partial<Configuracoes> | Record<string, unknown>) => patch<Configuracoes>('/api/config', p), { invalidate: ['config', 'bootstrap', 'automations'], success: 'Configurações salvas' });

export const useSuggestionAction = () =>
  useApiMutation(
    ({ id, action, body }: { id: string; action: 'approve' | 'ignore' | 'snooze' | 'link' | 'restore'; body?: unknown }) => post<unknown>(`/api/sugestoes/${id}/${action}`, body ?? {}),
    { invalidate: ['sugestoes', 'radar', ...PAUTA_KEYS] },
  );

export const useAsk = () => useMutation<AssistantAnswer, Error, string>({ mutationFn: (question) => post<AssistantAnswer>('/api/assistant', { question }) });

export { api, post, patch, del };
