import { describe, expect, it } from 'vitest';
import { JobState } from '@pautaflow/shared';
import { computeNextRun } from '../src/automation/scheduler';
import type { JobDef } from '../src/automation/jobs';
// @ts-expect-error módulo JS sem tipos
import { bump, classifyCommit } from '../../../scripts/versioning.mjs';

const daily = (time: string): JobDef => ({
  id: 'd', name: 'd', description: '', schedule: { kind: 'daily', time: () => time }, describe: () => '', available: async () => true, run: async () => ({ processed: 0, message: '' }),
});
const interval = (min: number): JobDef => ({
  id: 'i', name: 'i', description: '', schedule: { kind: 'interval', minutes: () => min }, describe: () => '', available: async () => true, run: async () => ({ processed: 0, message: '' }),
});

describe('computeNextRun', () => {
  const now = new Date(2026, 10, 10, 9, 30);
  it('intervalo: executa imediatamente na primeira vez e depois a cada N minutos', () => {
    expect(computeNextRun(interval(5), JobState.parse({ id: 'i' }), now)).toEqual(now);
    const st = JobState.parse({ id: 'i', lastRunAt: new Date(2026, 10, 10, 9, 28).toISOString() });
    expect(computeNextRun(interval(5), st, now).getMinutes()).toBe(33);
  });
  it('diário: recupera execução perdida (PC desligado no horário)', () => {
    const st = JobState.parse({ id: 'd', lastRunAt: new Date(2026, 10, 9, 8, 0).toISOString() });
    expect(computeNextRun(daily('08:00'), st, now)).toEqual(now);
  });
  it('diário: já executado hoje → amanhã', () => {
    const st = JobState.parse({ id: 'd', lastRunAt: new Date(2026, 10, 10, 8, 1).toISOString() });
    const next = computeNextRun(daily('08:00'), st, now);
    expect(next.getDate()).toBe(11);
    expect(next.getHours()).toBe(8);
  });
  it('backoff após falhas consecutivas', () => {
    const st = JobState.parse({ id: 'i', lastRunAt: now.toISOString(), consecutiveErrors: 3 });
    expect(computeNextRun(interval(1), st, now).getTime() - now.getTime()).toBe(8 * 60_000);
  });
});

describe('versionamento X.Y.Z', () => {
  it('X = função nova, Y = correção, Z = visual', () => {
    expect(bump('1.4.2', 'feature')).toBe('2.0.0');
    expect(bump('1.4.2', 'fix')).toBe('1.5.0');
    expect(bump('1.4.2', 'visual')).toBe('1.4.3');
  });
  it('classifica mensagens de commit', () => {
    expect(classifyCommit('feat: radar de prazos')).toBe('feature');
    expect(classifyCommit('fix(radar): corrige data')).toBe('fix');
    expect(classifyCommit('style: ajusta sombra dos cards')).toBe('visual');
    expect(classifyCommit('corrige cálculo do score')).toBe('fix');
    expect(classifyCommit('docs: README')).toBeNull();
    expect(classifyCommit('Ajustes gerais [visual]')).toBe('visual');
    expect(classifyCommit('feat: x [skip-version]')).toBeNull();
  });
});
