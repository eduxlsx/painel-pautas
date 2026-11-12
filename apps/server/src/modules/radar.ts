import { randomUUID } from 'node:crypto';
import { type Pauta, type PautaInput, type RadarStatus, Sugestao, isOpenStatus } from '@pautaflow/shared';
import type { AppContext } from '../core/context';
import { analyzeMail, analyzePlannerTask, deduplicate, type DemandCandidate, type RadarContext } from '../intelligence/radar';
import type { QueueItem } from '../storage/internalSchemas';
import { dueToDate, toLocalDateKey, brDate } from '../intelligence/dates';
import { truncate } from '../intelligence/text';

export interface RadarRunResult {
  processed: number;
  created: number;
  merged: number;
  linked: number;
  skipped: number;
  errors: number;
}

interface AiDemand {
  is_demand?: boolean;
  title?: string;
  summary?: string;
  due_date?: string | null;
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

export class RadarService {
  constructor(private readonly app: AppContext) {}

  private context(): RadarContext {
    const { db } = this.app;
    const me = db.integracoes.get().microsoft.username;
    const profile = db.users.get();
    return {
      now: new Date(),
      myEmails: [me, profile.email].filter((x): x is string => !!x).map((x) => x.toLowerCase()),
      categories: db.categorias.list(),
      projects: db.projetos.list(),
      ignoreSenders: db.config.get().radar.ignoreSenders,
    };
  }

  async enqueue(items: Pick<QueueItem, 'source' | 'externalId' | 'reason'>[]): Promise<number> {
    if (!items.length) return 0;
    const now = new Date().toISOString();
    let added = 0;
    await this.app.db.fila.update((q) => {
      const ids = new Set(q.items.map((i) => i.id));
      for (const it of items) {
        const id = `${it.source}:${it.externalId}`;
        if (ids.has(id)) continue;
        q.items.push({ id, ...it, enqueuedAt: now, attempts: 0, lastError: null });
        ids.add(id);
        added++;
      }
    });
    return added;
  }

  queueSize(): number {
    return this.app.db.fila.get().items.length;
  }

  /** Processa a fila de forma incremental. Itens com falha são re-tentados até 3 vezes. */
  async processQueue(limit = 150): Promise<RadarRunResult> {
    const { db, log } = this.app;
    const res: RadarRunResult = { processed: 0, created: 0, merged: 0, linked: 0, skipped: 0, errors: 0 };
    if (!db.config.get().radar.enabled) return res;
    const batch = db.fila.get().items.slice(0, limit);
    const done = new Set<string>();
    const failed = new Map<string, string>();
    const ctx = this.context();
    for (const item of batch) {
      try {
        const outcome = await this.processItem(item, ctx);
        res[outcome]++;
        res.processed++;
        done.add(item.id);
      } catch (err) {
        res.errors++;
        failed.set(item.id, (err as Error).message);
        log.warn({ err, item: item.id }, 'Falha ao analisar item do radar');
      }
    }
    const now = new Date().toISOString();
    await db.fila.update((q) => {
      q.items = q.items
        .filter((i) => !done.has(i.id))
        .map((i) => (failed.has(i.id) ? { ...i, attempts: i.attempts + 1, lastError: failed.get(i.id)! } : i))
        .filter((i) => i.attempts < 3);
    });
    await db.sincronizacao.update((s) => {
      for (const id of done) s.radar.processed[id] = now;
      s.radar.lastAnalysisAt = now;
    });
    if (res.created) {
      await this.app.notify.notify({
        type: 'suggestion',
        severity: 'info',
        title: `${res.created} nova(s) sugestão(ões) no Radar`,
        body: 'O radar identificou possíveis novas demandas para sua aprovação.',
        link: '/radar',
        dedupeKey: `radar-created:${now.slice(0, 16)}`,
      });
    }
    if (res.processed) this.app.bus.changed('sugestoes', 'pautas');
    return res;
  }

