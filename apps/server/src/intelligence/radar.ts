import type { Categoria, DuplicateHint, Pauta, PautaKind, PriorityLevel, Projeto, SourceRef, Sugestao } from '@pautaflow/shared';
import { isOpenStatus } from '@pautaflow/shared';
import type { MailMessage, PlannerTask } from '../storage/internalSchemas';
import { daysBetween, dueToDate, extractDeadline, toLocalDateKey, brDate } from './dates';
import { cleanSubject, norm, sentences, stripQuotedReply, titleSimilarity, truncate } from './text';

export interface DemandCandidate {
  title: string;
  description: string;
  requester: string | null;
  requesterEmail: string | null;
  dueDate: string | null;
  dueEvidence: string | null;
  priority: PriorityLevel;
  kind: PautaKind;
  approvalPending: boolean;
  categoryId: string | null;
  projectId: string | null;
  justification: string;
  evidence: string;
  signals: string[];
  confidence: number;
  sourceRef: SourceRef;
  receivedAt: string | null;
}

export interface RadarContext {
  now: Date;
  myEmails: string[];
  categories: Categoria[];
  projects: Projeto[];
  ignoreSenders: string[];
}

const NOISE_SENDER = /(no-?reply|noreply|nao-?responda|newsletter|mailer-daemon|postmaster|notifications?@|notificacao|marketing@|news@|bounce)/i;
const NOISE_TEXT = /(descadastr|unsubscribe|cancelar (a )?inscri|voce esta recebendo este e-?mail|this email was sent to|ver no navegador|view in browser)/;
const REQUEST = /\b(pode(ria|m|riam)?|consegue(m)?|conseguiria(m)?|preciso que|precisamos que|precisamos de|preciso de|necessito|solicit(o|amos|amos que)|pe(c|ç)o|pedimos|por gentileza|gentileza|por favor|favor (enviar|verificar|revisar|analisar|aprovar|providenciar|encaminhar|retornar|confirmar|incluir|ajustar|atualizar)|aguardo|fico no aguardo|ficamos no aguardo|me (envia|manda|passa|ajuda)|voce (pode|consegue)|teria como|seria possivel|e possivel|conto com|providenciar|demanda|solicitacao)\b/;
/** Avisos automáticos de status (chamados encerrados, confirmações, respostas automáticas) não são demandas. */
const STATUS_NOTICE = /\b(foi (encerrad|resolvid|conclu|fechad|cancelad|aprovad|recebid)|was (closed|resolved|completed|approved)|chamado (encerrado|resolvido)|ticket (closed|resolved)|confirmacao de (recebimento|leitura)|read receipt|resposta automatica|automatic reply|fora do escritorio|out of office)/;
const APPROVAL = /\b(aprova(r|cao|do|da)|de acordo(?! com)|validar|validacao|ok para (publicar|seguir|envio)|autoriza(r|cao)|parecer|sign-?off)\b/;
const URGENT = /\b(urgente|urgencia|prioridade|asap|o quanto antes|com urgencia|imediato|imediatamente|critico|importante)\b/;
const COMMITMENT = /\b(vou (enviar|verificar|providenciar|encaminhar|preparar|revisar|ajustar|mandar)|te envio|envio ate|fico de|retorno (ate|amanha|hoje|em)|me comprometo|vou te retornar|ate (amanha|sexta|segunda) (te )?envio)\b/;
const PUBLICATION = /\b(publicacao|publicar|post|postagem|release|materia|artigo|newsletter|veicula(r|cao))\b/;
const DELIVERY = /\b(entrega|entregar|enviar o material|relatorio|apresentacao|arquivo final|versao final)\b/;

function guessByKeywords<T extends { id: string; name: string; keywords: string[] }>(text: string, items: T[]): T | null {
  const t = norm(text);
  let best: { item: T; hits: number } | null = null;
  for (const it of items) {
    const words = [it.name, ...it.keywords].map(norm).filter((w) => w.length >= 3);
    const hits = words.filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t)).length;
    if (hits && (!best || hits > best.hits)) best = { item: it, hits };
  }
  return best?.item ?? null;
}

