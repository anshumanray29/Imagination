import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import clsx from 'clsx';
import { Download, Film, Heart, ImagePlus, Play, Scissors } from 'lucide-react';
import type { Asset } from '@imagination/shared';
import { api } from '@/lib/api';
import { duration } from '@/lib/format';
import { useModelName } from '@/lib/models';
import { useStudio } from '@/lib/studio';
import { ProviderBadge, Tooltip } from './ui';
import { toast } from './toast';

/** Gallery/feed tile: hover preview for videos plus one-click actions. */
export function MediaTile({
  asset,
  onOpen,
  aspect = 'natural',
  showMeta = true,
  selected,
  topLeft,
}: {
  asset: Asset;
  onOpen: () => void;
  aspect?: 'natural' | 'square';
  showMeta?: boolean;
  selected?: boolean;
  topLeft?: ReactNode;
}) {
  const [hover, setHover] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const navigate = useNavigate();
  const studio = useStudio();
  const modelName = useModelName();
  const ratio = aspect === 'natural' && asset.width && asset.height ? `${asset.width} / ${asset.height}` : '1 / 1';

  const stop = (fn: () => void | Promise<void>) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    void Promise.resolve(fn()).catch(toast.error);
  };

  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ aspectRatio: ratio }}
      className={clsx(
        'group checker relative w-full cursor-pointer overflow-hidden rounded-xl border transition duration-200',
        selected ? 'border-accent ring-2 ring-accent/40' : 'border-line hover:border-line-strong hover:shadow-2xl hover:shadow-black/50',
      )}
    >
      {!loaded && <div className="shimmer absolute inset-0" />}
      <img
        src={asset.thumbUrl}
        alt={asset.prompt ?? asset.name ?? ''}
        loading="lazy"
        draggable={false}
        onLoad={() => setLoaded(true)}
        className={clsx('absolute inset-0 size-full object-cover transition duration-500', loaded ? 'opacity-100' : 'opacity-0', 'group-hover:scale-[1.03]')}
      />
      {asset.kind === 'video' && hover && <video src={asset.url} muted autoPlay loop playsInline className="absolute inset-0 size-full object-cover" />}

      {/* Always-visible markers */}
      {asset.kind === 'video' && (
        <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur transition group-hover:opacity-0">
          <Play className="size-2.5 fill-current" /> {duration(asset.durationMs)}
        </span>
      )}
      {asset.favorite && !hover && (
        <span className="absolute top-2 right-2 rounded-md bg-black/55 p-1 text-pink-400 backdrop-blur">
          <Heart className="size-3 fill-current" />
        </span>
      )}
      {topLeft}

      {/* Hover layer */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/30 opacity-0 transition duration-200 group-hover:opacity-100" />
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition duration-200 group-hover:opacity-100">
        <TileButton label={asset.favorite ? 'Unfavorite' : 'Favorite'} onClick={stop(() => api.updateAsset(asset.id, { favorite: !asset.favorite }).then(() => undefined))}>
          <Heart className={clsx('size-3.5', asset.favorite && 'fill-pink-400 text-pink-400')} />
        </TileButton>
        <TileButton label="Download" href={`${asset.url}?download=1`}>
          <Download className="size-3.5" />
        </TileButton>
      </div>
      <div className="absolute inset-x-0 bottom-0 translate-y-1 p-2.5 opacity-0 transition duration-200 group-hover:translate-y-0 group-hover:opacity-100">
        {showMeta && asset.prompt && <p className="mb-2 line-clamp-2 text-[11px] leading-snug text-white/90">{asset.prompt}</p>}
        <div className="flex items-center gap-1.5">
          {showMeta && asset.provider && (
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[10px] font-medium text-white/70">
              <ProviderBadge provider={asset.provider} size="xs" />
              <span className="truncate">{modelName(asset.provider, asset.model)}</span>
            </span>
          )}
          {!showMeta || !asset.provider ? <span className="flex-1" /> : null}
          {asset.kind === 'image' ? (
            <>
              <TileButton label="Edit in Studio" onClick={stop(() => (studio.addSource(asset.id), navigate('/')))}>
                <ImagePlus className="size-3.5" />
              </TileButton>
              <TileButton label="Animate" onClick={stop(() => (studio.animate(asset.id), navigate('/')))}>
                <Film className="size-3.5" />
              </TileButton>
            </>
          ) : (
            <TileButton
              label="Continue from last frame"
              onClick={stop(async () => {
                const frame = await api.extractFrame(asset.id, 'last');
                studio.animate(frame.id);
                navigate('/');
                toast.success('Last frame set as the start frame of a new clip');
              })}
            >
              <Scissors className="size-3.5" />
            </TileButton>
          )}
        </div>
      </div>
    </div>
  );
}

const tileButtonClass =
  'pointer-events-auto flex size-7 items-center justify-center rounded-lg bg-black/55 text-white backdrop-blur transition hover:bg-white hover:text-zinc-900';

function TileButton({ label, children, onClick, href }: { label: string; children: ReactNode; onClick?: (e: React.MouseEvent) => void; href?: string }) {
  return (
    <Tooltip label={label}>
      {href ? (
        <a href={href} aria-label={label} onClick={(e) => e.stopPropagation()} className={tileButtonClass}>
          {children}
        </a>
      ) : (
        <button type="button" aria-label={label} onClick={onClick} className={tileButtonClass}>
          {children}
        </button>
      )}
    </Tooltip>
  );
}
