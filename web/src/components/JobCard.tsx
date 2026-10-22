import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Ban, Copy, MoreHorizontal, Repeat2, RotateCcw, Trash2 } from 'lucide-react';
import { MODE_LABELS, type Generation } from '@imagination/shared';
import { api } from '@/lib/api';
import { elapsed, timeAgo, usd } from '@/lib/format';
import { useModelName } from '@/lib/models';
import { useAsset, useGenerations } from '@/lib/queries';
import { useStudio } from '@/lib/studio';
import { MediaTile } from './MediaTile';
import { Badge, IconButton, ProviderBadge } from './ui';
import { toast } from './toast';

const STATUS_TONE = { queued: 'default', running: 'accent', succeeded: 'green', failed: 'red', canceled: 'amber' } as const;

function Output({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  const { data } = useAsset(id);
  if (!data) return <div className="shimmer aspect-square rounded-xl" />;
  return <MediaTile asset={data} onOpen={() => onOpen(id)} showMeta={false} />;
}

function useTicker(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
}

/** Typical run time of a model, from its recent successful jobs (median, seconds). */
function useTypicalSeconds(provider: string, model: string): number | null {
  const { data } = useGenerations(60);
  return useMemo(() => {
    const times = (data?.items ?? [])
      .filter((g) => g.provider === provider && g.model === model && g.status === 'succeeded' && g.startedAt && g.finishedAt)
      .map((g) => (g.finishedAt! - g.startedAt!) / 1000)
      .sort((a, b) => a - b);
    return times.length ? times[Math.floor(times.length / 2)]! : null;
  }, [data, provider, model]);
}

export function JobCard({ gen, onOpen }: { gen: Generation; onOpen: (assetId: string, all: string[]) => void }) {
  const modelName = useModelName();
  const remix = useStudio((s) => s.remix);
  const [menu, setMenu] = useState(false);
  const active = gen.status === 'queued' || gen.status === 'running';
  useTicker(active);
  const typical = useTypicalSeconds(gen.provider, gen.model);
  const expected = gen.kind === 'video' ? 1 : (gen.params.count ?? 1);

  const runningFor = gen.startedAt ? (Date.now() - gen.startedAt) / 1000 : 0;
  // Providers rarely report progress; estimate it from how long this model usually takes.
  const estimated = typical ? Math.min(95, Math.round((runningFor / typical) * 100)) : null;
  const progress = gen.status === 'running' ? Math.max(gen.progress && gen.progress > 1 ? gen.progress : 0, estimated ?? 0) : 0;
  const remaining = typical && gen.status === 'running' ? Math.max(0, Math.round(typical - runningFor)) : null;

  const act = async (fn: () => Promise<unknown>) => {
    setMenu(false);
    try {
      await fn();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <article className={clsx('animate-slide-up raised rounded-2xl border bg-panel/80 p-3', active ? 'border-accent/25' : 'border-line')}>
      <header className="mb-3 flex items-start gap-2.5">
        <ProviderBadge provider={gen.provider} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{modelName(gen.provider, gen.model)}</span>
            <Badge tone={STATUS_TONE[gen.status]}>{gen.status}</Badge>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-faint">
            <span>{MODE_LABELS[gen.mode]}</span>
            <span>·</span>
            <span>{active ? `${elapsed(gen.startedAt ?? gen.createdAt)} elapsed` : timeAgo(gen.createdAt)}</span>
            {gen.costUsd !== null && gen.costUsd > 0 && (
              <>
                <span>·</span>
                <span className="font-medium text-muted">{usd(gen.costUsd)}</span>
              </>
            )}
          </div>
        </div>
        <div className="relative">
          <IconButton label="Actions" tip={false} onClick={() => setMenu((m) => !m)}>
            <MoreHorizontal className="size-4" />
          </IconButton>
          {menu && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setMenu(false)} />
              <div className="animate-pop-in absolute top-full right-0 z-30 mt-1 w-48 overflow-hidden rounded-xl border border-line-strong bg-panel-2 py-1 text-sm shadow-2xl">
                <MenuItem icon={<Repeat2 className="size-3.5" />} onClick={() => (setMenu(false), remix(gen))}>
                  Remix in Studio
                </MenuItem>
                <MenuItem
                  icon={<Copy className="size-3.5" />}
                  onClick={() => (setMenu(false), navigator.clipboard.writeText(gen.prompt), toast.success('Prompt copied'))}
                >
                  Copy prompt
                </MenuItem>
                {active ? (
                  <MenuItem icon={<Ban className="size-3.5" />} onClick={() => act(() => api.cancelGeneration(gen.id))}>
                    Cancel
                  </MenuItem>
                ) : (
                  <>
                    <MenuItem icon={<RotateCcw className="size-3.5" />} onClick={() => act(() => api.retryGeneration(gen.id))}>
                      Run again
                    </MenuItem>
                    <MenuItem icon={<Trash2 className="size-3.5" />} onClick={() => act(() => api.deleteGeneration(gen.id).then(() => toast.info('Removed from history (files kept)')))}>
                      Remove from history
                    </MenuItem>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      <p className="mb-3 line-clamp-2 text-[13px] leading-relaxed text-fg/80" title={gen.prompt}>
        {gen.prompt || <span className="text-muted italic">No prompt</span>}
      </p>

      {gen.outputAssetIds.length ? (
        <div className={clsx('grid gap-2', gen.outputAssetIds.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
          {gen.outputAssetIds.map((id) => (
            <Output key={id} id={id} onOpen={(assetId) => onOpen(assetId, gen.outputAssetIds)} />
          ))}
        </div>
      ) : active ? (
        <div className={clsx('grid gap-2', expected > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
          {Array.from({ length: expected }, (_, i) => (
            <div key={i} className="shimmer relative flex aspect-square items-end overflow-hidden rounded-xl border border-line">
              <div className="w-full p-3">
                <div className="mb-2 flex items-baseline justify-between text-[11px]">
                  <span className="font-medium text-fg/80">
                    {gen.status === 'queued' ? 'Waiting in queue…' : gen.progress ? 'Generating…' : 'Sending to provider…'}
                  </span>
                  {remaining !== null && gen.status === 'running' && <span className="text-faint">~{remaining > 0 ? `${remaining}s left` : 'any moment'}</span>}
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="flow h-full rounded-full transition-all duration-1000" style={{ width: `${Math.max(gen.status === 'queued' ? 0 : 4, progress)}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {gen.error && (
        <div className={clsx('mt-2 flex gap-2 rounded-lg px-3 py-2 text-xs', gen.status === 'failed' ? 'bg-red-500/10 text-red-300' : 'bg-amber-500/10 text-amber-200')}>
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span className="break-words">{gen.error}</span>
        </div>
      )}
    </article>
  );
}

function MenuItem({ icon, children, onClick }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-fg/90 hover:bg-white/[0.05]">
      <span className="text-muted">{icon}</span>
      {children}
    </button>
  );
}
