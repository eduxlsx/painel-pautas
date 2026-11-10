import { describe, expect, it } from 'vitest';
import { extractDeadline, addBusinessDays, toLocalDateKey } from '../src/intelligence/dates';
import { cleanSubject, stripQuotedReply, titleSimilarity } from '../src/intelligence/text';

// Terça-feira, 10/11/2026, 09:00
const ref = new Date(2026, 10, 10, 9, 0, 0);

describe('extractDeadline', () => {
  it.each([
    ['Preciso do material até 15/11, por favor.', '2026-11-15'],
    ['Prazo: 20/11/2026', '2026-11-20'],
    ['Consegue me enviar até sexta?', '2026-11-13'],
    ['Pode entregar amanhã?', '2026-11-11'],
    ['Precisamos disso para hoje.', '2026-11-10'],
    ['entrega dia 25', '2026-11-25'],
    ['até 3 de dezembro', '2026-12-03'],
    ['Me envie em 5 dias úteis', toLocalDateKey(addBusinessDays(ref, 5))],
    ['Fechamento até o fim do mês', '2026-11-30'],
    ['a publicação ficou para a próxima segunda-feira', '2026-11-16'],
  ])('%s → %s', (text, expected) => {
    expect(extractDeadline(text, ref)?.date).toBe(expected);
  });

  it('prefere a data com contexto de prazo', () => {
    const r = extractDeadline('Na reunião de 05/11 combinamos: entregar até 18/11.', ref);
    expect(r?.date).toBe('2026-11-18');
    expect(r?.hasContext).toBe(true);
  });

  it('captura horário', () => {
    expect(extractDeadline('Preciso até amanhã às 14h', ref)?.time).toBe('14:00');
  });

  it('ignora datas antigas e textos sem data', () => {
    expect(extractDeadline('Conforme conversamos em 01/02/2025', ref)).toBeNull();
    expect(extractDeadline('Obrigado pelo retorno!', ref)).toBeNull();
  });

  it('virada de ano: 05/01 em novembro é do próximo ano', () => {
    expect(extractDeadline('prazo 05/01', ref)?.date).toBe('2027-01-05');
  });
});

describe('text utils', () => {
  it('limpa prefixos de assunto', () => {
    expect(cleanSubject('RE: ENC: [EXTERNO] Release da feira')).toBe('Release da feira');
  });
  it('remove histórico citado', () => {
    const b = 'Pode revisar o texto até sexta?\n\nDe: Fulano\nEnviado: ontem\nPrazo 01/12';
    expect(stripQuotedReply(b)).not.toContain('01/12');
  });
  it('similaridade de títulos', () => {
    expect(titleSimilarity('Release da Fenasucro 2026', 'RE: release Fenasucro 2026 - revisão')).toBeGreaterThan(0.6);
    expect(titleSimilarity('Relatório mensal de redes', 'Convite inauguração')).toBeLessThan(0.2);
  });
});
