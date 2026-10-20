import type { ProviderInfo } from '@imagination/shared';
import { config } from '../config.js';
import { notFound } from '../lib/util.js';
import { geminiProvider } from './gemini.js';
import { xaiProvider } from './xai.js';
import { wanProvider } from './wan.js';
import { mockProvider } from './mock.js';
import type { ProviderAdapter } from './types.js';

/** Register new providers here. */
const ALL: ProviderAdapter[] = [geminiProvider, xaiProvider, wanProvider, mockProvider];

export function providers(): ProviderAdapter[] {
  return ALL.filter((p) => p.id !== 'mock' || config.ENABLE_MOCK_PROVIDER);
}

export function getProvider(id: string): ProviderAdapter {
  const p = providers().find((x) => x.id === id);
  if (!p) throw notFound(`Provider "${id}"`);
  return p;
}

export function providerInfo(): ProviderInfo[] {
  return providers().map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    configured: p.isConfigured(),
    envKeys: p.envKeys,
    models: p.models,
  }));
}
