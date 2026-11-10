import path from 'node:path';
import {
  type AccountInfo,
  type AuthenticationResult,
  type ICachePlugin,
  type TokenCacheContext,
  InteractionRequiredAuthError,
  LogLevel,
  PublicClientApplication,
} from '@azure/msal-node';
import type { Logger } from 'pino';
import { SecureBlob } from '../../core/secrets';
import { openUrl } from '../../system/windows';

/** Permissões delegadas somente leitura. Nenhuma escrita em Outlook/Planner/Calendário é solicitada. */
export const GRAPH_SCOPES = ['User.Read', 'Mail.Read', 'Calendars.Read', 'Tasks.Read'];

export interface PendingAuth {
  mode: 'interactive' | 'device_code';
  message: string | null;
  userCode: string | null;
  verificationUri: string | null;
  startedAt: string;
}

/** Cache de tokens MSAL cifrado com DPAPI. Descriptografa uma vez e mantém em memória. */
class DpapiCachePlugin implements ICachePlugin {
  private memory: string | null | undefined;
  constructor(private readonly blob: SecureBlob) {}

  async beforeCacheAccess(ctx: TokenCacheContext): Promise<void> {
    if (this.memory === undefined) this.memory = await this.blob.read();
    if (this.memory) ctx.tokenCache.deserialize(this.memory);
  }

  async afterCacheAccess(ctx: TokenCacheContext): Promise<void> {
    if (!ctx.cacheHasChanged) return;
    this.memory = ctx.tokenCache.serialize();
    await this.blob.write(this.memory);
  }

  async clear() {
    this.memory = null;
    await this.blob.write(null);
  }
}

const SUCCESS_HTML = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>PautaFlow</title><body style="font-family:system-ui;display:grid;place-items:center;height:100vh;background:#0b1020;color:#e2e8f0"><div style="text-align:center"><h1 style="font-weight:600">Conta conectada ✓</h1><p>Você já pode fechar esta janela e voltar ao PautaFlow.</p></div></body></html>`;
const ERROR_HTML = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>PautaFlow</title><body style="font-family:system-ui;display:grid;place-items:center;height:100vh"><div style="text-align:center"><h1>Não foi possível conectar</h1><p>Volte ao PautaFlow para ver os detalhes.</p></div></body></html>`;

export class MsAuth {
  private pca: PublicClientApplication | null = null;
  private pcaKey = '';
  private readonly plugin: DpapiCachePlugin;
  pending: PendingAuth | null = null;
  lastError: string | null = null;

  constructor(
    secureDir: string,
    private readonly getConfig: () => { clientId: string; tenantId: string },
    private readonly log: Logger,
  ) {
    this.plugin = new DpapiCachePlugin(new SecureBlob(path.join(secureDir, 'msal-cache.dat')));
  }

  get configured(): boolean {
    return /^[0-9a-f-]{36}$/i.test(this.getConfig().clientId.trim());
  }

  private client(): PublicClientApplication {
    const { clientId, tenantId } = this.getConfig();
    if (!this.configured) throw new Error('Informe o Client ID do aplicativo registrado no Microsoft Entra ID (Integrações).');
    const key = `${clientId}|${tenantId}`;
    if (!this.pca || this.pcaKey !== key) {
      this.pca = new PublicClientApplication({
        auth: { clientId: clientId.trim(), authority: `https://login.microsoftonline.com/${tenantId.trim() || 'organizations'}` },
        cache: { cachePlugin: this.plugin },
        system: {
          loggerOptions: {
            logLevel: LogLevel.Warning,
            piiLoggingEnabled: false,
            loggerCallback: (level, message) => {
              if (level <= LogLevel.Warning) this.log.warn({ msal: message }, 'MSAL');
            },
          },
        },
      });
      this.pcaKey = key;
    }
    return this.pca;
  }

  async account(): Promise<AccountInfo | null> {
    if (!this.configured) return null;
    const accounts = await this.client().getTokenCache().getAllAccounts();
    return accounts[0] ?? null;
  }

