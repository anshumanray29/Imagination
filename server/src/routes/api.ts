import path from 'node:path';
import fs from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SystemStatus } from '@imagination/shared';
import { config } from '../config.js';
import { sqlite } from '../db/index.js';
import { worker } from '../jobs/worker.js';
import { badRequest, errorMessage } from '../lib/util.js';
import { ffmpegVersion } from '../media/ffmpeg.js';
import { getProvider, providerInfo } from '../providers/registry.js';
import {
  assetCounts,
  deleteAsset,
  ensureThumb,
  getAssetRow,
  ingestAsset,
  listAssets,
  migrateLocalToR2,
  toAssetDto,
  updateAsset,
} from '../services/assets.js';
import {
  addImages,
  characterCount,
  createCharacter,
  deleteCharacter,
  getCharacter,
  listCharacters,
  removeImage,
  updateCharacter,
} from '../services/characters.js';
import {
  cancelGeneration,
  createGenerations,
  deleteGeneration,
  generationCount,
  getGenerationRow,
  listGenerations,
  retryGeneration,
  spendByProvider,
  toGenerationDto,
} from '../services/generations.js';
import { subscribe } from '../services/events.js';
import { describeCharacter, enhancePrompt, textProviders } from '../services/llm.js';
import { extractFrameAsset, stitchVideos } from '../services/tools.js';
import { checkR2, driverFor, r2Storage } from '../storage/index.js';

const idParam = z.object({ id: z.string().min(1) });

const createGenerationSchema = z.object({
  kind: z.enum(['image', 'video']),
  targets: z
    .array(z.object({ provider: z.string(), model: z.string(), modelOverride: z.string().max(200).optional() }))
    .min(1)
    .max(6),
  prompt: z.string().max(10_000),
  negativePrompt: z.string().max(2000).optional(),
  params: z.object({
    aspectRatio: z.string().optional(),
    resolution: z.string().optional(),
    duration: z.number().int().min(1).max(60).optional(),
    count: z.number().int().min(1).max(4).optional(),
    seed: z.number().int().min(0).max(2147483647).optional(),
    audio: z.boolean().optional(),
    promptExtend: z.boolean().optional(),
    quality: z.string().optional(),
    style: z.string().optional(),
  }),
  inputs: z.array(z.object({ assetId: z.string(), role: z.enum(['source', 'reference', 'first_frame', 'last_frame']) })).max(20),
  characterIds: z.array(z.string()).max(6),
});

