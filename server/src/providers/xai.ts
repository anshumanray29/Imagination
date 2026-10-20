import { config } from '../config.js';
import { requestJson } from '../lib/http.js';
import { XAI_MODELS } from './catalog.js';
import type { JobContext, PollResult, ProviderAdapter, ProviderOutput, SubmitResult } from './types.js';

const BASE = config.XAI_BASE_URL.replace(/\/+$/, '');
const PROVIDER = 'xAI';
const auth = () => ({ Authorization: `Bearer ${config.XAI_API_KEY ?? ''}` });

/** xAI reports exact spend: 10,000,000,000 ticks = $1. */
const ticksToUsd = (usage: any): number | undefined => {
  const ticks = Number(usage?.cost_in_usd_ticks);
  return Number.isFinite(ticks) && ticks > 0 ? ticks / 1e10 : undefined;
};

async function imageRef(img: NonNullable<JobContext['firstFrame']>) {
  return { url: await img.dataUri({ maxSide: 2048, format: 'jpeg' }) };
}

async function generateImages(ctx: JobContext): Promise<SubmitResult> {
  const p = ctx.params;
  const body: Record<string, unknown> = {
    model: ctx.providerModelId,
    prompt: ctx.prompt,
    n: Math.max(1, Math.min(p.count ?? 1, 10)),
    response_format: 'b64_json',
  };
  if (p.aspectRatio && p.aspectRatio !== 'auto') body.aspect_ratio = p.aspectRatio;
  if (p.resolution) body.resolution = p.resolution;

  let endpoint = `${BASE}/images/generations`;
  if (ctx.sources.length) {
    endpoint = `${BASE}/images/edits`;
    const refs = await Promise.all(ctx.sources.map(imageRef));
    if (refs.length === 1) body.image = refs[0];
    else body.images = refs;
  } else if (p.quality && ctx.model.capabilities.qualities?.includes(p.quality)) {
    body.quality = p.quality;
  }

  const resp = await requestJson(endpoint, { headers: auth(), body, signal: ctx.signal, provider: PROVIDER });
  const outputs: ProviderOutput[] = (resp?.data ?? [])
    .map((d: any): ProviderOutput | null => {
      if (d?.b64_json) return { data: Buffer.from(d.b64_json, 'base64'), mime: d.mime_type ?? undefined };
      if (d?.url) return { url: d.url, mime: d.mime_type ?? undefined };
      return null;
    })
    .filter(Boolean);
  if (!outputs.length) throw new Error('xAI returned no images (the request may have been moderated).');
  return { status: 'completed', outputs, costUsd: ticksToUsd(resp?.usage) };
}

async function startVideo(ctx: JobContext): Promise<SubmitResult> {
  const p = ctx.params;
  const body: Record<string, unknown> = { model: ctx.providerModelId };
  if (ctx.prompt.trim()) body.prompt = ctx.prompt;
  if (p.duration) body.duration = p.duration;
  if (p.aspectRatio) body.aspect_ratio = p.aspectRatio;
  if (p.resolution) body.resolution = p.resolution;
  if (p.audio === false) body.generate_audio = false;
  if (ctx.firstFrame) body.image = await imageRef(ctx.firstFrame);
  if (ctx.lastFrame) body.last_frame = await imageRef(ctx.lastFrame);
  if (ctx.references.length) body.reference_images = await Promise.all(ctx.references.map(imageRef));

  const resp = await requestJson(`${BASE}/videos/generations`, { headers: auth(), body, signal: ctx.signal, provider: PROVIDER });
  if (!resp?.request_id) throw new Error('xAI did not return a request_id');
  return { status: 'pending', taskId: resp.request_id };
}

export const xaiProvider: ProviderAdapter = {
  id: 'xai',
  name: 'xAI Grok Imagine',
  description: 'Grok Imagine image and video models (exact per-request cost reporting).',
  envKeys: ['XAI_API_KEY'],
  models: XAI_MODELS,
  isConfigured: () => Boolean(config.XAI_API_KEY),
  imageLabel: (i, kind) => (kind === 'image' ? `<IMAGE_${i}>` : `reference image ${i + 1}`),

  submit(ctx) {
    return ctx.kind === 'image' ? generateImages(ctx) : startVideo(ctx);
  },

  async poll(ctx, taskId): Promise<PollResult> {
    const resp = await requestJson(`${BASE}/videos/${encodeURIComponent(taskId)}`, { headers: auth(), signal: ctx.signal, provider: PROVIDER });
    const status = String(resp?.status ?? '').toLowerCase();
    if (status === 'failed') return { status: 'failed', error: resp?.error?.message ?? 'xAI video generation failed' };
    if (status !== 'done') return { status: 'pending', progress: typeof resp?.progress === 'number' ? resp.progress : undefined };
    if (resp?.video && resp.video.respect_moderation === false) return { status: 'failed', error: 'The video was blocked by xAI moderation.' };
    const url = resp?.video?.url;
    if (!url) return { status: 'failed', error: 'xAI finished but returned no video URL' };
    return { status: 'completed', outputs: [{ url, mime: 'video/mp4' }], costUsd: ticksToUsd(resp?.usage) };
  },

  async test() {
    const resp = await requestJson(`${BASE}/models`, { headers: auth(), provider: PROVIDER });
    const ids: string[] = (resp?.data ?? []).map((m: any) => String(m.id));
    const imagine = ids.filter((id) => id.includes('imagine'));
    return `Connected. ${ids.length} models available${imagine.length ? ` (Imagine: ${imagine.join(', ')})` : ''}.`;
  },
};
