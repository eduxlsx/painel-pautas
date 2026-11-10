import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { Notificacao, NotificationType } from '@pautaflow/shared';
import type { Database } from '../storage/db';
import type { EventBus } from './events';
import { showToast } from '../system/windows';
import { IS_WINDOWS } from '../system/powershell';

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body?: string;
  severity?: Notificacao['severity'];
  link?: string | null;
  /** Evita repetir o mesmo alerta: não cria outro com a mesma chave dentro da janela. */
  dedupeKey?: string;
  dedupeHours?: number;
  native?: boolean;
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function inQuietHours(now: Date, start: string, end: string): boolean {
  const cur = now.getHours() * 60 + now.getMinutes();
  const s = minutesOf(start);
  const e = minutesOf(end);
  return s <= e ? cur >= s && cur < e : cur >= s || cur < e;
}

export class NotificationService {
  private nativeSent: number[] = [];

  constructor(
    private readonly db: Database,
    private readonly bus: EventBus,
    private readonly log: Logger,
  ) {}

  async notify(input: NotifyInput): Promise<Notificacao | null> {
    const cfg = this.db.config.get().notifications;
    if (!cfg.inApp) return null;
    if (cfg.types[input.type] === false) return null;
    const now = new Date();
    if (input.dedupeKey) {
      const windowMs = (input.dedupeHours ?? 24) * 3_600_000;
      const dup = this.db.notificacoes.find(
        (n) => n.dedupeKey === input.dedupeKey && now.getTime() - new Date(n.createdAt).getTime() < windowMs,
      );
      if (dup) return null;
    }
    const n: Notificacao = {
      id: randomUUID(),
      type: input.type,
      severity: input.severity ?? 'info',
      title: input.title,
      body: input.body ?? '',
      link: input.link ?? null,
      dedupeKey: input.dedupeKey ?? null,
      createdAt: now.toISOString(),
      readAt: null,
      nativeSent: false,
    };
    const wantsNative = input.native ?? (n.severity === 'critical' || n.severity === 'warning' || n.type === 'suggestion');
    if (wantsNative && (await this.sendNative(n.title, n.body))) n.nativeSent = true;
    await this.db.notificacoes.insert(n);
    this.bus.emit('notification', n);
    this.bus.changed('notificacoes');
    return n;
  }

  /** Envia toast do Windows respeitando opt-in, horário de silêncio e limite por hora. */
  async sendNative(title: string, body: string, force = false): Promise<boolean> {
    const cfg = this.db.config.get().notifications;
    if (!IS_WINDOWS) return false;
    if (!force) {
      if (!cfg.native) return false;
      if (inQuietHours(new Date(), cfg.quietHoursStart, cfg.quietHoursEnd)) return false;
      const hourAgo = Date.now() - 3_600_000;
      this.nativeSent = this.nativeSent.filter((t) => t > hourAgo);
      if (this.nativeSent.length >= cfg.maxNativePerHour) return false;
    }
    try {
      await showToast(title, body);
      this.nativeSent.push(Date.now());
      return true;
    } catch (err) {
      this.log.warn({ err }, 'Falha ao exibir notificação nativa do Windows');
      return false;
    }
  }

  async markRead(id: string) {
    await this.db.notificacoes.patch(id, (n) => {
      n.readAt ??= new Date().toISOString();
    });
    this.bus.changed('notificacoes');
  }

  async markAllRead() {
    const ids = this.db.notificacoes.filter((n) => !n.readAt).map((n) => n.id);
    const ts = new Date().toISOString();
    await this.db.notificacoes.patchMany(ids, (n) => {
      n.readAt = ts;
    });
    this.bus.changed('notificacoes');
  }

  /** Mantém no máximo 500 notificações e descarta lidas com mais de 30 dias. */
  async prune(): Promise<number> {
    const cutoff = Date.now() - 30 * 86_400_000;
    let removed = await this.db.notificacoes.removeWhere((n) => !!n.readAt && new Date(n.createdAt).getTime() < cutoff);
    const all = this.db.notificacoes.list().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (all.length > 500) {
      const drop = new Set(all.slice(500).map((n) => n.id));
      removed += await this.db.notificacoes.removeWhere((n) => drop.has(n.id));
    }
    return removed;
  }
}
