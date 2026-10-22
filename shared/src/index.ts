// Types and constants shared by the server and the web app.

export type MediaKind = 'image' | 'video';

export type GenerationMode =
  | 'text-to-image'
  | 'image-edit'
  | 'text-to-video'
  | 'image-to-video'
  | 'frames-to-video'
  | 'reference-to-video';

/** How an input asset is used by a generation. */
export type InputRole = 'source' | 'reference' | 'first_frame' | 'last_frame';

export interface ModelCapabilities {
  kind: MediaKind;
  /** Images that can be edited/combined (image models). 0 = text-to-image only. */
  maxSourceImages: number;
  /** Video: can start from a given first frame. */
  firstFrame: boolean;
  /** Video: can end on a given last frame. */
  lastFrame: boolean;
  /** Video: subject/character reference images. 0 = unsupported. */
  maxReferenceImages: number;
  /** Video: whether first/last frames may be combined with references in one request. */
  framesWithReferences: boolean;
  aspectRatios: string[];
  defaultAspectRatio?: string;
  resolutions: string[];
  defaultResolution?: string;
  /** Video durations in seconds the UI offers. Undefined = model decides. */
  durations?: number[];
  defaultDuration?: number;
  /** Max outputs per request. */
  maxOutputs: number;
  negativePrompt: boolean;
  seed: boolean;
  /** Has a toggle for generated sound. */
  audio: boolean;
  /** Provider-side automatic prompt rewriting toggle. */
  promptExtend: boolean;
  /** Supported quality levels, if any. */
  qualities?: string[];
  /** Can render a transparent (alpha) background. */
  transparentBackground?: boolean;
  /** Needs an input image: a start frame for video models, a source image for image models. */
  requiresImage?: boolean;
}

/** List prices in USD. Keyed maps override the flat price when the chosen param matches. */
export interface ModelPricing {
  perImage?: number;
  perImageByResolution?: Record<string, number>;
  /** Image price per quality level (at the smallest size). */
  perImageByQuality?: Record<string, number>;
  /** Multiplier applied to the image price per resolution (when price grows with pixel count). */
  scaleByResolution?: Record<string, number>;
  perSecond?: number;
  perSecondByResolution?: Record<string, number>;
  /** Flat price per clip (models with a fixed clip length). */
  perVideo?: number;
  perVideoByResolution?: Record<string, number>;
  /** True when the figures are estimates rather than published per-unit prices. */
  approximate?: boolean;
  note?: string;
}

export interface ModelInfo {
  /** Stable key used by IMG (usually equal to the provider model id). */
  id: string;
  /** The model id sent to the provider API. */
  providerModelId: string;
  name: string;
  description: string;
  capabilities: ModelCapabilities;
  pricing?: ModelPricing;
  tags?: string[];
}

export interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  configured: boolean;
  envKeys: string[];
  models: ModelInfo[];
}

export interface GenerationParams {
  aspectRatio?: string;
  resolution?: string;
  duration?: number;
  count?: number;
  seed?: number;
  audio?: boolean;
  promptExtend?: boolean;
  quality?: string;
  style?: string;
  background?: 'transparent' | 'auto';
}

export interface GenerationInput {
  assetId: string;
  role: InputRole;
}

export interface GenerationTarget {
  provider: string;
  model: string;
  /** Send a different model id to the provider (for brand-new models not in the catalog yet). */
  modelOverride?: string;
}

