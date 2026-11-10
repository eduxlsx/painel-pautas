// PautaFlow — versionamento semântico próprio:  X.Y.Z
//   X → funções novas (feature)        ex.: 1.4.2 → 2.0.0
//   Y → correções das funções atuais   ex.: 1.4.2 → 1.5.0
//   Z → correções visuais              ex.: 1.4.2 → 1.4.3
// Sem dependências: usado pelo hook de commit (node puro) e pelo servidor.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG_FILES = ['package.json', 'apps/server/package.json', 'apps/web/package.json', 'packages/shared/package.json'];
const HISTORY = path.join(ROOT, 'version-history.json');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');

/** @typedef {'feature'|'fix'|'visual'} BumpType */

const TYPE_LABEL = { feature: 'Função nova', fix: 'Correção', visual: 'Ajuste visual', manual: 'Definida manualmente' };

function writeAtomic(file, content) {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}

export function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim());
  if (!m) throw new Error(`Versão inválida: "${v}" (use o formato X.Y.Z)`);
  return { features: Number(m[1]), fixes: Number(m[2]), visual: Number(m[3]) };
}

export function formatVersion(p) {
  return `${p.features}.${p.fixes}.${p.visual}`;
}

/** @param {string} v @param {BumpType} type */
export function bump(v, type) {
  const p = parseVersion(v);
  if (type === 'feature') return formatVersion({ features: p.features + 1, fixes: 0, visual: 0 });
  if (type === 'fix') return formatVersion({ features: p.features, fixes: p.fixes + 1, visual: 0 });
  if (type === 'visual') return formatVersion({ features: p.features, fixes: p.fixes, visual: p.visual + 1 });
  throw new Error(`Tipo de alteração desconhecido: ${type}`);
}

/**
 * Classifica a mensagem de commit.
 * Marcadores explícitos têm precedência: [feature] [fix] [visual] [skip-version]
 * Prefixos aceitos (estilo Conventional Commits, em inglês ou português):
 *   feat/feature/novo/nova/add           → feature
 *   fix/corrige/correcao/bug/perf/refactor → fix
 *   style/ui/visual/design/css/layout    → visual
 *   docs/chore/test/build/ci/release     → sem alteração de versão
 * @returns {BumpType|null}
 */
export function classifyCommit(message) {
  const msg = String(message).toLowerCase();
  if (/\[(skip-version|no-version|sem-versao)\]/.test(msg)) return null;
  if (/\[(feature|feat|nova-funcao)\]/.test(msg)) return 'feature';
  if (/\[(fix|correcao|correção)\]/.test(msg)) return 'fix';
  if (/\[(visual|style|ui)\]/.test(msg)) return 'visual';
  const first = msg.split('\n')[0].trim();
  const m = /^([a-zçãé-]+)(\([^)]*\))?!?:/.exec(first);
  const type = m?.[1] ?? first.split(/\s+/)[0];
  if (/^(feat|feature|novo|nova|add|adiciona)$/.test(type)) return 'feature';
  if (/^(fix|bugfix|hotfix|corrige|correcao|correção|bug|perf|refactor)$/.test(type)) return 'fix';
  if (/^(style|ui|visual|design|css|layout|estilo)$/.test(type)) return 'visual';
  return null;
}

export function readVersion() {
  return JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
}

export function readHistory() {
  if (!existsSync(HISTORY)) return [];
  try {
    return JSON.parse(readFileSync(HISTORY, 'utf8'));
  } catch {
    return [];
  }
}

function writeVersion(version) {
  for (const rel of PKG_FILES) {
    const file = path.join(ROOT, rel);
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    pkg.version = version;
    writeAtomic(file, JSON.stringify(pkg, null, 2) + '\n');
  }
}

