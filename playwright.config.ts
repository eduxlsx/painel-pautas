import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

// Instância isolada: dados temporários e porta própria (nunca toca os dados reais).
const home = path.join(os.tmpdir(), `pautaflow-e2e-${process.pid}`);
const port = 3100;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    // Usa o Microsoft Edge já instalado no Windows (sem download de navegadores)
    channel: 'msedge',
    viewport: { width: 1440, height: 900 },
    locale: 'pt-BR',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx tsx apps/server/src/index.ts',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { PAUTAFLOW_HOME: home, PAUTAFLOW_PORT: String(port), PAUTAFLOW_LOG_LEVEL: 'warn' },
  },
});
