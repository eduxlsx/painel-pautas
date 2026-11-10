import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { StorageContext, RecoveryEvent } from '../src/storage/jsonFile';

export const silentLogger = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return silentLogger; } } as any;

export async function tempContext(): Promise<{ ctx: StorageContext; root: string; recoveries: RecoveryEvent[]; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pautaflow-test-'));
  const recoveries: RecoveryEvent[] = [];
  const ctx: StorageContext = {
    dataDir: path.join(root, 'data'),
    backupsDir: path.join(root, 'backups'),
    logger: silentLogger,
    onRecover: (e) => recoveries.push(e),
  };
  return { ctx, root, recoveries, cleanup: () => rm(root, { recursive: true, force: true }) };
}
