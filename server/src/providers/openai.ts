import { FormData } from 'undici';
import { config } from '../config.js';
import { requestForm, requestJson } from '../lib/http.js';
import { OPENAI_MODELS } from './catalog.js';
import type { JobContext, ProviderAdapter, ProviderOutput, SubmitResult } from './types.js';

const PROVIDER = 'OpenAI';
const base = () => config.OPENAI_BASE_URL.replace(/\/+$/, '');
const auth = () => ({ Authorization: `Bearer ${config.OPENAI_API_KEY ?? ''}` });

/** USD per 1M tokens: [text input, image input, image output] (developers.openai.com/api/docs/pricing). */
const TOKEN_RATES: Record<string, [number, number, number]> = {
  'gpt-image-2.5-sunburst': [5, 8, 30],
  'gpt-image-2.5-flare': [5, 8, 30],
  'gpt-image-2': [5, 8, 30],
  'gpt-image-1': [5, 10, 40],
  'gpt-image-1-mini': [2, 2.5, 8],
};

/** Exact spend from the usage block the Image API returns. */
function usageCost(modelId: string, usage: any): number | undefined {
  const rates = TOKEN_RATES[modelId];
  if (!rates || !usage) return undefined;
  const textIn = Number(usage.input_tokens_details?.text_tokens ?? 0);
  const imageIn = Number(usage.input_tokens_details?.image_tokens ?? Math.max(0, Number(usage.input_tokens ?? 0) - textIn));
  const out = Number(usage.output_tokens ?? 0);
  const cost = (textIn * rates[0] + imageIn * rates[1] + out * rates[2]) / 1e6;
  return Number.isFinite(cost) && cost > 0 ? cost : undefined;
}

const PIXEL_BUDGET: Record<string, number> = { '1K': 1024 * 1024, '2K': 2048 * 2048, '4K': 8_294_400 };
const CLASSIC_SIZES: Record<string, string> = { '1:1': '1024x1024', '3:2': '1536x1024', '2:3': '1024x1536' };

/**
 * GPT Image 2.x takes any WxH (multiples of 16, edges ≤ 3840, 655,360–8,294,400 px).
 * Older models only accept the three classic sizes.
 */
export function openaiSize(ctx: Pick<JobContext, 'params' | 'model'>): string {
  const ratio = ctx.params.aspectRatio;
  const res = ctx.params.resolution ?? '1K';
  if (ctx.model.capabilities.resolutions.length <= 1) return (ratio && CLASSIC_SIZES[ratio]) || 'auto';
  const budget = PIXEL_BUDGET[res.toUpperCase()] ?? PIXEL_BUDGET['1K']!;
  const [w, h] = ratio && ratio !== 'auto' ? ratio.split(':').map(Number) : [1, 1];
  if ((!ratio || ratio === 'auto') && res.toUpperCase() === '1K') return 'auto';
  const r = (w || 1) / (h || 1);
  let W = Math.sqrt(budget * r);
  let H = Math.sqrt(budget / r);
  const fit = Math.min(1, 3840 / Math.max(W, H));
  W *= fit;
  H *= fit;
  const floor16 = (n: number) => Math.max(16, Math.floor(n / 16) * 16);
  return `${floor16(W)}x${floor16(H)}`;
}

function toOutputs(resp: any): ProviderOutput[] {
  return (resp?.data ?? [])
    .map((d: any): ProviderOutput | null => {
      if (d?.b64_json) return { data: Buffer.from(d.b64_json, 'base64'), mime: `image/${resp?.output_format ?? 'png'}` };
      if (d?.url) return { url: d.url };
      return null;
    })
    .filter(Boolean);
}

async function generate(ctx: JobContext): Promise<SubmitResult> {
  const p = ctx.params;
  const fields: Record<string, string> = {
    model: ctx.providerModelId,
    prompt: ctx.prompt,
    n: String(Math.max(1, Math.min(p.count ?? 1, 4))),
    size: openaiSize(ctx),
  };
  if (p.quality && p.quality !== 'auto') fields.quality = p.quality;
  if (p.background === 'transparent') {
    fields.background = 'transparent';
    fields.output_format = 'png';
  }

  let resp: any;
  if (!ctx.sources.length) {
    resp = await requestJson(`${base()}/images/generations`, {
      headers: auth(),
      body: { ...fields, n: Number(fields.n) },
      signal: ctx.signal,
      provider: PROVIDER,
    });
  } else {
    // The edits endpoint takes multipart uploads: one image[] field per input image.
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    let i = 0;
    for (const img of ctx.sources) {
      const { data, mime } = await img.base64({ maxSide: 2048, format: 'png', flatten: false });
      form.append('image[]', new Blob([Buffer.from(data, 'base64')], { type: mime }), `image-${++i}.png`);
    }
    resp = await requestForm(`${base()}/images/edits`, { form, headers: auth(), signal: ctx.signal, provider: PROVIDER });
  }

  const outputs = toOutputs(resp);
  if (!outputs.length) throw new Error('OpenAI returned no images (the request may have been blocked by moderation).');
  return { status: 'completed', outputs, costUsd: usageCost(ctx.providerModelId, resp?.usage) };
}

export const openaiProvider: ProviderAdapter = {
  id: 'openai',
  name: 'OpenAI GPT Image',
  description: 'GPT Image 2.5 Sunburst / Flare and GPT Image 1 Mini (images only — the Sora video API was retired).',
  envKeys: ['OPENAI_API_KEY'],
  models: OPENAI_MODELS,
  isConfigured: () => Boolean(config.OPENAI_API_KEY),
  imageLabel: (i) => `image ${i + 1}`,

  submit(ctx) {
    if (ctx.kind !== 'image') throw new Error('OpenAI no longer offers a video API');
    return generate(ctx);
  },

  async test() {
    const resp = await requestJson(`${base()}/models`, { headers: auth(), provider: PROVIDER });
    const ids: string[] = (resp?.data ?? []).map((m: any) => String(m.id));
    const image = ids.filter((id) => id.startsWith('gpt-image'));
    return `Connected. ${ids.length} models available${image.length ? ` (image: ${image.join(', ')})` : ''}.`;
  },
};
