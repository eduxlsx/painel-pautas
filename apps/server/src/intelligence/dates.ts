import { norm } from './text';

/** Datas locais no formato YYYY-MM-DD (prazos sem horário). */
export function toLocalDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Converte um prazo (YYYY-MM-DD ou ISO completo) para Date. Datas sem hora valem até 23:59 local. */
export function dueToDate(due: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    const [y, m, d] = due.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, d, 23, 59, 59);
  }
  return new Date(due);
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);
}

export function addBusinessDays(d: Date, n: number): Date {
  let r = new Date(d);
  let added = 0;
  while (added < n) {
    r = addDays(r, 1);
    const wd = r.getDay();
    if (wd !== 0 && wd !== 6) added++;
  }
  return r;
}

export function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  const wd = s.getDay();
  return addDays(s, wd === 0 ? -6 : 1 - wd); // segunda-feira
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

const MONTHS: Record<string, number> = {
  janeiro: 0, jan: 0, fevereiro: 1, fev: 1, marco: 2, mar: 2, abril: 3, abr: 3, maio: 4, mai: 4, junho: 5, jun: 5,
  julho: 6, jul: 6, agosto: 7, ago: 7, setembro: 8, set: 8, outubro: 9, out: 9, novembro: 10, nov: 10, dezembro: 11, dez: 11,
};

const WEEKDAYS: Record<string, number> = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };

const CONTEXT = /(ate|prazo|entrega|entregar|enviar|deadline|data limite|vencimento|vence|no maximo|impreterivelmente|para o dia|para dia|limite|antes de|previsto para|agendad[oa] para|programad[oa] para|publicacao|publicar)\W{0,3}(o |a |dia |de |do |da |as |às |para )?\W{0,3}$/;

export interface ExtractedDate {
  date: string; // YYYY-MM-DD
  time: string | null; // HH:mm
  evidence: string;
  confidence: number;
  hasContext: boolean;
}

interface Candidate {
  date: Date;
  index: number;
  length: number;
  base: number; // confiança base da expressão
}

function nextWeekday(ref: Date, wd: number, forceNextWeek: boolean): Date {
  const cur = ref.getDay();
  let diff = (wd - cur + 7) % 7;
  if (diff === 0) diff = 7;
  let r = addDays(startOfDay(ref), diff);
  if (forceNextWeek && daysBetween(ref, r) < 7 && startOfWeek(r).getTime() === startOfWeek(ref).getTime()) r = addDays(r, 7);
  return r;
}

function inferYear(ref: Date, month: number, day: number): Date {
  let d = new Date(ref.getFullYear(), month, day);
  if (daysBetween(ref, d) < -45) d = new Date(ref.getFullYear() + 1, month, day);
  return d;
}

function validDate(y: number, m: number, d: number): boolean {
  const dt = new Date(y, m, d);
  return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d;
}

/**
 * Extrai o prazo mais provável de um texto em português, relativo à data de referência
 * (normalmente a data de recebimento do e-mail).
 */
