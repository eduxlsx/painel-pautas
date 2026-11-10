import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, Bot, Cpu, Eraser, FolderKanban, ListTodo, Radar, Sparkles, TriangleAlert, X } from 'lucide-react';
import type { AssistantAnswer } from '@pautaflow/shared';
import { useAsk } from '@/lib/queries';
import { cn, uid } from '@/lib/utils';
import { useUi } from '@/stores/ui';
import { Button, Kbd, Tip } from '@/components/ui';

const SUGGESTIONS = [
  'Quais são minhas prioridades hoje?',
  'O que chegou de novo no Outlook?',
  'Tenho alguma entrega atrasada?',
  'Resuma minha semana.',
  'Quais pautas estão aguardando aprovação?',
  'O que devo priorizar agora?',
  'Quais projetos receberam novas demandas?',
  'Como está minha produtividade neste mês?',
];

type Msg =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; text: string; items: AssistantAnswer['items']; source: string }
  | { id: string; role: 'error'; text: string; question: string };

const ITEM_ICON: Record<AssistantAnswer['items'][number]['type'], ReactNode> = {
  pauta: <ListTodo />,
  sugestao: <Radar />,
  projeto: <FolderKanban />,
};

function sourceLabel(source: string) {
  return source === 'rules' ? 'Motor de regras (dados locais)' : `IA: ${source}`;
}

/** Renderiza a resposta preservando quebras de linha, listas com marcadores e numeradas. */
function AnswerText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1">
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <div key={i} className="h-1.5" />;
        const bullet = /^\s*[•\-*]\s+(.*)$/.exec(line);
        const num = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
        if (bullet)
          return (
            <div key={i} className="flex gap-2 pl-0.5">
              <span className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-accent/70" />
              <span>{bullet[1]}</span>
            </div>
          );
        if (num)
          return (
            <div key={i} className="flex gap-2">
              <span className="tabular mt-px grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-md bg-accent-soft px-1 text-[10.5px] font-semibold text-accent">{num[1]}</span>
              <span>{num[2]}</span>
            </div>
          );
        return (
          <p key={i} className="whitespace-pre-wrap">
            {line}
          </p>
        );
      })}
    </div>
  );
}

