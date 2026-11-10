import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isOpenStatus } from '@pautaflow/shared';
import type { AppContext } from '../core/context';
import { isOverdue } from '../analytics/metrics';
import { toLocalDateKey } from '../intelligence/dates';
import { SkipJob } from './errors';

export type Schedule =
  | { kind: 'interval'; minutes: () => number }
  | { kind: 'daily'; time: () => string }
  | { kind: 'weekly'; weekday: () => number; time: () => string }
  | { kind: 'monthly'; monthday: () => number; time: () => string };

export interface JobDef {
  id: string;
  name: string;
  description: string;
  schedule: Schedule;
  describe: () => string;
  /** true, ou a explicação do que falta para poder executar. */
  available: () => Promise<true | string>;
  run: () => Promise<{ processed: number; message: string }>;
  /** Jobs executados em seguida após sucesso (encadeamento). */
  then?: string[];
}

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

export function buildJobs(app: AppContext): JobDef[] {
  const cfg = () => app.db.config.get();
  const s = () => cfg().schedules;
  const msReady = async (): Promise<true | string> => {
    const st = await app.ms.status();
    if (!st.configured) return 'Configure o Client ID do Microsoft 365 em Integrações';
    if (!st.connected) return 'Conecte sua conta Microsoft em Integrações';
    return true;
  };
  const every = (fn: () => number) => () => `A cada ${fn()} min`;
  const graphConnected = async () => (await app.ms.status()).connected;
  /** Outlook/Calendário: Microsoft Graph quando conectado; senão, o Outlook clássico deste computador. */
  const mailReady = async (): Promise<true | string> => {
    if (await graphConnected()) return true;
    if (cfg().outlookLocal.enabled) return (await app.outlookLocal.installed()) ? true : 'Outlook clássico não encontrado neste computador';
    return 'Conecte o Microsoft 365 ou ative "Outlook deste computador" em Integrações';
  };
  const localResult = (r: Awaited<ReturnType<typeof app.outlookLocal.sync>>) => {
    if (r.status === 'closed') throw new SkipJob('Outlook fechado — abra o Outlook (ou permita abri-lo em segundo plano em Integrações)');
    return r;
  };

  return [
    {
      id: 'outlook-sync',
      name: 'Radar Outlook',
      description: 'Sincronização incremental das pastas monitoradas e itens enviados (Microsoft Graph ou Outlook deste computador).',
      schedule: { kind: 'interval', minutes: () => s().outlookMinutes },
      describe: every(() => s().outlookMinutes),
      available: mailReady,
      run: async () => {
        if (!(await graphConnected())) {
          const r = localResult(await app.outlookLocal.sync({ mail: true, calendar: false }));
          return { processed: r.mails, message: `Outlook local: ${r.mails} e-mail(s) lidos, ${r.enqueued} novo(s) enviado(s) ao radar${r.errors.length ? ` · avisos: ${r.errors.join('; ')}` : ''}` };
        }
        const r = await app.ms.syncOutlook();
        return { processed: r.processed, message: `${r.processed} alteração(ões), ${r.enqueued} enviada(s) ao radar${r.removed ? `, ${r.removed} removida(s)` : ''}` };
      },
      then: ['radar-analysis'],
    },
    {
      id: 'planner-sync',
      name: 'Radar Planner',
      description: 'Tarefas atribuídas a você, novos prazos, status e conclusões.',
      schedule: { kind: 'interval', minutes: () => s().plannerMinutes },
      describe: every(() => s().plannerMinutes),
      available: msReady,
      run: async () => {
        const r = await app.ms.syncPlanner();
        return { processed: r.processed, message: `${r.processed} tarefa(s) verificadas, ${r.enqueued} nova(s), ${r.changes} alteração(ões) aplicadas` };
      },
      then: ['radar-analysis'],
    },
    {
      id: 'calendar-sync',
      name: 'Sincronização de calendário',
      description: 'Eventos e reuniões do Outlook (somente leitura).',
      schedule: { kind: 'interval', minutes: () => s().calendarMinutes },
      describe: every(() => s().calendarMinutes),
      available: async () => {
        const r = await mailReady();
        if (r === true && !(await graphConnected()) && !cfg().outlookLocal.calendar) return 'Calendário do Outlook local desativado em Integrações';
        return r;
      },
      run: async () => {
        if (!(await graphConnected())) {
          const l = localResult(await app.outlookLocal.sync({ mail: false, calendar: true }));
          return { processed: l.events, message: `Outlook local: ${l.events} evento(s) na janela` };
        }
        const r = await app.ms.syncCalendar();
        return { processed: r.processed, message: `${r.processed} evento(s) atualizados` };
      },
    },
    {
      id: 'radar-analysis',
      name: 'Análise inteligente',
      description: 'Interpreta a fila do radar, detecta prazos, responsáveis e duplicidades e gera sugestões.',
      schedule: { kind: 'interval', minutes: () => s().radarMinutes },
      describe: every(() => s().radarMinutes),
      available: async () => (cfg().radar.enabled ? true : 'Radar desativado nas configurações'),
      run: async () => {
        const reactivated = await app.radar.reactivateSnoozed();
        const r = await app.radar.processQueue();
        return {
          processed: r.processed,
          message: `${r.processed} analisado(s): ${r.created} sugestão(ões), ${r.merged} mesclada(s), ${r.linked} vinculada(s), ${r.skipped} sem demanda${r.errors ? `, ${r.errors} erro(s)` : ''}${reactivated ? `; ${reactivated} adiada(s) reativada(s)` : ''}`,
        };
      },
    },
    {
      id: 'priority-radar',
      name: 'Reavaliação de prioridades',
      description: 'Recalcula scores, verifica prazos, atrasos, esquecimentos e conflitos de agenda.',
      schedule: { kind: 'interval', minutes: () => s().prioritiesMinutes },
      describe: every(() => s().prioritiesMinutes),
      available: async () => true,
      run: async () => {
        const changed = await app.pautas.recomputeAll();
        const alerts = await app.radar.watch();
        await snapshotMetrics(app);
        return { processed: changed, message: `${changed} score(s) atualizado(s), ${alerts} alerta(s) gerado(s)` };
      },
    },
    {
      id: 'daily-summary',
      name: 'Resumo diário',
      description: 'Gerado no início do expediente.',
      schedule: { kind: 'daily', time: () => s().dailySummaryTime },
      describe: () => `Diariamente às ${s().dailySummaryTime}`,
      available: async () => true,
      run: async () => {
        const r = await app.summaries.generate('daily');
        return { processed: 1, message: r.headline };
      },
    },
    {
      id: 'weekly-summary',
      name: 'Resumo semanal',
      description: 'Resultados, gargalos e recomendações para a semana.',
      schedule: { kind: 'weekly', weekday: () => s().weeklySummaryDay, time: () => s().weeklySummaryTime },
      describe: () => `Toda ${WEEKDAYS[s().weeklySummaryDay]} às ${s().weeklySummaryTime}`,
      available: async () => true,
      run: async () => {
        const r = await app.summaries.generate('weekly');
        return { processed: 1, message: r.headline };
      },
    },
    {
      id: 'monthly-summary',
      name: 'Resumo mensal',
      description: 'Volume, conclusões, prazos e comparativo com o mês anterior.',
      schedule: { kind: 'monthly', monthday: () => s().monthlySummaryDay, time: () => s().dailySummaryTime },
      describe: () => `Todo dia ${s().monthlySummaryDay} às ${s().dailySummaryTime}`,
      available: async () => true,
      run: async () => {
        const r = await app.summaries.generate('monthly');
        return { processed: 1, message: r.headline };
      },
    },
    {
      id: 'backup',
      name: 'Backup JSON',
      description: 'Cópia diária de todos os dados com rotação de versões.',
      schedule: { kind: 'daily', time: () => s().backupTime },
      describe: () => `Diariamente às ${s().backupTime} (ou ao iniciar, se perdido)`,
      available: async () => true,
      run: async () => {
        const b = await app.backups.create('daily');
        return { processed: b.files, message: `Backup ${b.id} (${b.files} arquivos, ${(b.bytes / 1024).toFixed(0)} KB)` };
      },
    },
    {
      id: 'maintenance',
      name: 'Limpeza e manutenção',
      description: 'Remove dados antigos de fontes, notificações lidas e logs; compacta o estado do radar.',
      schedule: { kind: 'daily', time: () => s().maintenanceTime },
      describe: () => `Diariamente às ${s().maintenanceTime}`,
      available: async () => true,
      run: async () => {
        const n = await maintenance(app);
        return { processed: n, message: `${n} item(ns) antigo(s) removido(s)` };
      },
    },
  ];
}

