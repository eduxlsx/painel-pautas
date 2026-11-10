import { mkdirSync } from 'node:fs';
import path from 'node:path';
import pino, { type Logger } from 'pino';

export function createLogger(logsDir: string, level: string, toFile = true): Logger {
  const streams: pino.StreamEntry[] = [{ level: level as pino.Level, stream: process.stdout }];
  if (toFile) {
    mkdirSync(logsDir, { recursive: true });
    const month = new Date().toISOString().slice(0, 7);
    streams.push({
      level: level as pino.Level,
      stream: pino.destination({ dest: path.join(logsDir, `pautaflow-${month}.log`), mkdir: true, sync: false }),
    });
  }
  return pino(
    {
      level,
      base: { app: 'pautaflow' },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: ['*.accessToken', '*.refreshToken', '*.apiKey', 'headers.authorization'], censor: '[redacted]' },
    },
    pino.multistream(streams),
  );
}
