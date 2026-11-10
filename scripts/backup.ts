/**
 * PautaFlow — backup manual pela linha de comando.
 * Seguro com o servidor em execução: cada arquivo é substituído de forma atômica, então a cópia é consistente por arquivo.
 * Uso: npm run backup
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveEnv } from '../apps/server/src/env';

const env = resolveEnv();
const p = (n: number) => String(n).padStart(2, '0');
const d = new Date();
const id = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-manual`;
const target = path.join(env.backupsDir, id);

let files = 0;
let bytes = 0;
async function copy(src: string, dst: string) {
  await fs.mkdir(dst, { recursive: true });
  for (const e of await fs.readdir(src, { withFileTypes: true })) {
    if (/\.(tmp-.*|corrupt-\d+|bak)$/.test(e.name) || e.name === '.lock') continue;
    const s = path.join(src, e.name);
    const t = path.join(dst, e.name);
    if (e.isDirectory()) await copy(s, t);
    else if (e.isFile()) {
      await fs.copyFile(s, t);
      files++;
      bytes += (await fs.stat(t)).size;
    }
  }
}

await copy(env.dataDir, path.join(target, 'data'));
await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify({ id, createdAt: d.toISOString(), reason: 'manual', files, bytes }, null, 2));
console.log(`Backup criado: ${target} (${files} arquivos, ${(bytes / 1024).toFixed(0)} KB)`);
