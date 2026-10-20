/**
 * Model catalog — the one place to add, remove or tweak models.
 *
 * Providers ship new model versions every few months. To add one, copy an entry,
 * change `id`/`providerModelId`/`name`, and adjust capabilities. For a quick test
 * without editing this file, use "Custom model ID" in the Studio's advanced options.
 *
 * Last checked against provider docs: 2026-10-20.
 */
import type { ModelCapabilities, ModelInfo } from '@imagination/shared';

const imageBase: Omit<ModelCapabilities, 'aspectRatios' | 'resolutions' | 'maxSourceImages'> = {
  kind: 'image',
  firstFrame: false,
  lastFrame: false,
  maxReferenceImages: 0,
  framesWithReferences: false,
  maxOutputs: 4,
  negativePrompt: false,
  seed: false,
  audio: false,
  promptExtend: false,
};

const videoBase: Omit<ModelCapabilities, 'aspectRatios' | 'resolutions'> = {
  kind: 'video',
  maxSourceImages: 0,
  firstFrame: true,
  lastFrame: false,
  maxReferenceImages: 0,
  framesWithReferences: false,
  maxOutputs: 1,
  negativePrompt: false,
  seed: false,
  audio: false,
  promptExtend: false,
};

// ── Google Gemini ─────────────────────────────────────────────
// 'auto' = let the model decide (keeps the input's shape when editing).
const GEMINI_RATIOS = ['auto', '1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

export const GEMINI_MODELS: ModelInfo[] = [
  {
    id: 'gemini-nano-banana-2.1',
    providerModelId: 'gemini-nano-banana-2.1',
    name: 'Nano Banana 2.1',
    description: "Google's newest image generation & editing model. Strong typography and multi-image composition.",
    tags: ['recommended'],
    capabilities: { ...imageBase, maxSourceImages: 14, aspectRatios: GEMINI_RATIOS, defaultAspectRatio: 'auto', resolutions: ['1K', '2K', '4K'], defaultResolution: '1K' },
  },
  {
    id: 'gemini-3-pro-image',
    providerModelId: 'gemini-3-pro-image',
    name: 'Nano Banana Pro',
    description: 'Studio-quality, high-resolution images with precise text rendering. Slower, uses reasoning.',
    tags: ['quality'],
    capabilities: { ...imageBase, maxSourceImages: 14, aspectRatios: GEMINI_RATIOS, defaultAspectRatio: 'auto', resolutions: ['1K', '2K', '4K'], defaultResolution: '1K' },
  },
  {
    id: 'gemini-3.1-flash-image',
    providerModelId: 'gemini-3.1-flash-image',
    name: 'Nano Banana 2',
    description: 'Fast, high-volume image generation and editing.',
    tags: ['fast'],
    capabilities: { ...imageBase, maxSourceImages: 14, aspectRatios: GEMINI_RATIOS, defaultAspectRatio: 'auto', resolutions: ['1K', '2K', '4K'], defaultResolution: '1K' },
  },
  {
    id: 'gemini-3.1-flash-lite-image',
    providerModelId: 'gemini-3.1-flash-lite-image',
    name: 'Nano Banana 2 Lite',
    description: 'Lowest-latency, lowest-cost Gemini image model (1K only).',
    tags: ['cheap'],
    capabilities: { ...imageBase, maxSourceImages: 14, aspectRatios: GEMINI_RATIOS, defaultAspectRatio: 'auto', resolutions: ['1K'], defaultResolution: '1K' },
  },
  {
    id: 'gemini-omni-1.1-flash',
    providerModelId: 'gemini-omni-1.1-flash',
    name: 'Gemini Omni Flash',
    description: 'Text/image/reference → video with native audio, 3–10 s. Replaces the retired Veo 3.1 preview models.',
    tags: ['recommended'],
    capabilities: {
      ...videoBase,
      firstFrame: true,
      lastFrame: true,
      maxReferenceImages: 3,
      aspectRatios: ['16:9', '9:16'],
      defaultAspectRatio: '16:9',
      resolutions: ['360p', '720p', '1080p', '4k'],
      defaultResolution: '720p',
    },
  },
];

// ── xAI Grok Imagine ──────────────────────────────────────────
const XAI_IMAGE_RATIOS = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '2:1', '1:2', '21:9'];
const XAI_VIDEO_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9'];
const XAI_DURATIONS = [3, 5, 6, 8, 10, 12, 15];

