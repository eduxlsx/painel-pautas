import path from 'node:path';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import type { AppContext } from './core/context';
import { registerApi, fileExists } from './routes/api';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function hostOk(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]!;
  return LOCAL_HOSTS.has(name);
}

function originOk(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export async function buildApp(ctx: AppContext, opts: { serveWeb?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ loggerInstance: ctx.log.child({ mod: 'http' }) as unknown as FastifyBaseLogger, logController: new LogController({ disableRequestLogging: true }), bodyLimit: 2 * 1024 * 1024 });

  /**
   * Segurança local:
   * - aceita apenas Host local (protege contra DNS rebinding);
   * - rejeita Origin de outros sites;
   * - exige o cabeçalho X-PautaFlow em requisições que alteram dados (bloqueia CSRF via formulários).
   */
  app.addHook('onRequest', async (req, reply) => {
    if (!hostOk(req.headers.host)) return reply.code(403).send({ error: 'Host não permitido' });
    if (!originOk(req.headers.origin)) return reply.code(403).send({ error: 'Origem não permitida' });
    if (req.url.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-pautaflow'] !== '1') {
      return reply.code(403).send({ error: 'Cabeçalho X-PautaFlow ausente' });
    }
  });
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    return payload;
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'Dados inválidos', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (status >= 500) ctx.log.error({ err, url: req.url }, 'Erro na API');
    return reply.code(status).send({ error: err.message || 'Erro interno' });
  });

  registerApi(app, ctx);

  if (opts.serveWeb !== false && (await fileExists(path.join(ctx.env.webDist, 'index.html')))) {
    await app.register(fastifyStatic, { root: ctx.env.webDist, prefix: '/', wildcard: false, maxAge: '1h' });
    // SPA: rotas desconhecidas (fora de /api) retornam o index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Rota não encontrada' });
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    });
  } else {
    app.get('/', async (_req, reply) =>
      reply
        .type('text/html; charset=utf-8')
        .send('<!doctype html><meta charset="utf-8"><title>PautaFlow</title><body style="font-family:system-ui;padding:40px"><h1>PautaFlow Intelligence — API ativa</h1><p>A interface ainda não foi compilada. Execute <code>npm run build</code> e reinicie, ou use <code>npm run dev</code>.</p>'),
    );
  }
  return app;
}