export function extractDeadline(text: string, ref: Date = new Date()): ExtractedDate | null {
  const t = norm(text);
  const cands: Candidate[] = [];
  const push = (date: Date, m: RegExpExecArray, base: number) => cands.push({ date, index: m.index, length: m[0].length, base });
  let m: RegExpExecArray | null;

  const reNumeric = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/g;
  while ((m = reNumeric.exec(t))) {
    const day = Number(m[1]);
    const month = Number(m[2]) - 1;
    let year = m[3] ? Number(m[3]) : null;
    if (year !== null && year < 100) year += 2000;
    if (month < 0 || month > 11 || day < 1 || day > 31) continue;
    // Evita horários (10.30) e números de versão quando não há separador de barra
    if (!m[3] && m[0].includes('.') && !/\//.test(m[0])) continue;
    const y = year ?? inferYear(ref, month, day).getFullYear();
    if (!validDate(y, month, day)) continue;
    push(new Date(y, month, day), m, 0.75);
  }

  const reLong = /\b(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?/g;
  while ((m = reLong.exec(t))) {
    const day = Number(m[1]);
    const month = MONTHS[m[2]!]!;
    const y = m[3] ? Number(m[3]) : inferYear(ref, month, day).getFullYear();
    if (validDate(y, month, day)) push(new Date(y, month, day), m, 0.8);
  }

  const reDia = /\bdia\s+(\d{1,2})\b(?!\s*(de|\/|\.|-))/g;
  while ((m = reDia.exec(t))) {
    const day = Number(m[1]);
    if (day < 1 || day > 31) continue;
    let d = new Date(ref.getFullYear(), ref.getMonth(), day);
    if (d.getDate() !== day) continue;
    if (daysBetween(ref, d) < 0) d = new Date(ref.getFullYear(), ref.getMonth() + 1, day);
    push(d, m, 0.6);
  }

  const reRel: [RegExp, (r: Date) => Date, number][] = [
    [/\bdepois de amanha\b/g, (r) => addDays(r, 2), 0.7],
    [/\bamanha\b/g, (r) => addDays(r, 1), 0.7],
    [/\b(ainda hoje|hoje|fim do dia|final do dia|eod|ate o fim do expediente)\b/g, (r) => r, 0.65],
    [/\b(fim|final) d[ae]sta? semana\b|\b(ainda )?(esta|essa) semana\b/g, (r) => (r.getDay() >= 5 || r.getDay() === 0 ? r : addDays(startOfWeek(r), 4)), 0.55],
    [/\b(proxima semana|semana que vem)\b/g, (r) => addDays(startOfWeek(r), 11), 0.4],
    [/\b(fim|final) do mes\b/g, (r) => endOfMonth(r), 0.55],
  ];
  for (const [re, fn, base] of reRel) {
    while ((m = re.exec(t))) push(startOfDay(fn(ref)), m, base);
  }

  const reIn = /\bem\s+(\d{1,2})\s+dias(\s+uteis)?\b/g;
  while ((m = reIn.exec(t))) {
    const n = Number(m[1]);
    push(startOfDay(m[2] ? addBusinessDays(ref, n) : addDays(ref, n)), m, 0.6);
  }

  const reWd = /\b(proxim[ao]\s+)?(segunda|terca|quarta|quinta|sexta|sabado|domingo)(-feira)?(\s+que vem)?\b/g;
  while ((m = reWd.exec(t))) {
    const wd = WEEKDAYS[m[2]!]!;
    push(nextWeekday(ref, wd, Boolean(m[1] || m[4])), m, 0.6);
  }

  if (!cands.length) return null;

  const scored = cands
    .map((c) => {
      const before = t.slice(Math.max(0, c.index - 40), c.index);
      const hasContext = CONTEXT.test(before);
      const delta = daysBetween(ref, c.date);
      let conf = c.base + (hasContext ? 0.2 : -0.15);
      if (delta < -1) conf -= 0.5; // datas passadas raramente são prazos
      if (delta > 180) conf -= 0.3;
      return { ...c, hasContext, conf: Math.max(0, Math.min(1, conf)) };
    })
    .filter((c) => c.conf >= 0.35)
    .sort((a, b) => Number(b.hasContext) - Number(a.hasContext) || b.conf - a.conf || a.date.getTime() - b.date.getTime());

  const best = scored[0];
  if (!best) return null;

  // horário logo após a expressão: "às 14h", "14:30", "até 10h"
  const after = t.slice(best.index + best.length, best.index + best.length + 18);
  const tm = /^\W{0,4}(?:as\s+|ate\s+as\s+|ate\s+)?(\d{1,2})(?:h|:)(\d{2})?\b/.exec(after);
  let time: string | null = null;
  if (tm) {
    const h = Number(tm[1]);
    const mi = Number(tm[2] ?? 0);
    if (h < 24 && mi < 60) time = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  }

  const start = Math.max(0, best.index - 50);
  const end = Math.min(text.length, best.index + best.length + 30);
  const evidence = `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
  return { date: toLocalDateKey(best.date), time, evidence, confidence: Number(best.conf.toFixed(2)), hasContext: best.hasContext };
}

/** Data no padrão brasileiro para textos: "03/11/2026" ou "03/11/2026 às 14:00". */
export function brDate(due: string | null | undefined): string {
  if (!due) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(due);
  if (!m) return due;
  if (/Z|[+-]\d{2}:?\d{2}$/.test(due)) {
    const d = new Date(due);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} às ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` às ${m[4]}:${m[5]}` : ''}`;
}
