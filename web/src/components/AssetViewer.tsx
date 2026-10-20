import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Film,
  Heart,
  ImagePlus,
  Repeat2,
  Scissors,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { MODE_LABELS, type Asset } from '@imagination/shared';
import { api } from '@/lib/api';
import { bytes, duration, usd } from '@/lib/format';
import { useModelName } from '@/lib/models';
import { useAsset, useCharacters } from '@/lib/queries';
import { useStudio } from '@/lib/studio';
import { Badge, Button, IconButton } from './ui';
import { toast } from './toast';

export function AssetViewer({ assetId, ids, onNavigate, onClose }: { assetId: string; ids?: string[]; onNavigate?: (id: string) => void; onClose: () => void }) {
  const navigate = useNavigate();
  const { data: asset } = useAsset(assetId);
  const { data: generation } = useQuery({
    queryKey: ['generation', asset?.generationId],
    queryFn: () => api.generation(asset!.generationId!),
    enabled: Boolean(asset?.generationId),
  });
  const { data: characters } = useCharacters();
  const modelName = useModelName();
  const studio = useStudio();
  const [charMenu, setCharMenu] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const index = ids?.indexOf(assetId) ?? -1;
  const prev = ids && index > 0 ? ids[index - 1] : null;
  const next = ids && index >= 0 && index < ids.length - 1 ? ids[index + 1] : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && prev) onNavigate?.(prev);
      if (e.key === 'ArrowRight' && next) onNavigate?.(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, onClose, onNavigate]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const toStudio = (fn: () => void) => {
    fn();
    onClose();
    navigate('/');
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex bg-black/90 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="relative flex min-w-0 flex-1 items-center justify-center p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        {asset ? (
          asset.kind === 'image' ? (
            <img src={asset.url} alt={asset.prompt ?? ''} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" onMouseDown={(e) => e.stopPropagation()} />
          ) : (
            <video
              key={asset.id}
              src={asset.url}
              controls
              autoPlay
              loop
              playsInline
              className="max-h-full max-w-full rounded-lg shadow-2xl"
              onMouseDown={(e) => e.stopPropagation()}
            />
          )
        ) : (
          <div className="shimmer size-96 rounded-xl" />
        )}
        {prev && (
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onNavigate?.(prev)}
            className="absolute top-1/2 left-4 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <ChevronLeft className="size-5" />
          </button>
        )}
        {next && (
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onNavigate?.(next)}
            className="absolute top-1/2 right-4 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <ChevronRight className="size-5" />
          </button>
        )}
      </div>

      <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <Badge tone={asset?.source === 'generated' ? 'accent' : 'default'}>{asset?.source}</Badge>
            {asset?.kind === 'video' && <Badge>video · {duration(asset.durationMs)}</Badge>}
          </div>
          <IconButton label="Close (Esc)" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>

        {asset && (
          <div className="flex-1 space-y-5 overflow-y-auto p-4">
            {asset.prompt && (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Prompt</h3>
                  <IconButton
                    label="Copy prompt"
                    onClick={() => {
                      navigator.clipboard.writeText(asset.prompt ?? '');
                      toast.success('Prompt copied');
                    }}
                  >
                    <Copy className="size-3.5" />
                  </IconButton>
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{asset.prompt}</p>
              </section>
            )}

            <section className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {asset.provider && <Info label="Model" value={modelName(asset.provider, asset.model)} />}
              {generation && <Info label="Mode" value={MODE_LABELS[generation.mode]} />}
              <Info label="Size" value={asset.width ? `${asset.width}×${asset.height}` : '—'} />
              <Info label="File" value={`${asset.mime.split('/')[1]?.toUpperCase()} · ${bytes(asset.sizeBytes)}`} />
              {generation?.params.aspectRatio && <Info label="Aspect" value={generation.params.aspectRatio} />}
              {generation?.params.resolution && <Info label="Resolution" value={generation.params.resolution} />}
              {generation?.params.seed !== undefined && <Info label="Seed" value={String(generation.params.seed)} />}
              {generation && <Info label="Cost" value={usd(generation.costUsd)} />}
              <Info label="Created" value={new Date(asset.createdAt).toLocaleString()} />
              <Info label="Stored in" value={asset.storage === 'r2' ? 'Cloudflare R2' : 'Local disk'} />
            </section>

            {generation?.finalPrompt && generation.finalPrompt !== generation.prompt && (
              <details className="rounded-lg border border-line bg-panel-2 p-3 text-xs text-muted">
                <summary className="cursor-pointer font-medium text-fg">Prompt sent to the model</summary>
                <p className="mt-2 whitespace-pre-wrap">{generation.finalPrompt}</p>
              </details>
            )}
          </div>
        )}

        {asset && (
          <div className="space-y-2 border-t border-line p-4">
            <div className="grid grid-cols-2 gap-2">
              {asset.kind === 'image' ? (
                <>
                  <Button icon={<ImagePlus className="size-4" />} onClick={() => toStudio(() => studio.addSource(asset.id))}>
                    Edit / use
                  </Button>
                  <Button icon={<Film className="size-4" />} onClick={() => toStudio(() => studio.animate(asset.id))}>
                    Animate
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    icon={<Scissors className="size-4" />}
                    loading={busy === 'frame'}
                    onClick={() =>
                      run('frame', async () => {
                        const frame = await api.extractFrame(asset.id, 'last');
                        toast.success('Last frame saved — opening it in Studio to continue the shot');
                        toStudio(() => studio.animate(frame.id));
                      })
                    }
                  >
                    Continue
                  </Button>
                  <Button
                    icon={<Scissors className="size-4" />}
                    loading={busy === 'first'}
                    onClick={() => run('first', async () => (await api.extractFrame(asset.id, 'first'), toast.success('First frame saved to the gallery')))}
                  >
                    First frame
                  </Button>
                </>
              )}
              {generation && (
                <Button icon={<Repeat2 className="size-4" />} onClick={() => toStudio(() => studio.remix(generation))}>
                  Remix
                </Button>
              )}
              {asset.kind === 'image' && (
                <div className="relative">
                  <Button className="w-full" icon={<UserPlus className="size-4" />} onClick={() => setCharMenu((v) => !v)}>
                    Character
                  </Button>
                  {charMenu && (
                    <div className="absolute right-0 bottom-full z-10 mb-2 w-56 overflow-hidden rounded-lg border border-line bg-panel-2 py-1 shadow-xl">
                      {(characters ?? []).map((c) => (
                        <button
                          key={c.id}
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-white/5"
                          onClick={() =>
                            run('char', async () => {
                              await api.addCharacterImages(c.id, [asset.id]);
                              setCharMenu(false);
                              toast.success(`Added to ${c.name}`);
                            })
                          }
                        >
                          {c.name}
                        </button>
                      ))}
                      <button
                        className="block w-full border-t border-line px-3 py-2 text-left text-sm text-accent hover:bg-white/5"
                        onClick={() =>
                          run('char', async () => {
                            const name = window.prompt('Name for the new character');
                            if (!name) return;
                            await api.createCharacter({ name, assetIds: [asset.id] });
                            setCharMenu(false);
                            toast.success(`Created character ${name}`);
                          })
                        }
                      >
                        + New character
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                className="flex-1"
                icon={<Heart className={clsx('size-4', asset.favorite && 'fill-pink-400 text-pink-400')} />}
                onClick={() => run('fav', () => api.updateAsset(asset.id, { favorite: !asset.favorite }))}
              >
                {asset.favorite ? 'Favorited' : 'Favorite'}
              </Button>
              <a href={`${asset.url}?download=1`} className="flex-1">
                <Button className="w-full" icon={<Download className="size-4" />}>
                  Download
                </Button>
              </a>
              <IconButton
                label="Delete"
                className="hover:!bg-red-500/10 hover:!text-red-300"
                onClick={() =>
                  run('delete', async () => {
                    if (!confirm('Delete this file permanently (also from storage)?')) return;
                    const fallback = next ?? prev;
                    await api.deleteAsset(asset.id);
                    toast.success('Deleted');
                    if (fallback) onNavigate?.(fallback);
                    else onClose();
                  })
                }
              >
                <Trash2 className="size-4" />
              </IconButton>
            </div>
          </div>
        )}
      </aside>
    </div>,
    document.body,
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium tracking-wide text-faint uppercase">{label}</div>
      <div className="truncate text-fg" title={value ?? ''}>
        {value ?? '—'}
      </div>
    </div>
  );
}

