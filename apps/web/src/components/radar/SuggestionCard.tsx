import { useState } from 'react';
import { motion } from 'motion/react';
import {
  AlarmClock,
  AlertTriangle,
  Bot,
  CalendarClock,
  Check,
  ChevronDown,
  Clock,
  Cpu,
  ExternalLink,
  EyeOff,
  FolderKanban,
  GitMerge,
  Link2,
  Pencil,
  Quote,
  RotateCcw,
  ShieldCheck,
  Tag,
} from 'lucide-react';
import type { SourceKind, Sugestao } from '@pautaflow/shared';
import { KIND_LABEL } from '@pautaflow/shared';
import { cn, fmtDate, fmtDateTime, fmtRelative } from '@/lib/utils';
import { useUi } from '@/stores/ui';
import { Avatar, Badge, Button, DueChip, Popover, PopoverContent, PopoverTrigger, PriorityBadge, SourceBadge, Tip } from '@/components/ui';
import { useLookups } from '@/components/pauta/PautaCard';
import { SnoozeOptions } from './dialogs';

export interface SuggestionHandlers {
  onApprove: (s: Sugestao) => void;
  onEdit: (s: Sugestao) => void;
  onIgnore: (s: Sugestao) => void;
  onSnooze: (s: Sugestao, until: string, label: string) => void;
  onLinkPicker: (s: Sugestao) => void;
  onLinkTo: (s: Sugestao, pautaId: string, title: string) => void;
  onRestore: (s: Sugestao) => void;
}

const STATUS_BADGE: Record<Sugestao['status'], { label: string; tone: 'success' | 'neutral' | 'info' | 'warning' | 'accent' }> = {
  pending: { label: 'Pendente', tone: 'accent' },
  approved: { label: 'Aprovada', tone: 'success' },
  linked: { label: 'Vinculada', tone: 'info' },
  ignored: { label: 'Ignorada', tone: 'neutral' },
  snoozed: { label: 'Adiada', tone: 'warning' },
};

function sourceLinks(s: Sugestao): { label: string; url: string }[] {
  const name = (src: SourceKind) => (src === 'planner' ? 'Planner' : src === 'calendar' ? 'Calendário' : 'Outlook');
  const out: { label: string; url: string }[] = [];
  for (const r of s.sourceRefs) if (r.url && !out.some((o) => o.url === r.url)) out.push({ label: `Abrir no ${name(r.source)}`, url: r.url });
  if (s.sourceUrl && !out.some((o) => o.url === s.sourceUrl)) out.unshift({ label: `Abrir no ${name(s.source)}`, url: s.sourceUrl });
  return out;
}

function confidenceTone(c: number) {
  if (c >= 0.75) return { color: '#10b981', label: 'Alta' };
  if (c >= 0.5) return { color: 'var(--pf-accent)', label: 'Média' };
  return { color: '#f59e0b', label: 'Baixa' };
}

