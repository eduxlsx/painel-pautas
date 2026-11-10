import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Raiz do repositório (apps/server/src -> ../../..). */
export const REPO_ROOT = path.resolve(here, '..', '..', '..');

const envFile = path.join(REPO_ROOT, '.env');
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    /* .env inválido: segue com padrões */
  }
}

export interface Env {
  home: string;
  dataDir: string;
  backupsDir: string;
  logsDir: string;
  webDist: string;
  port: number;
  host: string;
  logLevel: string;
}

export function resolveEnv(overrides: Partial<Env> = {}): Env {
  const home = overrides.home ?? process.env.PAUTAFLOW_HOME ?? REPO_ROOT;
  return {
    home,
    dataDir: overrides.dataDir ?? path.join(home, 'data'),
    backupsDir: overrides.backupsDir ?? path.join(home, 'backups'),
    logsDir: overrides.logsDir ?? path.join(home, 'logs'),
    webDist: overrides.webDist ?? path.join(REPO_ROOT, 'apps', 'web', 'dist'),
    port: overrides.port ?? Number(process.env.PAUTAFLOW_PORT ?? 3000),
    host: overrides.host ?? process.env.PAUTAFLOW_HOST ?? '127.0.0.1',
    logLevel: overrides.logLevel ?? process.env.PAUTAFLOW_LOG_LEVEL ?? 'info',
  };
}
