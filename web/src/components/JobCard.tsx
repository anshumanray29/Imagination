import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Ban, Clock, Loader2, MoreHorizontal, Repeat2, RotateCcw, Trash2 } from 'lucide-react';
import { MODE_LABELS, type Generation } from '@imagination/shared';
import { api } from '@/lib/api';
import { elapsed, timeAgo, usd } from '@/lib/format';
import { useModelName } from '@/lib/models';
import { useAsset } from '@/lib/queries';
import { useStudio } from '@/lib/studio';
import { MediaThumb } from './MediaThumb';
import { Badge, IconButton } from './ui';
import { toast } from './toast';

const STATUS_TONE = { queued: 'default', running: 'accent', succeeded: 'green', failed: 'red', canceled: 'amber' } as const;

function Output({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  const { data } = useAsset(id);
  if (!data) return <div className="shimmer aspect-square rounded-xl" />;
  return <MediaThumb asset={data} onClick={() => onOpen(id)} />;
}

function useTicker(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
}

export function JobCard({ gen, onOpen }: { gen: Generation; onOpen: (assetId: string, all: string[]) => void }) {
  const modelName = useModelName();
  const remix = useStudio((s) => s.remix);
  const [menu, setMenu] = useState(false);
  const active = gen.status === 'queued' || gen.status === 'running';
  useTicker(active);
  const expected = gen.kind === 'video' ? 1 : (gen.params.count ?? 1);

  const act = async (fn: () => Promise<unknown>) => {
    setMenu(false);
    try {
      await fn();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="rounded-2xl border border-line bg-panel p-3">
      <div className="mb-2.5 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold">{modelName(gen.provider, gen.model)}</span>
            <Badge>{MODE_LABELS[gen.mode]}</Badge>
            <Badge tone={STATUS_TONE[gen.status]}>
              {gen.status === 'running' && <Loader2 className="size-2.5 animate-spin" />}
              {gen.status}
            </Badge>
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-muted" title={gen.prompt}>
            {gen.prompt || <span className="italic">No prompt</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-xs text-faint">
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {active ? elapsed(gen.startedAt ?? gen.createdAt) : timeAgo(gen.createdAt)}
          </span>
          {gen.costUsd !== null && gen.costUsd > 0 && <span className="ml-1.5 text-muted">{usd(gen.costUsd)}</span>}
          <div className="relative">
            <IconButton label="Actions" onClick={() => setMenu((m) => !m)}>
              <MoreHorizontal className="size-4" />
            </IconButton>
            {menu && (
              <div className="absolute top-full right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-line bg-panel-2 py-1 text-sm shadow-xl" onMouseLeave={() => setMenu(false)}>
                <MenuItem icon={<Repeat2 className="size-3.5" />} onClick={() => (setMenu(false), remix(gen))}>
                  Remix in Studio
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
                    <MenuItem
                      icon={<Trash2 className="size-3.5" />}
                      onClick={() => act(() => api.deleteGeneration(gen.id).then(() => toast.info('Job removed from history (files kept)')))}
                    >
                      Remove from history
                    </MenuItem>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {gen.status === 'succeeded' || gen.outputAssetIds.length ? (
        <div className={clsx('grid gap-2', gen.outputAssetIds.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
          {gen.outputAssetIds.map((id) => (
            <Output key={id} id={id} onOpen={(assetId) => onOpen(assetId, gen.outputAssetIds)} />
          ))}
        </div>
      ) : active ? (
        <div className={clsx('grid gap-2', expected > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
          {Array.from({ length: expected }, (_, i) => (
            <div key={i} className="shimmer relative flex aspect-square items-end overflow-hidden rounded-xl">
              <div className="w-full p-3">
                <div className="mb-1.5 flex justify-between text-[11px] text-muted">
                  <span>{gen.status === 'queued' ? 'Waiting in queue…' : gen.progress ? 'Generating…' : 'Submitting…'}</span>
                  {gen.progress !== null && gen.progress > 1 && <span>{gen.progress}%</span>}
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-white/5">
                  <div className="bg-brand h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(4, gen.progress ?? 0)}%` }} />
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
    </div>
  );
}

function MenuItem({ icon, children, onClick }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/5">
      {icon}
      {children}
    </button>
  );
}
