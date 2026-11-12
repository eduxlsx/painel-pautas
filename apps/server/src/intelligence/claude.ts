import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type Pauta, type PautaInput, PRIORITY_LABEL, STATUS_LABEL, isOpenStatus, sanitizeCalendarDate } from '@pautaflow/shared';
import type { AppContext } from '../core/context';
import { addDays, brDate, dueToDate, startOfDay, toLocalDateKey } from './dates';
import { effectiveOrder } from './priority';
import { nextActionFor } from './insights';
import { isOverdue } from '../analytics/metrics';
import { calendarItems } from '../modules/views';
import { norm, truncate } from './text';

type Msg = Anthropic.Beta.BetaMessageParam;

export interface ClaudeAction {
  tool: string;
  summary: string;
  pautaId: string | null;
}

export interface ClaudeReply {
  conversationId: string;
  answer: string;
  actions: ClaudeAction[];
  model: string;
  usage: { input: number; output: number; cacheRead: number };
}

export interface ClaudeStatus {
  hasKey: boolean;
  allowData: boolean;
  model: string;
  ready: boolean;
  detail: string;
}

/* Instruções estáveis (sem data/hora) para aproveitar o cache de prompt. */
const SYSTEM = `Você é o assistente do PautaFlow Intelligence, a central de pautas, demandas e produtividade do usuário (profissional de comunicação corporativa). Responda sempre em português do Brasil, de forma objetiva e cordial.

Como trabalhar:
- Use as ferramentas para consultar dados reais antes de responder. Nunca invente pautas, e-mails, prazos ou números; se a informação não existir, diga isso.
- Para criar ou alterar pautas, use as ferramentas de escrita. Ao associar projeto ou categoria, consulte antes os nomes existentes (listar_projetos_categorias).
- Se o pedido for ambíguo (ex.: várias pautas com nome parecido), pergunte antes de alterar.
- Datas em ferramentas: "AAAA-MM-DD" ou "AAAA-MM-DDTHH:mm" (horário local). Nas respostas ao usuário, use o formato brasileiro dd/mm/aaaa e horas no formato 24h.
- Depois de executar ações, confirme em uma frase o que foi feito.
- Respostas curtas: listas com marcadores quando houver vários itens; sem tabelas longas.
- Você não pode excluir pautas nem enviar e-mails; se pedirem, explique que essas ações são feitas pelo próprio usuário no aplicativo.`;

/* ------------------------------------------------------------------ */
/* Ferramentas                                                         */
/* ------------------------------------------------------------------ */

const STATUS = ['backlog', 'todo', 'in_progress', 'waiting', 'review', 'done', 'cancelled'] as const;
const PRIO = ['low', 'medium', 'high', 'critical'] as const;
const KIND = ['tarefa', 'entrega', 'publicacao', 'reuniao', 'aprovacao'] as const;