function priorityFrom(urgent: boolean, dueDate: string | null, flagged: boolean, highImportance: boolean, now: Date): PriorityLevel {
  const days = dueDate ? daysBetween(now, dueToDate(dueDate)) : null;
  if (urgent && days !== null && days <= 1) return 'critical';
  if (urgent || (days !== null && days <= 2) || (flagged && highImportance)) return 'high';
  if (days !== null || flagged || highImportance) return 'medium';
  return 'low';
}

const PLANNER_SENDER = /planner/i;
const PLANNER_ASSIGN = /(atribu[ií]|assigned|designou|foi designad)/;

/**
 * E-mails de notificação do Microsoft Planner ("X atribuiu uma tarefa a você").
 * Sem o Microsoft Graph, são a forma de o radar enxergar tarefas atribuídas no Planner.
 */
export function analyzePlannerEmail(msg: MailMessage, ctx: RadarContext): DemandCandidate | null {
  const body = msg.bodyText || msg.bodyPreview;
  const text = `${msg.subject}\n${body}`;
  if (!PLANNER_ASSIGN.test(norm(text))) return null; // comentários e outros avisos do Planner
  // Resumos ("Você tem tarefas atrasadas", "tarefas vencendo") não identificam uma tarefa única
  if (/(tarefas? (atrasad|vencend|vence)|voce tem \d* ?tarefas|late tasks|tasks? (due|overdue)|you have \d* ?tasks)/.test(norm(msg.subject))) return null;
  const quoted = /["“”«]([^"“”»\n]{3,160})["“”»]/.exec(msg.subject) ?? /["“”«]([^"“”»\n]{3,160})["“”»]/.exec(body);
  const afterColon = /(?:tarefa|task)\s*:\s*(.{3,160})$/im.exec(msg.subject);
  const title = (quoted?.[1] ?? afterColon?.[1] ?? cleanSubject(msg.subject)).trim();
  const plan = /(?:no plano|in (?:the )?plan|plano)\s*[:"“]?\s*([^\n"”]{2,80})/i.exec(body)?.[1]?.trim() ?? null;
  const dueLine = /(?:data de conclus[aã]o|conclus[aã]o|vencimento|due(?: date)?)\s*:?\s*([^\n]{4,40})/i.exec(body)?.[1] ?? null;
  const deadline = dueLine ? extractDeadline(`até ${dueLine}`, new Date(msg.receivedAt)) : extractDeadline(body, new Date(msg.receivedAt));
  const assigner = /^(.{2,60}?)\s+(atribuiu|assigned|designou)/i.exec(msg.subject)?.[1]?.trim() ?? null;
  const project = plan ? ctx.projects.find((p) => norm(p.name) === norm(plan)) ?? guessByKeywords(plan, ctx.projects) : guessByKeywords(text, ctx.projects.filter((p) => p.status === 'active'));
  const category = guessByKeywords(text, ctx.categories);
  const signals = ['Atribuição de tarefa no Planner (notificação por e-mail)'];
  if (plan) signals.push(`Plano: ${plan}`);
  if (deadline) signals.push(`Prazo identificado (${deadline.date})`);
  return {
    title: truncate(title, 140),
    description: truncate(stripQuotedReply(body).trim(), 1200),
    requester: assigner,
    requesterEmail: null,
    dueDate: deadline?.date ?? null,
    dueEvidence: deadline?.evidence ?? null,
    priority: priorityFrom(false, deadline?.date ?? null, false, false, ctx.now),
    kind: 'tarefa',
    approvalPending: false,
    categoryId: category?.id ?? null,
    projectId: project?.id ?? null,
    justification: signals.join(' · '),
    evidence: truncate(msg.subject, 300),
    signals,
    confidence: 0.8,
    sourceRef: {
      source: 'outlook',
      externalId: msg.id,
      url: msg.webLink,
      title: msg.subject,
      conversationId: msg.conversationId,
      linkedAt: new Date().toISOString(),
      snapshot: { receivedAt: msg.receivedAt, from: msg.fromEmail, planner: true, plan },
    },
    receivedAt: msg.receivedAt,
  };
}

