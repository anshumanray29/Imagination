import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, '../..');

dotenv.config({ path: path.join(ROOT_DIR, '.env'), quiet: true });

const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optional = () => z.preprocess(blankToUndefined, z.string().trim().optional());
const bool = (def: boolean) =>
  z.preprocess((v) => {
    const s = blankToUndefined(v);
    if (s === undefined) return def;
    return ['1', 'true', 'yes', 'on'].includes(String(s).toLowerCase());
  }, z.boolean());

const schema = z.object({
  HOST: z.preprocess(blankToUndefined, z.string().default('127.0.0.1')),
  PORT: z.preprocess(blankToUndefined, z.coerce.number().int().default(8787)),
  DATA_DIR: z.preprocess(blankToUndefined, z.string().default('./data')),
  MAX_CONCURRENT_JOBS: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).default(4)),

  STORAGE_DRIVER: z.preprocess(blankToUndefined, z.enum(['auto', 'local', 'r2']).default('auto')),
  R2_ACCOUNT_ID: optional(),
  R2_ACCESS_KEY_ID: optional(),
  R2_SECRET_ACCESS_KEY: optional(),
  R2_BUCKET: optional(),
  R2_PREFIX: optional(),
  /** Optional: any S3-compatible endpoint instead of Cloudflare (e.g. MinIO). */
  R2_ENDPOINT: optional(),

  GEMINI_API_KEY: optional(),
  GEMINI_TEXT_MODEL: z.preprocess(blankToUndefined, z.string().default('gemini-3.5-flash-lite')),
  GEMINI_BASE_URL: z.preprocess(blankToUndefined, z.string().default('https://generativelanguage.googleapis.com/v1beta')),

  XAI_API_KEY: optional(),
  XAI_TEXT_MODEL: z.preprocess(blankToUndefined, z.string().default('grok-4.7')),
  XAI_BASE_URL: z.preprocess(blankToUndefined, z.string().default('https://api.x.ai/v1')),

  OPENAI_API_KEY: optional(),
  OPENAI_BASE_URL: z.preprocess(blankToUndefined, z.string().default('https://api.openai.com/v1')),

  DASHSCOPE_API_KEY: optional(),
  DASHSCOPE_BASE_URL: z.preprocess(blankToUndefined, z.string().default('https://dashscope-intl.aliyuncs.com/api/v1')),
  DASHSCOPE_TEXT_MODEL: z.preprocess(blankToUndefined, z.string().default('qwen-plus')),
  DASHSCOPE_VISION_MODEL: z.preprocess(blankToUndefined, z.string().default('qwen-vl-max')),

  ENABLE_MOCK_PROVIDER: bool(true),

  FFMPEG_PATH: optional(),
  FFPROBE_PATH: optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid configuration in .env:');
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

const env = parsed.data;
const dataDir = path.resolve(ROOT_DIR, env.DATA_DIR);

const r2Configured = Boolean(
  (env.R2_ACCOUNT_ID || env.R2_ENDPOINT) && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET,
);
if (env.STORAGE_DRIVER === 'r2' && !r2Configured) {
  console.error('STORAGE_DRIVER=r2 but R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET are not all set.');
  process.exit(1);
}

export const config = {
  ...env,
  dataDir,
  dbPath: path.join(dataDir, 'imagination.db'),
  localStorageDir: path.join(dataDir, 'storage'),
  thumbsDir: path.join(dataDir, 'cache', 'thumbs'),
  tmpDir: path.join(dataDir, 'tmp'),
  webDistDir: path.join(ROOT_DIR, 'web', 'dist'),
  storageDriver: (env.STORAGE_DRIVER === 'local' ? 'local' : env.STORAGE_DRIVER === 'r2' || r2Configured ? 'r2' : 'local') as
    | 'local'
    | 'r2',
  r2Configured,
  r2Prefix: env.R2_PREFIX ? env.R2_PREFIX.replace(/^\/+/, '').replace(/\/?$/, '/') : '',
};

for (const dir of [config.dataDir, config.localStorageDir, config.thumbsDir, config.tmpDir]) {
  fs.mkdirSync(dir, { recursive: true });
}
