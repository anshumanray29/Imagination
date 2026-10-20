import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { CheckSquare, Film, Heart, Images, Loader2, Search, Square, Trash2, Upload, UserPlus, X } from 'lucide-react';
import type { MediaKind } from '@imagination/shared';
import { api, type AssetQuery } from '@/lib/api';
import { useAssets, useCharacters, useProviders } from '@/lib/queries';
import { pickFiles, useUpload } from '@/lib/upload';
import { AssetViewer } from '@/components/AssetViewer';
import { MediaThumb } from '@/components/MediaThumb';
import { Button, Chip, Empty, inputClass, Segmented } from '@/components/ui';
import { toast } from '@/components/toast';

export function GalleryPage() {
  const [kind, setKind] = useState<'all' | MediaKind>('all');
  const [source, setSource] = useState<'all' | 'generated' | 'upload' | 'derived'>('all');
  const [favorite, setFavorite] = useState(false);
  const [provider, setProvider] = useState<string>('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [viewer, setViewer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [charMenu, setCharMenu] = useState(false);
  const { data: providers } = useProviders();
  const { data: characters } = useCharacters();
  const { upload, uploading } = useUpload();

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const query: AssetQuery = {
    kind: kind === 'all' ? undefined : kind,
    source: source === 'all' ? undefined : source,
    favorite: favorite || undefined,
    provider: provider || undefined,
    q: q || undefined,
  };
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useAssets(query);
  const items = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  const ids = useMemo(() => items.map((a) => a.id), [items]);
  const selectedAssets = items.filter((a) => selected.includes(a.id));

  // Infinite scroll
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage();
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const exitSelect = () => {
    setSelecting(false);
    setSelected([]);
    setCharMenu(false);
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const videosSelected = selectedAssets.filter((a) => a.kind === 'video');
  const imagesSelected = selectedAssets.filter((a) => a.kind === 'image');

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void upload(Array.from(e.dataTransfer.files));
      }}
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-3">
        <h1 className="mr-2 font-semibold">Gallery</h1>
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: 'All' },
            { value: 'image', label: 'Images' },
            { value: 'video', label: 'Videos' },
          ]}
        />
        <div className="flex gap-1.5">
          {(['all', 'generated', 'upload', 'derived'] as const).map((s) => (
            <Chip key={s} active={source === s} onClick={() => setSource(s)}>
              {s === 'all' ? 'Any source' : s === 'generated' ? 'Generated' : s === 'upload' ? 'Uploads' : 'Edits & frames'}
            </Chip>
          ))}
          <Chip active={favorite} onClick={() => setFavorite((v) => !v)}>
            <span className="flex items-center gap-1">
              <Heart className={clsx('size-3', favorite && 'fill-current text-pink-400')} /> Favorites
            </span>
          </Chip>
        </div>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="h-8 rounded-lg border border-line bg-panel px-2 text-xs text-fg outline-none focus:border-accent/60"
        >
          <option value="">All providers</option>
          {providers?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="relative min-w-48 flex-1">
          <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-faint" />
          <input className={clsx(inputClass, 'h-8 py-0 pl-8 text-xs')} placeholder="Search prompts and names…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button size="sm" variant={selecting ? 'secondary' : 'ghost'} icon={<CheckSquare className="size-3.5" />} onClick={() => (selecting ? exitSelect() : setSelecting(true))}>
          {selecting ? 'Done' : 'Select'}
        </Button>
        <Button size="sm" variant="primary" loading={uploading} icon={<Upload className="size-3.5" />} onClick={async () => upload(await pickFiles('image/*,video/*'))}>
          Upload
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex justify-center py-20 text-muted">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : items.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {items.map((a) => {
              const isSel = selected.includes(a.id);
              return (
                <MediaThumb
                  key={a.id}
                  asset={a}
                  selected={isSel}
                  onClick={() => (selecting ? setSelected((s) => (isSel ? s.filter((x) => x !== a.id) : [...s, a.id])) : setViewer(a.id))}
                  overlay={
                    selecting && (
                      <span className="absolute top-1.5 left-1.5 rounded-md bg-black/60 p-0.5 text-white">
                        {isSel ? <CheckSquare className="size-4 text-accent" /> : <Square className="size-4" />}
                      </span>
                    )
                  }
                />
              );
            })}
          </div>
        ) : (
          <Empty icon={<Images className="size-5" />} title={q || favorite || source !== 'all' || kind !== 'all' ? 'No matches' : 'Your gallery is empty'}>
            Drop images or videos here to upload them, or create something in the Studio.
          </Empty>
        )}
        <div ref={sentinel} className="h-10" />
        {isFetchingNextPage && (
          <div className="flex justify-center text-muted">
            <Loader2 className="size-4 animate-spin" />
          </div>
        )}
      </div>

      {selecting && selected.length > 0 && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-line bg-panel-2/95 px-3 py-2 shadow-2xl backdrop-blur">
          <span className="px-2 text-sm font-medium">{selected.length} selected</span>
          {videosSelected.length >= 2 && (
            <Button
              size="sm"
              icon={<Film className="size-3.5" />}
              loading={busy}
              title="Join clips in the order you selected them"
              onClick={() =>
                run(async () => {
                  const order = selected.filter((id) => videosSelected.some((v) => v.id === id));
                  toast.info('Stitching clips… this can take a minute');
                  const asset = await api.stitch(order);
                  toast.success('Stitched video created');
                  exitSelect();
                  setViewer(asset.id);
                })
              }
            >
              Stitch {videosSelected.length} clips
            </Button>
          )}
          {imagesSelected.length > 0 && (
            <div className="relative">
              <Button size="sm" icon={<UserPlus className="size-3.5" />} onClick={() => setCharMenu((v) => !v)}>
                Add to character
              </Button>
              {charMenu && (
                <div className="absolute bottom-full left-0 mb-2 w-56 overflow-hidden rounded-lg border border-line bg-panel-2 py-1 shadow-xl">
                  {(characters ?? []).map((c) => (
                    <button
                      key={c.id}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-white/5"
                      onClick={() =>
                        run(async () => {
                          await api.addCharacterImages(c.id, imagesSelected.map((a) => a.id));
                          toast.success(`Added ${imagesSelected.length} image(s) to ${c.name}`);
                          exitSelect();
                        })
                      }
                    >
                      {c.name}
                    </button>
                  ))}
                  <button
                    className="block w-full border-t border-line px-3 py-2 text-left text-sm text-accent hover:bg-white/5"
                    onClick={() =>
                      run(async () => {
                        const name = window.prompt('Name for the new character');
                        if (!name) return;
                        await api.createCharacter({ name, assetIds: imagesSelected.map((a) => a.id) });
                        toast.success(`Created ${name}`);
                        exitSelect();
                      })
                    }
                  >
                    + New character
                  </button>
                </div>
              )}
            </div>
          )}
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 className="size-3.5" />}
            loading={busy}
            onClick={() =>
              run(async () => {
                if (!confirm(`Delete ${selected.length} file(s) permanently (also from storage)?`)) return;
                await api.bulkDeleteAssets(selected);
                toast.success('Deleted');
                exitSelect();
              })
            }
          >
            Delete
          </Button>
          <button onClick={exitSelect} className="rounded-md p-1 text-muted hover:text-fg">
            <X className="size-4" />
          </button>
        </div>
      )}

      {viewer && <AssetViewer assetId={viewer} ids={ids} onNavigate={setViewer} onClose={() => setViewer(null)} />}
    </div>
  );
}