/** Analisa um e-mail e decide se contém uma demanda. Retorna null para ruído/sem sinais. */
export function analyzeMail(msg: MailMessage, ctx: RadarContext): DemandCandidate | null {
  const sender = (msg.fromEmail ?? '').toLowerCase();
  if (msg.meetingMessageType && msg.meetingMessageType !== 'none') return null;
  if (!msg.isSent && (PLANNER_SENDER.test(sender) || (/planner/i.test(msg.fromName ?? '') && NOISE_SENDER.test(sender)))) return analyzePlannerEmail(msg, ctx);
  if (!msg.isSent && ctx.ignoreSenders.some((s) => s && sender.includes(s.toLowerCase()))) return null;
  if (!msg.isSent && NOISE_SENDER.test(sender)) return null;

  const body = stripQuotedReply(msg.bodyText || msg.bodyPreview);
  const full = `${msg.subject}\n${body}`;
  const nfull = norm(full);
  if (NOISE_TEXT.test(nfull)) return null;
  if (!msg.isSent && STATUS_NOTICE.test(norm(msg.subject))) return null;

  const sents = sentences(body);
  const signals: string[] = [];
  let score = 0;
  const ref = new Date(msg.receivedAt);
  const deadline = extractDeadline(full, ref);
  const urgent = URGENT.test(nfull) || msg.importance === 'high';
  const toMe = msg.to.some((t) => ctx.myEmails.includes(t.toLowerCase()));
  const ccOnly = !toMe && msg.cc.some((t) => ctx.myEmails.includes(t.toLowerCase()));
  // Pedido de aprovação: termo no assunto ou numa frase de solicitação — e você não está apenas em cópia
  const approval =
    !ccOnly &&
    (APPROVAL.test(norm(msg.subject)) ||
      /\b(para (sua |a sua )?(aprovacao|validacao)|aguardo (sua |o seu |seu )?(ok|aprovacao|de acordo|validacao))\b/.test(nfull) ||
      sents.some((x) => APPROVAL.test(norm(x)) && REQUEST.test(norm(x))));
  let kind: PautaKind = 'tarefa';
  let evidenceSents: string[] = [];

  if (msg.isSent) {
    const commit = sents.filter((s) => COMMITMENT.test(norm(s)));
    if (!commit.length) return null;
    signals.push('Compromisso assumido por você em e-mail enviado');
    score += 0.45;
    evidenceSents = commit.slice(0, 2);
  } else {
    const requestSents = sents.filter((s) => REQUEST.test(norm(s)) || (s.includes('?') && /\b(voce|vc|sr|sra)\b/.test(norm(s))));
    if (msg.flagged) {
      signals.push('E-mail sinalizado por você');
      score += 0.35;
    }
    if (requestSents.length) {
      signals.push('Linguagem de solicitação');
      score += 0.25 + Math.min(0.1, (requestSents.length - 1) * 0.05);
      evidenceSents = requestSents.slice(0, 2);
    } else if (REQUEST.test(norm(msg.subject))) {
      signals.push('Solicitação no assunto');
      score += 0.2;
    }
    if (approval) {
      signals.push('Pedido de aprovação/validação');
      score += 0.2;
      kind = 'aprovacao';
    }
    if (toMe && msg.to.length <= 3) {
      signals.push('Enviado diretamente a você');
      score += 0.08;
    }
    if (ccOnly) {
      signals.push('Você está apenas em cópia');
      score -= msg.flagged ? 0.05 : 0.25;
    }
    if (msg.inferenceClassification === 'other') {
      signals.push('Classificado como "Outros" pelo Outlook');
      score -= 0.1;
    }
  }
  if (deadline) {
    signals.push(`Prazo identificado (${deadline.date})`);
    score += deadline.hasContext ? 0.2 : 0.1;
  }
  if (urgent) {
    signals.push(msg.importance === 'high' ? 'Importância alta' : 'Termos de urgência');
    score += 0.1;
  }
  if (kind === 'tarefa' && PUBLICATION.test(nfull)) kind = 'publicacao';
  else if (kind === 'tarefa' && DELIVERY.test(nfull)) kind = 'entrega';

  const confidence = Math.max(0, Math.min(1, Number(score.toFixed(2))));
  if (confidence <= 0) return null;

  const subject = cleanSubject(msg.subject || '(sem assunto)');
  const title = msg.isSent ? `Retornar: ${subject}` : kind === 'aprovacao' ? `Aprovar: ${subject}` : subject;
  const firstRecipient = msg.to[0] ?? null;
  const category = guessByKeywords(full, ctx.categories);
  const project = guessByKeywords(full, ctx.projects.filter((p) => p.status === 'active'));
  const dueDate = deadline?.date ?? (msg.flagDueAt ? toLocalDateKey(new Date(msg.flagDueAt)) : null);
  const evidence = truncate((evidenceSents.length ? evidenceSents.join(' ') : msg.bodyPreview).replace(/\s+/g, ' '), 400);

  return {
    title: truncate(title, 140),
    description: truncate(body.replace(/\n{3,}/g, '\n\n').trim(), 1200),
    requester: msg.isSent ? firstRecipient : msg.fromName ?? msg.fromEmail,
    requesterEmail: msg.isSent ? firstRecipient : msg.fromEmail,
    dueDate,
    dueEvidence: deadline?.evidence ?? (msg.flagDueAt ? 'Prazo da sinalização no Outlook' : null),
    priority: priorityFrom(urgent, dueDate, msg.flagged, msg.importance === 'high', ctx.now),
    kind,
    approvalPending: kind === 'aprovacao',
    categoryId: category?.id ?? null,
    projectId: project?.id ?? null,
    justification: signals.join(' · '),
    evidence,
    signals,
    confidence,
    sourceRef: {
      source: 'outlook',
      externalId: msg.id,
      url: msg.webLink,
      title: msg.subject,
      conversationId: msg.conversationId,
      linkedAt: new Date().toISOString(),
      snapshot: { receivedAt: msg.receivedAt, from: msg.fromEmail, folder: msg.folderName },
    },
    receivedAt: msg.receivedAt,
  };
}

