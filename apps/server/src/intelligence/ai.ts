import type { Logger } from 'pino';
import type { AiStatus } from '@pautaflow/shared';
import type { Database } from '../storage/db';
import type { SecretStore } from '../core/secrets';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type AiTask = 'radar' | 'summary' | 'assistant' | 'test';

function isLocalUrl(u: string): boolean {
  try {
    const h = new URL(u).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
  } catch {
    return false;
  }
}

/**
 * Camada de provedores de IA: Ollama (local), endpoint compatível com OpenAI
 * (local ou externo, mediante autorização explícita) ou nenhum.
 * Todas as funções essenciais têm fallback determinístico — a IA apenas enriquece.
 */
export class AiService {
  private statusCache: { at: number; value: AiStatus } | null = null;

  constructor(
    private readonly db: Database,
    private readonly secrets: SecretStore,
    private readonly log: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private get cfg() {
    return this.db.config.get().ai;
  }

  invalidate() {
    this.statusCache = null;
  }

  async status(force = false): Promise<AiStatus> {
    if (!force && this.statusCache && Date.now() - this.statusCache.at < 60_000) return this.statusCache.value;
    const cfg = this.cfg;
    const hasApiKey = Boolean(await this.secrets.get('aiApiKey').catch(() => null));
    let value: AiStatus;
    if (cfg.provider === 'none') {
      value = { provider: 'none', available: false, model: null, detail: 'IA desativada — usando motor determinístico.', hasApiKey };
    } else if (cfg.provider === 'ollama') {
      try {
        const models = await this.ollamaModels();
        const ok = cfg.model !== '' && models.some((m) => m === cfg.model || m.startsWith(`${cfg.model}:`));
        value = {
          provider: 'ollama',
          available: ok,
          model: cfg.model || null,
          detail: ok ? `Ollama ativo com ${cfg.model}` : models.length ? `Modelo "${cfg.model || '—'}" não encontrado. Disponíveis: ${models.join(', ')}` : 'Ollama ativo, mas sem modelos instalados (use "ollama pull <modelo>").',
          hasApiKey,
        };
      } catch {
        value = { provider: 'ollama', available: false, model: cfg.model || null, detail: `Ollama não encontrado em ${cfg.ollamaUrl}. Instale em ollama.com e inicie o serviço.`, hasApiKey };
      }
    } else {
      const external = !isLocalUrl(cfg.baseUrl);
      const allowed = !external || cfg.allowExternal;
      value = {
        provider: 'openai-compatible',
        available: Boolean(cfg.baseUrl && cfg.model && allowed && (hasApiKey || !external)),
        model: cfg.model || null,
        detail: !cfg.baseUrl
          ? 'Informe a URL base do provedor.'
          : !allowed
            ? 'Provedor externo requer autorização explícita para envio de dados.'
            : external && !hasApiKey
              ? 'Informe a chave de API (armazenada cifrada com DPAPI).'
              : `Provedor configurado: ${new URL(cfg.baseUrl).host} / ${cfg.model}`,
        hasApiKey,
      };
    }
    this.statusCache = { at: Date.now(), value };
    return value;
  }

  async ollamaModels(): Promise<string[]> {
    const res = await this.fetchImpl(`${this.cfg.ollamaUrl.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`Ollama respondeu ${res.status}`);
    const json = (await res.json()) as { models?: { name: string }[] };
    return (json.models ?? []).map((m) => m.name);
  }

  enabledFor(task: AiTask): boolean {
    const cfg = this.cfg;
    if (cfg.provider === 'none') return false;
    if (task === 'radar') return cfg.useForRadar;
    if (task === 'summary') return cfg.useForSummaries;
    if (task === 'assistant') return cfg.useForAssistant;
    return true;
  }

  /** Retorna o texto gerado, ou null se a IA estiver indisponível (o chamador usa o fallback). */
  async complete(task: AiTask, messages: ChatMessage[], opts: { json?: boolean } = {}): Promise<string | null> {
    if (!this.enabledFor(task)) return null;
    const st = await this.status();
    if (!st.available) return null;
    const cfg = this.cfg;
    const signal = AbortSignal.timeout(cfg.timeoutSeconds * 1000);
    try {
      if (cfg.provider === 'ollama') {
        const res = await this.fetchImpl(`${cfg.ollamaUrl.replace(/\/$/, '')}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: cfg.model, messages, stream: false, ...(opts.json ? { format: 'json' } : {}), options: { temperature: 0.2 } }),
          signal,
        });
        if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
        const json = (await res.json()) as { message?: { content?: string } };
        return json.message?.content ?? null;
      }
      const key = await this.secrets.get('aiApiKey');
      const res = await this.fetchImpl(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ model: cfg.model, messages, temperature: 0.2, ...(opts.json ? { response_format: { type: 'json_object' } } : {}) }),
        signal,
      });
      if (!res.ok) throw new Error(`Provedor ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return json.choices?.[0]?.message?.content ?? null;
    } catch (err) {
      this.log.warn({ err: (err as Error).message, task }, 'IA indisponível — usando fallback determinístico');
      this.invalidate();
      return null;
    }
  }

  async completeJson<T>(task: AiTask, messages: ChatMessage[]): Promise<T | null> {
    const raw = await this.complete(task, messages, { json: true });
    if (!raw) return null;
    try {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      return JSON.parse(raw.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }

  get providerLabel(): string {
    const cfg = this.cfg;
    return cfg.provider === 'none' ? 'rules' : `ai:${cfg.provider}:${cfg.model}`;
  }
}
