import { useEffect } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Generation, ServerEvent } from '@imagination/shared';
import { api, type AssetQuery } from './api';

export const keys = {
  providers: ['providers'] as const,
  assets: (q?: AssetQuery) => (q ? (['assets', q] as const) : (['assets'] as const)),
  asset: (id: string) => ['asset', id] as const,
  generations: ['generations'] as const,
  characters: ['characters'] as const,
  status: ['status'] as const,
};

export const useProviders = () => useQuery({ queryKey: keys.providers, queryFn: api.providers, staleTime: 60_000 });

export const useCharacters = () => useQuery({ queryKey: keys.characters, queryFn: api.characters });

export const useStatus = () => useQuery({ queryKey: keys.status, queryFn: api.status });

export const useAsset = (id: string | null | undefined) =>
  useQuery({ queryKey: keys.asset(id ?? ''), queryFn: () => api.asset(id!), enabled: Boolean(id), staleTime: 30_000 });

export function useAssets(q: AssetQuery) {
  return useInfiniteQuery({
    queryKey: keys.assets(q),
    queryFn: ({ pageParam }) => api.assets({ ...q, cursor: pageParam ?? undefined, limit: 60 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useGenerations(limit = 60) {
  return useQuery({
    queryKey: [...keys.generations, limit],
    queryFn: () => api.generations({ limit }),
    // Safety net in case the live event stream drops.
    refetchInterval: (query) => (query.state.data?.items.some((g) => g.status === 'queued' || g.status === 'running') ? 10_000 : false),
  });
}

type GenPage = { items: Generation[]; nextCursor: string | null };

function applyGeneration(qc: QueryClient, gen: Generation) {
  let refetchHistory = false;
  qc.setQueriesData<GenPage | { pages: GenPage[]; pageParams: unknown[] }>({ queryKey: keys.generations }, (old) => {
    if (!old) return old;
    if ('pages' in old) {
      // Paged history (Jobs page): update in place; new jobs are picked up by a refetch since filters apply.
      let found = false;
      const pages = old.pages.map((p) => ({ ...p, items: p.items.map((g) => (g.id === gen.id ? ((found = true), gen) : g)) }));
      if (!found) refetchHistory = true;
      return found ? { ...old, pages } : old;
    }
    const idx = old.items.findIndex((g) => g.id === gen.id);
    if (idx === -1) return { ...old, items: [gen, ...old.items] };
    const items = old.items.slice();
    items[idx] = gen;
    return { ...old, items };
  });
  if (refetchHistory) qc.invalidateQueries({ queryKey: [...keys.generations, 'history'] });
}

/** One EventSource for the whole app; keeps every query in sync with the server. */
export function useLiveEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let assetsTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshAssets = () => {
      if (assetsTimer) return;
      assetsTimer = setTimeout(() => {
        assetsTimer = null;
        qc.invalidateQueries({ queryKey: keys.assets() });
        qc.invalidateQueries({ queryKey: keys.status });
      }, 300);
    };
    const connect = () => {
      source = new EventSource('/api/events');
      source.onmessage = (msg) => {
        const event = JSON.parse(msg.data) as ServerEvent;
        if (event.type === 'generation') {
          applyGeneration(qc, event.data);
          if (event.data.status === 'succeeded' || event.data.status === 'failed') qc.invalidateQueries({ queryKey: keys.status });
        } else if (event.type === 'asset') {
          qc.setQueryData(keys.asset(event.data.id), event.data);
          refreshAssets();
        } else if (event.type === 'asset-deleted') {
          qc.removeQueries({ queryKey: keys.asset(event.id) });
          refreshAssets();
          qc.invalidateQueries({ queryKey: keys.characters });
        } else if (event.type === 'character') {
          qc.invalidateQueries({ queryKey: keys.characters });
        }
      };
      source.onerror = () => {
        source?.close();
        retry = setTimeout(connect, 3000);
      };
      source.onopen = () => qc.invalidateQueries({ queryKey: keys.generations });
    };
    connect();
    return () => {
      source?.close();
      if (retry) clearTimeout(retry);
      if (assetsTimer) clearTimeout(assetsTimer);
    };
  }, [qc]);
}
