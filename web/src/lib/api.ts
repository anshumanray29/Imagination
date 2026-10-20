import type {
  Asset,
  Character,
  CreateGenerationBody,
  Generation,
  MediaKind,
  Page,
  ProviderInfo,
  SystemStatus,
} from '@imagination/shared';

export class ApiError extends Error {}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
};

export interface AssetQuery {
  kind?: MediaKind;
  source?: 'upload' | 'generated' | 'derived';
  favorite?: boolean;
  q?: string;
  provider?: string;
}

export const api = {
  providers: () => request<ProviderInfo[]>('GET', '/api/providers'),
  testProvider: (id: string) => request<{ ok: boolean; message: string }>('POST', `/api/providers/${id}/test`),

  assets: (q: AssetQuery & { cursor?: string; limit?: number }) => request<Page<Asset>>('GET', `/api/assets${qs({ ...q })}`),
  asset: (id: string) => request<Asset>('GET', `/api/assets/${id}`),
  upload: (files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append('file', f, f.name));
    return request<Asset[]>('POST', '/api/assets/upload', form);
  },
  updateAsset: (id: string, patch: { favorite?: boolean; name?: string | null }) => request<Asset>('PATCH', `/api/assets/${id}`, patch),
  deleteAsset: (id: string) => request<{ ok: true }>('DELETE', `/api/assets/${id}`),
  bulkDeleteAssets: (ids: string[]) => request<{ ok: true }>('POST', '/api/assets/bulk-delete', { ids }),

  generations: (q: { active?: boolean; status?: string; batchId?: string; cursor?: string; limit?: number }) =>
    request<Page<Generation>>('GET', `/api/generations${qs(q)}`),
  generation: (id: string) => request<Generation>('GET', `/api/generations/${id}`),
  createGenerations: (body: CreateGenerationBody) => request<Generation[]>('POST', '/api/generations', body),
  cancelGeneration: (id: string) => request<Generation>('POST', `/api/generations/${id}/cancel`),
  retryGeneration: (id: string) => request<Generation>('POST', `/api/generations/${id}/retry`),
  deleteGeneration: (id: string) => request<{ ok: true }>('DELETE', `/api/generations/${id}`),

  characters: () => request<Character[]>('GET', '/api/characters'),
  character: (id: string) => request<Character>('GET', `/api/characters/${id}`),
  createCharacter: (body: { name: string; description?: string; assetIds?: string[] }) => request<Character>('POST', '/api/characters', body),
  updateCharacter: (id: string, patch: { name?: string; description?: string; coverAssetId?: string | null }) =>
    request<Character>('PATCH', `/api/characters/${id}`, patch),
  deleteCharacter: (id: string) => request<{ ok: true }>('DELETE', `/api/characters/${id}`),
  addCharacterImages: (id: string, assetIds: string[]) => request<Character>('POST', `/api/characters/${id}/images`, { assetIds }),
  removeCharacterImage: (id: string, assetId: string) => request<Character>('DELETE', `/api/characters/${id}/images/${assetId}`),

  enhancePrompt: (prompt: string, kind: MediaKind) =>
    request<{ prompt: string; provider: string }>('POST', '/api/tools/enhance-prompt', { prompt, kind }),
  describeCharacter: (assetIds: string[]) => request<{ description: string; provider: string }>('POST', '/api/tools/describe-character', { assetIds }),
  extractFrame: (assetId: string, at: 'first' | 'last' | number) => request<Asset>('POST', '/api/tools/extract-frame', { assetId, at }),
  stitch: (assetIds: string[]) => request<Asset>('POST', '/api/tools/stitch', { assetIds }),

  status: () => request<SystemStatus>('GET', '/api/system/status'),
  testStorage: () => request<{ ok: boolean; message: string }>('POST', '/api/system/test-storage'),
  migrateToR2: () => request<{ moved: number; failed: string[] }>('POST', '/api/system/migrate-to-r2'),
  backup: () => request<{ ok: boolean; message: string }>('POST', '/api/system/backup'),
};
