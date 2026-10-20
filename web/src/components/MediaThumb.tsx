import { useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Heart, Play } from 'lucide-react';
import type { Asset } from '@imagination/shared';
import { duration } from '@/lib/format';

export function MediaThumb({
  asset,
  onClick,
  selected,
  className,
  overlay,
  aspect = 'square',
  hoverPlay = true,
}: {
  asset: Asset;
  onClick?: (e: React.MouseEvent) => void;
  selected?: boolean;
  className?: string;
  overlay?: ReactNode;
  aspect?: 'square' | 'natural';
  hoverPlay?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ratio = aspect === 'natural' && asset.width && asset.height ? `${asset.width} / ${asset.height}` : '1 / 1';

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ aspectRatio: ratio }}
      className={clsx(
        'group checker relative cursor-pointer overflow-hidden rounded-xl border transition',
        selected ? 'border-accent ring-2 ring-accent/40' : 'border-line hover:border-line-strong',
        className,
      )}
    >
      {!loaded && <div className="shimmer absolute inset-0" />}
      <img
        src={asset.thumbUrl}
        alt={asset.prompt ?? asset.name ?? ''}
        loading="lazy"
        draggable={false}
        onLoad={() => setLoaded(true)}
        className={clsx('absolute inset-0 size-full object-cover transition duration-300', loaded ? 'opacity-100' : 'opacity-0', 'group-hover:scale-[1.02]')}
      />
      {asset.kind === 'video' && hover && hoverPlay && (
        <video
          ref={videoRef}
          src={asset.url}
          muted
          autoPlay
          loop
          playsInline
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {asset.kind === 'video' && (
        <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
          <Play className="size-2.5 fill-current" /> {duration(asset.durationMs)}
        </span>
      )}
      {asset.favorite && (
        <span className="absolute top-1.5 right-1.5 rounded-md bg-black/55 p-1 text-pink-400 backdrop-blur">
          <Heart className="size-3 fill-current" />
        </span>
      )}
      {overlay}
    </div>
  );
}