const READ_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'listar_pautas',
    description: 'Lista pautas do usuário. Filtros opcionais: situacao ("abertas", "atrasadas", "hoje", "semana", "concluidas", "todas"), busca (texto no título/descrição/solicitante), projeto (nome). Retorna id, título, status, prioridade, score e prazo.',
    input_schema: {
      type: 'object',
      properties: {
        situacao: { type: 'string', enum: ['abertas', 'atrasadas', 'hoje', 'semana', 'concluidas', 'todas'] },
        busca: { type: 'string' },
        projeto: { type: 'string' },
        limite: { type: 'integer', minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: 'ver_pauta',
    description: 'Detalhes completos de uma pauta (descrição, checklist, subtarefas, comentários, fontes, fatores de prioridade). Aceita o id completo ou os 8 primeiros caracteres.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'prioridades',
    description: 'Ordem recomendada do que fazer agora, com score (0–100), justificativa e próxima ação sugerida.',
    input_schema: { type: 'object', properties: { limite: { type: 'integer', minimum: 1, maximum: 20 } } },
  },
  {
    name: 'agenda',
    description: 'Reuniões/eventos do calendário e prazos de pautas num intervalo de datas (AAAA-MM-DD). Padrão: hoje.',
    input_schema: { type: 'object', properties: { de: { type: 'string' }, ate: { type: 'string' } } },
  },
  {
    name: 'buscar_emails',
    description: 'Busca e-mails sincronizados do Outlook (caixa de entrada e enviados). Retorna id, assunto, remetente, data, sinalizado e trecho. Use ler_email para o conteúdo completo.',
    input_schema: {
      type: 'object',
      properties: {
        busca: { type: 'string', description: 'Texto no assunto, remetente ou corpo' },
        dias: { type: 'integer', minimum: 1, maximum: 60, description: 'Janela em dias (padrão 2)' },
        enviados: { type: 'boolean', description: 'true para itens enviados' },
        limite: { type: 'integer', minimum: 1, maximum: 40 },
      },
    },
  },
  {
    name: 'ler_email',
    description: 'Conteúdo completo de um e-mail sincronizado pelo id retornado em buscar_emails.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'listar_sugestoes',
    description: 'Sugestões de demandas identificadas pelo radar aguardando decisão (pendentes) ou adiadas.',
    input_schema: { type: 'object', properties: { situacao: { type: 'string', enum: ['pending', 'snoozed'] } } },
  },
  {
    name: 'resumo_do_dia',
    description: 'Gera o resumo do dia: entregas, reuniões, e-mails que pedem ação, atrasos, aprovações e recomendações.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'listar_projetos_categorias',
    description: 'Lista os projetos e categorias existentes (nomes e ids), para associar pautas.',
    input_schema: { type: 'object', properties: {} },
  },
];

const pautaFields = {
  descricao: { type: 'string' },
  prazo: { type: 'string', description: 'AAAA-MM-DD ou AAAA-MM-DDTHH:mm; "" remove o prazo' },
  inicio: { type: 'string', description: 'AAAA-MM-DD' },
  prioridade: { type: 'string', enum: [...PRIO, 'automatica'] },
  status: { type: 'string', enum: [...STATUS] },
  tipo: { type: 'string', enum: [...KIND] },
  projeto: { type: 'string', description: 'Nome do projeto existente' },
  categoria: { type: 'string', description: 'Nome da categoria existente' },
  solicitante: { type: 'string' },
  responsavel: { type: 'string' },
  impacto: { type: 'integer', minimum: 1, maximum: 5 },
  aprovacao_pendente: { type: 'boolean' },
  tags: { type: 'array', items: { type: 'string' } },
  comentario: { type: 'string', description: 'Comentário a acrescentar' },
  item_checklist: { type: 'string', description: 'Item a acrescentar ao checklist' },
} as const;

const WRITE_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'criar_pauta',
    description: 'Cria uma nova pauta.',
    input_schema: { type: 'object', properties: { titulo: { type: 'string' }, ...pautaFields }, required: ['titulo'] },
  },
  {
    name: 'atualizar_pauta',
    description: 'Altera campos de uma pauta existente (só os campos informados mudam). Use status "done" para concluir.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, titulo: { type: 'string' }, ...pautaFields }, required: ['id'] },
  },
  {
    name: 'decidir_sugestao',
    description: 'Decide uma sugestão do radar: aprovar (vira pauta), ignorar, ou adiar até uma data (AAAA-MM-DD).',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' }, acao: { type: 'string', enum: ['aprovar', 'ignorar', 'adiar'] }, ate: { type: 'string' } },
      required: ['id', 'acao'],
    },
  },
];

const PautaArgs = z.object({
  titulo: z.string().min(1).max(300).optional(),
  descricao: z.string().max(5000).optional(),
  prazo: z.string().optional(),
  inicio: z.string().optional(),
  prioridade: z.enum([...PRIO, 'automatica']).optional(),
  status: z.enum(STATUS).optional(),
  tipo: z.enum(KIND).optional(),
  projeto: z.string().optional(),
  categoria: z.string().optional(),
  solicitante: z.string().optional(),
  responsavel: z.string().optional(),
  impacto: z.number().int().min(1).max(5).optional(),
  aprovacao_pendente: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  comentario: z.string().max(2000).optional(),
  item_checklist: z.string().max(300).optional(),
});

