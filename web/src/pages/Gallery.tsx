import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { CheckSquare, Film, Grid3x3, Heart, Images, Loader2, Search, Square, Trash2, Upload, UserPlus, X } from 'lucide-react';
import type { Asset, MediaKind } from '@imagination/shared';
import { api, type AssetQuery } from '@/lib/api';
import { dayLabel } from '@/lib/format';
import { providerMeta } from '@/lib/providers';
import { useAssets, useCharacters, useProviders } from '@/lib/queries';
import { pickFiles, useUpload } from '@/lib/upload';
import { AssetViewer } from '@/components/AssetViewer';
import { MediaTile } from '@/components/MediaTile';
import { Button, Chip, Empty, inputClass, PageHeader, ProviderBadge, Segmented } from '@/components/ui';
import { toast } from '@/components/toast';

const DENSITY_KEY = 'img-gallery-columns';

function readColumns(): number {
  try {
    const n = Number(localStorage.getItem(DENSITY_KEY));
    return n >= 2 && n <= 8 ? n : 5;
  } catch {
    return 5;
  }
}

export function GalleryPage() {
  const [kind, setKind] = useState<'all' | MediaKind>('all');
  const [source, setSource] = useState<'all' | 'generated' | 'upload' | 'derived'>('all');
  const [favorite, setFavorite] = useState(false);
  const [provider, setProvider] = useState<string>('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [columns, setColumns] = useState(readColumns);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [viewer, setViewer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [charMenu, setCharMenu] = useState(false);
  const [dragging, setDragging] = useState(false);
  const { data: providers } = useProviders();
  const { data: characters } = useCharacters();
  const { upload, uploading } = useUpload();

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    try {
      localStorage.setItem(DENSITY_KEY, String(columns));
    } catch {
      /* storage unavailable */
    }
  }, [columns]);

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
  const groups = useMemo(() => {
    const out: { label: string; items: Asset[] }[] = [];
    for (const a of items) {
      const label = dayLabel(a.createdAt);
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(a);
      else out.push({ label, items: [a] });
    }
    return out;
  }, [items]);
  const selectedAssets = items.filter((a) => selected.includes(a.id));

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '800px' },
    );
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
  const filtered = q || favorite || source !== 'all' || kind !== 'all' || provider;

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onDragEnter={(e) => e.dataTransfer.types.includes('Files') && setDragging(true)}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void upload(Array.from(e.dataTransfer.files));
      }}
    >
      {dragging && (
        <div className="animate-fade-in pointer-events-none absolute inset-4 z-40 flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-accent/60 bg-bg/85 text-sm font-medium backdrop-blur">
          <Upload className="size-7 text-accent" />
          Drop to upload to your library
        </div>
      )}

      <PageHeader title="Gallery" subtitle={items.length ? `${items.length}${hasNextPage ? '+' : ''} items` : undefined}>
        <Segmented
          size="sm"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: 'All' },
            { value: 'image', label: 'Images' },
            { value: 'video', label: 'Videos' },
          ]}
        />
        <div className="relative min-w-48 flex-1">
          <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-faint" />
          <input className={clsx(inputClass, 'h-9 py-0 pl-8 text-xs')} placeholder="Search prompts and names…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-faint" title="Tile size">
          <Grid3x3 className="size-3.5" />
          <input type="range" className="slider w-24" min={2} max={8} value={10 - columns} onChange={(e) => setColumns(10 - Number(e.target.value))} />
        </label>
        <Button size="sm" variant={selecting ? 'secondary' : 'ghost'} icon={<CheckSquare className="size-3.5" />} onClick={() => (selecting ? exitSelect() : setSelecting(true))}>
          {selecting ? 'Done' : 'Select'}
        </Button>
        <Button size="sm" variant="primary" loading={uploading} icon={<Upload className="size-3.5" />} onClick={async () => upload(await pickFiles('image/*,video/*'))}>
          Upload
        </Button>
        <div className="flex w-full flex-wrap items-center gap-1.5">
          {(['all', 'generated', 'upload', 'derived'] as const).map((s) => (
            <Chip key={s} active={source === s} onClick={() => setSource(s)}>
              {s === 'all' ? 'Any source' : s === 'generated' ? 'Generated' : s === 'upload' ? 'Uploads' : 'Frames & stitches'}
            </Chip>
          ))}
          <Chip active={favorite} onClick={() => setFavorite((v) => !v)}>
            <Heart className={clsx('size-3', favorite && 'fill-current text-pink-400')} /> Favorites
          </Chip>
          <span className="mx-1 h-4 w-px bg-line" />
          <Chip active={!provider} onClick={() => setProvider('')}>
            All providers
          </Chip>
          {providers
            ?.filter((p) => p.configured)
            .map((p) => (
              <Chip key={p.id} active={provider === p.id} onClick={() => setProvider(provider === p.id ? '' : p.id)}>
                <ProviderBadge provider={p.id} size="xs" /> {providerMeta(p.id).label}
              </Chip>
            ))}
        </div>
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 pt-4 pb-24">
        {isLoading ? (
          <div className="flex justify-center py-20 text-muted">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : items.length ? (
          groups.map((g) => (
            <section key={g.label} className="mb-8">
              <h3 className="mb-3 flex items-baseline gap-2 text-sm font-semibold">
                {g.label}
                <span className="text-xs font-normal text-faint">{g.items.length}</span>
              </h3>
              <div style={{ columnCount: columns, columnGap: '0.75rem' }}>
                {g.items.map((a) => {
                  const isSel = selected.includes(a.id);
                  return (
                    <div key={a.id} className="mb-3 break-inside-avoid">
                      <MediaTile
                        asset={a}
                        selected={isSel}
                        onOpen={() => (selecting ? setSelected((s) => (isSel ? s.filter((x) => x !== a.id) : [...s, a.id])) : setViewer(a.id))}
                        topLeft={
                          selecting && (
                            <span className="absolute top-2 left-2 z-10 rounded-md bg-black/60 p-0.5 text-white">
                              {isSel ? <CheckSquare className="size-4 text-accent" /> : <Square className="size-4" />}
                            </span>
                          )
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        ) : (
          <Empty icon={<Images className="size-6" />} title={filtered ? 'No matches' : 'Your gallery is empty'}>
            {filtered ? 'Try clearing a filter or searching for something else.' : 'Drop images or videos anywhere on this page to upload them, or create something in the Studio.'}
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
        <div className="animate-slide-up glass fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-line-strong px-3 py-2 shadow-2xl">
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
                <div className="animate-pop-in absolute bottom-full left-0 mb-2 w-56 overflow-hidden rounded-xl border border-line-strong bg-panel-2 py-1 shadow-2xl">
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
          <button onClick={exitSelect} className="rounded-md p-1 text-muted hover:text-fg" aria-label="Cancel selection">
            <X className="size-4" />
          </button>
        </div>
      )}

      {viewer && <AssetViewer assetId={viewer} ids={ids} onNavigate={setViewer} onClose={() => setViewer(null)} />}
    </div>
  );
}