  private async processItem(item: QueueItem, ctx: RadarContext): Promise<keyof Omit<RadarRunResult, 'processed' | 'errors'>> {
    const { db } = this.app;
    let cand: DemandCandidate | null = null;
    if (item.source === 'outlook') {
      const msg = db.mensagens.get(item.externalId);
      if (!msg) return 'skipped';
      if (msg.isSent && !db.config.get().radar.analyzeSentItems) return 'skipped';
      cand = analyzeMail(msg, ctx);
      if (cand) cand = await this.enrichWithAi(cand, `${msg.subject}\n\n${msg.bodyText || msg.bodyPreview}`);
    } else {
      const task = db.plannerTasks.get(item.externalId);
      if (!task) return 'skipped';
      cand = analyzePlannerTask(task, ctx);
    }
    if (!cand) return 'skipped';

    const cfg = db.config.get().radar;
    const dd = deduplicate(cand, db.pautas.list(), db.sugestoes.list(), cfg.duplicateThreshold);
    switch (dd.kind) {
      case 'known':
        return 'skipped';
      case 'thread': {
        const p = db.pautas.get(dd.pautaId)!;
        await this.app.pautas.addSourceRef(p.id, cand.sourceRef, `Nova mensagem na conversa: ${cand.sourceRef.title ?? ''}`);
        if (cand.confidence >= cfg.minConfidence) {
          await this.app.notify.notify({
            type: 'sync',
            title: `Atualização em "${truncate(p.title, 60)}"`,
            body: `${cand.requester ?? 'Alguém'} respondeu na conversa vinculada.`,
            link: `/pautas?id=${p.id}`,
            dedupeKey: `thread:${p.id}:${cand.sourceRef.externalId}`,
          });
        }
        return 'linked';
      }
      case 'crosslink': {
        await this.app.pautas.addSourceRef(dd.pautaId, cand.sourceRef, `Referência cruzada automática (${cand.sourceRef.source}): ${dd.reason}`);
        return 'linked';
      }
      case 'merge': {
        await db.sugestoes.patch(dd.suggestionId, (s) => {
          if (!s.sourceRefs.some((r) => r.source === cand!.sourceRef.source && r.externalId === cand!.sourceRef.externalId)) s.sourceRefs.push(cand!.sourceRef);
          s.confidence = Math.min(1, Math.max(s.confidence, cand!.confidence) + 0.05);
          if (!s.dueDate && cand!.dueDate) {
            s.dueDate = cand!.dueDate;
            s.dueDateEvidence = cand!.dueEvidence;
          }
          s.signals = [...new Set([...s.signals, ...cand!.signals, `Também identificada em ${cand!.sourceRef.source} (${dd.reason})`])];
          s.justification = s.signals.join(' · ');
          s.updatedAt = new Date().toISOString();
        });
        return 'merged';
      }
      case 'new': {
        if (cand.confidence < cfg.minConfidence) return 'skipped';
        const now = new Date().toISOString();
        const s = Sugestao.parse({
          id: randomUUID(),
          title: cand.title,
          description: cand.description,
          source: cand.sourceRef.source,
          sourceRefs: [cand.sourceRef],
          sourceUrl: cand.sourceRef.url,
          requester: cand.requester,
          requesterEmail: cand.requesterEmail,
          dueDate: cand.dueDate,
          dueDateEvidence: cand.dueEvidence,
          suggestedPriority: cand.priority,
          kind: cand.kind,
          approvalPending: cand.approvalPending,
          categoryId: cand.categoryId,
          projectId: cand.projectId,
          justification: cand.justification,
          evidence: cand.evidence,
          signals: cand.signals,
          confidence: cand.confidence,
          analyzedBy: (cand as DemandCandidate & { analyzedBy?: string }).analyzedBy ?? 'rules',
          duplicates: dd.duplicates,
          receivedAt: cand.receivedAt,
          createdAt: now,
          updatedAt: now,
        });
        await db.sugestoes.insert(s);
        await this.app.history.record({ entity: 'sugestao', entityId: s.id, action: 'suggested', summary: `Radar sugeriu: ${s.title}`, actor: 'radar' });
        return 'created';
      }
    }
  }

