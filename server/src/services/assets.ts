import fs from 'node:fs/promises';
import path from 'node:path';
import { and, desc, eq, inArray, like, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Asset, AssetSource, MediaKind, Page } from '@imagination/shared';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import type { AssetRow } from '../db/schema.js';
import { driverFor, primaryStorage, localStorage, r2Storage } from '../storage/index.js';
import { extForMime, kindForMime, newId, notFound, sniffMime, badRequest } from '../lib/util.js';
import { imageSize, makeThumb } from '../media/image.js';
import { extractFrame, probeVideo } from '../media/ffmpeg.js';
import { publish } from './events.js';

export function toAssetDto(row: AssetRow): Asset {
  return {
    id: row.id,
    kind: row.kind,
    source: row.source,
    name: row.name,
    mime: row.mime,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    sizeBytes: row.sizeBytes,
    prompt: row.prompt,
    generationId: row.generationId,
    provider: row.provider,
    model: row.model,
    favorite: row.favorite,
    storage: row.storageDriver,
    createdAt: row.createdAt,
    url: `/api/assets/${row.id}/file`,
    thumbUrl: `/api/assets/${row.id}/thumb`,
  };
}

export interface IngestOptions {
  buffer: Buffer;
  mime?: string | null;
  source: AssetSource;
  name?: string | null;
  prompt?: string | null;
  generationId?: string | null;
  provider?: string | null;
  model?: string | null;
}

/** Store a file (upload, generation output or derived media), create its thumbnail and DB row. */
export async function ingestAsset(opts: IngestOptions): Promise<Asset> {
  const sniffed = sniffMime(opts.buffer);
  const mime = sniffed ?? (opts.mime && kindForMime(opts.mime) ? opts.mime : null);
  if (!mime) throw badRequest('Unsupported file type — only images and videos are accepted');
  const kind = kindForMime(mime)!;
  const id = newId();
  const now = new Date();
  const key = `${kind}s/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${id}.${extForMime(mime)}`;

  let width: number | null = null;
  let height: number | null = null;
  let durationMs: number | null = null;
  let thumb: Buffer | null = null;

  if (kind === 'image') {
    ({ width, height } = await imageSize(opts.buffer));
    thumb = await makeThumb(opts.buffer).catch(() => null);
  } else {
    const tmp = path.join(config.tmpDir, `${id}.${extForMime(mime)}`);
    await fs.writeFile(tmp, opts.buffer);
    try {
      const probe = await probeVideo(tmp).catch(() => null);
      if (probe) ({ width, height, durationMs } = probe);
      const at = durationMs ? Math.min(1, durationMs / 2000) : 0;
      const frame = await extractFrame(tmp, at).catch(() => null);
      if (frame?.length) thumb = await makeThumb(frame).catch(() => null);
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }

  await primaryStorage.put(key, opts.buffer, mime);
  if (thumb) await fs.writeFile(thumbPath(id), thumb);

  const row: AssetRow = {
    id,
    kind,
    source: opts.source,
    name: opts.name ?? null,
    storageDriver: primaryStorage.name,
    storageKey: key,
    mime,
    width,
    height,
    durationMs,
    sizeBytes: opts.buffer.length,
    prompt: opts.prompt ?? null,
    generationId: opts.generationId ?? null,
    provider: opts.provider ?? null,
    model: opts.model ?? null,
    favorite: false,
    createdAt: Date.now(),
  };
  db.insert(schema.assets).values(row).run();
  const dto = toAssetDto(row);
  publish({ type: 'asset', data: dto });
  return dto;
}

export function thumbPath(id: string) {
  return path.join(config.thumbsDir, `${id}.webp`);
}

export function getAssetRow(id: string): AssetRow {
  const row = db.select().from(schema.assets).where(eq(schema.assets.id, id)).get();
  if (!row) throw notFound('Asset');
  return row;
}

export function getAssetRows(ids: string[]): AssetRow[] {
  if (!ids.length) return [];
  const rows = db.select().from(schema.assets).where(inArray(schema.assets.id, ids)).all();
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is AssetRow => Boolean(r));
}

export function readAsset(row: AssetRow): Promise<Buffer> {
  return driverFor(row.storageDriver).get(row.storageKey);
}