export async function apiRoutes(app: FastifyInstance) {
  // ── Providers ──
  app.get('/api/providers', async () => providerInfo());

  app.post('/api/providers/:id/test', async (req) => {
    const { id } = idParam.parse(req.params);
    const provider = getProvider(id);
    if (!provider.isConfigured()) return { ok: false, message: `Not configured — set ${provider.envKeys.join(', ')} in .env` };
    try {
      return { ok: true, message: await provider.test() };
    } catch (err) {
      return { ok: false, message: errorMessage(err) };
    }
  });

  // ── Assets ──
  app.get('/api/assets', async (req) => {
    const q = z
      .object({
        kind: z.enum(['image', 'video']).optional(),
        source: z.enum(['upload', 'generated', 'derived']).optional(),
        favorite: z.enum(['1', 'true']).optional(),
        q: z.string().optional(),
        provider: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().optional(),
      })
      .parse(req.query);
    return listAssets({ ...q, favorite: Boolean(q.favorite) });
  });

  app.get('/api/assets/:id', async (req) => toAssetDto(getAssetRow(idParam.parse(req.params).id)));

  app.post('/api/assets/upload', async (req) => {
    const created = [];
    for await (const part of req.files()) {
      const buffer = await part.toBuffer();
      created.push(await ingestAsset({ buffer, mime: part.mimetype, source: 'upload', name: part.filename }));
    }
    if (!created.length) throw badRequest('No files received');
    return created;
  });

  app.patch('/api/assets/:id', async (req) => {
    const body = z.object({ favorite: z.boolean().optional(), name: z.string().max(200).nullable().optional() }).parse(req.body);
    return updateAsset(idParam.parse(req.params).id, body);
  });

  app.delete('/api/assets/:id', async (req) => {
    await deleteAsset(idParam.parse(req.params).id);
    return { ok: true };
  });

  app.post('/api/assets/bulk-delete', async (req) => {
    const { ids } = z.object({ ids: z.array(z.string()).min(1).max(500) }).parse(req.body);
    for (const id of ids) await deleteAsset(id).catch(() => undefined);
    return { ok: true };
  });

  app.get('/api/assets/:id/file', async (req, reply) => {
    const row = getAssetRow(idParam.parse(req.params).id);
    const download = (req.query as Record<string, string>).download === '1';
    const filename = `${(row.name ?? row.id).replace(/[^\w.\- ]+/g, '_').replace(/\.[a-z0-9]+$/i, '')}.${row.storageKey.split('.').pop()}`;
    if (row.storageDriver === 'r2') {
      const url = await driverFor('r2').signedUrl(row.storageKey, download ? { downloadName: filename } : undefined);
      return reply.redirect(url!, 302);
    }
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    if (download) reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.sendFile(row.storageKey, config.localStorageDir);
  });

  app.get('/api/assets/:id/thumb', async (req, reply) => {
    const row = getAssetRow(idParam.parse(req.params).id);
    const file = await ensureThumb(row);
    if (!file) return row.kind === 'image' ? reply.redirect(`/api/assets/${row.id}/file`, 302) : reply.code(404).send();
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    return reply.sendFile(path.basename(file), config.thumbsDir);
  });

  // ── Generations ──
  app.post('/api/generations', async (req) => {
    const body = createGenerationSchema.parse(req.body);
    const created = createGenerations(body);
    worker.wake();
    return created;
  });

  app.get('/api/generations', async (req) => {
    const q = z
      .object({
        status: z.string().optional(),
        active: z.enum(['1', 'true']).optional(),
        batchId: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().optional(),
      })
      .parse(req.query);
    return listGenerations({ ...q, active: Boolean(q.active) });
  });

  app.get('/api/generations/:id', async (req) => toGenerationDto(getGenerationRow(idParam.parse(req.params).id)));

  app.post('/api/generations/:id/cancel', async (req) => {
    const { id } = idParam.parse(req.params);
    const result = cancelGeneration(id);
    worker.abort(id);
    return result;
  });

  app.post('/api/generations/:id/retry', async (req) => {
    const result = retryGeneration(idParam.parse(req.params).id);
    worker.wake();
    return result;
  });

  app.delete('/api/generations/:id', async (req) => {
    deleteGeneration(idParam.parse(req.params).id);
    return { ok: true };
  });

  // ── Characters ──
  app.get('/api/characters', async () => listCharacters());
  app.get('/api/characters/:id', async (req) => getCharacter(idParam.parse(req.params).id));

  app.post('/api/characters', async (req) => {
    const body = z
      .object({ name: z.string().min(1).max(100), description: z.string().max(4000).optional(), assetIds: z.array(z.string()).optional() })
      .parse(req.body);
    return createCharacter(body);
  });

  app.patch('/api/characters/:id', async (req) => {
    const body = z
      .object({ name: z.string().max(100).optional(), description: z.string().max(4000).optional(), coverAssetId: z.string().nullable().optional() })
      .parse(req.body);
    return updateCharacter(idParam.parse(req.params).id, body);
  });

  app.delete('/api/characters/:id', async (req) => {
    deleteCharacter(idParam.parse(req.params).id);
    return { ok: true };
  });

  app.post('/api/characters/:id/images', async (req) => {
    const { assetIds } = z.object({ assetIds: z.array(z.string()).min(1).max(50) }).parse(req.body);
    return addImages(idParam.parse(req.params).id, assetIds);
  });

  app.delete('/api/characters/:id/images/:assetId', async (req) => {
    const { id, assetId } = z.object({ id: z.string(), assetId: z.string() }).parse(req.params);
    return removeImage(id, assetId);
  });

  // ── AI + media tools ──
  app.post('/api/tools/enhance-prompt', async (req) => {
    const body = z.object({ prompt: z.string().max(10_000), kind: z.enum(['image', 'video']), provider: z.string().optional() }).parse(req.body);
    return enhancePrompt(body.prompt, body.kind, body.provider);
  });

  app.post('/api/tools/describe-character', async (req) => {
    const body = z.object({ assetIds: z.array(z.string()).min(1).max(10), provider: z.string().optional() }).parse(req.body);
    return describeCharacter(body.assetIds, body.provider);
  });

  app.post('/api/tools/extract-frame', async (req) => {
    const body = z.object({ assetId: z.string(), at: z.union([z.enum(['first', 'last']), z.number().min(0)]) }).parse(req.body);
    return extractFrameAsset(body.assetId, body.at);
  });

  app.post('/api/tools/stitch', async (req) => {
    const body = z.object({ assetIds: z.array(z.string()).min(2).max(30) }).parse(req.body);
    return stitchVideos(body.assetIds);
  });

  // ── System ──
  app.get('/api/system/status', async (): Promise<SystemStatus> => {
    const counts = assetCounts();
    const version = await ffmpegVersion();
    return {
      storage: { driver: config.storageDriver, bucket: config.storageDriver === 'r2' ? (config.R2_BUCKET ?? null) : null, localPath: config.localStorageDir },
      ffmpeg: { available: Boolean(version), version },
      textProviders: textProviders(),
      counts: {
        assets: counts.total,
        images: counts.images,
        videos: counts.videos,
        localAssets: counts.local,
        generations: generationCount(),
        characters: characterCount(),
      },
      spend: spendByProvider(),
    };
  });

  app.post('/api/system/test-storage', async () => {
    if (!r2Storage) return { ok: true, message: `Using local storage at ${config.localStorageDir}` };
    try {
      await checkR2();
      return { ok: true, message: `Connected to R2 bucket "${config.R2_BUCKET}"` };
    } catch (err) {
      return { ok: false, message: errorMessage(err) };
    }
  });

  app.post('/api/system/migrate-to-r2', async () => migrateLocalToR2());

  app.post('/api/system/backup', async () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = `imagination-${stamp}.db`;
    const localDir = path.join(config.dataDir, 'backups');
    await fs.mkdir(localDir, { recursive: true });
    const file = path.join(localDir, name);
    await sqlite.backup(file);
    if (r2Storage) {
      await r2Storage.put(`backups/${name}`, await fs.readFile(file), 'application/vnd.sqlite3');
      return { ok: true, message: `Database backed up to R2: backups/${name} (local copy in ${localDir})` };
    }
    return { ok: true, message: `Database backed up to ${file}` };
  });

  // ── Live events (Server-Sent Events) ──
  app.get('/api/events', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': connected\n\n');
    const unsubscribe = subscribe((event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
