/** Utilitários de texto em português (sem dependências). */

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function norm(s: string): string {
  return stripAccents(s.toLowerCase());
}

const STOPWORDS = new Set(
  'a o as os um uma uns umas de da do das dos em no na nos nas para pra por com sem sobre e ou que se ao aos à às é ser foi são ja já mais menos muito muita seu sua seus suas meu minha nosso nossa este esta esse essa isso isto aquele aquela ele ela eles elas voce você voces vocês lhe me te nos re res enc fw fwd rv tr favor ola olá bom dia boa tarde noite obrigado obrigada att atenciosamente abs abraco abraço prezado prezada prezados caro cara oi segue seguem'
    .split(' ')
    .map(norm),
);

export function cleanSubject(subject: string): string {
  let s = subject.trim();
  // Remove repetidamente prefixos RE:/ENC:/FW:/RES:/TR:/RV:/[EXTERNO]
  for (let i = 0; i < 6; i++) {
    const next = s.replace(/^\s*(\[[^\]]{1,20}\]\s*)?(re|res|enc|fw|fwd|tr|rv|aw|wg)\s*:\s*/i, '').replace(/^\s*\[(externo|external|ext)\]\s*/i, '');
    if (next === s) break;
    s = next;
  }
  return s.trim() || subject.trim();
}

export function tokens(s: string): string[] {
  return norm(s)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .map(stem);
}

/** Radicalização leve: remove plurais e sufixos comuns para melhorar a comparação. */
function stem(t: string): string {
  if (t.length > 5) {
    for (const suf of ['coes', 'cao', 'mente', 'oes', 'aes', 'eis', 'ais', 'ores', 'ar', 'er', 'ir', 'es', 's']) {
      if (t.endsWith(suf) && t.length - suf.length >= 4) return t.slice(0, -suf.length);
    }
  }
  return t;
}

export function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Similaridade entre títulos: média entre Jaccard e coeficiente de sobreposição. */
export function titleSimilarity(a: string, b: string): number {
  const ta = tokens(cleanSubject(a));
  const tb = tokens(cleanSubject(b));
  if (!ta.length || !tb.length) return 0;
  const A = new Set(ta);
  const B = new Set(tb);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const overlap = inter / Math.min(A.size, B.size);
  return (jaccard(ta, tb) + overlap) / 2;
}

/** Remove o histórico citado de respostas/encaminhamentos. */
export function stripQuotedReply(body: string): string {
  const markers = [
    /^\s*-{2,}\s*(mensagem original|original message)/im,
    /^\s*(de|from)\s*:.*$/im,
    /^\s*em .{5,80} escreveu:\s*$/im,
    /^\s*on .{5,80} wrote:\s*$/im,
    /^\s*_{10,}\s*$/m,
  ];
  let cut = body.length;
  for (const m of markers) {
    const r = m.exec(body);
    if (r && r.index > 20 && r.index < cut) cut = r.index;
  }
  return body.slice(0, cut);
}

export function sentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/(?<=[.!?])\s+|\n{1,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

const JOIN_URL = /https:\/\/(teams\.microsoft\.com\/(l\/meetup-join|meet)\/|teams\.live\.com\/meet\/|[\w.-]*zoom\.us\/(j|my|w)\/|meet\.google\.com\/|[\w.-]*webex\.com\/(meet|join|[\w.-]+\/j\.php))[^\s<>"]+/i;

/** Encontra o link de entrada de uma reunião online (Teams, Zoom, Google Meet, Webex). */
export function findJoinUrl(text: string | null | undefined): string | null {
  const m = JOIN_URL.exec(text ?? '');
  return m ? m[0].replace(/[>")\].,;]+$/, '') : null;
}
