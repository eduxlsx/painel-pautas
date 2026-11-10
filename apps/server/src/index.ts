import { resolveEnv } from './env';
import { createLogger } from './core/logger';
import { createContext } from './core/context';
import { buildApp } from './app';
import { acquireLock } from './storage/backup';

async function main() {
  const env = resolveEnv();
  const log = createLogger(env.logsDir, env.logLevel);
  log.info({ dataDir: env.dataDir, port: env.port, host: env.host }, 'Iniciando PautaFlow Intelligence');

  const releaseLock = await acquireLock(env.dataDir);
  const ctx = await createContext(env, log);
  const app = await buildApp(ctx);
  await app.listen({ port: env.port, host: env.host });
  await ctx.scheduler.start();
  const v = await ctx.version.info();
  log.info(`PautaFlow Intelligence v${v.version} disponível em http://${env.host === '0.0.0.0' ? 'localhost' : env.host}:${env.port}`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'Encerrando com segurança…');
    ctx.scheduler.stop();
    try {
      await app.close();
      await ctx.db.flushAll();
    } finally {
      await releaseLock();
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGHUP', () => void shutdown('SIGHUP'));
  process.on('unhandledRejection', (err) => log.error({ err }, 'Promessa rejeitada sem tratamento'));
  process.on('uncaughtException', (err) => {
    log.fatal({ err }, 'Exceção não tratada — encerrando (o supervisor reinicia o processo)');
    void ctx.db.flushAll().finally(() => releaseLock().finally(() => process.exit(1)));
  });
}

main().catch((err) => {
  console.error('[PautaFlow] Falha ao iniciar:', err instanceof Error ? err.message : err);
  process.exit(1);
});