export function SuggestionCard({ s, handlers, busy }: { s: Sugestao; handlers: SuggestionHandlers; busy?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const { openPauta } = useUi();
  const { project, category } = useLookups();
  const proj = project(s.projectId);
  const cat = category(s.categoryId);
  const sources = [...new Set([s.source, ...s.sourceRefs.map((r) => r.source)])];
  const crossRef = new Set(s.sourceRefs.map((r) => `${r.source}:${r.externalId}`)).size > 1;
  const links = sourceLinks(s);
  const conf = Math.round(s.confidence * 100);
  const tone = confidenceTone(s.confidence);
  const pending = s.status === 'pending';
  const ai = s.analyzedBy !== 'rules';
  const longDesc = s.description.length > 220;

  return (
    <article className={cn('glass p-5 transition-opacity', busy && 'pointer-events-none opacity-60')}>
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center gap-1.5">
        {sources.map((src) => (
          <SourceBadge key={src} source={src} />
        ))}
        {crossRef && (
          <Tip content="Esta demanda apareceu em mais de uma fonte; o radar uniu as referências.">
            <span>
              <Badge tone="accent" icon={<GitMerge />}>
                referência cruzada
              </Badge>
            </span>
          </Tip>
        )}
        {!pending && <Badge tone={STATUS_BADGE[s.status].tone}>{STATUS_BADGE[s.status].label}</Badge>}
        {s.status === 'snoozed' && s.snoozeUntil && (
          <Badge tone="warning" icon={<AlarmClock />}>
            até {fmtDateTime(s.snoozeUntil)}
          </Badge>
        )}
        <span className="ml-auto flex items-center gap-1 text-[11.5px] text-fg-3" title={s.receivedAt ? fmtDateTime(s.receivedAt) : undefined}>
          <Clock className="size-3" />
          {s.receivedAt ? `Recebida ${fmtRelative(s.receivedAt)}` : `Detectada ${fmtRelative(s.createdAt)}`}
        </span>
      </div>

      <div className="mt-3 grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="min-w-0">
          <h3 className="text-[17px] font-semibold leading-snug tracking-[-0.015em] text-fg">{s.title}</h3>
          {s.description && (
            <div className="mt-1.5">
              <p className={cn('whitespace-pre-line text-[13.5px] leading-relaxed text-fg-2', !expanded && 'line-clamp-3')}>{s.description}</p>
              {longDesc && (
                <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
                  {expanded ? 'Mostrar menos' : 'Ler mais'}
                  <ChevronDown className={cn('size-3 transition-transform', expanded && 'rotate-180')} />
                </button>
              )}
            </div>
          )}

          {/* Metadados */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <PriorityBadge level={s.suggestedPriority} />
            <Tip content={s.dueDateEvidence ? `Prazo detectado em: “${s.dueDateEvidence}”` : s.dueDate ? 'Prazo informado na origem' : 'Nenhum prazo identificado'}>
              <span>
                <DueChip due={s.dueDate} />
              </span>
            </Tip>
            <Badge icon={<Tag />}>{KIND_LABEL[s.kind]}</Badge>
            {s.approvalPending && (
              <Badge tone="warning" icon={<ShieldCheck />}>
                Pede aprovação
              </Badge>
            )}
            {cat && (
              <span className="inline-flex h-6 items-center gap-1 rounded-full bg-sunken px-2 text-[11.5px] font-medium ring-1 ring-inset ring-line" style={{ color: cat.color }}>
                <span className="size-1.5 rounded-full bg-current" />
                {cat.name}
              </span>
            )}
            {proj && (
              <span className="inline-flex h-6 items-center gap-1 rounded-full bg-sunken px-2 text-[11.5px] font-medium text-fg-2 ring-1 ring-inset ring-line">
                <FolderKanban className="size-3" style={{ color: proj.color }} />
                {proj.name}
              </span>
            )}
          </div>
          {s.dueDateEvidence && (
            <p className="mt-1.5 flex items-center gap-1 text-[11.5px] text-fg-3">
              <CalendarClock className="size-3" />
              Prazo {s.dueDate ? fmtDate(s.dueDate, "d 'de' MMMM") : ''} inferido de “{s.dueDateEvidence}”
            </p>
          )}

          {/* Justificativa */}
          {(s.justification || s.signals.length > 0) && (
            <div className="mt-4">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-3">Por que o radar sugeriu</div>
              {s.justification && <p className="text-[13px] leading-relaxed text-fg-2">{s.justification}</p>}
              {s.signals.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {s.signals.map((sig) => (
                    <span key={sig} className="rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent">
                      {sig}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {s.evidence && (
            <blockquote className="mt-3 flex gap-2 rounded-2xl border-l-[3px] border-accent/60 bg-sunken/70 px-3.5 py-2.5 text-[13px] italic leading-relaxed text-fg-2">
              <Quote className="mt-0.5 size-3.5 shrink-0 text-accent" />
              <span className="line-clamp-4">{s.evidence}</span>
            </blockquote>
          )}

          {/* Duplicidades */}
          {s.duplicates.length > 0 && (
            <div className="mt-3 rounded-2xl bg-warning/[0.08] p-3 ring-1 ring-inset ring-warning/25">
              <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-amber-700 dark:text-amber-300">
                <AlertTriangle className="size-3.5" /> Possível duplicidade
              </div>
              <ul className="space-y-1.5">
                {s.duplicates.map((d) => (
                  <li key={`${d.type}:${d.id}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
                    <span className="min-w-0 flex-1 text-fg">
                      Possível duplicidade com{' '}
                      {d.type === 'pauta' ? (
                        <button type="button" onClick={() => openPauta(d.id)} className="font-medium text-fg underline decoration-fg-3/40 underline-offset-2 hover:decoration-accent">
                          “{d.title}”
                        </button>
                      ) : (
                        <span className="font-medium">“{d.title}” (outra sugestão)</span>
                      )}
                      <span className="tabular ml-1.5 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-700 dark:text-amber-300">{Math.round(d.similarity * 100)}%</span>
                      {d.reason && <span className="block text-[11.5px] text-fg-3">{d.reason}</span>}
                    </span>
                    {d.type === 'pauta' && pending && (
                      <Button size="sm" variant="outline" className="h-7 text-[12px]" onClick={() => handlers.onLinkTo(s, d.id, d.title)}>
                        <Link2 /> Vincular a esta pauta
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Coluna lateral */}
        <aside className="space-y-4 lg:border-l lg:border-line lg:pl-5">
          {(s.requester || s.requesterEmail) && (
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-3">Solicitante</div>
              <div className="flex items-center gap-2.5">
                <Avatar name={s.requester ?? s.requesterEmail} className="size-8" />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-fg">{s.requester ?? s.requesterEmail}</div>
                  {s.requesterEmail && s.requester && <div className="truncate text-[11.5px] text-fg-3">{s.requesterEmail}</div>}
                </div>
              </div>
            </div>
          )}
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-3">
              Confiança
              <span className="tabular text-[12px] normal-case tracking-normal" style={{ color: tone.color }}>
                {conf}% · {tone.label}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-line">
              <motion.div className="h-full rounded-full" style={{ background: tone.color }} initial={{ width: 0 }} animate={{ width: `${conf}%` }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
            </div>
            <div className="mt-1.5 flex items-center gap-1 text-[11.5px] text-fg-3">
              {ai ? <Bot className="size-3" /> : <Cpu className="size-3" />}
              Analisado por {ai ? `IA${s.analyzedBy !== 'ai' ? ` (${s.analyzedBy})` : ''}` : 'Regras'}
            </div>
          </div>
          {links.length > 0 && (
            <div className="space-y-1">
              {links.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-[12.5px] font-medium text-accent hover:underline">
                  <ExternalLink className="size-3.5" />
                  {l.label}
                </a>
              ))}
            </div>
          )}
          {s.linkedPautaId && !pending && (
            <Button size="sm" variant="subtle" onClick={() => openPauta(s.linkedPautaId!)}>
              Abrir pauta
            </Button>
          )}
        </aside>
      </div>

      {/* Ações */}
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {pending ? (
          <>
            <Button variant="primary" size="sm" onClick={() => handlers.onApprove(s)}>
              <Check /> Aprovar
            </Button>
            <Button variant="secondary" size="sm" onClick={() => handlers.onEdit(s)}>
              <Pencil /> Editar
            </Button>
            <Button variant="secondary" size="sm" onClick={() => handlers.onLinkPicker(s)}>
              <Link2 /> Vincular a pauta existente
            </Button>
            <Popover open={snoozeOpen} onOpenChange={setSnoozeOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm">
                  <AlarmClock /> Adiar
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start">
                <SnoozeOptions
                  onPick={(iso, label) => {
                    setSnoozeOpen(false);
                    handlers.onSnooze(s, iso, label);
                  }}
                />
              </PopoverContent>
            </Popover>
            <Button variant="ghost" size="sm" className="ml-auto text-fg-3 hover:text-critical" onClick={() => handlers.onIgnore(s)}>
              <EyeOff /> Ignorar
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={() => handlers.onRestore(s)}>
              <RotateCcw /> Restaurar
            </Button>
            {s.decidedAt && <span className="text-[11.5px] text-fg-3">Decidida {fmtRelative(s.decidedAt)}</span>}
          </>
        )}
      </div>
    </article>
  );
}

