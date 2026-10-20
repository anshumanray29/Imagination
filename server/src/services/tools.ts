import fs from 'node:fs/promises';
import path from 'node:path';
import type { Asset } from '@imagination/shared';
import { config } from '../config.js';
import { extForMime, newId, badRequest } from '../lib/util.js';
import { concatVideos, extractFrame } from '../media/ffmpeg.js';
import { getAssetRow, getAssetRows, ingestAsset, readAsset } from './assets.js';

async function withTempFile<T>(buffer: Buffer, ext: string, fn: (file: string) => Promise<T>): Promise<T> {
  const file = path.join(config.tmpDir, `${newId()}.${ext}`);
  await fs.writeFile(file, buffer);
  try {
    return await fn(file);
  } finally {
    await fs.rm(file, { force: true });
  }
}

/** Save the first/last (or any) frame of a video as a new image — e.g. to continue a clip. */
export async function extractFrameAsset(assetId: string, at: 'first' | 'last' | number): Promise<Asset> {
  const row = getAssetRow(assetId);
  if (row.kind !== 'video') throw badRequest('Frames can only be extracted from videos');
  const png = await withTempFile(await readAsset(row), extForMime(row.mime), (file) =>
    extractFrame(file, at === 'first' ? 0 : at === 'last' ? 'last' : at),
  );
  if (!png.length) throw new Error('ffmpeg produced no frame');
  const label = at === 'first' ? 'First frame' : at === 'last' ? 'Last frame' : `Frame at ${at}s`;
  return ingestAsset({
    buffer: png,
    mime: 'image/png',
    source: 'derived',
    name: `${label} of ${row.name ?? 'video'}`,
    prompt: row.prompt,
    provider: row.provider,
    model: row.model,
  });
}

/** Join clips in the given order into one video. */
export async function stitchVideos(assetIds: string[]): Promise<Asset> {
  if (assetIds.length < 2) throw badRequest('Pick at least two videos to stitch');
  const rows = getAssetRows(assetIds);
  if (rows.length !== assetIds.length || rows.some((r) => r.kind !== 'video')) throw badRequest('All items must be existing videos');
  const files: string[] = [];
  const out = path.join(config.tmpDir, `${newId()}-stitched.mp4`);
  try {
    for (const r of rows) {
      const f = path.join(config.tmpDir, `${newId()}.${extForMime(r.mime)}`);
      await fs.writeFile(f, await readAsset(r));
      files.push(f);
    }
    await concatVideos(files, out);
    return await ingestAsset({
      buffer: await fs.readFile(out),
      mime: 'video/mp4',
      source: 'derived',
      name: `Stitched (${rows.length} clips)`,
      prompt: rows.map((r) => r.prompt).filter(Boolean).join(' → ') || null,
    });
  } finally {
    await Promise.all([...files, out].map((f) => fs.rm(f, { force: true })));
  }
}
