import type { MediaKind } from '@imagination/shared';
import { config } from '../config.js';
import { ProviderHttpError, requestJson } from '../lib/http.js';
import { GEMINI_MODELS } from './catalog.js';
import type { JobContext, PollResult, ProviderAdapter, ProviderOutput, SubmitResult } from './types.js';

const BASE = config.GEMINI_BASE_URL.replace(/\/+$/, '');
const PROVIDER = 'Gemini';

const headers = () => ({ 'x-goog-api-key': config.GEMINI_API_KEY ?? '' });

interface FoundMedia {
  data?: string;
  uri?: string;
  mime: string;
}

/**
 * Walk an Interactions (or generateContent) response and collect generated media.
 * Tolerant of shape differences between API revisions; skips echoed inputs and "thought" images.
 */
function findMedia(resp: unknown, kind: MediaKind): FoundMedia[] {
  const found: FoundMedia[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const o = node as Record<string, any>;
    if (o.type === 'thought') return;
    const mime: unknown = o.mime_type ?? o.mimeType;
    const looksLike = o.type === kind || (typeof mime === 'string' && mime.startsWith(`${kind}/`));
    if (looksLike && (typeof o.data === 'string' || typeof o.uri === 'string')) {
      found.push({ data: o.data, uri: o.uri, mime: typeof mime === 'string' ? mime : kind === 'image' ? 'image/png' : 'video/mp4' });
      return;
    }
    for (const [key, value] of Object.entries(o)) {
      if (key === 'input' || key === 'summary') continue;
      visit(value);
    }
  };
  const r = resp as Record<string, any>;
  visit(r?.steps ?? r?.outputs ?? r?.candidates ?? r);
  return found;
}

function findText(resp: unknown): string {
  const texts: string[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const o = node as Record<string, any>;
    if (o.type === 'thought') return;
    if (typeof o.text === 'string' && (o.type === 'text' || o.type === undefined)) texts.push(o.text);
    for (const [key, value] of Object.entries(o)) if (key !== 'input' && key !== 'text') visit(value);
  };
  const r = resp as Record<string, any>;
  visit(r?.steps ?? r?.outputs ?? r?.candidates ?? []);
  return texts.join(' ').trim();
}

function interactionError(resp: any): string | null {
  const status = String(resp?.status ?? '').toLowerCase();
  if (status === 'failed' || status === 'cancelled') {
    return resp?.error?.message ?? `Interaction ${status}`;
  }
  return null;
}

/** Turn a media URI from the response into something downloadable, or report that the file is still processing. */
async function resolveUri(uri: string, signal: AbortSignal): Promise<{ ready: boolean; output?: ProviderOutput }> {
  const fileMatch = uri.match(/(?:^|\/v1beta\/)(files\/[^/:?]+)$/);
  if (!fileMatch) return { ready: true, output: { url: uri, headers: headers() } };
  const fileUrl = `${BASE}/${fileMatch[1]}`;
  const meta = await requestJson(fileUrl, { headers: headers(), signal, provider: PROVIDER });
  const state = String(meta?.state ?? 'ACTIVE').toUpperCase();
  if (state === 'FAILED') throw new Error(meta?.error?.message ?? 'Gemini failed to process the generated video');
  if (state !== 'ACTIVE') return { ready: false };
  return { ready: true, output: { url: meta?.downloadUri ?? `${fileUrl}:download?alt=media`, headers: headers(), mime: meta?.mimeType } };
}

async function toOutputs(media: FoundMedia[], signal: AbortSignal): Promise<{ ready: boolean; outputs: ProviderOutput[] }> {
  const outputs: ProviderOutput[] = [];
  for (const m of media) {
    if (m.data) outputs.push({ data: Buffer.from(m.data, 'base64'), mime: m.mime });
    else if (m.uri) {
      const r = await resolveUri(m.uri, signal);
      if (!r.ready) return { ready: false, outputs: [] };
      outputs.push({ ...r.output!, mime: r.output!.mime ?? m.mime });
    }
  }
  return { ready: true, outputs };
}

async function imageParts(ctx: JobContext) {
  const parts = [];
  for (const img of ctx.sources) {
    const { data, mime } = await img.base64({ maxSide: 2048 });
    parts.push({ type: 'image', mime_type: mime, data });
  }
  return parts;
}

async function generateImage(ctx: JobContext): Promise<ProviderOutput[]> {
  const parts = [{ type: 'text', text: ctx.prompt }, ...(await imageParts(ctx))];
  const responseFormat: Record<string, string> = { type: 'image' };
  const ratio = ctx.params.aspectRatio;
  if (ratio && ratio !== 'auto') responseFormat.aspect_ratio = ratio;
  if (ctx.params.resolution) responseFormat.image_size = ctx.params.resolution;

  const resp = await requestJson(`${BASE}/interactions`, {
    headers: headers(),
    body: { model: ctx.providerModelId, input: parts, response_format: responseFormat, store: false },
    signal: ctx.signal,
    provider: PROVIDER,
  });
  const err = interactionError(resp);
  if (err) throw new Error(err);
  const media = findMedia(resp, 'image');
  if (!media.length) {
    const text = findText(resp);
    throw new Error(text ? `Gemini returned no image: ${text.slice(0, 300)}` : 'Gemini returned no image (it may have been blocked by safety filters).');
  }
  return (await toOutputs(media, ctx.signal)).outputs;
}