export interface CreateGenerationBody {
  kind: MediaKind;
  targets: GenerationTarget[];
  prompt: string;
  negativePrompt?: string;
  params: GenerationParams;
  inputs: GenerationInput[];
  characterIds: string[];
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface Generation {
  id: string;
  batchId: string;
  kind: MediaKind;
  mode: GenerationMode;
  provider: string;
  model: string;
  providerModelId: string;
  prompt: string;
  finalPrompt: string | null;
  negativePrompt: string | null;
  params: GenerationParams;
  inputs: GenerationInput[];
  characterIds: string[];
  status: JobStatus;
  progress: number | null;
  error: string | null;
  costUsd: number | null;
  outputAssetIds: string[];
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export type AssetSource = 'upload' | 'generated' | 'derived';

export interface Asset {
  id: string;
  kind: MediaKind;
  source: AssetSource;
  name: string | null;
  mime: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sizeBytes: number;
  prompt: string | null;
  generationId: string | null;
  provider: string | null;
  model: string | null;
  favorite: boolean;
  storage: 'local' | 'r2';
  createdAt: number;
  url: string;
  thumbUrl: string;
}

export interface Character {
  id: string;
  name: string;
  description: string;
  coverAssetId: string | null;
  assets: Asset[];
  createdAt: number;
  updatedAt: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface SystemStatus {
  storage: { driver: 'local' | 'r2'; bucket: string | null; localPath: string };
  ffmpeg: { available: boolean; version: string | null };
  textProviders: string[];
  counts: { assets: number; images: number; videos: number; generations: number; characters: number; localAssets: number };
  spend: { provider: string; costUsd: number; jobs: number }[];
  spendToday: number;
  spendMonth: number;
}

export interface DailyUsage {
  day: string;
  provider: string;
  costUsd: number;
  jobs: number;
}

export type ServerEvent =
  | { type: 'generation'; data: Generation }
  | { type: 'asset'; data: Asset }
  | { type: 'asset-deleted'; id: string }
  | { type: 'character'; id: string };

export interface StylePreset {
  id: string;
  name: string;
  suffix: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  { id: 'cinematic', name: 'Cinematic', suffix: 'cinematic shot, dramatic lighting, shallow depth of field, anamorphic lens, film grain, color graded' },
  { id: 'photoreal', name: 'Photoreal', suffix: 'photorealistic, natural lighting, high detail, shot on a full-frame camera, 50mm lens' },
  { id: 'anime', name: 'Anime', suffix: 'anime style, clean line art, vibrant cel shading, detailed background art' },
  { id: '3d', name: '3D Animation', suffix: 'stylized 3D animated film look, soft global illumination, expressive characters, high-quality render' },
  { id: 'watercolor', name: 'Watercolor', suffix: 'delicate watercolor painting, soft bleeding edges, textured paper, muted palette' },
  { id: 'cyberpunk', name: 'Cyberpunk', suffix: 'cyberpunk aesthetic, neon lights, rain-soaked streets, high contrast, futuristic' },
  { id: 'fantasy', name: 'Fantasy', suffix: 'epic fantasy art, painterly, magical atmosphere, rich detail, volumetric light' },
  { id: 'product', name: 'Product shot', suffix: 'professional studio product photography, clean background, softbox lighting, crisp reflections' },
  { id: 'portrait', name: 'Studio portrait', suffix: 'studio portrait, rim light, 85mm lens, sharp focus on eyes, neutral backdrop' },
  { id: 'vintage', name: 'Vintage film', suffix: 'vintage 35mm film photo, warm tones, light leaks, nostalgic, soft grain' },
];

export function modeFor(kind: MediaKind, inputs: GenerationInput[]): GenerationMode {
  const has = (role: InputRole) => inputs.some((i) => i.role === role);
  if (kind === 'image') return has('source') || has('reference') ? 'image-edit' : 'text-to-image';
  if (has('last_frame')) return 'frames-to-video';
  if (has('first_frame')) return 'image-to-video';
  if (has('reference')) return 'reference-to-video';
  return 'text-to-video';
}

/** Fit params to what a model supports (used per target, e.g. in compare mode). */
export function normalizeParams(p: GenerationParams, caps: ModelCapabilities): GenerationParams {
  const out: GenerationParams = { ...p };
  // Providers spell the same option differently ("2K" vs "2k", "720P" vs "720p").
  const pick = (value: string | undefined, options: string[], fallback?: string) =>
    options.find((o) => o.toLowerCase() === value?.toLowerCase()) ?? fallback ?? options[0];
  if (caps.aspectRatios.length) out.aspectRatio = pick(out.aspectRatio, caps.aspectRatios, caps.defaultAspectRatio);
  else delete out.aspectRatio;
  if (caps.resolutions.length) out.resolution = pick(out.resolution, caps.resolutions, caps.defaultResolution);
  else delete out.resolution;
  if (caps.durations?.length) {
    const want = out.duration ?? caps.defaultDuration ?? caps.durations[0]!;
    if (!caps.durations.includes(want)) {
      out.duration = caps.durations.reduce((best, d) => (Math.abs(d - want) < Math.abs(best - want) ? d : best), caps.durations[0]!);
    } else out.duration = want;
  } else delete out.duration;
  if (!caps.seed) delete out.seed;
  if (!caps.audio) delete out.audio;
  if (!caps.promptExtend) delete out.promptExtend;
  if (!out.quality || !caps.qualities?.includes(out.quality)) delete out.quality;
  if (!caps.transparentBackground || out.background !== 'transparent') delete out.background;
  return out;
}

/** Case-insensitive lookup in a price map ("2K" matches "2k"). */
function priceFor(map: Record<string, number> | undefined, key: string | undefined): number | undefined {
  if (!map || !key) return undefined;
  const k = Object.keys(map).find((x) => x.toLowerCase() === key.toLowerCase());
  return k === undefined ? undefined : map[k];
}

export function estimateCost(model: ModelInfo, params: GenerationParams): number | null {
  const p = model.pricing;
  if (!p) return null;
  const count = params.count ?? 1;
  if (model.capabilities.kind === 'video') {
    const perClip = priceFor(p.perVideoByResolution, params.resolution) ?? p.perVideo;
    if (perClip !== undefined) return perClip * count;
    const rate = priceFor(p.perSecondByResolution, params.resolution) ?? p.perSecond;
    return rate && params.duration ? rate * params.duration * count : null;
  }
  let unit = priceFor(p.perImageByQuality, params.quality ?? 'auto') ?? priceFor(p.perImageByResolution, params.resolution) ?? p.perImage;
  if (unit === undefined) return null;
  unit *= priceFor(p.scaleByResolution, params.resolution) ?? 1;
  return unit * count;
}

/** Cheapest–dearest unit price, for compact labels. */
export function priceRange(p: ModelPricing | undefined): { min: number; max: number; unit: 'image' | 'sec' | 'video' } | null {
  if (!p) return null;
  const image = [p.perImage, ...Object.values(p.perImageByResolution ?? {}), ...Object.values(p.perImageByQuality ?? {})].filter(
    (n): n is number => typeof n === 'number',
  );
  if (image.length) {
    const scales = Object.values(p.scaleByResolution ?? { base: 1 });
    return { min: Math.min(...image) * Math.min(...scales), max: Math.max(...image) * Math.max(...scales), unit: 'image' };
  }
  const clip = [p.perVideo, ...Object.values(p.perVideoByResolution ?? {})].filter((n): n is number => typeof n === 'number');
  if (clip.length) return { min: Math.min(...clip), max: Math.max(...clip), unit: 'video' };
  const video = [p.perSecond, ...Object.values(p.perSecondByResolution ?? {})].filter((n): n is number => typeof n === 'number');
  if (video.length) return { min: Math.min(...video), max: Math.max(...video), unit: 'sec' };
  return null;
}

export const MODE_LABELS: Record<GenerationMode, string> = {
  'text-to-image': 'Text → Image',
  'image-edit': 'Image edit',
  'text-to-video': 'Text → Video',
  'image-to-video': 'Image → Video',
  'frames-to-video': 'Frames → Video',
  'reference-to-video': 'Reference → Video',
};
