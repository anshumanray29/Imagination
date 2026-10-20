import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import clsx from 'clsx';
import { Clapperboard, Image as ImageIcon, Plus, Star, Trash2, Users, Wand2, X } from 'lucide-react';
import type { Character } from '@imagination/shared';
import { api } from '@/lib/api';
import { useCharacters } from '@/lib/queries';
import { useStudio } from '@/lib/studio';
import { AssetPicker } from '@/components/AssetPicker';
import { Button, Empty, Field, inputClass } from '@/components/ui';
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
      <aside className="flex w-72 shrink-0 flex-col border-r border-line">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h1 className="font-semibold">Characters</h1>
          <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={create}>
            New
          </Button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {characters?.map((c) => {
            const cover = c.assets.find((a) => a.id === c.coverAssetId) ?? c.assets[0];
            return (
              <button
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={clsx('flex w-full items-center gap-3 rounded-xl p-2 text-left transition', active?.id === c.id ? 'bg-panel-2 ring-1 ring-line-strong' : 'hover:bg-panel')}
              >
                {cover ? <img src={cover.thumbUrl} alt="" className="size-11 rounded-lg object-cover" /> : <div className="size-11 rounded-lg bg-line" />}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-muted">{c.assets.length} reference image{c.assets.length === 1 ? '' : 's'}</div>
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
            <Empty icon={<Users className="size-5" />} title="Keep characters consistent">
              <p>
                A character is a name, a short description and 2–6 reference photos (different angles help). Select it in the Studio and IMG sends the photos as
                references and adds the description to your prompt, for images and videos alike.
              </p>
              <Button variant="primary" className="mt-4" icon={<Plus className="size-4" />} onClick={create}>
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
    <div className="mx-auto max-w-4xl space-y-8 p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 bg-transparent text-2xl font-semibold outline-none" />
        <div className="flex gap-2">
          <Button icon={<ImageIcon className="size-4" />} onClick={() => useIn('image')}>
            Use for images
          </Button>
          <Button icon={<Clapperboard className="size-4" />} onClick={() => useIn('video')}>
            Use for videos
          </Button>
        </div>
      </div>

      <Field
        label="Description"
        hint={
          <button className="flex items-center gap-1 text-accent hover:underline disabled:opacity-50" disabled={describing || !character.assets.length} onClick={autoDescribe}>
            <Wand2 className="size-3" /> {describing ? 'Describing…' : 'Auto-describe from photos'}
          </button>
        }
      >
        <textarea
          className={clsx(inputClass, 'min-h-28 leading-relaxed')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Woman in her late 20s, shoulder-length silver hair with bangs, green eyes, freckles, slim build, wears a cropped olive bomber jacket and silver hoop earrings."
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
            Save
          </Button>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Reference images</h2>
          <span className="text-xs text-muted">Clear, well-lit shots from a few angles work best. The ★ image is the cover.</span>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {character.assets.map((a) => {
            const isCover = (character.coverAssetId ?? character.assets[0]?.id) === a.id;
            return (
              <div key={a.id} className="group checker relative aspect-square overflow-hidden rounded-xl border border-line">
                <img src={a.thumbUrl} alt="" className="size-full object-cover" />
                <div className="absolute inset-x-1 top-1 flex justify-between opacity-0 transition group-hover:opacity-100">
                  <button
                    title="Use as cover"
                    onClick={() => api.updateCharacter(character.id, { coverAssetId: a.id }).catch(toast.error)}
                    className={clsx('rounded-md bg-black/70 p-1', isCover ? 'text-amber-300' : 'text-white')}
                  >
                    <Star className={clsx('size-3.5', isCover && 'fill-current')} />
                  </button>
                  <button title="Remove from character" onClick={() => api.removeCharacterImage(character.id, a.id).catch(toast.error)} className="rounded-md bg-black/70 p-1 text-white">
                    <X className="size-3.5" />
                  </button>
                </div>
                {isCover && <Star className="absolute bottom-1.5 left-1.5 size-3.5 fill-amber-300 text-amber-300" />}
              </div>
            );
          })}
          <button
            onClick={() => setPicker(true)}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong text-sm text-muted transition hover:border-accent/60 hover:text-fg"
          >
            <Plus className="size-5" />
            Add images
          </button>
        </div>
      </section>

      <div className="border-t border-line pt-6">
        <Button
          variant="danger"
          size="sm"
          icon={<Trash2 className="size-3.5" />}
          onClick={async () => {
            if (!confirm(`Delete character "${character.name}"? Its images stay in your gallery.`)) return;
            await api.deleteCharacter(character.id).catch(toast.error);
          }}
        >
          Delete character
        </Button>
      </div>

      <AssetPicker
        open={picker}
        onClose={() => setPicker(false)}
        max={12}
        title={`Add reference images for ${character.name}`}
        onPick={(ids) => api.addCharacterImages(character.id, ids).catch(toast.error)}
      />
    </div>
  );
}
