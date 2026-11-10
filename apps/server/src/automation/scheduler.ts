import { type AutomationInfo, type JobRun, JobState } from '@pautaflow/shared';
import type { AppContext } from '../core/context';
import { NotConnectedError } from '../integrations/microsoft/auth';
import { buildJobs, type JobDef } from './jobs';

const TICK_MS = 20_000;
const HISTORY_LIMIT = 40;

export { SkipJob } from './errors';
import { SkipJob } from './errors';

/** Converte "HH:mm" na próxima ocorrência diária. */
function hm(time: string): [number, number] {
  const [h, m] = time.split(':').map(Number);
  return [h ?? 8, m ?? 0];
}

/** Calcula a próxima execução; para jobs diários/semanais/mensais, recupera execuções perdidas (PC desligado). */
export function computeNextRun(def: JobDef, state: JobState, now: Date): Date {
  const s = def.schedule;
  const last = state.lastRunAt ? new Date(state.lastRunAt) : null;
  if (s.kind === 'interval') {
    if (!last) return now;
    const backoff = state.consecutiveErrors > 0 ? Math.min(60, 2 ** state.consecutiveErrors) * 60_000 : 0;
    return new Date(Math.max(last.getTime() + s.minutes() * 60_000, last.getTime() + backoff));
  }
  const [h, m] = hm(s.time());
  // Ocorrência agendada mais recente que já passou (ou hoje)
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  const matches = (d: Date) =>
    s.kind === 'daily' ? true : s.kind === 'weekly' ? d.getDay() === s.weekday() : d.getDate() === s.monthday();
  let latest: Date | null = null;
  for (let i = 0; i < 40; i++) {
    const d = new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate() - i, h, m);
    if (d <= now && matches(d)) {
      latest = d;
      break;
    }
  }
  if (latest && (!last || last < latest)) return now; // execução perdida → rodar agora
  for (let i = 0; i < 400; i++) {
    const d = new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate() + i, h, m);
    if (d > now && matches(d)) return d;
  }
  return new Date(now.getTime() + 86_400_000);
}

export class Scheduler {
  readonly jobs: JobDef[];
  private timer: NodeJS.Timeout | null = null;
  private running = new Set<string>();
  private stopped = true;

  constructor(private readonly app: AppContext) {
    this.jobs = buildJobs(app);
  }

  private state(id: string): JobState {
    return this.app.db.automacoes.get().jobs[id] ?? JobState.parse({ id });
  }