function videoTask(ctx: JobContext): string | undefined {
  if (ctx.mode === 'reference-to-video') return 'reference_to_video';
  if (ctx.mode === 'image-to-video' || ctx.mode === 'frames-to-video') return 'image_to_video';
  if (ctx.mode === 'text-to-video') return 'text_to_video';
  return undefined;
}

async function videoBody(ctx: JobContext) {
  const parts: any[] = [];
  const add = async (img: JobContext['firstFrame']) => {
    if (!img) return;
    const { data, mime } = await img.base64({ maxSide: 1920 });
    parts.push({ type: 'image', mime_type: mime, data });
  };
  await add(ctx.firstFrame);
  await add(ctx.lastFrame);
  for (const ref of ctx.references) await add(ref);
  let prompt = ctx.prompt;
  if (ctx.firstFrame && ctx.lastFrame) prompt += '\n\nUse the first image as the opening frame and the second image as the final frame.';
  else if (ctx.firstFrame) prompt += '\n\nUse the provided image as the opening frame.';
  parts.push({ type: 'text', text: prompt });

  const responseFormat: Record<string, string> = { type: 'video', delivery: 'uri' };
  if (ctx.params.aspectRatio) responseFormat.aspect_ratio = ctx.params.aspectRatio;
  if (ctx.params.resolution) responseFormat.resolution = ctx.params.resolution;
  const task = videoTask(ctx);
  return {
    model: ctx.providerModelId,
    input: parts,
    response_format: responseFormat,
    ...(task ? { generation_config: { video_config: { task } } } : {}),
  };
}

async function finishVideo(resp: any, ctx: JobContext): Promise<PollResult> {
  const err = interactionError(resp);
  if (err) return { status: 'failed', error: err };
  const media = findMedia(resp, 'video');
  if (!media.length) {
    const text = findText(resp);
    return { status: 'failed', error: text ? `Gemini returned no video: ${text.slice(0, 300)}` : 'Gemini returned no video (it may have been blocked by safety filters).' };
  }
  const { ready, outputs } = await toOutputs(media, ctx.signal);
  return ready ? { status: 'completed', outputs } : { status: 'pending', progress: 95 };
}

export const geminiProvider: ProviderAdapter = {
  id: 'gemini',
  name: 'Google Gemini',
  description: 'Nano Banana image models and Gemini Omni Flash video.',
  envKeys: ['GEMINI_API_KEY'],
  models: GEMINI_MODELS,
  isConfigured: () => Boolean(config.GEMINI_API_KEY),
  imageLabel: (i) => `image ${i + 1}`,

  async submit(ctx): Promise<SubmitResult> {
    if (ctx.kind === 'image') {
      // One image per call; run requests in parallel for multiple outputs.
      const count = Math.max(1, Math.min(ctx.params.count ?? 1, ctx.model.capabilities.maxOutputs));
      const results = await Promise.allSettled(Array.from({ length: count }, () => generateImage(ctx)));
      const outputs = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
      if (!outputs.length) throw (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason;
      return { status: 'completed', outputs };
    }

    const body = await videoBody(ctx);
    let resp: any;
    try {
      resp = await requestJson(`${BASE}/interactions`, { headers: headers(), body: { ...body, background: true }, signal: ctx.signal, provider: PROVIDER });
    } catch (err) {
      // Fall back to a long synchronous request if background execution is not offered for this model.
      if (err instanceof ProviderHttpError && err.status === 400 && /background/i.test(err.body)) {
        resp = await requestJson(`${BASE}/interactions`, { headers: headers(), body: { ...body, store: false }, signal: ctx.signal, provider: PROVIDER });
      } else throw err;
    }
    const status = String(resp?.status ?? '').toLowerCase();
    const id: string | undefined = resp?.id ?? (typeof resp?.name === 'string' ? resp.name.split('/').pop() : undefined);
    if ((status === 'in_progress' || status === 'queued' || status === 'pending') && id) return { status: 'pending', taskId: id };
    const done = await finishVideo(resp, ctx);
    if (done.status === 'completed') return done;
    if (done.status === 'failed') throw new Error(done.error);
    if (!id) throw new Error('Gemini returned a pending video without an interaction id');
    return { status: 'pending', taskId: id };
  },

  async poll(ctx, taskId): Promise<PollResult> {
    const resp = await requestJson(`${BASE}/interactions/${encodeURIComponent(taskId)}`, { headers: headers(), signal: ctx.signal, provider: PROVIDER });
    const status = String(resp?.status ?? '').toLowerCase();
    if (status === 'in_progress' || status === 'queued' || status === 'pending' || status === 'requires_action') return { status: 'pending' };
    return finishVideo(resp, ctx);
  },

  async test() {
    const resp = await requestJson(`${BASE}/models?pageSize=200`, { headers: headers(), provider: PROVIDER });
    const ids: string[] = (resp?.models ?? []).map((m: any) => String(m.name ?? '').replace(/^models\//, ''));
    const known = GEMINI_MODELS.filter((m) => ids.includes(m.providerModelId)).length;
    return `Connected. ${ids.length} models visible to this key (${known}/${GEMINI_MODELS.length} catalog models listed).`;
  },
};