  /** Enriquecimento opcional por IA. Nunca é obrigatório: sem IA, o resultado das regras é mantido. */
  private async enrichWithAi(cand: DemandCandidate, text: string): Promise<DemandCandidate | null> {
    const ai = this.app.ai;
    if (!ai.enabledFor('radar')) return cand;
    const out = await ai.completeJson<AiDemand>('radar', [
      {
        role: 'system',
        content:
          'Você analisa e-mails corporativos em português e identifica demandas de trabalho para o destinatário. Responda SOMENTE JSON: {"is_demand": boolean, "title": "título curto no imperativo", "summary": "1-2 frases", "due_date": "YYYY-MM-DD ou null", "priority": "low|medium|high|critical"}. Não invente prazos.',
      },
      { role: 'user', content: `Data de hoje: ${toLocalDateKey(new Date())}\n\n${truncate(text, 4000)}` },
    ]);
    if (!out) return cand;
    if (out.is_demand === false && cand.confidence < 0.7) return null;
    const enriched: DemandCandidate & { analyzedBy?: string } = { ...cand, analyzedBy: ai.providerLabel };
    if (out.title && out.title.length > 3) enriched.title = truncate(out.title, 140);
    if (out.summary) enriched.description = `${out.summary}\n\n${cand.description}`.trim();
    if (!cand.dueDate && out.due_date && /^\d{4}-\d{2}-\d{2}$/.test(out.due_date)) {
      enriched.dueDate = out.due_date;
      enriched.dueEvidence = 'Prazo inferido pela IA (verifique)';
    }
    if (out.priority && ['low', 'medium', 'high', 'critical'].includes(out.priority)) enriched.priority = out.priority;
    enriched.signals = [...cand.signals, 'Enriquecido por IA'];
    enriched.confidence = Math.min(1, cand.confidence + (out.is_demand ? 0.1 : -0.1));
    return enriched;
  }

