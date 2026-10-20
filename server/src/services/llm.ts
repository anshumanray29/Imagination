import type { MediaKind } from '@imagination/shared';
import { config } from '../config.js';
import { requestJson } from '../lib/http.js';
import { badRequest } from '../lib/util.js';
import { normalizeImage } from '../media/image.js';
import { dashscopeCompatBase } from '../providers/wan.js';
import { getAssetRows, readAsset } from './assets.js';

export type TextProvider = 'gemini' | 'xai' | 'wan';

export function textProviders(): TextProvider[] {
  const list: TextProvider[] = [];
  if (config.GEMINI_API_KEY) list.push('gemini');
  if (config.XAI_API_KEY) list.push('xai');
  if (config.DASHSCOPE_API_KEY) list.push('wan');
  return list;
}

interface CompleteRequest {
  system: string;
  user: string;
  images?: { data: string; mime: string }[];
}

async function complete(provider: TextProvider, req: CompleteRequest): Promise<string> {
  if (provider === 'gemini') {
    const parts = [
      ...(req.images ?? []).map((img) => ({ inlineData: { mimeType: img.mime, data: img.data } })),
      { text: req.user },
    ];
    const resp = await requestJson(
      `${config.GEMINI_BASE_URL.replace(/\/+$/, '')}/models/${config.GEMINI_TEXT_MODEL}:generateContent`,
      {
        headers: { 'x-goog-api-key': config.GEMINI_API_KEY! },
        body: { systemInstruction: { parts: [{ text: req.system }] }, contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.8 } },
        provider: 'Gemini',
      },
    );
    return (resp?.candidates?.[0]?.content?.parts ?? []).map((p: any) => (p.thought ? '' : (p.text ?? ''))).join('').trim();
  }

  // xAI and DashScope both speak the OpenAI chat-completions format.
  const isXai = provider === 'xai';
  const url = isXai ? `${config.XAI_BASE_URL.replace(/\/+$/, '')}/chat/completions` : `${dashscopeCompatBase()}/chat/completions`;
  const key = isXai ? config.XAI_API_KEY! : config.DASHSCOPE_API_KEY!;
  const model = isXai ? config.XAI_TEXT_MODEL : req.images?.length ? config.DASHSCOPE_VISION_MODEL : config.DASHSCOPE_TEXT_MODEL;
  const content = req.images?.length
    ? [...req.images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data}` } })), { type: 'text', text: req.user }]
    : req.user;
  const resp = await requestJson(url, {
    headers: { Authorization: `Bearer ${key}` },
    body: { model, messages: [{ role: 'system', content: req.system }, { role: 'user', content }], temperature: 0.8 },
    provider: isXai ? 'xAI' : 'Wan',
  });
  return String(resp?.choices?.[0]?.message?.content ?? '').trim();
}

function pickProvider(preferred?: string): TextProvider {
  const available = textProviders();
  if (preferred && available.includes(preferred as TextProvider)) return preferred as TextProvider;
  if (!available.length) throw badRequest('Add a Gemini, xAI or DashScope API key to use AI prompt tools');
  return available[0]!;
}

const clean = (s: string) => s.replace(/^["'`\s]+|["'`\s]+$/g, '').replace(/^(prompt|enhanced prompt)\s*:\s*/i, '');

export async function enhancePrompt(prompt: string, kind: MediaKind, provider?: string) {
  if (!prompt.trim()) throw badRequest('Write a prompt to enhance');
  const used = pickProvider(provider);
  const video = kind === 'video';
  const system = [
    `You are an expert prompt writer for AI ${video ? 'video' : 'image'} generation models.`,
    "Rewrite the user's idea into one vivid, specific prompt.",
    'Keep the subjects, intent and any quoted text exactly; do not invent new main characters.',
    video
      ? 'Describe the subject and action, setting, camera movement and framing, lighting, mood, pacing and sound.'
      : 'Describe the subject, setting, composition and framing, lighting, color palette, style and level of detail.',
    'Answer with the prompt only — no preamble, no quotes, no bullet points, under 130 words.',
  ].join(' ');
  const text = clean(await complete(used, { system, user: prompt }));
  if (!text) throw new Error('The model returned an empty prompt');
  return { prompt: text, provider: used };
}

export async function describeCharacter(assetIds: string[], provider?: string) {
  const rows = getAssetRows(assetIds).filter((r) => r.kind === 'image').slice(0, 4);
  if (!rows.length) throw badRequest('Add at least one image of the character first');
  const used = pickProvider(provider);
  const images = await Promise.all(
    rows.map(async (r) => {
      const n = await normalizeImage(await readAsset(r), { maxSide: 1024, format: 'jpeg' });
      return { data: n.buffer.toString('base64'), mime: n.mime };
    }),
  );
  const system =
    'You describe characters so that AI image and video models can reproduce them consistently. ' +
    'Write 2–4 sentences covering apparent age, build, face, skin tone, eyes, hair (color, length, style), ' +
    'signature clothing and accessories, and distinctive marks. Visual facts only — no names, no personality. Answer with the description only.';
  const text = clean(await complete(used, { system, user: 'These images all show the same character. Describe them.', images }));
  if (!text) throw new Error('The model returned an empty description');
  return { description: text, provider: used };
}
