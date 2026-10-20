import { config } from '../config.js';
import { requestJson } from '../lib/http.js';
import { r2Storage } from '../storage/index.js';
import { WAN_MODELS } from './catalog.js';
import type { JobContext, PollResult, ProviderAdapter, SubmitResult } from './types.js';

const PROVIDER = 'Wan';
const base = () => config.DASHSCOPE_BASE_URL.replace(/\/+$/, '');
const auth = () => ({ Authorization: `Bearer ${config.DASHSCOPE_API_KEY ?? ''}` });
const asyncHeaders = () => ({ ...auth(), 'X-DashScope-Async': 'enable' });

export const dashscopeCompatBase = () => base().replace(/\/api\/v1$/, '/compatible-mode/v1');

const TIER_PX: Record<string, number> = { '1K': 1024, '2K': 2048, '4K': 4096 };

/** Wan image sizes: a tier keeps the input's shape; an explicit ratio becomes "W*H" with the tier's pixel budget. */
function imageSize(ctx: JobContext): string {
  const tier = ctx.params.resolution && TIER_PX[ctx.params.resolution] ? ctx.params.resolution : '2K';
  const ratio = ctx.params.aspectRatio;
  if (!ratio || ratio === 'auto' || ratio === '1:1') return tier;
  const [w, h] = ratio.split(':').map(Number);
  if (!w || !h) return tier;
  // Editing / multi-image output is capped at 2K.
  const side = ctx.sources.length ? Math.min(TIER_PX[tier]!, 2048) : TIER_PX[tier]!;
  const r = w / h;
  const round16 = (n: number) => Math.max(16, Math.round(n / 16) * 16);
  return `${round16(side * Math.sqrt(r))}*${round16(side / Math.sqrt(r))}`;
}

async function startImage(ctx: JobContext): Promise<SubmitResult> {
  const content: Record<string, string>[] = [];
  for (const img of ctx.sources) content.push({ image: await img.url({ maxSide: 2048, format: 'jpeg' }) });
  content.push({ text: ctx.prompt });
  const parameters: Record<string, unknown> = {
    size: imageSize(ctx),
    n: Math.max(1, Math.min(ctx.params.count ?? 1, 4)),
    watermark: false,
  };
  if (ctx.params.seed !== undefined) parameters.seed = ctx.params.seed;
  const resp = await requestJson(`${base()}/services/aigc/image-generation/generation`, {
    headers: asyncHeaders(),
    body: { model: ctx.providerModelId, input: { messages: [{ role: 'user', content }] }, parameters },
    signal: ctx.signal,
    provider: PROVIDER,
  });
  const taskId = resp?.output?.task_id;
  if (!taskId) throw new Error(`Wan did not return a task id: ${resp?.message ?? JSON.stringify(resp).slice(0, 200)}`);
  return { status: 'pending', taskId };
}

async function startVideo(ctx: JobContext): Promise<SubmitResult> {
  const media: { type: string; url: string }[] = [];
  const add = async (type: string, img?: JobContext['firstFrame']) => {
    if (img) media.push({ type, url: await img.url({ maxSide: 1920, format: 'jpeg' }) });
  };
  await add('first_frame', ctx.firstFrame);
  await add('last_frame', ctx.lastFrame);
  for (const ref of ctx.references) await add('reference_image', ref);

  const input: Record<string, unknown> = { prompt: ctx.prompt };
  if (media.length) input.media = media;
  if (ctx.negativePrompt) input.negative_prompt = ctx.negativePrompt;
  const p = ctx.params;
  const parameters: Record<string, unknown> = {
    resolution: p.resolution ?? '720P',
    ratio: p.aspectRatio ?? 'adaptive',
    duration: p.duration ?? 5,
    prompt_extend: p.promptExtend ?? true,
    watermark: false,
  };
  if (p.audio === false) parameters.audio = false;
  if (p.seed !== undefined) parameters.seed = p.seed;

  const resp = await requestJson(`${base()}/services/aigc/video-generation/video-synthesis`, {
    headers: asyncHeaders(),
    body: { model: ctx.providerModelId, input, parameters },
    signal: ctx.signal,
    provider: PROVIDER,
  });
  const taskId = resp?.output?.task_id;
  if (!taskId) throw new Error(`Wan did not return a task id: ${resp?.message ?? JSON.stringify(resp).slice(0, 200)}`);
  return { status: 'pending', taskId };
}

function collectImageUrls(output: any): string[] {
  const urls: string[] = [];
  for (const choice of output?.choices ?? []) {
    for (const c of choice?.message?.content ?? []) if (typeof c?.image === 'string') urls.push(c.image);
  }
  for (const r of output?.results ?? []) if (typeof r?.url === 'string') urls.push(r.url);
  return urls;
}

export const wanProvider: ProviderAdapter = {
  id: 'wan',
  name: 'Wan (Alibaba Model Studio)',
  description: 'Wan 3.0 video and Wan 2.7 image models via DashScope.',
  envKeys: ['DASHSCOPE_API_KEY', 'DASHSCOPE_BASE_URL'],
  models: WAN_MODELS,
  isConfigured: () => Boolean(config.DASHSCOPE_API_KEY),
  imageLabel: (i) => `Image ${i + 1}`,

  async submit(ctx) {
    try {
      return ctx.kind === 'image' ? await startImage(ctx) : await startVideo(ctx);
    } catch (err) {
      const hasInputs = ctx.sources.length || ctx.references.length || ctx.firstFrame || ctx.lastFrame;
      if (hasInputs && !r2Storage && err instanceof Error) {
        err.message += ' — Tip: Wan downloads input images from a URL. Configure Cloudflare R2 so IMG can give it signed links.';
      }
      throw err;
    }
  },

  async poll(ctx, taskId): Promise<PollResult> {
    const resp = await requestJson(`${base()}/tasks/${encodeURIComponent(taskId)}`, { headers: auth(), signal: ctx.signal, provider: PROVIDER });
    const out = resp?.output ?? {};
    const status = String(out.task_status ?? '').toUpperCase();
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
      return { status: 'failed', error: [out.code, out.message].filter(Boolean).join(': ') || `Wan task ${status.toLowerCase()}` };
    }
    if (status !== 'SUCCEEDED') return { status: 'pending' };
    if (ctx.kind === 'video') {
      if (!out.video_url) return { status: 'failed', error: 'Wan finished but returned no video URL' };
      return { status: 'completed', outputs: [{ url: out.video_url, mime: 'video/mp4' }] };
    }
    const urls = collectImageUrls(out);
    if (!urls.length) return { status: 'failed', error: 'Wan finished but returned no images' };
    return { status: 'completed', outputs: urls.map((url) => ({ url })) };
  },

  async test() {
    const resp = await requestJson(`${dashscopeCompatBase()}/models`, { headers: auth(), provider: PROVIDER });
    const ids: string[] = (resp?.data ?? []).map((m: any) => String(m.id));
    const wan = ids.filter((id) => id.startsWith('wan'));
    return `Connected (${base()}). ${ids.length} models visible${wan.length ? `, incl. ${wan.slice(0, 6).join(', ')}` : ''}.`;
  },
};
