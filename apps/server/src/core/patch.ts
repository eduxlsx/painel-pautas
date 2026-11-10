/**
 * Em atualizações parciais (PATCH), o Zod aplica os valores padrão a campos ausentes.
 * Este helper mantém apenas os campos que o cliente realmente enviou — sem ele, editar o status
 * apagaria descrição, prazo, checklist etc.
 */
export function onlyProvided<T extends object>(parsed: T, raw: unknown): Partial<T> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Partial<T> = {};
  for (const k of Object.keys(raw)) {
    if (k in parsed) (out as Record<string, unknown>)[k] = (parsed as Record<string, unknown>)[k];
  }
  return out;
}
