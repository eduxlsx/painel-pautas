import { randomUUID } from 'node:crypto';
import { Pauta, PautaInput, type SourceKind, type SourceRef, STATUS_LABEL } from '@pautaflow/shared';
import type { Database } from '../storage/db';
import type { EventBus } from '../core/events';
import { diff, type HistoryService } from '../core/history';
import { onlyProvided } from '../core/patch';
import { computePriority, type PriorityContext } from '../intelligence/priority';

type Actor = 'user' | 'system' | 'radar' | 'sync' | 'assistant';

const TRACKED: (keyof Pauta)[] = [
  'title', 'description', 'kind', 'categoryId', 'projectId', 'requester', 'owner', 'status', 'manualPriority', 'impact',
  'complexity', 'estimatedHours', 'approvalPending', 'scoreAdjustment', 'startDate', 'dueDate', 'dependencies', 'tags',
];

export class ValidationError extends Error {
  readonly statusCode = 400;
}

export class PautaService {
  constructor(
    private readonly db: Database,
    private readonly bus: EventBus,
    private readonly history: HistoryService,
  ) {}

  private priorityContext(all = this.db.pautas.list()): PriorityContext {
    const cfg = this.db.config.get();
    return { now: new Date(), all, capacityHoursPerDay: cfg.workday.dailyCapacityHours, workdays: cfg.workday.days };
  }

  private validateDependencies(id: string, deps: string[]) {
    for (const d of deps) {
      if (d === id) throw new ValidationError('Uma pauta não pode depender de si mesma');
      if (!this.db.pautas.get(d)) throw new ValidationError(`Dependência inexistente: ${d}`);
    }
    // Detecta ciclos (A depende de B que depende de A)
    const visit = (cur: string, seen: Set<string>): boolean => {
      if (cur === id) return true;
      if (seen.has(cur)) return false;
      seen.add(cur);
      return (this.db.pautas.get(cur)?.dependencies ?? []).some((n) => visit(n, seen));
    };
    if (deps.some((d) => visit(d, new Set()))) throw new ValidationError('Dependência circular detectada');
  }

  async create(
    input: PautaInput & { title: string },
    opts: { origin?: SourceKind; actor?: Actor; sourceRefs?: SourceRef[]; suggestionId?: string | null } = {},
  ): Promise<Pauta> {
    const data = PautaInput.parse(input);
    const now = new Date().toISOString();
    const id = randomUUID();
    if (data.dependencies?.length) this.validateDependencies(id, data.dependencies);
    let pauta = Pauta.parse({
      ...data,
      id,
      title: input.title.trim(),
      origin: opts.origin ?? 'manual',
      sourceRefs: opts.sourceRefs ?? [],
      suggestionId: opts.suggestionId ?? null,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      completedAt: data.status === 'done' ? now : null,
      dueLocked: data.dueLocked ?? (data.dueDate ? (opts.origin ?? 'manual') === 'manual' : false),
    });
    const pr = computePriority(pauta, this.priorityContext([...this.db.pautas.list(), pauta]));
    pauta = { ...pauta, priorityScore: pr.score, recommendedPriority: pr.level, priorityFactors: pr.factors, priorityJustification: pr.justification, priorityComputedAt: now };
    await this.db.pautas.insert(pauta);
    await this.history.record({
      entity: 'pauta',
      entityId: id,
      action: 'created',
      summary: `Pauta criada: ${pauta.title}`,
      actor: opts.actor ?? 'user',
    });
    await this.recomputeAll();
    this.bus.changed('pautas');
    return this.db.pautas.get(id)!;
  }

  async update(id: string, input: PautaInput, actor: Actor = 'user'): Promise<Pauta> {
    const data = onlyProvided(PautaInput.parse(input), input);
    const before = this.db.pautas.get(id);
    if (!before) throw Object.assign(new Error('Pauta não encontrada'), { statusCode: 404 });
    if (data.dependencies) this.validateDependencies(id, data.dependencies);
    const now = new Date().toISOString();
    const after = await this.db.pautas.patch(id, (p) => {
      Object.assign(p, data);
      if (data.title !== undefined) p.title = data.title.trim();
      if (actor === 'user' && data.dueDate !== undefined && data.dueDate !== before.dueDate && data.dueLocked === undefined) p.dueLocked = true;
      if (data.status && data.status !== before.status) {
        if (data.status === 'done') p.completedAt = now;
        else if (before.status === 'done') p.completedAt = null;
      }
      p.updatedAt = now;
      p.lastActivityAt = now;
    });
    const changes = diff(before, after, TRACKED);
    if (Object.keys(changes).length) {
      const statusChange = changes.status ? ` · ${STATUS_LABEL[before.status]} → ${STATUS_LABEL[after.status]}` : '';
      await this.history.record({
        entity: 'pauta',
        entityId: id,
        action: after.status === 'done' && before.status !== 'done' ? 'completed' : changes.status ? 'status_changed' : 'updated',
        summary: `${after.title}${statusChange}`,
        actor,
        changes,
      });
    } else if (data.comments && data.comments.length > before.comments.length) {
      await this.history.record({ entity: 'pauta', entityId: id, action: 'commented', summary: `Comentário em ${after.title}`, actor });
    }
    await this.recomputeAll();
    this.bus.changed('pautas');
    return this.db.pautas.get(id)!;
  }