  /** Login interativo pelo navegador padrão (fluxo oficial com redirecionamento para http://localhost). */
  async connectInteractive(): Promise<AuthenticationResult> {
    this.pending = { mode: 'interactive', message: 'Conclua o login na janela do navegador que foi aberta.', userCode: null, verificationUri: null, startedAt: new Date().toISOString() };
    try {
      const result = await this.client().acquireTokenInteractive({
        scopes: GRAPH_SCOPES,
        openBrowser: async (url) => openUrl(url),
        successTemplate: SUCCESS_HTML,
        errorTemplate: ERROR_HTML,
        prompt: 'select_account',
      });
      this.lastError = null;
      return result;
    } catch (err) {
      this.lastError = friendlyAuthError(err);
      throw new Error(this.lastError);
    } finally {
      this.pending = null;
    }
  }

  /** Login por código de dispositivo (útil quando o loopback é bloqueado por política). */
  async connectDeviceCode(): Promise<AuthenticationResult | null> {
    this.pending = { mode: 'device_code', message: 'Gerando código…', userCode: null, verificationUri: null, startedAt: new Date().toISOString() };
    try {
      const result = await this.client().acquireTokenByDeviceCode({
        scopes: GRAPH_SCOPES,
        deviceCodeCallback: (r) => {
          this.pending = { mode: 'device_code', message: r.message, userCode: r.userCode, verificationUri: r.verificationUri, startedAt: this.pending?.startedAt ?? new Date().toISOString() };
        },
      });
      this.lastError = null;
      return result;
    } catch (err) {
      this.lastError = friendlyAuthError(err);
      throw new Error(this.lastError);
    } finally {
      this.pending = null;
    }
  }

  /** Token silencioso (renovação automática via refresh token armazenado com DPAPI). */
  async token(forceRefresh = false): Promise<string> {
    const account = await this.account();
    if (!account) throw new NotConnectedError();
    try {
      const r = await this.client().acquireTokenSilent({ account, scopes: GRAPH_SCOPES, forceRefresh });
      return r.accessToken;
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError) {
        this.lastError = 'A sessão Microsoft expirou ou exige novo consentimento. Reconecte em Integrações.';
        throw new NotConnectedError(this.lastError);
      }
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.configured) {
      const cache = this.client().getTokenCache();
      for (const a of await cache.getAllAccounts()) await cache.removeAccount(a);
    }
    await this.plugin.clear();
  }
}

export class NotConnectedError extends Error {
  constructor(msg = 'Conta Microsoft não conectada') {
    super(msg);
  }
}

export function friendlyAuthError(err: unknown): string {
  const msg = (err as Error)?.message ?? String(err);
  if (/AADSTS65001|consent/i.test(msg)) return 'O consentimento para as permissões não foi concedido. Pode ser necessária a aprovação de um administrador do Microsoft 365 da sua organização.';
  if (/AADSTS50105|AADSTS90094|admin/i.test(msg)) return 'A organização exige aprovação do administrador para este aplicativo. Solicite ao time de TI o consentimento das permissões: ' + GRAPH_SCOPES.join(', ') + '.';
  if (/AADSTS700016/.test(msg)) return 'Client ID não encontrado no tenant. Verifique o registro do aplicativo no Microsoft Entra ID.';
  if (/AADSTS7000218|public client/i.test(msg)) return 'Habilite "Allow public client flows" no registro do aplicativo para usar o código de dispositivo.';
  if (/AADSTS50011|redirect/i.test(msg)) return 'Adicione o Redirect URI "http://localhost" (plataforma Mobile and desktop applications) no registro do aplicativo.';
  if (/user_cancelled|cancel/i.test(msg)) return 'Login cancelado.';
  if (/expired|timeout/i.test(msg)) return 'O tempo para concluir o login expirou. Tente novamente.';
  return msg;
}
