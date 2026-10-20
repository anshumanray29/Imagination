import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Ban, ListChecks, Loader2, Repeat2, RotateCcw, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { MODE_LABELS, type Generation, type JobStatus } from '@imagination/shared';
import { api } from '@/lib/api';
import { elapsed, usd } from '@/lib/format';
import { useModelName } from '@/lib/models';
import { useStudio } from '@/lib/studio';
import { Badge, Chip, Empty, IconButton } from '@/components/ui';
import { toast } from '@/components/toast';
import { AssetViewer } from '@/components/AssetViewer';

const TONE = { queued: 'default', running: 'accent', succeeded: 'green', failed: 'red', canceled: 'amber' } as const;

export function JobsPage() {
  const [status, setStatus] = useState<'all' | JobStatus>('all');
  const [viewer, setViewer] = useState<{ id: string; ids: string[] } | null>(null);
  const modelName = useModelName();
  const remix = useStudio((s) => s.remix);
  const navigate = useNavigate();
  // Shares the ['generations'] key prefix so live events update this list too.
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['generations', 'history', status],
    queryFn: ({ pageParam }) => api.generations({ status: status === 'all' ? undefined : status, cursor: pageParam ?? undefined, limit: 100 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows: Generation[] = data?.pages.flatMap((p) => p.items) ?? [];

  const act = (fn: () => Promise<unknown>) => fn().catch(toast.error);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-6 py-3">
        <h1 className="mr-2 font-semibold">Queue & history</h1>
        {(['all', 'running', 'queued', 'succeeded', 'failed', 'canceled'] as const).map((s) => (
          <Chip key={s} active={status === s} onClick={() => setStatus(s)}>
            {s}
          </Chip>
        ))}
      </header>
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex justify-center py-20 text-muted">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : rows.length ? (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-bg/95 text-left text-[11px] tracking-wide text-faint uppercase backdrop-blur">
              <tr className="border-b border-line">
                <th className="px-6 py-2 font-medium">Status</th>
                <th className="py-2 font-medium">Model</th>
                <th className="py-2 font-medium">Prompt</th>
                <th className="py-2 font-medium">Outputs</th>
                <th className="py-2 font-medium">Time</th>
                <th className="py-2 font-medium">Cost</th>
                <th className="py-2 pr-6" />
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => {
                const active = g.status === 'queued' || g.status === 'running';
                return (
                  <tr key={g.id} className="border-b border-line/60 align-top hover:bg-panel/60">
                    <td className="px-6 py-3">
                      <Badge tone={TONE[g.status]}>
                        {g.status === 'running' && <Loader2 className="size-2.5 animate-spin" />}
                        {g.status}
                        {g.status === 'running' && g.progress ? ` ${g.progress}%` : ''}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="font-medium">{modelName(g.provider, g.model)}</div>
                      <div className="text-xs text-muted">{MODE_LABELS[g.mode]}</div>
                    </td>
                    <td className="max-w-md py-3 pr-4">
                      <div className="line-clamp-2 text-muted" title={g.prompt}>
                        {g.prompt}
                      </div>
                      {g.error && <div className="mt-1 line-clamp-2 text-xs text-red-300" title={g.error}>{g.error}</div>}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex gap-1">
                        {g.outputAssetIds.slice(0, 4).map((id) => (
                          <img
                            key={id}
                            src={`/api/assets/${id}/thumb`}
                            alt=""
                            onClick={() => setViewer({ id, ids: g.outputAssetIds })}
                            className="size-10 cursor-pointer rounded-md border border-line object-cover hover:border-accent"
                          />
                        ))}
                      </div>
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap text-muted">
                      <div>{new Date(g.createdAt).toLocaleString()}</div>
                      {g.startedAt && <div className="text-xs text-faint">took {elapsed(g.startedAt, g.finishedAt)}</div>}
                    </td>
                    <td className="py-3 pr-4 text-muted">{usd(g.costUsd)}</td>
                    <td className="py-3 pr-6">
                      <div className="flex justify-end">
                        <IconButton label="Remix in Studio" onClick={() => (remix(g), navigate('/'))}>
                          <Repeat2 className="size-4" />
                        </IconButton>
                        {active ? (
                          <IconButton label="Cancel" onClick={() => act(() => api.cancelGeneration(g.id))}>
                            <Ban className="size-4" />
                          </IconButton>
                        ) : (
                          <>
                            <IconButton label="Run again" onClick={() => act(() => api.retryGeneration(g.id))}>
                              <RotateCcw className="size-4" />
                            </IconButton>
                            <IconButton label="Remove from history (keeps files)" onClick={() => act(() => api.deleteGeneration(g.id))}>
                              <Trash2 className="size-4" />
                            </IconButton>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty icon={<ListChecks className="size-5" />} title="No jobs" />
        )}
        {hasNextPage && (
          <div className="flex justify-center p-4">
            <button className="text-sm text-muted hover:text-fg" disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
      {viewer && <AssetViewer assetId={viewer.id} ids={viewer.ids} onNavigate={(id) => setViewer({ ...viewer, id })} onClose={() => setViewer(null)} />}
    </div>
  );
}
