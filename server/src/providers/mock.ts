import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';
import { makeTestVideo } from '../media/ffmpeg.js';
import { MOCK_MODELS } from './catalog.js';
import type { JobContext, PollResult, ProviderAdapter, ProviderOutput } from './types.js';

const RUN_MS = 5000;

function dims(ratio: string | undefined, long: number): { width: number; height: number } {
  const [w, h] = (ratio && ratio.includes(':') ? ratio : '1:1').split(':').map(Number);
  const r = (w || 1) / (h || 1);
  const even = (n: number) => Math.round(n / 2) * 2;
  return r >= 1 ? { width: long, height: even(long / r) } : { width: even(long * r), height: long };
}

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

function wrap(text: string, perLine: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > perLine) {
      lines.push(line.trim());
      line = w;
      if (lines.length === maxLines) break;
    } else line += ' ' + w;
  }
  if (lines.length < maxLines && line.trim()) lines.push(line.trim());
  return lines;
}

async function mockImage(ctx: JobContext, index: number): Promise<ProviderOutput> {
  const { width, height } = dims(ctx.params.aspectRatio, 1024);
  const hue = (hash(ctx.prompt) + index * 47 + (ctx.params.seed ?? 0)) % 360;
  const lines = wrap(ctx.prompt.split('\n')[0] ?? '', Math.max(18, Math.round(width / 30)), 5);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue},70%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 80) % 360},70%,25%)"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <text x="50%" y="${height * 0.12}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${Math.round(width / 28)}" fill="rgba(255,255,255,0.6)">MOCK · #${index + 1}</text>
    ${lines
      .map((l, i) => `<text x="50%" y="${height * 0.78 + i * (width / 22)}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${Math.round(width / 26)}" fill="white">${escapeXml(l)}</text>`)
      .join('')}
  </svg>`;
  let img = sharp(Buffer.from(svg));
  if (ctx.sources.length) {
    // Show the input images as a strip so editing flows are visibly wired up.
    const tile = Math.round(Math.min(width / (ctx.sources.length + 1), height * 0.45));
    const tiles = await Promise.all(
      ctx.sources.map(async (s, i) => ({
        input: await sharp(await s.buffer()).resize(tile, tile, { fit: 'cover' }).png().toBuffer(),
        left: Math.round((width - ctx.sources.length * (tile + 16)) / 2 + i * (tile + 16)),
        top: Math.round(height * 0.2),
      })),
    );
    img = img.composite(tiles);
  }
  return { data: await img.png().toBuffer(), mime: 'image/png' };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export const mockProvider: ProviderAdapter = {
  id: 'mock',
  name: 'Mock (offline)',
  description: 'Free placeholder generator for testing flows without API keys.',
  envKeys: ['ENABLE_MOCK_PROVIDER'],
  models: MOCK_MODELS,
  isConfigured: () => config.ENABLE_MOCK_PROVIDER,
  imageLabel: (i) => `image ${i + 1}`,

  async submit(ctx) {
    if (ctx.prompt.toLowerCase().includes('[fail]')) throw new Error('Mock failure requested via [fail] in the prompt');
    return { status: 'pending', taskId: ctx.generationId, providerData: { startedAt: Date.now() } };
  },

  async poll(ctx): Promise<PollResult> {
    const started = Number(ctx.providerData.startedAt ?? Date.now());
    const elapsed = Date.now() - started;
    const total = ctx.kind === 'video' ? RUN_MS * 1.5 : RUN_MS;
    if (elapsed < total) return { status: 'pending', progress: Math.min(95, Math.round((elapsed / total) * 100)) };

    if (ctx.kind === 'image') {
      const count = Math.max(1, Math.min(ctx.params.count ?? 1, 4));
      const outputs = await Promise.all(Array.from({ length: count }, (_, i) => mockImage(ctx, i)));
      return { status: 'completed', outputs, costUsd: 0 };
    }
    const long = ctx.params.resolution === '720p' ? 1280 : 854;
    const { width, height } = dims(ctx.params.aspectRatio, long);
    const file = path.join(config.tmpDir, `mock-${ctx.generationId}.mp4`);
    try {
      await makeTestVideo(file, { width, height, seconds: ctx.params.duration ?? 4, hue: hash(ctx.prompt) % 360 });
      return { status: 'completed', outputs: [{ data: await fs.readFile(file), mime: 'video/mp4' }], costUsd: 0 };
    } finally {
      await fs.rm(file, { force: true });
    }
  },

  async test() {
    return 'Mock provider is always available.';
  },
};
