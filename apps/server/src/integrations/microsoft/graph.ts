import type { Logger } from 'pino';

export const GRAPH = 'https://graph.microsoft.com/v1.0';

export class GraphError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Cliente mínimo do Microsoft Graph com renovação de token, paginação e respeito a throttling (429/503). */
export class GraphClient {
  constructor(
    private readonly getToken: (force?: boolean) => Promise<string>,
    private readonly log: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request<T>(urlOrPath: string, init: { headers?: Record<string, string>; method?: string } = {}): Promise<T> {
    const url = urlOrPath.startsWith('http') ? urlOrPath : `${GRAPH}${urlOrPath}`;
    let refreshed = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const token = await this.getToken(refreshed);
      const res = await this.fetchImpl(url, {
        method: init.method ?? 'GET',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...init.headers },
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) return (await res.json()) as T;
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        continue;
      }
      if (res.status === 429 || res.status === 503 || res.status === 504) {
        const retryAfter = Number(res.headers.get('retry-after') ?? 0);
        const wait = Math.min(120, retryAfter || 2 ** attempt * 2) * 1000;
        this.log.warn({ status: res.status, wait }, 'Microsoft Graph limitou as requisições — aguardando');
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      let code = 'unknown';
      let message = `Graph respondeu ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } };
        code = body.error?.code ?? code;
        message = body.error?.message ?? message;
      } catch {
        /* corpo não-JSON */
      }
      if (res.status === 403) message = `Acesso negado pelo Microsoft 365 (${code}). A política da organização pode restringir esta permissão.`;
      throw new GraphError(res.status, code, message);
    }
    throw new GraphError(429, 'throttled', 'Limite de requisições do Microsoft Graph excedido. Nova tentativa no próximo ciclo.');
  }

  /** Percorre @odata.nextLink até o fim; retorna também o @odata.deltaLink quando existir. */
  async collect<T>(first: string, headers?: Record<string, string>, maxPages = 200): Promise<{ items: T[]; deltaLink: string | null }> {
    const items: T[] = [];
    let next: string | null = first;
    let deltaLink: string | null = null;
    for (let page = 0; next && page < maxPages; page++) {
      const body: { value?: T[]; '@odata.nextLink'?: string; '@odata.deltaLink'?: string } = await this.request(next, { headers });
      items.push(...(body.value ?? []));
      next = body['@odata.nextLink'] ?? null;
      deltaLink = body['@odata.deltaLink'] ?? deltaLink;
    }
    return { items, deltaLink };
  }
}