/** Planner: tarefas atribuídas a você são demandas explícitas (alta confiança). */
export function analyzePlannerTask(task: PlannerTask, ctx: RadarContext): DemandCandidate | null {
  if (task.percentComplete >= 100) return null;
  const pr = task.priority;
  const priority: PriorityLevel = pr === null ? 'medium' : pr <= 1 ? 'critical' : pr <= 4 ? 'high' : pr <= 7 ? 'medium' : 'low';
  const dueDate = task.dueDateTime ? toLocalDateKey(new Date(task.dueDateTime)) : null;
  const text = `${task.title}\n${task.description}\n${task.planTitle}`;
  const project = ctx.projects.find((p) => norm(p.name) === norm(task.planTitle)) ?? guessByKeywords(text, ctx.projects.filter((p) => p.status === 'active'));
  const category = guessByKeywords(text, ctx.categories);
  const signals = ['Tarefa atribuída a você no Planner', `Plano: ${task.planTitle || task.planId}`];
  if (dueDate) signals.push(`Prazo no Planner (${brDate(dueDate)})`);
  if (task.percentComplete > 0) signals.push(`Em andamento (${task.percentComplete}%)`);
  return {
    title: truncate(task.title, 140),
    description: truncate(task.description, 1200),
    requester: task.createdBy,
    requesterEmail: null,
    dueDate,
    dueEvidence: dueDate ? 'Data de conclusão definida no Planner' : null,
    priority,
    kind: 'tarefa',
    approvalPending: false,
    categoryId: category?.id ?? null,
    projectId: project?.id ?? null,
    justification: signals.join(' · '),
    evidence: task.description ? truncate(task.description, 300) : `Tarefa "${task.title}" no plano ${task.planTitle}`,
    signals,
    confidence: 0.9,
    sourceRef: {
      source: 'planner',
      externalId: task.id,
      url: task.url,
      title: task.title,
      conversationId: null,
      linkedAt: new Date().toISOString(),
      snapshot: { dueDateTime: task.dueDateTime, percentComplete: task.percentComplete, planId: task.planId },
    },
    receivedAt: task.createdDateTime,
  };
}