  async remove(id: string): Promise<void> {
    const p = this.db.pautas.get(id);
    if (!p) throw Object.assign(new Error('Pauta não encontrada'), { statusCode: 404 });
    const dependents = this.db.pautas.filter((o) => o.dependencies.includes(id)).map((o) => o.id);
    await this.db.pautas.patchMany(dependents, (o) => {
      o.dependencies = o.dependencies.filter((d) => d !== id);
    });
    await this.db.pautas.remove(id);
    await this.db.bookmarks.patchMany(
      this.db.bookmarks.filter((b) => b.pautaId === id).map((b) => b.id),
      (b) => {
        b.pautaId = null;
      },
    );
    await this.history.record({ entity: 'pauta', entityId: id, action: 'deleted', summary: `Pauta excluída: ${p.title}`, actor: 'user' });
    await this.recomputeAll();
    this.bus.changed('pautas', 'bookmarks');
  }

  /** Recalcula o score de todas as pautas abertas. Grava apenas o que mudou. Não altera decisões manuais. */
  async recomputeAll(): Promise<number> {
    const all = this.db.pautas.list();
    const ctx = this.priorityContext(all);
    const changed: Map<string, ReturnType<typeof computePriority>> = new Map();
    for (const p of all) {
      const r = computePriority(p, ctx);
      if (r.score !== p.priorityScore || r.level !== p.recommendedPriority || r.justification !== p.priorityJustification) changed.set(p.id, r);
    }
    if (!changed.size) return 0;
    const now = new Date().toISOString();
    await this.db.pautas.patchMany([...changed.keys()], (p) => {
      const r = changed.get(p.id)!;
      p.priorityScore = r.score;
      p.recommendedPriority = r.level;
      p.priorityFactors = r.factors;
      p.priorityJustification = r.justification;
      p.priorityComputedAt = now;
    });
    this.bus.changed('pautas');
    return changed.size;
  }

  /** Define a ordem manual (ajuste do usuário sobre a recomendação). */
  async setManualOrder(ids: string[]): Promise<void> {
    const rank = new Map(ids.map((id, i) => [id, i]));
    await this.db.pautas.patchMany(this.db.pautas.list().map((p) => p.id), (p) => {
      p.manualRank = rank.has(p.id) ? rank.get(p.id)! : null;
    });
    await this.history.record({ entity: 'pauta', entityId: null, action: 'reordered', summary: `Ordem manual definida para ${ids.length} pauta(s)`, actor: 'user' });
    this.bus.changed('pautas');
  }

  /** Aceita a ordem recomendada: remove ordenações manuais. */
  async acceptRecommended(): Promise<void> {
    const ids = this.db.pautas.filter((p) => p.manualRank !== null).map((p) => p.id);
    await this.db.pautas.patchMany(ids, (p) => {
      p.manualRank = null;
    });
    await this.history.record({ entity: 'pauta', entityId: null, action: 'accepted_recommendation', summary: 'Ordem recomendada aceita', actor: 'user' });
    this.bus.changed('pautas');
  }

  async addSourceRef(id: string, ref: SourceRef, note?: string): Promise<Pauta> {
    const p = await this.db.pautas.patch(id, (d) => {
      if (!d.sourceRefs.some((r) => r.source === ref.source && r.externalId === ref.externalId)) d.sourceRefs.push(ref);
      d.updatedAt = new Date().toISOString();
    });
    await this.history.record({ entity: 'pauta', entityId: id, action: 'source_linked', summary: note ?? `Fonte vinculada (${ref.source}): ${ref.title ?? ref.externalId}`, actor: 'radar' });
    this.bus.changed('pautas');
    return p;
  }
}