class ToolError extends Error {}

/* ------------------------------------------------------------------ */

export class ClaudeAssistant {
  private conversations = new Map<string, { messages: Msg[]; touched: number }>();

  constructor(private readonly app: AppContext) {}

  private get cfg() {
    return this.app.db.config.get().claude;
  }

  async status(): Promise<ClaudeStatus> {
    const hasKey = !!(await this.app.secrets.get('anthropicApiKey').catch(() => null));
    const c = this.cfg;
    const ready = hasKey && c.allowData;
    return {
      hasKey,
      allowData: c.allowData,
      model: c.model,
      ready,
      detail: !hasKey ? 'Informe a chave de API da Anthropic.' : !c.allowData ? 'Autorize o envio dos dados consultados à Anthropic para ativar.' : `Pronto · ${c.model}`,
    };
  }

  reset(conversationId: string) {
    this.conversations.delete(conversationId);
  }

  private async client(): Promise<Anthropic> {
    const key = await this.app.secrets.get('anthropicApiKey');
    if (!key) throw Object.assign(new Error('Chave da API da Anthropic não configurada (Integrações → Claude).'), { statusCode: 400 });
    return new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120_000 });
  }

  /** Teste de conexão com uma chamada mínima. */
  async test(): Promise<{ ok: boolean; detail: string }> {
    try {
      const client = await this.client();
      const t0 = Date.now();
      const r = await client.messages.create({ model: this.cfg.model, max_tokens: 64, output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'Responda apenas: OK' }] });
      const text = r.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      return { ok: true, detail: `${this.cfg.model} respondeu em ${((Date.now() - t0) / 1000).toFixed(1)}s: ${truncate(text, 40)}` };
    } catch (err) {
      return { ok: false, detail: friendly(err) };
    }
  }

  async chat(conversationId: string | null, text: string): Promise<ClaudeReply> {
    const c = this.cfg;
    if (!c.allowData) throw Object.assign(new Error('Autorize o envio de dados à Anthropic em Integrações → Claude.'), { statusCode: 400 });
    const client = await this.client();
    this.gc();
    const id = conversationId && this.conversations.has(conversationId) ? conversationId : randomUUID();
    const conv = this.conversations.get(id) ?? { messages: [], touched: Date.now() };
    const now = new Date();
    const stamp = now.toLocaleString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const messages: Msg[] = [...conv.messages, { role: 'user', content: `[Agora: ${stamp}]\n${text}` }];
    const tools = c.allowActions ? [...READ_TOOLS, ...WRITE_TOOLS] : READ_TOOLS;
    const actions: ClaudeAction[] = [];
    const usage = { input: 0, output: 0, cacheRead: 0 };
    let answer = '';
    let model: string = c.model;

    for (let turn = 0; turn < 12; turn++) {
      let response: Anthropic.Beta.BetaMessage;
      try {
        response = await client.beta.messages.create({
          model: c.model,
          max_tokens: 16000,
          system: SYSTEM,
          tools,
          messages,
          output_config: { effort: c.effort },
          cache_control: { type: 'ephemeral' },
          // Se o modelo recusar por política, a própria API tenta um modelo alternativo
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        });
      } catch (err) {
        throw Object.assign(new Error(friendly(err)), { statusCode: 502 });
      }
      model = response.model;
      usage.input += response.usage.input_tokens;
      usage.output += response.usage.output_tokens;
      usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
      messages.push({ role: 'assistant', content: response.content });

      const texts = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : []));
      if (response.stop_reason === 'refusal') {
        answer = 'Não posso ajudar com esse pedido.';
        break;
      }
      if (response.stop_reason === 'pause_turn') continue;
      const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || uses.length === 0) {
        answer = texts.join('\n').trim();
        if (response.stop_reason === 'max_tokens') answer += '\n\n(resposta interrompida por limite de tamanho)';
        break;
      }
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const u of uses) {
        try {
          const out = await this.runTool(u.name, u.input, actions, c.allowActions);
          results.push({ type: 'tool_result', tool_use_id: u.id, content: out });
        } catch (err) {
          results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: (err as Error).message });
        }
      }
      messages.push({ role: 'user', content: results });
      if (turn === 11) answer = texts.join('\n').trim() || 'Parei após muitas etapas. Pode reformular o pedido?';
    }

    // Mantém o histórico enxuto: ao passar de 80 mensagens, recomeça a partir do último pedido
    const trimmed = messages.length > 80 ? messages.slice(-2) : messages;
    this.conversations.set(id, { messages: trimmed.length === 2 && messages.length > 80 ? [] : trimmed, touched: Date.now() });
    if (actions.length) {
      await this.app.history.record({ entity: 'sistema', entityId: null, action: 'claude_actions', summary: `Claude executou ${actions.length} ação(ões): ${truncate(actions.map((a) => a.summary).join('; '), 300)}`, actor: 'assistant' });
    }
    return { conversationId: id, answer: answer || 'Feito.', actions, model, usage };
  }

  private gc() {
    const cutoff = Date.now() - 6 * 3_600_000;
    for (const [k, v] of this.conversations) if (v.touched < cutoff) this.conversations.delete(k);
  }

  /* ------------------------------ Execução das ferramentas ------------------------------ */

  private findPauta(ref: string): Pauta {
    const r = ref.trim().toLowerCase();
    const p = this.app.db.pautas.get(r) ?? this.app.db.pautas.find((x) => x.id.startsWith(r));
    if (!p) throw new ToolError(`Pauta não encontrada: ${ref}`);
    return p;
  }

  private brief(p: Pauta) {
    const proj = p.projectId ? this.app.db.projetos.get(p.projectId)?.name : null;
    return {
      id: p.id.slice(0, 8),
      titulo: p.title,
      status: STATUS_LABEL[p.status],
      prioridade: PRIORITY_LABEL[p.manualPriority ?? p.recommendedPriority],
      score: p.priorityScore,
      prazo: p.dueDate ? brDate(p.dueDate) : null,
      atrasada: isOverdue(p, new Date()) || undefined,
      projeto: proj ?? undefined,
      solicitante: p.requester ?? undefined,
      responsavel: p.owner ?? undefined,
    };
  }

  private byName<T extends { id: string; name: string }>(list: T[], name: string | undefined, what: string): string | null | undefined {
    if (name === undefined) return undefined;
    if (!name.trim()) return null;
    const n = norm(name);
    const hit = list.find((x) => norm(x.name) === n) ?? list.find((x) => norm(x.name).includes(n));
    if (!hit) throw new ToolError(`${what} "${name}" não existe. Existentes: ${list.map((x) => x.name).join(', ') || 'nenhum'}.`);
    return hit.id;
  }

  private toInput(a: z.infer<typeof PautaArgs>, current?: Pauta): PautaInput & { title?: string } {
    const { db } = this.app;
    const out: PautaInput & { title?: string } = {};
    if (a.titulo !== undefined) out.title = a.titulo;
    if (a.descricao !== undefined) out.description = a.descricao;
    if (a.prazo !== undefined) {
      const d = sanitizeCalendarDate(a.prazo);
      if (a.prazo && !d) throw new ToolError(`Prazo inválido: ${a.prazo} (use AAAA-MM-DD ou AAAA-MM-DDTHH:mm)`);
      out.dueDate = d;
    }
    if (a.inicio !== undefined) out.startDate = sanitizeCalendarDate(a.inicio);
    if (a.prioridade !== undefined) out.manualPriority = a.prioridade === 'automatica' ? null : a.prioridade;
    if (a.status !== undefined) out.status = a.status;
    if (a.tipo !== undefined) out.kind = a.tipo;
    const proj = this.byName(db.projetos.list(), a.projeto, 'Projeto');
    if (proj !== undefined) out.projectId = proj;
    const cat = this.byName(db.categorias.list(), a.categoria, 'Categoria');
    if (cat !== undefined) out.categoryId = cat;
    if (a.solicitante !== undefined) out.requester = a.solicitante || null;
    if (a.responsavel !== undefined) out.owner = a.responsavel || null;
    if (a.impacto !== undefined) out.impact = a.impacto;
    if (a.aprovacao_pendente !== undefined) out.approvalPending = a.aprovacao_pendente;
    if (a.tags !== undefined) out.tags = a.tags;
    if (a.comentario) out.comments = [...(current?.comments ?? []), { id: randomUUID(), text: a.comentario, createdAt: new Date().toISOString(), author: 'Claude (a seu pedido)' }];
    if (a.item_checklist) out.checklist = [...(current?.checklist ?? []), { id: randomUUID(), text: a.item_checklist, done: false }];
    return out;
  }

  private async runTool(name: string, input: unknown, actions: ClaudeAction[], allowActions: boolean): Promise<string> {
    const { db } = this.app;
    const now = new Date();
    const j = (v: unknown) => JSON.stringify(v);
    const args = (input ?? {}) as Record<string, unknown>;
    switch (name) {
      case 'listar_pautas': {
        const a = z.object({ situacao: z.string().optional(), busca: z.string().optional(), projeto: z.string().optional(), limite: z.number().optional() }).parse(args);
        let list = db.pautas.list();
        const sit = a.situacao ?? 'abertas';
        const today = toLocalDateKey(now);
        const weekEnd = addDays(startOfDay(now), 7);
        if (sit === 'abertas') list = effectiveOrder(list);
        else if (sit === 'atrasadas') list = effectiveOrder(list).filter((p) => isOverdue(p, now));
        else if (sit === 'hoje') list = effectiveOrder(list).filter((p) => p.dueDate?.slice(0, 10) === today);
        else if (sit === 'semana') list = effectiveOrder(list).filter((p) => p.dueDate && dueToDate(p.dueDate) < weekEnd);
        else if (sit === 'concluidas') list = list.filter((p) => p.status === 'done').sort((x, y) => (y.completedAt ?? '').localeCompare(x.completedAt ?? ''));
        if (a.busca) {
          const q = norm(a.busca);
          list = list.filter((p) => norm(`${p.title} ${p.description} ${p.requester ?? ''} ${p.tags.join(' ')}`).includes(q));
        }
        if (a.projeto) {
          const pid = this.byName(db.projetos.list(), a.projeto, 'Projeto');
          list = list.filter((p) => p.projectId === pid);
        }
        const lim = a.limite ?? 25;
        return j({ total: list.length, pautas: list.slice(0, lim).map((p) => this.brief(p)) });
      }
      case 'ver_pauta': {
        const p = this.findPauta(String(args.id ?? ''));
        return j({
          ...this.brief(p),
          id_completo: p.id,
          descricao: truncate(p.description, 3000),
          tipo: p.kind,
          categoria: p.categoryId ? db.categorias.get(p.categoryId)?.name : null,
          impacto: p.impact,
          inicio: p.startDate ? brDate(p.startDate) : null,
          aprovacao_pendente: p.approvalPending,
          justificativa_prioridade: p.priorityJustification,
          proxima_acao: isOpenStatus(p.status) ? nextActionFor(p, now).action : null,
          checklist: p.checklist.map((c) => `${c.done ? '[x]' : '[ ]'} ${c.text}`),
          subtarefas: p.subtasks.map((s) => `${s.done ? '[x]' : '[ ]'} ${s.title}${s.dueDate ? ` (${brDate(s.dueDate)})` : ''}`),
          comentarios: p.comments.slice(-10).map((c) => `${c.author}: ${c.text}`),
          fontes: p.sourceRefs.map((r) => `${r.source}: ${r.title ?? r.externalId}`),
          tags: p.tags,
        });
      }
      case 'prioridades': {
        const lim = Number(args.limite ?? 10);
        return j(effectiveOrder(db.pautas.list()).slice(0, lim).map((p, i) => ({ ordem: i + 1, ...this.brief(p), justificativa: p.priorityJustification, proxima_acao: nextActionFor(p, now).action })));
      }
      case 'agenda': {
        const de = sanitizeCalendarDate(args.de) ?? toLocalDateKey(now);
        const ate = sanitizeCalendarDate(args.ate) ?? de;
        const items = calendarItems(this.app, new Date(`${de}T00:00:00`), new Date(`${ate}T23:59:59`));
        return j(
          items.slice(0, 80).map((i) => ({
            tipo: i.kind === 'event' ? 'reunião' : i.kind === 'planner' ? 'tarefa do Planner' : 'prazo de pauta',
            titulo: i.title,
            quando: i.allDay ? brDate(i.start) : `${brDate(i.start.slice(0, 10))} ${new Date(i.start).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}${i.end ? `–${new Date(i.end).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}`,
            local: i.location ?? undefined,
            online: i.joinUrl ? true : undefined,
            pauta_id: i.pautaId?.slice(0, 8),
          })),
        );
      }
      case 'buscar_emails': {
        const a = z.object({ busca: z.string().optional(), dias: z.number().optional(), enviados: z.boolean().optional(), limite: z.number().optional() }).parse(args);
        const since = new Date(now.getTime() - (a.dias ?? 2) * 86_400_000).toISOString();
        let list = db.mensagens.filter((m) => m.receivedAt >= since && m.isSent === !!a.enviados);
        if (a.busca) {
          const q = norm(a.busca);
          list = list.filter((m) => norm(`${m.subject} ${m.fromName ?? ''} ${m.fromEmail ?? ''} ${m.bodyText}`).includes(q));
        }
        list.sort((x, y) => y.receivedAt.localeCompare(x.receivedAt));
        return j({
          total: list.length,
          emails: list.slice(0, a.limite ?? 20).map((m) => ({
            id: m.id.slice(-16),
            assunto: m.subject,
            de: m.isSent ? undefined : `${m.fromName ?? ''} <${m.fromEmail ?? ''}>`,
            para: m.isSent ? m.to.slice(0, 3) : undefined,
            data: new Date(m.receivedAt).toLocaleString('pt-BR'),
            sinalizado: m.flagged || undefined,
            nao_lido: !m.isRead || undefined,
            trecho: truncate(m.bodyPreview, 200),
          })),
        });
      }
      case 'ler_email': {
        const ref = String(args.id ?? '');
        const m = db.mensagens.get(ref) ?? db.mensagens.find((x) => x.id.endsWith(ref));
        if (!m) throw new ToolError('E-mail não encontrado no cache sincronizado.');
        return j({ assunto: m.subject, de: `${m.fromName ?? ''} <${m.fromEmail ?? ''}>`, para: m.to, cc: m.cc, data: new Date(m.receivedAt).toLocaleString('pt-BR'), corpo: truncate(m.bodyText || m.bodyPreview, 6000) });
      }
      case 'listar_sugestoes': {
        const st = args.situacao === 'snoozed' ? 'snoozed' : 'pending';
        return j(
          db.sugestoes
            .filter((s) => s.status === st)
            .slice(0, 30)
            .map((s) => ({ id: s.id.slice(0, 8), titulo: s.title, solicitante: s.requester, prazo: s.dueDate ? brDate(s.dueDate) : null, prioridade_sugerida: PRIORITY_LABEL[s.suggestedPriority], confianca: `${Math.round(s.confidence * 100)}%`, evidencia: truncate(s.evidence, 200) })),
        );
      }
      case 'resumo_do_dia': {
        const r = await this.app.summaries.generate('daily');
        return j({ manchete: r.headline, secoes: r.sections.filter((s) => s.items.length).map((s) => ({ titulo: s.title, itens: s.items.slice(0, 8).map((i) => (i.meta ? `${i.text} (${i.meta})` : i.text)) })) });
      }
      case 'listar_projetos_categorias':
        return j({ projetos: db.projetos.list().map((p) => ({ nome: p.name, status: p.status })), categorias: db.categorias.list().map((c) => c.name) });

      /* ------------------------------ Escrita ------------------------------ */
      case 'criar_pauta':
      case 'atualizar_pauta':
      case 'decidir_sugestao':
        if (!allowActions) throw new ToolError('Ações desativadas nas configurações do Claude: apenas consultas são permitidas.');
        break;
      default:
        throw new ToolError(`Ferramenta desconhecida: ${name}`);
    }

    if (name === 'criar_pauta') {
      const a = PautaArgs.extend({ titulo: z.string().min(1).max(300) }).parse(args);
      const input = this.toInput(a);
      const p = await this.app.pautas.create({ ...input, title: a.titulo }, { origin: 'assistant', actor: 'assistant' });
      actions.push({ tool: name, summary: `Pauta criada: ${p.title}`, pautaId: p.id });
      return j({ ok: true, pauta: this.brief(p) });
    }
    if (name === 'atualizar_pauta') {
      const a = PautaArgs.extend({ id: z.string() }).parse(args);
      const cur = this.findPauta(a.id);
      const input = this.toInput(a, cur);
      if (!Object.keys(input).length) throw new ToolError('Nenhum campo para alterar.');
      const p = await this.app.pautas.update(cur.id, input, 'assistant');
      actions.push({ tool: name, summary: `Pauta atualizada: ${p.title} (${Object.keys(input).join(', ')})`, pautaId: p.id });
      return j({ ok: true, pauta: this.brief(p) });
    }
    // decidir_sugestao
    const a = z.object({ id: z.string(), acao: z.enum(['aprovar', 'ignorar', 'adiar']), ate: z.string().optional() }).parse(args);
    const s = db.sugestoes.get(a.id) ?? db.sugestoes.find((x) => x.id.startsWith(a.id.toLowerCase()));
    if (!s) throw new ToolError('Sugestão não encontrada.');
    if (a.acao === 'aprovar') {
      const p = await this.app.radar.approve(s.id);
      actions.push({ tool: name, summary: `Sugestão aprovada: ${p.title}`, pautaId: p.id });
      return j({ ok: true, pauta_criada: this.brief(p) });
    }
    if (a.acao === 'ignorar') {
      await this.app.radar.ignore(s.id);
      actions.push({ tool: name, summary: `Sugestão ignorada: ${s.title}`, pautaId: null });
      return j({ ok: true });
    }
    const until = sanitizeCalendarDate(a.ate) ?? toLocalDateKey(addDays(now, 1));
    await this.app.radar.snooze(s.id, new Date(`${until.slice(0, 10)}T08:00:00`).toISOString());
    actions.push({ tool: name, summary: `Sugestão adiada até ${brDate(until)}: ${s.title}`, pautaId: null });
    return j({ ok: true, adiada_ate: brDate(until) });
  }
}

function friendly(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'Chave de API inválida ou revogada.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'A chave não tem permissão para este modelo.';
  if (err instanceof Anthropic.RateLimitError) return 'Limite de uso da API atingido. Tente novamente em instantes.';
  if (err instanceof Anthropic.BadRequestError) return `Requisição recusada pela API: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Sem conexão com a API da Anthropic (verifique internet/proxy da empresa).';
  if (err instanceof Anthropic.APIError) return `Erro da API (${err.status}): ${err.message}`;
  return (err as Error)?.message ?? String(err);
}