export type DedupResult =
  | { kind: 'known'; target: 'pauta' | 'sugestao'; id: string }
  | { kind: 'thread'; pautaId: string }
  | { kind: 'merge'; suggestionId: string; similarity: number; reason: string }
  | { kind: 'crosslink'; pautaId: string; similarity: number; reason: string }
  | { kind: 'new'; duplicates: DuplicateHint[] };

function similarity(c: DemandCandidate, title: string, requester: string | null, due: string | null): { score: number; reason: string } {
  let s = titleSimilarity(c.title.replace(/^(aprovar|retornar):\s*/i, ''), title.replace(/^(aprovar|retornar):\s*/i, ''));
  const reasons = [`títulos ${Math.round(s * 100)}% similares`];
  if (c.requester && requester && norm(c.requester) === norm(requester)) {
    s += 0.1;
    reasons.push('mesmo solicitante');
  }
  if (c.dueDate && due && Math.abs(daysBetween(dueToDate(c.dueDate), dueToDate(due))) <= 2) {
    s += 0.1;
    reasons.push('prazos próximos');
  }
  return { score: Math.min(1, s), reason: reasons.join(', ') };
}

/** Deduplicação: identifica a mesma demanda entre Outlook, Planner, pautas e sugestões. */
export function deduplicate(c: DemandCandidate, pautas: Pauta[], suggestions: Sugestao[], threshold: number): DedupResult {
  const ext = c.sourceRef;
  const sameRef = (r: SourceRef) => r.source === ext.source && r.externalId === ext.externalId;
  const p0 = pautas.find((p) => p.sourceRefs.some(sameRef));
  if (p0) return { kind: 'known', target: 'pauta', id: p0.id };
  const s0 = suggestions.find((s) => s.sourceRefs.some(sameRef));
  if (s0) return { kind: 'known', target: 'sugestao', id: s0.id };

  if (ext.conversationId) {
    const pt = pautas.find((p) => isOpenStatus(p.status) && p.sourceRefs.some((r) => r.conversationId === ext.conversationId));
    if (pt) return { kind: 'thread', pautaId: pt.id };
    const st = suggestions.find((s) => (s.status === 'pending' || s.status === 'snoozed') && s.sourceRefs.some((r) => r.conversationId === ext.conversationId));
    if (st) return { kind: 'merge', suggestionId: st.id, similarity: 1, reason: 'mesma conversa de e-mail' };
  }

  const hints: DuplicateHint[] = [];
  const recentCutoff = Date.now() - 30 * 86_400_000;
  for (const p of pautas) {
    if (!isOpenStatus(p.status) && new Date(p.updatedAt).getTime() < recentCutoff) continue;
    const { score, reason } = similarity(c, p.title, p.requester, p.dueDate);
    if (score >= threshold) hints.push({ type: 'pauta', id: p.id, title: p.title, similarity: Number(score.toFixed(2)), reason });
  }
  for (const s of suggestions) {
    if (s.status !== 'pending' && s.status !== 'snoozed') continue;
    const { score, reason } = similarity(c, s.title, s.requester, s.dueDate);
    if (score >= threshold) hints.push({ type: 'sugestao', id: s.id, title: s.title, similarity: Number(score.toFixed(2)), reason });
  }
  hints.sort((a, b) => b.similarity - a.similarity);
  const top = hints[0];
  if (top) {
    // Mesma demanda vinda de outra fonte (Outlook × Planner): cria referência cruzada automaticamente
    if (top.type === 'pauta' && top.similarity >= 0.85) {
      const p = pautas.find((x) => x.id === top.id)!;
      if (!p.sourceRefs.some((r) => r.source === ext.source)) return { kind: 'crosslink', pautaId: p.id, similarity: top.similarity, reason: top.reason };
    }
    if (top.type === 'sugestao') return { kind: 'merge', suggestionId: top.id, similarity: top.similarity, reason: top.reason };
  }
  return { kind: 'new', duplicates: hints.slice(0, 3) };
}