/** Thumbnails live in a local cache; rebuild one if it was cleared. */
export async function ensureThumb(row: AssetRow): Promise<string | null> {
  const file = thumbPath(row.id);
  try {
    await fs.access(file);
    return file;
  } catch {
    /* regenerate */
  }
  try {
    const buf = await readAsset(row);
    let thumb: Buffer;
    if (row.kind === 'image') thumb = await makeThumb(buf);
    else {
      const tmp = path.join(config.tmpDir, `${row.id}-thumb.${extForMime(row.mime)}`);
      await fs.writeFile(tmp, buf);
      try {
        thumb = await makeThumb(await extractFrame(tmp, 0.5));
      } finally {
        await fs.rm(tmp, { force: true });
      }
    }
    await fs.writeFile(file, thumb);
    return file;
  } catch {
    return null;
  }
}

export interface ListAssetsQuery {
  kind?: MediaKind;
  source?: AssetSource;
  favorite?: boolean;
  q?: string;
  provider?: string;
  cursor?: string;
  limit?: number;
}

export function listAssets(query: ListAssetsQuery): Page<Asset> {
  const limit = Math.min(Math.max(query.limit ?? 60, 1), 200);
  const conds: SQL[] = [];
  const a = schema.assets;
  if (query.kind) conds.push(eq(a.kind, query.kind));
  if (query.source) conds.push(eq(a.source, query.source));
  if (query.favorite) conds.push(eq(a.favorite, true));
  if (query.provider) conds.push(eq(a.provider, query.provider));
  if (query.q) {
    const pattern = `%${query.q.replace(/[%_]/g, '')}%`;
    conds.push(or(like(a.prompt, pattern), like(a.name, pattern))!);
  }
  if (query.cursor) {
    const sep = query.cursor.indexOf('_');
    const ts = Number(query.cursor.slice(0, sep));
    const id = query.cursor.slice(sep + 1);
    conds.push(or(lt(a.createdAt, ts), and(eq(a.createdAt, ts), lt(a.id, id)))!);
  }
  const rows = db
    .select()
    .from(a)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(a.createdAt), desc(a.id))
    .limit(limit + 1)
    .all();
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items: items.map(toAssetDto), nextCursor: hasMore && last ? `${last.createdAt}_${last.id}` : null };
}

export function updateAsset(id: string, patch: { favorite?: boolean; name?: string | null }): Asset {
  getAssetRow(id);
  const values: Partial<AssetRow> = {};
  if (patch.favorite !== undefined) values.favorite = patch.favorite;
  if (patch.name !== undefined) values.name = patch.name;
  if (Object.keys(values).length) db.update(schema.assets).set(values).where(eq(schema.assets.id, id)).run();
  const dto = toAssetDto(getAssetRow(id));
  publish({ type: 'asset', data: dto });
  return dto;
}

export async function deleteAsset(id: string): Promise<void> {
  const row = getAssetRow(id);
  await driverFor(row.storageDriver).delete(row.storageKey).catch(() => undefined);
  // Provider-friendly copy uploaded when the image was used as an input (see providers/inputs.ts).
  if (r2Storage && row.kind === 'image') await r2Storage.delete(`provider-inputs/${id}.jpg`).catch(() => undefined);
  await fs.rm(thumbPath(id), { force: true });
  db.update(schema.characters).set({ coverAssetId: null }).where(eq(schema.characters.coverAssetId, id)).run();
  db.delete(schema.assets).where(eq(schema.assets.id, id)).run();
  publish({ type: 'asset-deleted', id });
}

export function assetCounts() {
  const a = schema.assets;
  const row = db
    .select({
      total: sql<number>`count(*)`,
      images: sql<number>`sum(case when ${a.kind} = 'image' then 1 else 0 end)`,
      videos: sql<number>`sum(case when ${a.kind} = 'video' then 1 else 0 end)`,
      local: sql<number>`sum(case when ${a.storageDriver} = 'local' then 1 else 0 end)`,
    })
    .from(a)
    .get();
  return { total: row?.total ?? 0, images: row?.images ?? 0, videos: row?.videos ?? 0, local: row?.local ?? 0 };
}

/** Copy every locally stored original into R2 and switch the asset over. */
export async function migrateLocalToR2(onProgress?: (done: number, total: number) => void) {
  if (!r2Storage) throw badRequest('R2 is not configured');
  const rows = db.select().from(schema.assets).where(eq(schema.assets.storageDriver, 'local')).all();
  let done = 0;
  const failed: string[] = [];
  for (const row of rows) {
    try {
      const buf = await localStorage.get(row.storageKey);
      await r2Storage.put(row.storageKey, buf, row.mime);
      db.update(schema.assets).set({ storageDriver: 'r2' }).where(eq(schema.assets.id, row.id)).run();
      await localStorage.delete(row.storageKey);
    } catch {
      failed.push(row.id);
    }
    onProgress?.(++done, rows.length);
  }
  return { moved: rows.length - failed.length, failed };
}
