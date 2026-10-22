import { config } from '../config.js';
import { ProviderHttpError, requestJson } from '../lib/http.js';
import { imageSize } from '../media/image.js';
import { FAL_MODELS } from './catalog.js';
import type { JobContext, PollResult, ProviderAdapter, SubmitResult } from './types.js';

const PROVIDER = 'fal.ai';
const base = () => config.FAL_BASE_URL.replace(/\/+$/, '');
const auth = () => ({ Authorization: `Key ${config.FAL_KEY ?? ''}` });

/** Each Wan generation on fal takes a different input shape. */
type WanFormat = 'wan22' | 'wan3' | 'wan26-flash' | 'wan27-image' | 'wan22-image';
const WAN_FORMAT: Record<string, WanFormat> = {
  'fal-wan-3.0': 'wan3',
  'fal-wan-3.0-prime': 'wan3',
  'fal-wan-2.6-flash': 'wan26-flash',
  'fal-wan-2.2-a14b': 'wan22',
  'fal-wan-2.2-a14b-turbo': 'wan22',
  'fal-wan-2.7-image': 'wan27-image',
  'fal-wan-2.2-image': 'wan22-image',
};

type EndpointCtx = Pick<JobContext, 'kind' | 'providerModelId' | 'firstFrame' | 'references' | 'sources'>;

/** Base paths get the task appended; full endpoint ids are used as-is. */
export function falEndpoint(ctx: EndpointCtx): string {
  const id = ctx.providerModelId.replace(/^\/+|\/+$/g, '');
  if (ctx.kind === 'image') {
    if (/\/(text-to-image|image-to-image|edit)(\/|$)/.test(id)) return id;
    return `${id}/${ctx.sources.length ? 'edit' : 'text-to-image'}`;
  }
  if (/\/(text|image|reference)-to-video(\/|$)/.test(id)) return id;
  const task = ctx.firstFrame ? 'image-to-video' : ctx.references.length ? 'reference-to-video' : 'text-to-video';
  return `${id}/${task}`;
}

const imageUrl = (img: NonNullable<JobContext['firstFrame']>) => img.url({ maxSide: 1920, format: 'jpeg' });

/** fal's preset image sizes (about 1 megapixel). */
const IMAGE_SIZE: Record<string, string> = {
  '1:1': 'square_hd',
  '4:3': 'landscape_4_3',
  '3:4': 'portrait_4_3',
  '16:9': 'landscape_16_9',
  '9:16': 'portrait_16_9',
};

/** 'auto' when editing: keep the first photo's shape at about 1280 px on the long side. */
async function sizeFromImage(img: NonNullable<JobContext['firstFrame']>): Promise<{ width: number; height: number } | undefined> {
  const { width, height } = await imageSize(await img.buffer());
  if (!width || !height) return undefined;
  const scale = 1280 / Math.max(width, height);
  const r16 = (n: number) => Math.max(384, Math.round((n * scale) / 16) * 16);
  return { width: r16(width), height: r16(height) };
}

async function buildImageInput(ctx: JobContext, format: WanFormat, input: Record<string, unknown>) {
  const p = ctx.params;
  if (ctx.negativePrompt) input.negative_prompt = ctx.negativePrompt;
  const preset = p.aspectRatio ? IMAGE_SIZE[p.aspectRatio] : undefined;
  if (preset) input.image_size = preset;
  else if (ctx.sources[0]) {
    const size = await sizeFromImage(ctx.sources[0]);
    if (size) input.image_size = size;
  }
  if (format === 'wan22-image') {
    input.enable_output_safety_checker = false;
    return input;
  }
  // Wan 2.7
  input.num_images = Math.max(1, Math.min(p.count ?? 1, 4));
  input.output_format = 'png';
  if (ctx.sources.length) input.image_urls = await Promise.all(ctx.sources.slice(0, 4).map(imageUrl));
  else delete input.enable_prompt_expansion; // only offered for edits
  return input;
}

async function buildInput(ctx: JobContext): Promise<Record<string, unknown>> {
  const p = ctx.params;
  const caps = ctx.model.capabilities;
  const format = WAN_FORMAT[ctx.model.id] ?? (ctx.kind === 'image' ? 'wan27-image' : 'wan22');
  const input: Record<string, unknown> = {
    prompt: ctx.prompt,
    // Send the prompt as written unless the user turns provider rewriting on.
    enable_prompt_expansion: p.promptExtend === true,
    // Request the least restrictive checks; fal may require account approval to switch the checker off.
    enable_safety_checker: false,
  };
  if (p.seed !== undefined) input.seed = p.seed;
  if (ctx.kind === 'image') return buildImageInput(ctx, format, input);
  if (p.resolution) input.resolution = p.resolution;

  if (format === 'wan3') {
    input.aspect_ratio = p.aspectRatio ?? 'adaptive';
    if (p.duration) input.duration = p.duration;
    input.audio = p.audio !== false;
    if (ctx.firstFrame) input.start_image_url = await imageUrl(ctx.firstFrame);
    if (ctx.lastFrame) input.end_image_url = await imageUrl(ctx.lastFrame);
    if (!ctx.firstFrame && ctx.references.length) input.reference_image_urls = await Promise.all(ctx.references.map(imageUrl));
    return input;
  }

  if (format === 'wan26-flash') {
    if (!ctx.firstFrame) throw new Error('Wan 2.6 Flash needs a start frame');
    input.image_url = await imageUrl(ctx.firstFrame);
    if (p.duration) input.duration = String(p.duration); // enum "5" | "10" | "15"
    input.generate_audio = p.audio !== false;
    input.multi_shots = false;
    if (ctx.negativePrompt) input.negative_prompt = ctx.negativePrompt;
    return input;
  }

  // Wan 2.2 (A14B and Turbo)
  input.enable_output_safety_checker = false;
  if (p.aspectRatio && p.aspectRatio !== 'auto') input.aspect_ratio = p.aspectRatio;
  else if (ctx.firstFrame) input.aspect_ratio = 'auto';
  if (ctx.negativePrompt && caps.negativePrompt) input.negative_prompt = ctx.negativePrompt;
  if (caps.durations?.length && p.duration) {
    // fal accepts 17–161 frames at 16 fps.
    input.num_frames = Math.min(161, Math.max(17, Math.round(p.duration * 16) + 1));
    input.frames_per_second = 16;
  }
  if (ctx.firstFrame) input.image_url = await imageUrl(ctx.firstFrame);
  if (ctx.lastFrame) input.end_image_url = await imageUrl(ctx.lastFrame);
  return input;
}

