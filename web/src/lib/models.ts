import { useMemo } from 'react';
import type { ModelInfo, ProviderInfo } from '@imagination/shared';
import { useProviders } from './queries';
import { modelKey } from './studio';

export interface ModelEntry {
  key: string;
  provider: ProviderInfo;
  model: ModelInfo;
}

export function useModelIndex() {
  const { data } = useProviders();
  return useMemo(() => {
    const map = new Map<string, ModelEntry>();
    for (const provider of data ?? []) {
      for (const model of provider.models) map.set(modelKey(provider.id, model.id), { key: modelKey(provider.id, model.id), provider, model });
    }
    return map;
  }, [data]);
}

export function useModelName() {
  const index = useModelIndex();
  return (provider: string | null | undefined, model: string | null | undefined) => {
    if (!provider || !model) return null;
    const e = index.get(modelKey(provider, model));
    return e ? e.model.name : model;
  };
}