  async start(): Promise<void> {
    this.stopped = false;
    // Execuções interrompidas por queda/encerramento ficam marcadas como erro
    await this.app.db.automacoes.update((f) => {
      for (const def of this.jobs) {
        const st = f.jobs[def.id] ?? JobState.parse({ id: def.id });
        if (st.lastStatus === 'running') {
          st.lastStatus = 'error';
          st.lastMessage = 'Execução interrompida (encerramento inesperado). Reagendada.';
          const h = st.history[0];
          if (h && h.status === 'running') Object.assign(h, { status: 'error', finishedAt: new Date().toISOString(), message: st.lastMessage });
        }
        st.nextRunAt = computeNextRun(def, st, new Date()).toISOString();
        f.jobs[def.id] = st;
      }
    });
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    // Reconciliação inicial logo após a inicialização
    setTimeout(() => void this.tick('startup'), 3_000);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(trigger: JobRun['trigger'] = 'schedule'): Promise<void> {
    if (this.stopped) return;
    const now = new Date();
    for (const def of this.jobs) {
      const st = this.state(def.id);
      if (!st.enabled || this.running.has(def.id)) continue;
      const next = computeNextRun(def, st, now);
      if (next <= now) await this.run(def.id, trigger);
    }
  }

  /** Executa uma sequência (ex.: sincronizações seguidas da análise do radar). */
  async runChain(ids: string[], trigger: JobRun['trigger'] = 'chain'): Promise<void> {
    for (const id of ids) await this.run(id, trigger);
  }

  private inflight = new Map<string, Promise<JobState>>();

  /** Executa o job; se já estiver em execução, aguarda a execução corrente. */
  run(id: string, trigger: JobRun['trigger'] = 'manual'): Promise<JobState> {
    const existing = this.inflight.get(id);
    if (existing) return existing;
    const p = this.execute(id, trigger).finally(() => this.inflight.delete(id));
    this.inflight.set(id, p);
    return p;
  }

  private async execute(id: string, trigger: JobRun['trigger']): Promise<JobState> {
    const def = this.jobs.find((j) => j.id === id);
    if (!def) throw Object.assign(new Error(`Automação desconhecida: ${id}`), { statusCode: 404 });
    this.running.add(id);
    const startedAt = new Date().toISOString();
    await this.update(id, (st) => {
      st.lastStatus = 'running';
      st.history.unshift({ startedAt, finishedAt: null, status: 'running', processed: 0, message: '', trigger });
      st.history = st.history.slice(0, HISTORY_LIMIT);
    });
    this.app.bus.changed('automacoes');
    let status: JobRun['status'] = 'success';
    let message = '';
    let processed = 0;
    try {
      const avail = await def.available();
      if (avail !== true) throw new SkipJob(avail);
      const r = await def.run();
      processed = r.processed;
      message = r.message;
    } catch (err) {
      if (err instanceof SkipJob || err instanceof NotConnectedError) {
        status = 'skipped';
        message = err.message;
      } else {
        status = 'error';
        message = (err as Error).message;
        this.app.log.error({ err, job: id }, 'Falha na automação');
      }
    } finally {
      this.running.delete(id);
    }
    const finishedAt = new Date().toISOString();
    const st = await this.update(id, (s) => {
      s.lastRunAt = startedAt;
      s.lastStatus = status;
      s.lastMessage = message;
      s.totalRuns++;
      s.totalProcessed += processed;
      if (status === 'success') {
        s.lastSuccessAt = finishedAt;
        s.consecutiveErrors = 0;
      } else if (status === 'error') {
        s.totalErrors++;
        s.consecutiveErrors++;
      }
      const h = s.history.find((x) => x.startedAt === startedAt);
      if (h) Object.assign(h, { finishedAt, status, processed, message });
    });
    await this.update(id, (s) => {
      s.nextRunAt = computeNextRun(def, s, new Date()).toISOString();
    });
    if (status === 'error' && st.consecutiveErrors === 3) {
      await this.app.notify.notify({
        type: 'integration_error',
        severity: 'warning',
        title: `Automação com falhas: ${def.name}`,
        body: message.slice(0, 240),
        link: '/automacoes',
        dedupeKey: `job-fail:${id}`,
        dedupeHours: 12,
      });
    }
    this.app.bus.changed('automacoes');
    this.app.bus.emit('job', { id, name: def.name, status, message, processed, trigger });
    if (status === 'success' && def.then?.length && trigger !== 'chain') void this.runChain(def.then);
    return this.state(id);
  }

  private async update(id: string, fn: (s: JobState) => void): Promise<JobState> {
    let out!: JobState;
    await this.app.db.automacoes.update((f) => {
      const st = f.jobs[id] ?? JobState.parse({ id });
      fn(st);
      f.jobs[id] = st;
      out = st;
    });
    return out;
  }

  async setEnabled(id: string, enabled: boolean): Promise<JobState> {
    const st = await this.update(id, (s) => {
      s.enabled = enabled;
    });
    this.app.bus.changed('automacoes');
    return st;
  }

  async list(): Promise<AutomationInfo[]> {
    const out: AutomationInfo[] = [];
    for (const def of this.jobs) {
      const st = this.state(def.id);
      const avail = await def.available();
      out.push({
        ...st,
        nextRunAt: st.enabled ? computeNextRun(def, st, new Date()).toISOString() : null,
        name: def.name,
        description: def.description,
        schedule: def.describe(),
        requires: avail === true ? null : avail,
        available: avail === true,
      });
    }
    return out;
  }
}