export const XAI_MODELS: ModelInfo[] = [
  {
    id: 'grok-imagine-image-2.0',
    providerModelId: 'grok-imagine-image-2.0',
    name: 'Grok Imagine Image 2.0',
    description: 'Fast image generation; edits and combines up to 5 images.',
    tags: ['recommended'],
    capabilities: { ...imageBase, maxSourceImages: 5, aspectRatios: XAI_IMAGE_RATIOS, defaultAspectRatio: 'auto', resolutions: ['1k', '2k'], defaultResolution: '1k', qualities: ['auto', 'low', 'medium'] },
  },
  {
    id: 'grok-imagine-image-quality',
    providerModelId: 'grok-imagine-image-quality',
    name: 'Grok Imagine Image Quality',
    description: 'Higher-fidelity Grok image model.',
    tags: ['quality'],
    capabilities: { ...imageBase, maxSourceImages: 5, aspectRatios: XAI_IMAGE_RATIOS, defaultAspectRatio: 'auto', resolutions: ['1k', '2k'], defaultResolution: '1k' },
  },
  {
    id: 'grok-imagine-video-1.5',
    providerModelId: 'grok-imagine-video-1.5',
    name: 'Grok Imagine Video 1.5',
    description: 'Up to 15 s with audio, native 1080p, first/last frame and reference images.',
    tags: ['recommended'],
    capabilities: {
      ...videoBase,
      lastFrame: true,
      maxReferenceImages: 4,
      framesWithReferences: true,
      aspectRatios: XAI_VIDEO_RATIOS,
      defaultAspectRatio: '16:9',
      resolutions: ['480p', '720p', '1080p'],
      defaultResolution: '720p',
      durations: XAI_DURATIONS,
      defaultDuration: 8,
      audio: true,
    },
  },
  {
    id: 'grok-imagine-video-1.5-lite',
    providerModelId: 'grok-imagine-video-1.5-lite',
    name: 'Grok Imagine Video 1.5 Lite',
    description: 'Cheaper/faster 1.5 variant (1080p via upscaling).',
    tags: ['cheap'],
    capabilities: {
      ...videoBase,
      lastFrame: true,
      maxReferenceImages: 4,
      framesWithReferences: true,
      aspectRatios: XAI_VIDEO_RATIOS,
      defaultAspectRatio: '16:9',
      resolutions: ['480p', '720p', '1080p'],
      defaultResolution: '720p',
      durations: XAI_DURATIONS,
      defaultDuration: 8,
      audio: true,
    },
  },
  {
    id: 'grok-imagine-video',
    providerModelId: 'grok-imagine-video',
    name: 'Grok Imagine Video (classic)',
    description: 'Original model, up to 720p. References limited to 10 s clips.',
    tags: ['legacy'],
    capabilities: {
      ...videoBase,
      maxReferenceImages: 4,
      aspectRatios: XAI_VIDEO_RATIOS,
      defaultAspectRatio: '16:9',
      resolutions: ['480p', '720p'],
      defaultResolution: '720p',
      durations: [3, 5, 6, 8, 10],
      defaultDuration: 8,
      audio: true,
    },
  },
];

// ── Wan (Alibaba Cloud Model Studio) ─────────────────────────
const WAN_IMAGE_RATIOS = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];

export const WAN_MODELS: ModelInfo[] = [
  {
    id: 'wan2.7-image-pro',
    providerModelId: 'wan2.7-image-pro',
    name: 'Wan 2.7 Image Pro',
    description: 'Text rendering, character-consistent multi-image generation, editing with up to 9 inputs. 4K for text-to-image.',
    tags: ['recommended'],
    capabilities: { ...imageBase, maxSourceImages: 9, seed: true, aspectRatios: WAN_IMAGE_RATIOS, defaultAspectRatio: 'auto', resolutions: ['1K', '2K', '4K'], defaultResolution: '2K' },
  },
  {
    id: 'wan2.7-image',
    providerModelId: 'wan2.7-image',
    name: 'Wan 2.7 Image',
    description: 'Same features as Pro, faster, up to 2K.',
    tags: ['fast'],
    capabilities: { ...imageBase, maxSourceImages: 9, seed: true, aspectRatios: WAN_IMAGE_RATIOS, defaultAspectRatio: 'auto', resolutions: ['1K', '2K'], defaultResolution: '2K' },
  },
  {
    id: 'wan3.0-video',
    providerModelId: 'wan3.0-video',
    name: 'Wan 3.0 Video',
    description: 'Text/first-last-frame/reference → video, 2–30 s with audio. Up to 10 reference images for characters.',
    tags: ['recommended'],
    pricing: { perSecond: 0.1, note: 'List price at 720P (Singapore); 1080P costs more.' },
    capabilities: {
      ...videoBase,
      lastFrame: true,
      maxReferenceImages: 10,
      aspectRatios: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4'],
      defaultAspectRatio: 'adaptive',
      resolutions: ['480P', '720P', '1080P'],
      defaultResolution: '720P',
      durations: [3, 5, 8, 10, 15, 20, 30],
      defaultDuration: 5,
      negativePrompt: true,
      seed: true,
      audio: true,
      promptExtend: true,
    },
  },
  {
    id: 'wan3.0-video-prime',
    providerModelId: 'wan3.0-video-prime',
    name: 'Wan 3.0 Video Prime',
    description: 'Wan 3.0 variant with the same inputs (Model Studio lists it as speed-optimized).',
    capabilities: {
      ...videoBase,
      lastFrame: true,
      maxReferenceImages: 10,
      aspectRatios: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4'],
      defaultAspectRatio: 'adaptive',
      resolutions: ['480P', '720P', '1080P'],
      defaultResolution: '720P',
      durations: [3, 5, 8, 10, 15, 20, 30],
      defaultDuration: 5,
      negativePrompt: true,
      seed: true,
      audio: true,
      promptExtend: true,
    },
  },
];

// ── Mock (offline test provider) ─────────────────────────────
export const MOCK_MODELS: ModelInfo[] = [
  {
    id: 'mock-image',
    providerModelId: 'mock-image',
    name: 'Mock Image',
    description: 'Instant placeholder images. Free; for testing the app without API keys.',
    capabilities: { ...imageBase, maxSourceImages: 4, seed: true, negativePrompt: true, aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'], defaultAspectRatio: '1:1', resolutions: ['1K'], defaultResolution: '1K' },
  },
  {
    id: 'mock-video',
    providerModelId: 'mock-video',
    name: 'Mock Video',
    description: 'Test-pattern clips generated locally with ffmpeg.',
    capabilities: {
      ...videoBase,
      lastFrame: true,
      maxReferenceImages: 4,
      framesWithReferences: true,
      aspectRatios: ['16:9', '9:16', '1:1'],
      defaultAspectRatio: '16:9',
      resolutions: ['480p', '720p'],
      defaultResolution: '480p',
      durations: [2, 4, 6],
      defaultDuration: 4,
      audio: true,
    },
  },
];
