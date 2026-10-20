import { Agent, fetch } from 'undici';
import { summarizeBody } from './util.js';

// Video endpoints can hold a request open for minutes; the default 5-minute header timeout is too short.
const longAgent = new Agent({ headersTimeout: 15 * 60_000, bodyTimeout: 15 * 60_000, connectTimeout: 30_000 });

export class ProviderHttpError extends Error {
  constructor(
    public status: number,
    public body: string,
    provider: string,
  ) {
    super(`${provider} API error ${status}: ${extractErrorMessage(body)}`);
  }
}

function extractErrorMessage(body: string): string {
  try {
    const json = JSON.parse(body);
    const msg =
      json?.error?.message ?? json?.message ?? json?.error ?? json?.output?.message ?? json?.detail ?? json?.code;
    if (typeof msg === 'string' && msg) return summarizeBody(msg);
  } catch {
    /* not JSON */
  }
  return summarizeBody(body) || 'empty response';
}

export interface JsonRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  provider: string;
}

/** Node's fetch reports every network problem as "fetch failed"; surface the real cause. */
function networkError(provider: string, url: string, err: unknown): Error {
  if (err instanceof Error && err.name === 'AbortError') return err;
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
  const detail = cause?.code ?? cause?.message ?? (err instanceof Error ? err.message : String(err));
  return new Error(`${provider}: could not reach ${new URL(url).host} (${detail})`);
}

export async function requestJson<T = any>(url: string, req: JsonRequest): Promise<T> {
  const res = await fetch(url, {
    method: req.method ?? (req.body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...req.headers,
    },
    body: req.body === undefined ? undefined : JSON.stringify(req.body),
    signal: req.signal,
    dispatcher: longAgent,
  }).catch((err) => {
    throw networkError(req.provider, url, err);
  });
  const text = await res.text();
  if (!res.ok) throw new ProviderHttpError(res.status, text, req.provider);
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${req.provider} returned a non-JSON response: ${summarizeBody(text)}`);
  }
}

export async function downloadBuffer(
  url: string,
  opts: { headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<{ buffer: Buffer; contentType: string | null }> {
  const res = await fetch(url, { headers: opts.headers, signal: opts.signal, redirect: 'follow', dispatcher: longAgent }).catch((err) => {
    throw networkError('Download', url, err);
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Download failed (${res.status}): ${summarizeBody(text, 200)}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType: res.headers.get('content-type') };
}