export function AssistantPanel() {
  const { assistantOpen: open, setAssistant, openPauta } = useUi();
  const navigate = useNavigate();
  const ask = useAsk();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 180);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"][data-state="open"]')) setAssistant(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, setAssistant]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, ask.isPending]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft]);

  const send = (text: string) => {
    const question = text.trim();
    if (!question || ask.isPending) return;
    setMessages((m) => [...m, { id: uid(), role: 'user', text: question }]);
    setDraft('');
    ask.mutate(question, {
      onSuccess: (r) => setMessages((m) => [...m, { id: uid(), role: 'assistant', text: r.answer, items: r.items, source: r.source }]),
      onError: (err) => setMessages((m) => [...m, { id: uid(), role: 'error', text: err.message || 'Não foi possível obter uma resposta.', question }]),
    });
  };

  const openItem = (it: AssistantAnswer['items'][number]) => {
    if (it.type === 'pauta') openPauta(it.id);
    else if (it.type === 'sugestao') {
      navigate('/radar');
      setAssistant(false);
    } else {
      navigate('/projetos');
      setAssistant(false);
    }
  };

  const empty = messages.length === 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.section
          role="complementary"
          aria-label="Assistente PautaFlow"
          className="glass glass-strong pf-no-print fixed bottom-3 right-3 z-[35] flex flex-col overflow-hidden !rounded-[28px]"
          style={{ width: 'min(440px, calc(100vw - 24px))', height: 'min(720px, calc(100vh - 24px))', transformOrigin: 'bottom right' }}
          initial={{ opacity: 0, scale: 0.92, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 16 }}
          transition={{ type: 'spring', stiffness: 380, damping: 34 }}
        >
          {/* Cabeçalho */}
          <header className="relative flex shrink-0 items-center gap-3 border-b border-line px-5 py-4">
            <div className="pointer-events-none absolute -left-10 -top-16 size-40 rounded-full bg-flow opacity-20 blur-3xl" />
            <span className="relative grid size-9 place-items-center rounded-xl bg-flow text-white shadow-[0_8px_20px_-8px_var(--pf-accent)] [&_svg]:size-[18px]">
              <Sparkles />
            </span>
            <div className="relative min-w-0 flex-1">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">Assistente</h2>
              <p className="truncate text-xs text-fg-3">Pergunte sobre suas pautas, prazos e projetos</p>
            </div>
            {!empty && (
              <Tip content="Limpar conversa">
                <Button size="icon-sm" variant="ghost" onClick={() => setMessages([])} aria-label="Limpar conversa" disabled={ask.isPending}>
                  <Eraser />
                </Button>
              </Tip>
            )}
            <Button size="icon-sm" variant="ghost" onClick={() => setAssistant(false)} aria-label="Fechar assistente">
              <X />
            </Button>
          </header>

          {/* Mensagens */}
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {empty ? (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
                <div className="mb-5 flex items-start gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent [&_svg]:size-4">
                    <Bot />
                  </span>
                  <div className="text-[13.5px] leading-relaxed text-fg-2">
                    <p className="font-medium text-fg">Olá! Eu consulto seus dados locais do PautaFlow.</p>
                    <p className="mt-1">Posso listar prioridades, prazos em risco, aprovações pendentes, novidades do radar e resumir seu período. Clique em uma sugestão ou escreva sua pergunta.</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s, i) => (
                    <motion.button
                      key={s}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.12 + i * 0.035 }}
                      onClick={() => send(s)}
                      className="rounded-full bg-surface px-3 py-1.5 text-left text-[12.5px] font-medium text-fg-2 shadow-[var(--pf-shadow)] transition hover:-translate-y-px hover:text-accent"
                    >
                      {s}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            ) : (
              <div className="space-y-4">
                {messages.map((m) => (
                  <motion.div key={m.id} layout="position" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 34 }}>
                    {m.role === 'user' ? (
                      <div className="flex justify-end">
                        <div className="max-w-[85%] whitespace-pre-wrap rounded-[20px] rounded-br-md bg-flow px-3.5 py-2.5 text-[13.5px] leading-relaxed text-white shadow-[0_8px_20px_-10px_var(--pf-accent)]">{m.text}</div>
                      </div>
                    ) : m.role === 'error' ? (
                      <div className="flex items-start gap-2.5">
                        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-critical/12 text-critical [&_svg]:size-3.5">
                          <TriangleAlert />
                        </span>
                        <div className="rounded-[20px] rounded-tl-md bg-critical/8 px-3.5 py-2.5 text-[13px] text-fg-2 ring-1 ring-inset ring-critical/20">
                          <p>{m.text}</p>
                          <button onClick={() => send(m.question)} className="mt-1.5 text-xs font-semibold text-accent hover:underline" disabled={ask.isPending}>
                            Tentar novamente
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2.5">
                        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent [&_svg]:size-3.5">
                          <Bot />
                        </span>
                        <div className="min-w-0 max-w-[88%]">
                          <div className="rounded-[20px] rounded-tl-md bg-surface px-3.5 py-2.5 text-[13.5px] leading-relaxed text-fg shadow-[var(--pf-shadow)]">
                            <AnswerText text={m.text} />
                          </div>
                          {m.items.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {m.items.map((it) => (
                                <button
                                  key={`${it.type}-${it.id}`}
                                  onClick={() => openItem(it)}
                                  className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-accent-soft py-1 pl-2 pr-2.5 text-[12px] font-medium text-accent transition hover:brightness-110 [&_svg]:size-3 [&_svg]:shrink-0"
                                  title={it.meta ? `${it.title} — ${it.meta}` : it.title}
                                >
                                  {ITEM_ICON[it.type]}
                                  <span className="truncate">{it.title}</span>
                                  {it.meta && <span className="shrink-0 text-accent/70">· {it.meta}</span>}
                                </button>
                              ))}
                            </div>
                          )}
                          <div className="mt-1.5 flex items-center gap-1 pl-1 text-[10.5px] text-fg-3">
                            {m.source === 'rules' ? <Cpu className="size-3" /> : <Sparkles className="size-3" />}
                            {sourceLabel(m.source)}
                          </div>
                        </div>
                      </div>
                    )}
                  </motion.div>
                ))}
                <AnimatePresence>
                  {ask.isPending && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-2.5">
                      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent [&_svg]:size-3.5">
                        <Bot />
                      </span>
                      <div className="flex items-center gap-1 rounded-[20px] rounded-tl-md bg-surface px-4 py-3 shadow-[var(--pf-shadow)]" aria-label="Assistente digitando">
                        {[0, 1, 2].map((d) => (
                          <motion.span
                            key={d}
                            className="size-1.5 rounded-full bg-fg-3"
                            animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
                            transition={{ duration: 0.9, repeat: Infinity, delay: d * 0.15, ease: 'easeInOut' }}
                          />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* Entrada */}
          <div className="shrink-0 border-t border-line p-3">
            {!empty && (
              <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
                {SUGGESTIONS.slice(0, 5).map((s) => (
                  <Fragment key={s}>
                    <button
                      onClick={() => send(s)}
                      disabled={ask.isPending}
                      className="shrink-0 rounded-full bg-sunken px-2.5 py-1 text-[11.5px] font-medium text-fg-2 ring-1 ring-line transition hover:text-accent disabled:opacity-50"
                    >
                      {s}
                    </button>
                  </Fragment>
                ))}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(draft);
              }}
              className="flex items-end gap-2 rounded-[20px] bg-sunken p-1.5 pl-3.5 ring-1 ring-line transition focus-within:bg-surface-strong focus-within:ring-2 focus-within:ring-accent/40"
            >
              <textarea
                ref={inputRef}
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send(draft);
                  }
                }}
                placeholder="Pergunte algo…"
                maxLength={1000}
                className="max-h-[140px] min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[13.5px] leading-relaxed text-fg placeholder:text-fg-3 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!draft.trim() || ask.isPending}
                className={cn(
                  'grid size-9 shrink-0 place-items-center rounded-full transition-all [&_svg]:size-4',
                  draft.trim() && !ask.isPending ? 'bg-flow text-white shadow-[0_6px_16px_-6px_var(--pf-accent)] hover:brightness-110' : 'bg-line text-fg-3',
                )}
                aria-label="Enviar"
              >
                <ArrowUp />
              </button>
            </form>
            <div className="mt-1.5 flex items-center justify-center gap-1.5 text-[10.5px] text-fg-3">
              <Kbd>Enter</Kbd> envia · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> nova linha
            </div>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
