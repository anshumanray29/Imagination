import fs from 'node:fs';
import { spawn } from 'node:child_process';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { config } from './config.js';
import { runMigrations } from './db/index.js';
import { worker } from './jobs/worker.js';
import { HttpError } from './lib/util.js';
import { ffmpegVersion } from './media/ffmpeg.js';
import { providers } from './providers/registry.js';
import { apiRoutes } from './routes/api.js';

runMigrations();

const app = Fastify({
  logger: { level: 'warn' },
  bodyLimit: 60 * 1024 * 1024,
});

await app.register(multipart, { limits: { fileSize: 1024 * 1024 * 1024, files: 50 } });

// Serves locally stored originals (with Range support for video seeking) via reply.sendFile().
await app.register(fastifyStatic, { root: config.localStorageDir, serve: false });

const hasWebBuild = fs.existsSync(config.webDistDir);
if (hasWebBuild) {
  // Missing paths fall through to the not-found handler below, which serves the SPA's index.html.
  await app.register(fastifyStatic, { root: config.webDistDir, prefix: '/', decorateReply: false });
}

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ZodError) {
    return reply.code(400).send({ error: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') });
  }
  if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
  const status = (err as { statusCode?: number }).statusCode;
  if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
  console.error(err);
  return reply.code(500).send({ error: (err as Error).message || 'Internal error' });
});

await app.register(apiRoutes);

app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/') || !hasWebBuild) return reply.code(404).send({ error: 'Not found' });
  // Single-page app: let the client-side router handle the path.
  return reply.sendFile('index.html', config.webDistDir);
});

await app.listen({ host: config.HOST, port: config.PORT });
worker.start();

const ff = await ffmpegVersion();
const configured = providers().filter((p) => p.isConfigured()).map((p) => p.name);
console.log(`
  ┌─────────────────────────────────────────────┐
  │  IMG · Imagination                          │
  └─────────────────────────────────────────────┘
  API        http://${config.HOST}:${config.PORT}${hasWebBuild ? `   (app UI served here too)` : ''}
  Storage    ${config.storageDriver === 'r2' ? `Cloudflare R2 → ${config.R2_BUCKET}` : `local → ${config.localStorageDir}`}
  Providers  ${configured.length ? configured.join(', ') : 'none configured — add keys to .env'}
  ffmpeg     ${ff ?? 'NOT FOUND (video thumbnails, frames and stitching disabled)'}
`);

if (process.env.OPEN_BROWSER === '1' && hasWebBuild) {
  const url = `http://${config.HOST}:${config.PORT}`;
  const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(opener[0] as string, opener[1] as string[], { stdio: 'ignore', detached: true, windowsHide: true }).unref();
}

const shutdown = async () => {
  worker.stop();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