/** Registra um retrato diário de indicadores (base para tendências observadas). */
export async function snapshotMetrics(app: AppContext): Promise<void> {
  const now = new Date();
  const id = toLocalDateKey(now);
  const pautas = app.db.pautas.list();
  const snap = {
    id,
    date: id,
    open: pautas.filter((p) => isOpenStatus(p.status)).length,
    done: pautas.filter((p) => p.status === 'done').length,
    overdue: pautas.filter((p) => isOverdue(p, now)).length,
    createdToday: pautas.filter((p) => toLocalDateKey(new Date(p.createdAt)) === id).length,
    completedToday: pautas.filter((p) => p.completedAt && toLocalDateKey(new Date(p.completedAt)) === id).length,
    pendingSuggestions: app.db.sugestoes.filter((s) => s.status === 'pending').length,
    capturedAt: now.toISOString(),
  };
  await app.db.metricas.upsertMany([snap]);
}

async function maintenance(app: AppContext): Promise<number> {
  const { db } = app;
  const cfg = db.config.get();
  let removed = 0;
  // Mensagens fora da janela (2× o período de busca), exceto as vinculadas a pautas/sugestões
  const linked = new Set([...db.pautas.list().flatMap((p) => p.sourceRefs), ...db.sugestoes.list().flatMap((s) => s.sourceRefs)].map((r) => r.externalId));
  const cutoff = Date.now() - cfg.microsoft.lookbackDays * 2 * 86_400_000;
  removed += await db.mensagens.removeWhere((m) => new Date(m.receivedAt).getTime() < cutoff && !linked.has(m.id));
  // Sugestões ignoradas há mais de 90 dias
  const sugCut = new Date(Date.now() - 90 * 86_400_000).toISOString();
  removed += await db.sugestoes.removeWhere((s) => s.status === 'ignored' && (s.decidedAt ?? s.updatedAt) < sugCut);
  removed += await app.notify.prune();
  // Estado do radar: mantém os 5.000 itens processados mais recentes
  await db.sincronizacao.update((s) => {
    const entries = Object.entries(s.radar.processed).sort((a, b) => b[1].localeCompare(a[1]));
    if (entries.length > 5000) {
      removed += entries.length - 5000;
      s.radar.processed = Object.fromEntries(entries.slice(0, 5000));
    }
  });
  // Métricas diárias: 2 anos; histórico: 24 meses
  const metCut = toLocalDateKey(new Date(Date.now() - 730 * 86_400_000));
  removed += await db.metricas.removeWhere((m) => m.date < metCut);
  const histCut = new Date();
  histCut.setMonth(histCut.getMonth() - 24);
  removed += await db.historico.pruneOlderThan(histCut.toISOString().slice(0, 7));
  // Logs com mais de 6 meses
  try {
    const logs = await fs.readdir(app.env.logsDir);
    const limit = new Date();
    limit.setMonth(limit.getMonth() - 6);
    for (const f of logs) {
      const m = /^pautaflow-(\d{4}-\d{2})\.log$/.exec(f);
      if (m && m[1]! < limit.toISOString().slice(0, 7)) {
        await fs.rm(path.join(app.env.logsDir, f), { force: true });
        removed++;
      }
    }
  } catch {
    /* sem logs */
  }
  // Arquivos em quarentena (.corrupt-*) com mais de 30 dias
  try {
    for (const f of await fs.readdir(app.env.dataDir)) {
      const m = /\.corrupt-(\d+)$/.exec(f);
      if (m && Date.now() - Number(m[1]) > 30 * 86_400_000) {
        await fs.rm(path.join(app.env.dataDir, f), { force: true });
        removed++;
      }
    }
  } catch {
    /* ignora */
  }
  return removed;
}