  /** Proposta manual (revisão assistida): entra no Radar como sugestão pendente, nunca como pauta direta. */
  async propose(p: {
    title: string;
    description?: string;
    dueDate?: string | null;
    priority?: Sugestao['suggestedPriority'];
    kind?: Sugestao['kind'];
    requester?: string | null;
    evidence?: string;
    justification?: string;
    emailIds?: string[];
    analyzedBy?: string;
  }): Promise<Sugestao> {
    const { db } = this.app;
    const now = new Date().toISOString();
    const refs = (p.emailIds ?? [])
      .map((id) => db.mensagens.get(id) ?? db.mensagens.find((m) => m.id.endsWith(id)))
      .filter((m): m is NonNullable<typeof m> => !!m)
      .map((m) => ({ source: 'outlook' as const, externalId: m.id, url: m.webLink, title: m.subject, conversationId: m.conversationId, linkedAt: now, snapshot: {} }));
    const ctx = this.context();
    const text = `${p.title} ${p.description ?? ''}`;
    const s = Sugestao.parse({
      id: randomUUID(),
      title: p.title,
      description: p.description ?? '',
      source: refs.length ? 'outlook' : 'assistant',
      sourceRefs: refs,
      sourceUrl: refs[0]?.url ?? null,
      requester: p.requester ?? null,
      dueDate: p.dueDate ?? null,
      dueDateEvidence: p.dueDate ? 'Indicado na revisão dos e-mails' : null,
      suggestedPriority: p.priority ?? 'medium',
      kind: p.kind ?? 'tarefa',
      approvalPending: p.kind === 'aprovacao',
      categoryId: ctx.categories.find((c) => [c.name, ...c.keywords].some((k) => k.length > 3 && text.toLowerCase().includes(k.toLowerCase())))?.id ?? null,
      justification: p.justification ?? '',
      evidence: p.evidence ?? '',
      signals: ['Proposta da revisão de e-mails e Planner'],
      confidence: 0.85,
      analyzedBy: p.analyzedBy ?? 'revisão assistida',
      receivedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await db.sugestoes.insert(s);
    await this.app.history.record({ entity: 'sugestao', entityId: s.id, action: 'suggested', summary: `Proposta da revisão: ${s.title}`, actor: 'assistant' });
    this.app.bus.changed('sugestoes');
    return s;
  }

  /* ------------------------- Ações do usuário ------------------------- */

  private get(id: string): Sugestao {
    const s = this.app.db.sugestoes.get(id);
    if (!s) throw Object.assign(new Error('Sugestão não encontrada'), { statusCode: 404 });
    return s;
  }

  async approve(id: string, overrides: PautaInput = {}): Promise<Pauta> {
    const s = this.get(id);
    if (s.status === 'approved' || s.status === 'linked') throw Object.assign(new Error('Sugestão já processada'), { statusCode: 409 });
    const pauta = await this.app.pautas.create(
      {
        description: [s.description, s.evidence ? `\n\nEvidência: “${s.evidence}”` : ''].join('').trim(),
        kind: s.kind,
        categoryId: s.categoryId,
        projectId: s.projectId,
        requester: s.requester,
        manualPriority: s.suggestedPriority,
        dueDate: s.dueDate,
        approvalPending: s.approvalPending,
        status: 'todo',
        links: s.sourceUrl ? [{ id: randomUUID(), label: `Abrir no ${s.source === 'planner' ? 'Planner' : 'Outlook'}`, url: s.sourceUrl }] : [],
        ...overrides,
        title: overrides.title ?? s.title,
      },
      { origin: s.source, actor: 'user', sourceRefs: s.sourceRefs, suggestionId: s.id },
    );
    await this.decide(id, 'approved', { linkedPautaId: pauta.id });
    return pauta;
  }

  async ignore(id: string) {
    return this.decide(id, 'ignored');
  }

  async snooze(id: string, until: string) {
    return this.decide(id, 'snoozed', { snoozeUntil: until });
  }

  async link(id: string, pautaId: string) {
    const s = this.get(id);
    const p = this.app.db.pautas.get(pautaId);
    if (!p) throw Object.assign(new Error('Pauta não encontrada'), { statusCode: 404 });
    for (const ref of s.sourceRefs) await this.app.pautas.addSourceRef(pautaId, ref, `Sugestão vinculada: ${s.title}`);
    return this.decide(id, 'linked', { linkedPautaId: pautaId });
  }

  async edit(id: string, patch: Partial<Pick<Sugestao, 'title' | 'description' | 'dueDate' | 'suggestedPriority' | 'categoryId' | 'projectId' | 'requester' | 'kind'>>) {
    const s = await this.app.db.sugestoes.patch(id, (d) => {
      Object.assign(d, patch);
      d.updatedAt = new Date().toISOString();
    });
    this.app.bus.changed('sugestoes');
    return s;
  }

  async restore(id: string) {
    return this.decide(id, 'pending', { snoozeUntil: null });
  }

  private async decide(id: string, status: Sugestao['status'], extra: Partial<Sugestao> = {}) {
    const s = await this.app.db.sugestoes.patch(id, (d) => {
      d.status = status;
      Object.assign(d, extra);
      d.decidedAt = status === 'pending' ? null : new Date().toISOString();
      d.updatedAt = new Date().toISOString();
    });
    const labels: Record<string, string> = { approved: 'aprovada', ignored: 'ignorada', snoozed: 'adiada', linked: 'vinculada', pending: 'reativada' };
    await this.app.history.record({ entity: 'sugestao', entityId: id, action: status, summary: `Sugestão ${labels[status]}: ${s.title}`, actor: 'user' });
    this.app.bus.changed('sugestoes');
    return s;
  }

  /**
   * Refaz a análise das fontes já sincronizadas (útil após ajustar regras, categorias ou a IA).
   * Remove apenas sugestões pendentes sem decisão; aprovadas, vinculadas, ignoradas e adiadas são preservadas
   * e continuam impedindo que o mesmo item volte a ser sugerido.
   */
  async reanalyze(): Promise<{ removed: number; updated: number; enqueued: number; result: RadarRunResult }> {
    const { db } = this.app;
    const ctx = this.context();
    const minConf = db.config.get().radar.minConfidence;
    // 1) Reavalia as sugestões pendentes no lugar (evita recriá-las e duplicar notificações)
    let removed = 0;
    let updated = 0;
    for (const s of db.sugestoes.filter((x) => x.status === 'pending')) {
      const ref = s.sourceRefs[0];
      if (!ref) continue;
      const cand =
        ref.source === 'outlook'
          ? (() => {
              const m = db.mensagens.get(ref.externalId);
              return m ? analyzeMail(m, ctx) : undefined;
            })()
          : ref.source === 'planner'
            ? (() => {
                const t = db.plannerTasks.get(ref.externalId);
                return t ? analyzePlannerTask(t, ctx) : undefined;
              })()
            : undefined;
      if (cand === undefined) continue; // fonte não está mais em cache: mantém
      if (cand === null || cand.confidence < minConf) {
        await db.sugestoes.remove(s.id);
        removed++;
        continue;
      }
      await db.sugestoes.patch(s.id, (d) => {
        Object.assign(d, {
          title: cand.title,
          kind: cand.kind,
          approvalPending: cand.approvalPending,
          suggestedPriority: cand.priority,
          confidence: cand.confidence,
          signals: cand.signals,
          justification: cand.justification,
          dueDate: d.dueDate ?? cand.dueDate,
          categoryId: d.categoryId ?? cand.categoryId,
          requester: d.requester ?? cand.requester,
          projectId: d.projectId ?? cand.projectId,
          updatedAt: new Date().toISOString(),
        });
      });
      updated++;
    }
    // 2) Reanalisa os itens que não geraram sugestão nem pauta
    const referenced = new Set([...db.pautas.list().flatMap((p) => p.sourceRefs), ...db.sugestoes.list().flatMap((s) => s.sourceRefs)].map((r) => `${r.source}:${r.externalId}`));
    await db.sincronizacao.update((s) => {
      for (const k of Object.keys(s.radar.processed)) if (!referenced.has(k)) delete s.radar.processed[k];
    });
    const enqueued = await this.enqueue([
      ...db.mensagens.list().filter((m) => !referenced.has(`outlook:${m.id}`)).map((m) => ({ source: 'outlook' as const, externalId: m.id, reason: 'updated' as const })),
      ...db.plannerTasks.list().filter((t) => !referenced.has(`planner:${t.id}`)).map((t) => ({ source: 'planner' as const, externalId: t.id, reason: 'updated' as const })),
    ]);
    let result = await this.processQueue(10_000);
    while (this.queueSize() > 0 && result.processed > 0) result = await this.processQueue(10_000);
    await this.app.history.record({ entity: 'sistema', entityId: null, action: 'radar_reanalyzed', summary: `Radar reanalisado: ${removed} sugestão(ões) descartada(s), ${updated} atualizada(s), ${result.created} nova(s)`, actor: 'user' });
    this.app.bus.changed('sugestoes');
    return { removed, updated, enqueued, result };
  }

  /** Reativa sugestões adiadas cujo prazo de adiamento passou. */
  async reactivateSnoozed(): Promise<number> {
    const now = new Date().toISOString();
    const ids = this.app.db.sugestoes.filter((s) => s.status === 'snoozed' && !!s.snoozeUntil && s.snoozeUntil <= now).map((s) => s.id);
    await this.app.db.sugestoes.patchMany(ids, (s) => {
      s.status = 'pending';
      s.snoozeUntil = null;
      s.updatedAt = now;
    });
    if (ids.length) this.app.bus.changed('sugestoes');
    return ids.length;
  }

  status(): RadarStatus {
    const { db } = this.app;
    const sync = db.sincronizacao.get();
    const ms = this.app.ms.statusSync();
    const today = toLocalDateKey(new Date());
    const processedToday = Object.values(sync.radar.processed).filter((t) => toLocalDateKey(new Date(t)) === today).length;
    const sugs = db.sugestoes.list();
    return {
      enabled: db.config.get().radar.enabled,
      queueSize: this.queueSize(),
      lastScanAt: sync.radar.lastScanAt,
      lastAnalysisAt: sync.radar.lastAnalysisAt,
      pending: sugs.filter((s) => s.status === 'pending').length,
      snoozed: sugs.filter((s) => s.status === 'snoozed').length,
      processedToday,
      sources: (() => {
        const local = db.config.get().outlookLocal;
        const viaLocal = !ms.connected && local.enabled;
        return {
          outlook: {
            available: ms.connected || viaLocal,
            lastSyncAt: sync.outlook.lastSyncAt,
            items: db.mensagens.size,
            detail: ms.connected ? `${db.config.get().microsoft.mailFolders.length} pasta(s) via Microsoft 365` : viaLocal ? `Outlook deste computador${sync.outlook.localAccount ? ` (${sync.outlook.localAccount})` : ''}` : 'Conecte o Microsoft 365 ou ative o Outlook deste computador',
          },
          planner: {
            available: ms.connected,
            lastSyncAt: sync.planner.lastSyncAt,
            items: db.plannerTasks.size,
            detail: ms.connected ? `${sync.planner.plans.length} plano(s) encontrados` : viaLocal ? 'Via e-mails de atribuição do Planner (sincronização completa requer Microsoft 365)' : 'Requer Microsoft 365 conectado',
          },
          calendar: {
            available: ms.connected || (viaLocal && local.calendar),
            lastSyncAt: sync.calendar.lastSyncAt,
            items: db.eventos.size,
            detail: ms.connected ? 'Eventos via Microsoft 365' : viaLocal && local.calendar ? 'Calendário do Outlook deste computador' : 'Conecte o Microsoft 365 ou ative o Outlook deste computador',
          },
        };
      })(),
    };
  }

  /* -------------------- Vigilância: prazos e esquecimentos -------------------- */

  /** Gera alertas de prazos, atrasos, aprovações, esquecimentos e conflitos de agenda. */
  async watch(): Promise<number> {
    const { db, notify } = this.app;
    const cfg = db.config.get();
    const now = new Date();
    const today = toLocalDateKey(now);
    let count = 0;
    const open = db.pautas.filter((p) => isOpenStatus(p.status));
    const warnMs = cfg.notifications.deadlineWarningHours * 3_600_000;

    for (const p of open) {
      if (p.dueDate) {
        const due = dueToDate(p.dueDate).getTime();
        if (due < now.getTime()) {
          if (await notify.notify({ type: 'overdue', severity: 'critical', title: `Atrasada: ${truncate(p.title, 70)}`, body: `Prazo era ${brDate(p.dueDate)}.`, link: `/pautas?id=${p.id}`, dedupeKey: `overdue:${p.id}:${today}` })) count++;
        } else if (due - now.getTime() <= warnMs) {
          if (await notify.notify({ type: 'deadline', severity: 'warning', title: `Prazo próximo: ${truncate(p.title, 70)}`, body: `Vence em ${brDate(p.dueDate)}.`, link: `/pautas?id=${p.id}`, dedupeKey: `deadline:${p.id}:${brDate(p.dueDate)}` })) count++;
        }
      }
      if (p.recommendedPriority === 'critical') {
        if (await notify.notify({ type: 'critical', severity: 'critical', title: `Demanda crítica: ${truncate(p.title, 70)}`, body: p.priorityJustification, link: `/pautas?id=${p.id}`, dedupeKey: `critical:${p.id}`, dedupeHours: 72 })) count++;
      }
      if (p.approvalPending) {
        if (await notify.notify({ type: 'approval', severity: 'info', title: `Aprovação pendente: ${truncate(p.title, 70)}`, link: `/pautas?id=${p.id}`, dedupeKey: `approval:${p.id}`, dedupeHours: 48, native: false })) count++;
      }
      const idleDays = (now.getTime() - new Date(p.lastActivityAt ?? p.updatedAt).getTime()) / 86_400_000;
      if (p.status === 'waiting' && idleDays >= cfg.radar.staleAfterDays) {
        if (await notify.notify({ type: 'forgotten', severity: 'warning', title: `Cobrar retorno: ${truncate(p.title, 70)}`, body: `Aguardando há ${Math.floor(idleDays)} dias sem movimentação.`, link: `/pautas?id=${p.id}`, dedupeKey: `waiting:${p.id}`, dedupeHours: 72 })) count++;
      } else if (p.status === 'in_progress' && idleDays >= cfg.radar.staleAfterDays) {
        if (await notify.notify({ type: 'forgotten', severity: 'info', title: `Pauta parada: ${truncate(p.title, 70)}`, body: `Em andamento sem atualização há ${Math.floor(idleDays)} dias.`, link: `/pautas?id=${p.id}`, dedupeKey: `stale:${p.id}`, dedupeHours: 72, native: false })) count++;
      }
    }

    // E-mails sinalizados sem pauta/sugestão correspondente
    const flaggedCutoff = now.getTime() - cfg.radar.forgottenAfterDays * 86_400_000;
    const tracked = new Set([...db.pautas.list().flatMap((p) => p.sourceRefs), ...db.sugestoes.list().flatMap((s) => s.sourceRefs)].map((r) => r.externalId));
    for (const m of db.mensagens.filter((m) => m.flagged && !m.isSent && new Date(m.receivedAt).getTime() < flaggedCutoff && !tracked.has(m.id))) {
      if (await notify.notify({ type: 'forgotten', severity: 'warning', title: `Possível esquecimento: ${truncate(m.subject, 70)}`, body: `E-mail sinalizado de ${m.fromName ?? m.fromEmail} sem pauta associada.`, link: m.webLink, dedupeKey: `flagged:${m.id}`, dedupeHours: 96 })) count++;
    }

    // Sugestões pendentes há muito tempo
    const oldPending = db.sugestoes.filter((s) => s.status === 'pending' && now.getTime() - new Date(s.createdAt).getTime() > cfg.radar.forgottenAfterDays * 86_400_000);
    if (oldPending.length) {
      if (await notify.notify({ type: 'forgotten', severity: 'info', title: `${oldPending.length} sugestão(ões) aguardando decisão`, body: 'Revise o Radar para aprovar, adiar ou ignorar.', link: '/radar', dedupeKey: `old-pending:${today}`, native: false })) count++;
    }

    // Conflitos de agenda (próximos 7 dias)
    const horizon = now.getTime() + 7 * 86_400_000;
    const evs = db.eventos
      .filter((e) => !e.isCancelled && !e.isAllDay && e.showAs !== 'free' && new Date(e.end).getTime() > now.getTime() && new Date(e.start).getTime() < horizon)
      .sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < evs.length; i++) {
      const a = evs[i - 1]!;
      const b = evs[i]!;
      if (new Date(b.start).getTime() < new Date(a.end).getTime()) {
        if (await notify.notify({ type: 'conflict', severity: 'warning', title: 'Conflito de agenda', body: `"${truncate(a.subject, 40)}" e "${truncate(b.subject, 40)}" se sobrepõem em ${new Date(b.start).toLocaleString('pt-BR')}.`, link: '/calendario', dedupeKey: `conflict:${a.id}:${b.id}`, dedupeHours: 24 * 7 })) count++;
      }
    }
    return count;
  }
}
