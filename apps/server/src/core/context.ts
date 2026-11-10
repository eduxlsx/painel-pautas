import path from 'node:path';
import type { Logger } from 'pino';
import type { Env } from '../env';
import { Database } from '../storage/db';
import { BackupService } from '../storage/backup';
import { EventBus } from './events';
import { HistoryService } from './history';
import { NotificationService } from './notifications';
import { SecretStore } from './secrets';
import { AiService } from '../intelligence/ai';
import { PautaService } from '../modules/pautas';
import { RadarService } from '../modules/radar';
import { SummaryService } from '../modules/summaries';
import { MicrosoftService } from '../integrations/microsoft/service';
import { Scheduler } from '../automation/scheduler';
import { VersionService } from './version';
import { DiscordService } from '../integrations/discord/bot';
import { OutlookLocalService } from '../integrations/outlook-local/service';

export interface AppContext {
  env: Env;
  log: Logger;
  db: Database;
  bus: EventBus;
  history: HistoryService;
  notify: NotificationService;
  backups: BackupService;
  secrets: SecretStore;
  ai: AiService;
  pautas: PautaService;
  radar: RadarService;
  summaries: SummaryService;
  ms: MicrosoftService;
  scheduler: Scheduler;
  version: VersionService;
  discord: DiscordService;
  outlookLocal: OutlookLocalService;
  startedAt: Date;
}

export interface ContextOptions {
  fetchImpl?: typeof fetch;
  /** Desativa recursos que tocam o sistema (DPAPI, toasts) — usado nos testes. */
  sandbox?: boolean;
  /** Substitui o MSAL por um provedor de token (somente testes). */
  msTokenProvider?: () => Promise<string>;
}

export async function createContext(env: Env, log: Logger, opts: ContextOptions = {}): Promise<AppContext> {
  const bus = new EventBus();
  const ctx = {} as AppContext;
  const db = new Database({
    dataDir: env.dataDir,
    backupsDir: env.backupsDir,
    logger: log,
    onRecover: (ev) => {
      // Registrado após a carga; notificação aparece no painel
      queueMicrotask(() => {
        void ctx.notify
          ?.notify({
            type: 'system',
            severity: 'warning',
            title: 'Arquivo de dados recuperado',
            body: `${ev.file}: ${ev.reason}. Restaurado a partir de ${ev.recoveredFrom === 'bak' ? 'cópia de segurança imediata' : ev.recoveredFrom === 'backup' ? 'backup automático' : 'valores padrão'}.`,
            dedupeKey: `recover:${ev.file}:${ev.quarantined}`,
          })
          .catch(() => undefined);
      });
    },
  });
  await db.loadAll();
  const history = new HistoryService(db, bus);
  const secrets = new SecretStore(path.join(env.dataDir, 'secure'));
  Object.assign(ctx, {
    env,
    log,
    db,
    bus,
    history,
    secrets,
    startedAt: new Date(),
    notify: new NotificationService(db, bus, log),
    backups: new BackupService(db, env.backupsDir),
    ai: new AiService(db, secrets, log, opts.fetchImpl),
    pautas: new PautaService(db, bus, history),
    version: new VersionService(),
  });
  ctx.radar = new RadarService(ctx);
  ctx.summaries = new SummaryService(ctx);
  ctx.outlookLocal = new OutlookLocalService(ctx);
  ctx.ms = new MicrosoftService(ctx, { fetchImpl: opts.fetchImpl, sandbox: opts.sandbox, tokenProvider: opts.msTokenProvider });
  ctx.scheduler = new Scheduler(ctx);
  ctx.discord = new DiscordService(ctx, env.discord);
  return ctx;
}
