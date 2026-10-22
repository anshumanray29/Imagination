import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import clsx from 'clsx';
import { Clapperboard, Image as ImageIcon, Plus, Star, Trash2, UserRound, Users, Wand2, X } from 'lucide-react';
import type { Character } from '@imagination/shared';
import { api } from '@/lib/api';
import { useCharacters } from '@/lib/queries';
import { useStudio } from '@/lib/studio';
import { AssetPicker } from '@/components/AssetPicker';
import { Button, Empty, Field, inputClass, Tooltip } from '@/components/ui';
import { toast } from '@/components/toast';

export function CharactersPage() {
  const { data: characters, isLoading } = useCharacters();
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = characters?.find((c) => c.id === activeId) ?? characters?.[0] ?? null;

  const create = async () => {
    const name = window.prompt('Character name');
    if (!name?.trim()) return;
    try {
      const c = await api.createCharacter({ name });
      setActiveId(c.id);
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <aside className="glass flex w-80 shrink-0 flex-col border-r border-line">
        <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
          <div>
            <h1 className="text-[15px] font-semibold tracking-tight">Characters</h1>
            <p className="text-xs text-muted">{characters?.length ?? 0} saved</p>
          </div>
          <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={create}>
            New
          </Button>
        </div>
        <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
          {characters?.map((c) => {
            const cover = c.assets.find((a) => a.id === c.coverAssetId) ?? c.assets[0];
            const on = active?.id === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={clsx(
                  'raised flex w-full items-center gap-3 rounded-2xl border p-2.5 text-left transition',
                  on ? 'border-accent/40 bg-accent/[0.07]' : 'border-transparent hover:border-line hover:bg-panel-2/60',
                )}
              >
                {cover ? (
                  <img src={cover.thumbUrl} alt="" className="size-14 rounded-xl object-cover" />
                ) : (
                  <span className="flex size-14 items-center justify-center rounded-xl bg-panel-3 text-faint">
                    <UserRound className="size-6" />
                  </span>
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{c.name}</div>
                  <div className="line-clamp-1 text-xs text-muted">{c.description || 'No description yet'}</div>
                  <div className="mt-0.5 text-[11px] text-faint">{c.assets.length} reference photo{c.assets.length === 1 ? '' : 's'}</div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        {active ? (
          <CharacterDetail key={active.id} character={active} />
        ) : (
          !isLoading && (
            <Empty icon={<Users className="size-6" />} title="Keep characters consistent">
              <p>
                A character is a name, a short description and 2–6 reference photos (different angles help). Select it in the Studio and IMG sends the photos as
                references and describes the person in your prompt — for images and videos alike.
              </p>
              <Button variant="primary" className="mt-5" icon={<Plus className="size-4" />} onClick={create}>
                Create your first character
              </Button>
            </Empty>
          )
        )}
      </main>
    </div>
  );
}

function CharacterDetail({ character }: { character: Character }) {
  const navigate = useNavigate();
  const studio = useStudio();
  const [name, setName] = useState(character.name);
  const [description, setDescription] = useState(character.description);
  const [picker, setPicker] = useState(false);
  const [describing, setDescribing] = useState(false);
  const dirty = name !== character.name || description !== character.description;
  const cover = character.assets.find((a) => a.id === character.coverAssetId) ?? character.assets[0];

  useEffect(() => {
    setName(character.name);
    setDescription(character.description);
  }, [character.name, character.description]);

  const save = async () => {
    try {
      await api.updateCharacter(character.id, { name, description });
      toast.success('Saved');
    } catch (err) {
      toast.error(err);
    }
  };

  const autoDescribe = async () => {
    setDescribing(true);
    try {
      const res = await api.describeCharacter(character.assets.map((a) => a.id));
      setDescription(res.description);
      toast.info(`Description written by ${res.provider} — review it and press Save`);
    } catch (err) {
      toast.error(err);
    } finally {
      setDescribing(false);
    }
  };

  const useIn = (kind: 'image' | 'video') => {
    if (!studio.characterIds.includes(character.id)) studio.toggleCharacter(character.id);
    studio.set({ kind });
    navigate('/');
  };

  return (
    <div className="animate-fade-in">
      {/* Banner */}
      <div className="relative h-44 overflow-hidden border-b border-line">
        {cover ? (
          <img src={cover.thumbUrl} alt="" className="absolute inset-0 size-full scale-110 object-cover opacity-40 blur-2xl" />
        ) : (
          <div className="bg-brand absolute inset-0 opacity-10" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/40 to-transparent" />
        <div className="relative mx-auto flex h-full max-w-5xl items-end gap-5 px-8 pb-5">
          {cover ? (
            <img src={cover.thumbUrl} alt="" className="glow-brand size-24 rounded-2xl object-cover" />
          ) : (
            <span className="flex size-24 items-center justify-center rounded-2xl border border-line bg-panel-2 text-faint">
              <UserRound className="size-10" />
            </span>
          )}
          <div className="min-w-0 flex-1 pb-1">
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-transparent text-3xl font-semibold tracking-tight outline-none" />
            <p className="text-sm text-muted">{character.assets.length} reference photos</p>
          </div>
          <div className="flex gap-2 pb-1">
            <Button icon={<ImageIcon className="size-4" />} onClick={() => useIn('image')}>
              Use for images
            </Button>
            <Button variant="primary" icon={<Clapperboard className="size-4" />} onClick={() => useIn('video')}>
              Use for videos
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-8 px-8 py-6">
        <Field
          label="Description"
          hint={
            <button className="flex items-center gap-1 font-medium text-accent hover:underline disabled:opacity-50" disabled={describing || !character.assets.length} onClick={autoDescribe}>
              <Wand2 className="size-3" /> {describing ? 'Describing…' : 'Auto-describe from photos'}
            </button>
          }
        >
          <textarea
            className={clsx(inputClass, 'min-h-28 leading-relaxed')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Woman in her late 20s, shoulder-length silver hair with bangs, green eyes, freckles, slim build, cropped olive bomber jacket and silver hoop earrings."
          />
        </Field>
        {dirty && (
          <div className="-mt-5 flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setName(character.name);
                setDescription(character.description);
              }}
            >
              Discard
            </Button>
            <Button size="sm" variant="primary" onClick={save}>
              Save changes
            </Button>
          </div>
        )}

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Reference photos</h2>
            <span className="text-xs text-muted">Clear, well-lit shots from a few angles work best · ★ marks the cover</span>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            {character.assets.map((a) => {
              const isCover = (character.coverAssetId ?? character.assets[0]?.id) === a.id;
              return (
                <div key={a.id} className="group checker relative aspect-square overflow-hidden rounded-2xl border border-line">
                  <img src={a.thumbUrl} alt="" className="size-full object-cover transition duration-500 group-hover:scale-105" />
                  <div className="absolute inset-x-1.5 top-1.5 flex justify-between opacity-0 transition group-hover:opacity-100">
                    <Tooltip label="Use as cover">
                      <button
                        onClick={() => api.updateCharacter(character.id, { coverAssetId: a.id }).catch(toast.error)}
                        className={clsx('rounded-lg bg-black/65 p-1.5 backdrop-blur', isCover ? 'text-amber-300' : 'text-white')}
                      >
                        <Star className={clsx('size-3.5', isCover && 'fill-current')} />
                      </button>
                    </Tooltip>
                    <Tooltip label="Remove from character">
                      <button onClick={() => api.removeCharacterImage(character.id, a.id).catch(toast.error)} className="rounded-lg bg-black/65 p-1.5 text-white backdrop-blur">
                        <X className="size-3.5" />
                      </button>
                    </Tooltip>
                  </div>
                  {isCover && <Star className="absolute bottom-2 left-2 size-4 fill-amber-300 text-amber-300 drop-shadow" />}
                </div>
              );
            })}
            <button
              onClick={() => setPicker(true)}
              className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line-strong text-sm text-muted transition hover:border-accent/60 hover:bg-accent/5 hover:text-fg"
            >
              <Plus className="size-5" />
              Add photos
            </button>
          </div>
        </section>

        <div className="border-t border-line pt-6">
          <Button
            variant="danger"
            size="sm"
            icon={<Trash2 className="size-3.5" />}
            onClick={async () => {
              if (!confirm(`Delete character "${character.name}"? Its photos stay in your gallery.`)) return;
              await api.deleteCharacter(character.id).catch(toast.error);
            }}
          >
            Delete character
          </Button>
        </div>
      </div>

      <AssetPicker
        open={picker}
        onClose={() => setPicker(false)}
        max={12}
        title={`Add reference photos for ${character.name}`}
        onPick={(ids) => api.addCharacterImages(character.id, ids).catch(toast.error)}
      />
    </div>
  );
}
