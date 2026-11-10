import { QueryClient } from '@tanstack/react-query';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

/** Chamada à API local. Escritas levam o cabeçalho X-PautaFlow exigido pelo servidor. */
export async function api<T>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = { accept: 'application/json' };
  if (method !== 'GET') headers['x-pautaflow'] = '1';
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, signal: opts.signal });
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) {
    const issues = (data?.issues ?? []) as { path: string; message: string }[];
    const msg = issues.length ? issues.map((i) => i.message).join(' · ') : (data?.error ?? `Erro ${res.status}`);
    throw new ApiError(msg, res.status, issues);
  }
  return data as T;
}

export const post = <T>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 },
  },
});

/** Tópicos do servidor → chaves de consulta a invalidar. */
const TOPIC_KEYS: Record<string, string[]> = {
  pautas: ['pautas', 'pauta', 'dashboard', 'priorities', 'calendar', 'week', 'analytics', 'history', 'projetos-stats'],
  projetos: ['projetos', 'dashboard', 'analytics'],
  categorias: ['categorias', 'dashboard', 'analytics'],
  sugestoes: ['sugestoes', 'radar', 'dashboard', 'analytics'],
  notificacoes: ['notifications'],
  automacoes: ['automations', 'health'],
  integracoes: ['bootstrap', 'microsoft', 'radar', 'health'],
  config: ['bootstrap', 'config', 'automations'],
  resumos: ['resumos', 'dashboard'],
  bookmarks: ['bookmarks'],
  calendar: ['calendar', 'week', 'dashboard'],
};

/** Conecta ao fluxo SSE do servidor para atualizar a interface automaticamente. */
export function connectLiveUpdates(onStatus?: (online: boolean) => void): () => void {
  let es: EventSource | null = null;
  let retry: number | undefined;
  const open = () => {
    es = new EventSource('/api/events');
    es.addEventListener('hello', () => onStatus?.(true));
    es.addEventListener('change', (ev) => {
      const topics = JSON.parse((ev as MessageEvent).data) as string[];
      if (topics.includes('all')) {
        void queryClient.invalidateQueries();
        return;
      }
      const keys = new Set(topics.flatMap((t) => TOPIC_KEYS[t] ?? []));
      for (const k of keys) void queryClient.invalidateQueries({ queryKey: [k] });
    });
    es.onerror = () => {
      onStatus?.(false);
      es?.close();
      retry = window.setTimeout(open, 4000);
    };
  };
  open();
  return () => {
    window.clearTimeout(retry);
    es?.close();
  };
}
