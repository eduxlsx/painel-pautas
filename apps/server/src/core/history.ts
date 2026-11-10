import { randomUUID } from 'node:crypto';
import type { HistoryEntry } from '@pautaflow/shared';
import type { Database } from '../storage/db';
import type { EventBus } from './events';

export type HistoryInput = Omit<HistoryEntry, 'id' | 'at' | 'changes'> & { changes?: HistoryEntry['changes'] };

export class HistoryService {
  constructor(
    private readonly db: Database,
    private readonly bus?: EventBus,
  ) {}

  async record(input: HistoryInput): Promise<HistoryEntry> {
    const entry: HistoryEntry = { id: randomUUID(), at: new Date().toISOString(), changes: {}, ...input };
    const saved = await this.db.historico.insert(entry);
    this.bus?.emit('history', saved);
    return saved;
  }

  async forEntity(entityId: string, limit = 100): Promise<HistoryEntry[]> {
    return this.db.historico.query({ limit, filter: (h) => h.entityId === entityId, sortKey: (h) => h.at });
  }

  async range(from: string, to: string, limit = 5000): Promise<HistoryEntry[]> {
    return this.db.historico.query({ from, to, limit, sortKey: (h) => h.at });
  }
}

/** Diferença rasa entre dois objetos (para registrar alterações no histórico). */
export function diff<T extends object>(before: T, after: T, keys: (keyof T)[]): HistoryEntry['changes'] {
  const out: HistoryEntry['changes'] = {};
  for (const k of keys) {
    const a = before[k];
    const b = after[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out[String(k)] = { from: a, to: b };
  }
  return out;
}
