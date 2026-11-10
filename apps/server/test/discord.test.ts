import { describe, expect, it } from 'vitest';
import { Pauta, Sugestao } from '@pautaflow/shared';
import { parseDueInput } from '../src/integrations/discord/bot';
import { pautaEmbed, suggestionEmbed, discordTime, pautaLine } from '../src/integrations/discord/format';
import { resolveDiscordEnv } from '../src/env';

const now = new Date(2026, 10, 10, 9, 0);

describe('Discord — prazos em linguagem natural', () => {
  it.each([
    ['15/11', '2026-11-15'],
    ['sexta', '2026-11-13'],
    ['amanhã', '2026-11-11'],
    ['2026-12-01', '2026-12-01'],
  ])('%s → %s', (input, out) => expect(parseDueInput(input, now)).toBe(out));
  it('sem prazo e inválido', () => {
    expect(parseDueInput('sem prazo', now)).toBeNull();
    expect(parseDueInput('quando der', now)).toBe('invalid');
  });
});

describe('Discord — formatação', () => {
  const p = Pauta.parse({
    id: '0f6c3f6e-1111-4c4c-9999-aaaaaaaaaaaa',
    title: 'Release Fenasucro',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    dueDate: '2026-11-13',
    manualPriority: 'high',
    sourceRefs: [{ source: 'outlook', externalId: 'm1', url: 'https://outlook.office.com/x', linkedAt: now.toISOString() }],
  });
  it('embed de pauta com campos, link da fonte e timestamp nativo', () => {
    const e = pautaEmbed(p, { project: 'Feira', appUrl: 'http://localhost:3000' });
    expect(e.title).toBe('Release Fenasucro');
    expect(e.url).toContain(`/pautas?id=${p.id}`);
    expect(e.fields!.find((f) => f.name === 'Prazo')!.value).toMatch(/<t:\d+:D>/);
    expect(e.fields!.find((f) => f.name === 'Fontes')!.value).toContain('outlook.office.com');
    expect(pautaLine(p)).toContain('`0f6c3f6e`');
  });
  it('embed de sugestão com evidência e confiança', () => {
    const s = Sugestao.parse({ id: 's1', title: 'Revisar release', source: 'outlook', confidence: 0.72, evidence: 'Pode revisar até sexta?', createdAt: now.toISOString(), updatedAt: now.toISOString() });
    const e = suggestionEmbed(s);
    expect(e.fields!.find((f) => f.name === 'Confiança')!.value).toBe('72%');
    expect(e.fields!.find((f) => f.name === 'Evidência')!.value).toContain('> Pode revisar');
  });
  it('timestamp do Discord', () => {
    expect(discordTime(new Date(1_700_000_000_000), 'R')).toBe('<t:1700000000:R>');
  });
});

describe('Discord — configuração', () => {
  it('desativado sem token; lê canais e usuários autorizados', () => {
    const saved = { ...process.env };
    process.env.DISCORD_BOT_TOKEN = '';
    process.env.DISCORD_CHANNEL_PAUTAS = '123';
    process.env.DISCORD_ALLOWED_USER_IDS = '1, 2;3';
    const e = resolveDiscordEnv();
    expect(e.enabled).toBe(false);
    expect(e.channels.pautas).toBe('123');
    expect(e.allowedUserIds).toEqual(['1', '2', '3']);
    process.env.DISCORD_BOT_TOKEN = 'abc';
    expect(resolveDiscordEnv().enabled).toBe(true);
    process.env = saved;
  });
});
