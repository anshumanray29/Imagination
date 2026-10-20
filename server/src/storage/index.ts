import fs from 'node:fs/promises';
import path from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';

export type DriverName = 'local' | 'r2';

export interface StorageDriver {
  name: DriverName;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Time-limited URL that anyone (incl. AI providers) can fetch. Null when the driver has no public URLs. */
  signedUrl(key: string, opts?: { expiresIn?: number; downloadName?: string }): Promise<string | null>;
}

class LocalStorage implements StorageDriver {
  name = 'local' as const;
  constructor(private root: string) {}

  filePath(key: string) {
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(path.resolve(this.root))) throw new Error('Invalid storage key');
    return resolved;
  }

  async put(key: string, body: Buffer) {
    const file = this.filePath(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
  }

  get(key: string) {
    return fs.readFile(this.filePath(key));
  }

  async delete(key: string) {
    await fs.rm(this.filePath(key), { force: true });
  }

  async signedUrl() {
    return null;
  }
}

class R2Storage implements StorageDriver {
  name = 'r2' as const;
  private client: S3Client;
  private urlCache = new Map<string, { url: string; expires: number }>();

  constructor(
    private bucket: string,
    private prefix: string,
  ) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: config.R2_ENDPOINT ?? `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      forcePathStyle: Boolean(config.R2_ENDPOINT),
      credentials: { accessKeyId: config.R2_ACCESS_KEY_ID!, secretAccessKey: config.R2_SECRET_ACCESS_KEY! },
      // R2 does not support the newer default checksum headers on every operation.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  private k(key: string) {
    return this.prefix + key;
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: this.k(key), Body: body, ContentType: contentType }),
    );
  }

  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.k(key) }));
    if (!res.Body) throw new Error(`Empty object: ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.k(key) }));
    this.urlCache.delete(key);
  }

  async signedUrl(key: string, opts: { expiresIn?: number; downloadName?: string } = {}) {
    const expiresIn = opts.expiresIn ?? 3600;
    // Reuse a signed URL while it is still fresh so the browser can cache the media.
    const cacheable = !opts.downloadName && expiresIn === 3600;
    const cached = cacheable ? this.urlCache.get(key) : undefined;
    if (cached && cached.expires > Date.now() + 10 * 60_000) return cached.url;
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.k(key),
        ResponseContentDisposition: opts.downloadName
          ? `attachment; filename="${opts.downloadName.replace(/"/g, '')}"`
          : undefined,
      }),
      { expiresIn },
    );
    if (cacheable) this.urlCache.set(key, { url, expires: Date.now() + expiresIn * 1000 });
    return url;
  }

  /** Exercise exactly the permissions IMG needs: write, read and delete an object. */
  async check() {
    const key = '.img-healthcheck';
    try {
      await this.put(key, Buffer.from(`ok ${Date.now()}`), 'text/plain');
      await this.get(key);
      await this.delete(key);
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      const hints: Record<number, string> = {
        401: 'R2 rejected the credentials — check R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY',
        403: 'Access denied — the R2 API token needs "Object Read & Write" permission on this bucket',
        404: `Bucket "${this.bucket}" was not found — check R2_BUCKET and R2_ACCOUNT_ID`,
      };
      throw new Error(hints[status ?? 0] ?? `R2 check failed${status ? ` (HTTP ${status})` : ''}: ${(err as Error).message}`);
    }
  }
}

export const localStorage = new LocalStorage(config.localStorageDir);
export const r2Storage = config.r2Configured ? new R2Storage(config.R2_BUCKET!, config.r2Prefix) : null;

/** Driver that new files are written to. */
export const primaryStorage: StorageDriver = config.storageDriver === 'r2' && r2Storage ? r2Storage : localStorage;

export function driverFor(name: DriverName): StorageDriver {
  if (name === 'r2') {
    if (!r2Storage) throw new Error('This file is stored in R2, but R2 is not configured in .env');
    return r2Storage;
  }
  return localStorage;
}

export async function checkR2(): Promise<void> {
  if (!r2Storage) throw new Error('R2 is not configured');
  await r2Storage.check();
}