function renderChangelog(history) {
  const lines = ['# Changelog — PautaFlow Intelligence', '', 'Formato **X.Y.Z** — X: funções novas · Y: correções · Z: ajustes visuais.', ''];
  for (const h of [...history].reverse()) {
    lines.push(`## ${h.version} — ${h.date.slice(0, 10)}`, '', `- **${TYPE_LABEL[h.type] ?? h.type}:** ${h.message}${h.commit ? ` (\`${h.commit.slice(0, 7)}\`)` : ''}`, '');
  }
  return lines.join('\n');
}

/**
 * Aplica uma nova versão: package.json (raiz e workspaces), histórico e CHANGELOG.
 * @param {{ type: BumpType|'manual', version?: string, message: string, commit?: string|null }} opts
 */
export function applyVersion(opts) {
  const current = readVersion();
  const next = opts.type === 'manual' ? formatVersion(parseVersion(opts.version)) : bump(current, opts.type);
  writeVersion(next);
  const history = readHistory();
  history.push({ version: next, previous: current, date: new Date().toISOString(), type: opts.type, message: opts.message.split('\n')[0].slice(0, 200), commit: opts.commit ?? null });
  writeAtomic(HISTORY, JSON.stringify(history, null, 2) + '\n');
  writeAtomic(CHANGELOG, renderChangelog(history));
  return { previous: current, version: next };
}

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

/** Executado pelo hook post-commit: classifica o último commit e, se necessário, emenda a versão nele. */
export function autoFromLastCommit() {
  if (process.env.PAUTAFLOW_VERSIONING === '1') return { skipped: 'recursão' };
  const gitDir = git(['rev-parse', '--git-dir']);
  const abs = path.isAbsolute(gitDir) ? gitDir : path.join(ROOT, gitDir);
  for (const marker of ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
    if (existsSync(path.join(abs, marker))) return { skipped: `operação em andamento (${marker})` };
  }
  const message = git(['log', '-1', '--pretty=%B']);
  if (/^Version: \d+\.\d+\.\d+$/m.test(message)) return { skipped: 'commit já versionado' };
  // Versão alterada manualmente neste commit → respeitar
  let changedVersion = false;
  try {
    const d = git(['diff', 'HEAD~1', 'HEAD', '--', 'package.json']);
    changedVersion = /^[+-]\s+"version":/m.test(d);
  } catch {
    changedVersion = false; // primeiro commit
  }
  if (changedVersion) return { skipped: 'versão definida manualmente neste commit' };
  const type = classifyCommit(message);
  if (!type) return { skipped: 'tipo de commit sem alteração de versão' };
  // O hash muda ao emendar o commit; a referência fica no trailer "Version:" da mensagem.
  const res = applyVersion({ type, message, commit: null });
  git(['add', ...PKG_FILES.filter((f) => existsSync(path.join(ROOT, f))), 'version-history.json', 'CHANGELOG.md']);
  const newMsg = `${message.trimEnd()}\n\nVersion: ${res.version}\n`;
  execFileSync('git', ['commit', '--amend', '--no-verify', '-F', '-'], {
    cwd: ROOT,
    input: newMsg,
    env: { ...process.env, PAUTAFLOW_VERSIONING: '1' },
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  return { ...res, type };
}

// CLI: node scripts/versioning.mjs <auto|bump|set|show|install-hooks> [...]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, arg, ...rest] = process.argv.slice(2);
  try {
    if (cmd === 'auto') {
      const r = autoFromLastCommit();
      if (r.version) console.log(`[PautaFlow] versão ${r.previous} → ${r.version} (${TYPE_LABEL[r.type]})`);
    } else if (cmd === 'bump') {
      if (!['feature', 'fix', 'visual'].includes(arg)) throw new Error('Uso: npm run version:bump -- <feature|fix|visual> "mensagem"');
      const r = applyVersion({ type: arg, message: rest.join(' ') || `Atualização manual (${TYPE_LABEL[arg]})` });
      console.log(`Versão ${r.previous} → ${r.version}`);
    } else if (cmd === 'set') {
      const r = applyVersion({ type: 'manual', version: arg, message: rest.join(' ') || 'Versão definida manualmente' });
      console.log(`Versão ${r.previous} → ${r.version}`);
    } else if (cmd === 'install-hooks') {
      git(['config', 'core.hooksPath', '.githooks']);
      console.log('Hooks de versionamento ativados (core.hooksPath = .githooks).');
    } else {
      console.log(`Versão atual: ${readVersion()}`);
    }
  } catch (err) {
    console.error(`[PautaFlow] versionamento: ${err.message}`);
    process.exit(cmd === 'auto' ? 0 : 1); // nunca bloqueia um commit
  }
}
