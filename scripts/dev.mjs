// Desenvolvimento: servidor (tsx watch, porta 3000) + interface (Vite, porta 5173) juntos.
import { spawn } from 'node:child_process';

const procs = [
  ['server', ['run', 'dev', '-w', '@pautaflow/server']],
  ['web', ['run', 'dev', '-w', '@pautaflow/web']],
].map(([name, args]) => {
  const p = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const tag = name === 'server' ? '\x1b[36m[server]\x1b[0m' : '\x1b[35m[web]\x1b[0m';
  for (const s of [p.stdout, p.stderr]) s.on('data', (d) => process.stdout.write(String(d).replace(/^/gm, `${tag} `)));
  p.on('exit', (code) => {
    console.log(`${tag} encerrado (${code})`);
    shutdown();
  });
  return p;
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  for (const p of procs) if (!p.killed) p.kill();
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