export const falProvider: ProviderAdapter = {
  id: 'fal',
  name: 'fal.ai',
  description: 'Wan video (3.0, 2.6 Flash, 2.2) and Wan images (2.7, 2.2) hosted on fal — one key, pay as you go.',
  envKeys: ['FAL_KEY'],
  models: FAL_MODELS,
  isConfigured: () => Boolean(config.FAL_KEY),
  // Wan refers to references as "Image 1", "Image 2"…
  imageLabel: (i) => `Image ${i + 1}`,

  async submit(ctx): Promise<SubmitResult> {
    const endpoint = falEndpoint(ctx);
    const input = await buildInput(ctx);
    const send = (body: Record<string, unknown>) =>
      requestJson(`${base()}/${endpoint}`, { headers: auth(), body, signal: ctx.signal, provider: PROVIDER });

    let resp: any;
    try {
      resp = await send(input);
    } catch (err) {
      // Accounts without approval can't switch the safety checker off; fall back to fal's default.
      if (!(err instanceof ProviderHttpError && err.status >= 400 && err.status < 500 && /safety/i.test(err.body))) throw err;
      console.warn(`[fal] ${endpoint} refused enable_safety_checker=false; retrying with fal's default`);
      const { enable_safety_checker: _drop, ...rest } = input;
      resp = await send(rest);
    }
    if (!resp?.request_id) throw new Error('fal.ai did not return a request id');
    // Follow-up URLs use only owner/app (not the endpoint path), so keep the ones fal returns.
    return {
      status: 'pending',
      taskId: resp.request_id,
      providerData: { statusUrl: resp.status_url, responseUrl: resp.response_url, endpoint },
    };
  },

  async poll(ctx, taskId): Promise<PollResult> {
    const endpoint = String(ctx.providerData.endpoint ?? falEndpoint(ctx));
    const app = endpoint.split('/').slice(0, 2).join('/');
    const statusUrl = String(ctx.providerData.statusUrl ?? `${base()}/${app}/requests/${taskId}/status`);
    const responseUrl = String(ctx.providerData.responseUrl ?? `${base()}/${app}/requests/${taskId}`);

    const status = await requestJson(statusUrl, { headers: auth(), signal: ctx.signal, provider: PROVIDER });
    const state = String(status?.status ?? '').toUpperCase();
    if (state === 'IN_QUEUE' || state === 'IN_PROGRESS') return { status: 'pending' };
    if (status?.error) return { status: 'failed', error: `fal.ai: ${status.error}` };

    try {
      const result = await requestJson(responseUrl, { headers: auth(), signal: ctx.signal, provider: PROVIDER });
      if (ctx.kind === 'image') {
        // Wan 2.7 returns images[]; Wan 2.2 returns a single image.
        const files: any[] = Array.isArray(result?.images) ? result.images : result?.image ? [result.image] : [];
        const outputs = files.filter((f) => f?.url).map((f) => ({ url: String(f.url), mime: f.content_type ?? undefined }));
        if (!outputs.length) return { status: 'failed', error: 'fal.ai finished but returned no images' };
        return { status: 'completed', outputs };
      }
      const url = result?.video?.url;
      if (!url) return { status: 'failed', error: 'fal.ai finished but returned no video' };
      return { status: 'completed', outputs: [{ url, mime: result.video.content_type ?? 'video/mp4' }] };
    } catch (err) {
      // A failed request reports its reason on the result URL.
      if (err instanceof ProviderHttpError && err.status >= 400 && err.status < 500) return { status: 'failed', error: err.message };
      throw err;
    }
  },

  async test() {
    // fal has no "whoami" endpoint: ask for a request that can't exist. 401/403 = bad key; 404/422 = key accepted.
    try {
      await requestJson(`${base()}/fal-ai/wan/requests/00000000-0000-0000-0000-000000000000/status`, { headers: auth(), provider: PROVIDER });
      return 'Connected.';
    } catch (err) {
      if (err instanceof ProviderHttpError && (err.status === 401 || err.status === 403)) throw new Error('fal.ai rejected the key (check FAL_KEY)');
      if (err instanceof ProviderHttpError) return 'Connected — key accepted by fal.ai.';
      throw err;
    }
  },
};
