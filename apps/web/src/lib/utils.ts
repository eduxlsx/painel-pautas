import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNowStrict, isToday, isTomorrow, isYesterday, parseISO, differenceInCalendarDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Converte prazo (YYYY-MM-DD ou ISO) em Date local; datas sem hora valem até o fim do dia. */
export function parseDue(due: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    const [y, m, d] = due.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, d, 23, 59, 59);
  }
  return parseISO(due);
}

export function toDateKey(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

export function fmtDate(iso: string | null | undefined, pattern = "d 'de' MMM"): string {
  if (!iso) return '—';
  return format(parseDue(iso), pattern, { locale: ptBR });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return format(parseISO(iso), "d MMM, HH:mm", { locale: ptBR });
}

export function fmtTime(iso: string): string {
  return format(parseISO(iso), 'HH:mm');
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return 'nunca';
  return formatDistanceToNowStrict(parseISO(iso), { locale: ptBR, addSuffix: true });
}

/** "Hoje", "Amanhã", "Ontem", "em 3 dias", "há 2 dias" + estado de urgência. */
export function dueLabel(due: string | null | undefined, done = false): { text: string; tone: 'overdue' | 'today' | 'soon' | 'later' | 'none' | 'done' } {
  if (!due) return { text: 'Sem prazo', tone: 'none' };
  const d = parseDue(due);
  const diff = differenceInCalendarDays(d, new Date());
  if (done) return { text: format(d, "d MMM", { locale: ptBR }), tone: 'done' };
  if (d.getTime() < Date.now() && !isToday(d)) return { text: isYesterday(d) ? 'Ontem' : `Atrasada ${-diff}d`, tone: 'overdue' };
  if (isToday(d)) return { text: 'Hoje', tone: 'today' };
  if (isTomorrow(d)) return { text: 'Amanhã', tone: 'soon' };
  if (diff <= 5) return { text: format(d, 'EEEE', { locale: ptBR }).replace('-feira', ''), tone: 'soon' };
  return { text: format(d, "d MMM", { locale: ptBR }), tone: 'later' };
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.replace(/[<>@].*$/, '').trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts.at(-1)![0] : '')).toUpperCase() || '?';
}

export function uid(): string {
  return crypto.randomUUID();
}

export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export function download(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
