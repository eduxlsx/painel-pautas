/**
 * PautaFlow — verificação de integridade (somente leitura).
 * Valida todos os arquivos JSON contra os schemas, sem alterar nada.
 * Uso: npm run check
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z, type ZodType } from 'zod';
import { Bookmark, Categoria, Configuracoes, HistoryEntry, Notificacao, Pauta, Projeto, Resumo, Sugestao, UserProfile } from '@pautaflow/shared';
import { resolveEnv } from '../apps/server/src/env';
import { AutomationFile, CalendarEvent, IntegrationState, MailMessage, MetricSnapshot, PlannerTask, QueueFile, SyncState } from '../apps/server/src/storage/internalSchemas';

const coll = <T>(item: ZodType<T>) => z.object({ version: z.number().optional(), updatedAt: z.string().nullable().optional(), items: z.array(item) });

const FILES: [string, ZodType<unknown>][] = [
  ['users.json', UserProfile],
  ['configuracoes.json', Configuracoes],
  ['pautas.json', coll(Pauta)],
  ['projetos.json', coll(Projeto)],
  ['categorias.json', coll(Categoria)],
  ['sugestoes.json', coll(Sugestao)],
  ['notificacoes.json', coll(Notificacao)],
  ['arquivos.json', coll(Bookmark)],
  ['metricas.json', coll(MetricSnapshot)],
  ['automacoes.json', AutomationFile],
  ['sincronizacao.json', SyncState],
  ['integracoes.json', IntegrationState],
  ['fontes/outlook-mensagens.json', coll(MailMessage)],
  ['fontes/planner-tarefas.json', coll(PlannerTask)],
  ['fontes/calendario-eventos.json', coll(CalendarEvent)],
  ['fila/radar.json', QueueFile],
];

async function check(file: string, schema: ZodType<unknown>): Promise<{ ok: boolean; detail: string }> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return { ok: true, detail: 'ainda não criado' };
  }
  try {
    const json = JSON.parse(raw.replace(/^﻿/, ''));
    const r = schema.safeParse(json);
    if (!r.success) return { ok: false, detail: r.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
    const items = (json as { items?: unknown[] }).items;
    return { ok: true, detail: items ? `${items.length} registro(s)` : 'ok' };
  } catch (err) {
    return { ok: false, detail: `JSON inválido: ${(err as Error).message}` };
  }
}

const env = resolveEnv();
let failures = 0;
console.log(`\nPautaFlow — verificação de integridade\nDados: ${env.dataDir}\n`);
for (const [rel, schema] of FILES) {
  const r = await check(path.join(env.dataDir, rel), schema);
  if (!r.ok) failures++;
  console.log(`${r.ok ? '  ✓' : '  ✗'} ${rel.padEnd(34)} ${r.detail}`);
}
for (const [dir, schema] of [['historico', HistoryEntry], ['resumos', Resumo]] as const) {
  let shards: string[] = [];
  try {
    shards = (await fs.readdir(path.join(env.dataDir, dir))).filter((f) => /^\d{4}-\d{2}\.json$/.test(f));
  } catch {
    /* sem partições */
  }
  for (const s of shards) {
    const r = await check(path.join(env.dataDir, dir, s), coll(schema as ZodType<unknown>));
    if (!r.ok) failures++;
    console.log(`${r.ok ? '  ✓' : '  ✗'} ${`${dir}/${s}`.padEnd(34)} ${r.detail}`);
  }
}
const quarantined = (await fs.readdir(env.dataDir).catch(() => [] as string[])).filter((f) => f.includes('.corrupt-'));
if (quarantined.length) console.log(`\n  ! ${quarantined.length} arquivo(s) em quarentena (.corrupt-*) — recuperados automaticamente anteriormente.`);
let backups: string[] = [];
try {
  backups = (await fs.readdir(env.backupsDir)).sort();
} catch {
  /* sem backups */
}
console.log(`\n  Backups: ${backups.length}${backups.length ? ` (mais recente: ${backups.at(-1)})` : ''}`);
console.log(failures ? `\n  ${failures} problema(s) encontrado(s). O servidor tenta recuperar automaticamente a partir de .bak/backups ao iniciar.\n` : '\n  Todos os arquivos estão íntegros.\n');
process.exit(failures ? 1 : 0);
