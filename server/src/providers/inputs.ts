import type { AssetRow } from '../db/schema.js';
import { normalizeImage, type NormalizeOptions } from '../media/image.js';
import { readAsset } from '../services/assets.js';
import { r2Storage } from '../storage/index.js';
import type { InputImage } from './types.js';

/** R2 key of the provider-friendly copy of an asset (JPEG, ≤2048 px), shared by all jobs. */
export const providerCopyKey = (assetId: string) => `provider-inputs/${assetId}.jpg`;
const uploaded = new Set<string>();

export function makeInputImage(row: AssetRow): InputImage {
  if (row.kind !== 'image') throw new Error('Only images can be used as generation inputs');
  let raw: Promise<Buffer> | null = null;
  const normalized = new Map<string, Promise<{ buffer: Buffer; mime: string }>>();

  const buffer = () => (raw ??= readAsset(row));
  const normalize = (opts: NormalizeOptions = {}) => {
    const key = JSON.stringify(opts);
    let p = normalized.get(key);
    if (!p) {
      p = buffer().then((b) => normalizeImage(b, opts));
      normalized.set(key, p);
    }
    return p;
  };

  const self: InputImage = {
    assetId: row.id,
    buffer,
    async base64(opts) {
      const n = await normalize(opts);
      return { data: n.buffer.toString('base64'), mime: n.mime };
    },
    async dataUri(opts) {
      const n = await normalize(opts);
      return `data:${n.mime};base64,${n.buffer.toString('base64')}`;
    },
    async url(opts) {
      if (!r2Storage) return self.dataUri(opts);
      const key = providerCopyKey(row.id);
      if (!uploaded.has(key)) {
        const n = await normalize({ maxSide: 2048, format: 'jpeg' });
        await r2Storage.put(key, n.buffer, n.mime);
        uploaded.add(key);
      }
      const url = await r2Storage.signedUrl(key, { expiresIn: 6 * 3600 });
      return url!;
    },
  };
  return self;
}
