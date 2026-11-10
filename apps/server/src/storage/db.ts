import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  Bookmark,
  Categoria,
  Configuracoes,
  HistoryEntry,
  Notificacao,
  Pauta,
  Projeto,
  Resumo,
  Sugestao,
  UserProfile,
} from '@pautaflow/shared';
import { Collection, ShardedCollection } from './collection';
import { JsonFile, type StorageContext } from './jsonFile';
import {
  AutomationFile,
  CalendarEvent,
  IntegrationState,
  MailMessage,
  MetricSnapshot,
  PlannerTask,
  QueueFile,
  SyncState,
} from './internalSchemas';
import { cleanupOrphanTemps } from './atomic';

export const DEFAULT_CATEGORIES: { name: string; color: string; icon: string; keywords: string[] }[] = [
  { name: 'Comunicação Interna', color: '#6366f1', icon: 'megaphone', keywords: ['comunicado', 'intranet', 'colaboradores', 'endomarketing', 'mural', 'newsletter interna'] },
  { name: 'Imprensa', color: '#0ea5e9', icon: 'newspaper', keywords: ['imprensa', 'release', 'jornalista', 'entrevista', 'assessoria', 'matéria', 'clipping'] },
  { name: 'Redes Sociais', color: '#ec4899', icon: 'share-2', keywords: ['instagram', 'linkedin', 'post', 'redes sociais', 'stories', 'reels', 'publicação'] },
  { name: 'Eventos', color: '#f59e0b', icon: 'calendar-days', keywords: ['evento', 'feira', 'congresso', 'workshop', 'inauguração', 'visita'] },
  { name: 'Campanhas', color: '#10b981', icon: 'sparkles', keywords: ['campanha', 'peça', 'arte', 'criação', 'layout', 'banner', 'vídeo'] },
  { name: 'Relatórios', color: '#8b5cf6', icon: 'file-bar-chart', keywords: ['relatório', 'indicadores', 'dados', 'planilha', 'apresentação', 'report'] },
  { name: 'Institucional', color: '#14b8a6', icon: 'building-2', keywords: ['institucional', 'site', 'marca', 'sustentabilidade', 'diretoria'] },
  { name: 'Administrativo', color: '#64748b', icon: 'briefcase', keywords: ['contrato', 'pagamento', 'nota fiscal', 'orçamento', 'fornecedor', 'compra'] },
];

export class Database {
  readonly users: JsonFile<UserProfile>;
  readonly config: JsonFile<Configuracoes>;
  readonly pautas: Collection<Pauta>;
  readonly projetos: Collection<Projeto>;
  readonly categorias: Collection<Categoria>;
  readonly sugestoes: Collection<Sugestao>;
  readonly notificacoes: Collection<Notificacao>;
  readonly bookmarks: Collection<Bookmark>;
  readonly metricas: Collection<MetricSnapshot>;
  readonly historico: ShardedCollection<HistoryEntry>;
  readonly resumos: ShardedCollection<Resumo>;
  readonly automacoes: JsonFile<AutomationFile>;
  readonly sincronizacao: JsonFile<SyncState>;
  readonly integracoes: JsonFile<IntegrationState>;
  readonly mensagens: Collection<MailMessage>;
  readonly plannerTasks: Collection<PlannerTask>;
  readonly eventos: Collection<CalendarEvent>;
  readonly fila: JsonFile<QueueFile>;

  constructor(readonly ctx: StorageContext) {
    const now = () => new Date().toISOString();
    this.users = new JsonFile('users.json', UserProfile, () => ({ id: randomUUID(), name: '', email: null, role: null, createdAt: now() }), ctx);
    this.config = new JsonFile('configuracoes.json', Configuracoes, () => Configuracoes.parse({}), ctx);
    this.pautas = new Collection('pautas.json', Pauta, ctx);
    this.projetos = new Collection('projetos.json', Projeto, ctx);
    this.categorias = new Collection('categorias.json', Categoria, ctx);
    this.sugestoes = new Collection('sugestoes.json', Sugestao, ctx);
    this.notificacoes = new Collection('notificacoes.json', Notificacao, ctx);
    this.bookmarks = new Collection('arquivos.json', Bookmark, ctx);
    this.metricas = new Collection('metricas.json', MetricSnapshot, ctx);
    this.historico = new ShardedCollection('historico', HistoryEntry, (h) => ShardedCollection.monthKey(h.at), ctx);
    this.resumos = new ShardedCollection('resumos', Resumo, (r) => ShardedCollection.monthKey(r.periodStart), ctx);
    this.automacoes = new JsonFile('automacoes.json', AutomationFile, () => ({ jobs: {} }), ctx);
    this.sincronizacao = new JsonFile('sincronizacao.json', SyncState, () => SyncState.parse({}), ctx);
    this.integracoes = new JsonFile('integracoes.json', IntegrationState, () => IntegrationState.parse({}), ctx);
    this.mensagens = new Collection(path.join('fontes', 'outlook-mensagens.json'), MailMessage, ctx);
    this.plannerTasks = new Collection(path.join('fontes', 'planner-tarefas.json'), PlannerTask, ctx);
    this.eventos = new Collection(path.join('fontes', 'calendario-eventos.json'), CalendarEvent, ctx);
    this.fila = new JsonFile(path.join('fila', 'radar.json'), QueueFile, () => ({ items: [] }), ctx);
  }

  private get loadables(): { load(): Promise<unknown> }[] {
    return [
      this.users,
      this.config,
      this.pautas,
      this.projetos,
      this.categorias,
      this.sugestoes,
      this.notificacoes,
      this.bookmarks,
      this.metricas,
      this.automacoes,
      this.sincronizacao,
      this.integracoes,
      this.mensagens,
      this.plannerTasks,
      this.eventos,
      this.fila,
    ];
  }

  async loadAll(): Promise<void> {
    await fs.mkdir(this.ctx.dataDir, { recursive: true });
    const removed = await cleanupOrphanTemps(this.ctx.dataDir);
    if (removed) this.ctx.logger.warn({ removed }, 'Temporários órfãos removidos (encerramento inesperado anterior)');
    for (const store of this.loadables) await store.load();
    if (this.categorias.size === 0) {
      const ts = new Date().toISOString();
      await this.categorias.upsertMany(DEFAULT_CATEGORIES.map((c) => ({ id: randomUUID(), createdAt: ts, ...c })));
    }
  }

  async flushAll(): Promise<void> {
    await Promise.all([
      ...this.loadables.map((s) => (s as unknown as { flush(): Promise<void> }).flush()),
      this.historico.flush(),
      this.resumos.flush(),
    ]);
  }

  /** Lista de arquivos JSON gerenciados (para verificação de integridade). */
  managedFiles(): string[] {
    return this.loadables.map((s) => (s as unknown as { relPath: string }).relPath);
  }
}
