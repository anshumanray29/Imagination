import type { GenerationMode, GenerationParams, MediaKind, ModelInfo } from '@imagination/shared';
import type { NormalizeOptions } from '../media/image.js';

/** An input image, resolved lazily into whatever form the provider needs. */
export interface InputImage {
  assetId: string;
  /** Original bytes as stored. */
  buffer(): Promise<Buffer>;
  /** Normalized image as raw base64 (no data: prefix). */
  base64(opts?: NormalizeOptions): Promise<{ data: string; mime: string }>;
  /** Normalized image as a data: URI. */
  dataUri(opts?: NormalizeOptions): Promise<string>;
  /**
   * URL the provider can download: a signed R2 link when R2 is configured,
   * otherwise a data: URI (not every provider accepts those).
   */
  url(opts?: NormalizeOptions): Promise<string>;
}

export interface JobContext {
  generationId: string;
  kind: MediaKind;
  mode: GenerationMode;
  model: ModelInfo;
  providerModelId: string;
  /** Final prompt including style and character notes. */
  prompt: string;
  negativePrompt?: string;
  params: GenerationParams;
  /** Image models: images to edit/combine (explicit inputs first, then character references). */
  sources: InputImage[];
  /** Video models: subject references (explicit references first, then character references). */
  references: InputImage[];
  firstFrame?: InputImage;
  lastFrame?: InputImage;
  /** State saved between submit() and poll() calls (persisted in the DB). */
  providerData: Record<string, unknown>;
  signal: AbortSignal;
}

export interface ProviderOutput {
  url?: string;
  /** Extra headers needed to download `url` (e.g. an API key). */
  headers?: Record<string, string>;
  data?: Buffer;
  mime?: string;
}

export type SubmitResult =
  | { status: 'completed'; outputs: ProviderOutput[]; costUsd?: number }
  | { status: 'pending'; taskId: string; providerData?: Record<string, unknown> };

export type PollResult =
  | { status: 'pending'; progress?: number; providerData?: Record<string, unknown> }
  | { status: 'completed'; outputs: ProviderOutput[]; costUsd?: number }
  | { status: 'failed'; error: string };

export interface ProviderAdapter {
  id: string;
  name: string;
  description: string;
  envKeys: string[];
  models: ModelInfo[];
  isConfigured(): boolean;
  /** How a prompt should refer to the i-th (0-based) input image of a request. */
  imageLabel(index: number, kind: MediaKind): string;
  submit(ctx: JobContext): Promise<SubmitResult>;
  poll?(ctx: JobContext, taskId: string): Promise<PollResult>;
  /** Cheap authenticated call used by Settings → "Test connection". */
  test(): Promise<string>;
}
