import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import clsx from 'clsx';
import {
  ChevronDown,
  Clapperboard,
  Image as ImageIcon,
  Layers,
  Plus,
  Sparkles,
  Wand2,
  X,
  Users,
  Settings2,
  Loader2,
  Check,
} from 'lucide-react';
import { estimateCost, normalizeParams, STYLE_PRESETS, type GenerationInput, type MediaKind } from '@imagination/shared';
import { api } from '@/lib/api';
import { useModelIndex, type ModelEntry } from '@/lib/models';
import { useAsset, useCharacters, useGenerations, useProviders } from '@/lib/queries';
import { modelKey, splitKey, useStudio } from '@/lib/studio';
import { filesFromClipboard, useUpload } from '@/lib/upload';
import { usd } from '@/lib/format';
import { AssetPicker } from '@/components/AssetPicker';
import { AssetViewer } from '@/components/AssetViewer';
import { JobCard } from '@/components/JobCard';
import { Badge, Button, Chip, Empty, Field, IconButton, inputClass, Segmented, Toggle } from '@/components/ui';
import { toast } from '@/components/toast';

const EXAMPLES: Record<MediaKind, string[]> = {
  image: [
    'A cozy reading nook inside a giant hollow tree, warm lantern light, rain outside',
    'Product shot of a matte black perfume bottle on wet volcanic rock, moody rim light',
    'Portrait of an elderly fisherman with a weathered face, golden hour, 85mm',
  ],
  video: [
    'Slow dolly-in on a lighthouse during a thunderstorm, waves crashing, lightning flashes',
    'A paper boat drifting down a rainy city gutter, macro lens, reflections of neon signs',
    'A fox walks through a snowy forest at dawn, tracking shot, breath visible in the cold air',
  ],
};

export function StudioPage() {
  const s = useStudio();
  const { data: providers } = useProviders();
  const index = useModelIndex();
  const { data: characters } = useCharacters();
  const { data: generations } = useGenerations(60);
  const { upload, uploading } = useUpload();
  const [picker, setPicker] = useState<null | 'sources' | 'first' | 'last' | 'refs'>(null);
  const [modelMenu, setModelMenu] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [viewer, setViewer] = useState<{ id: string; ids: string[] } | null>(null);
  const [feedFilter, setFeedFilter] = useState<'all' | MediaKind>('all');
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const kind = s.kind;
  const params = s.params[kind];

  // All models of this kind, configured ones first.
  const kindModels = useMemo(() => {
    const list: ModelEntry[] = [];
    for (const p of providers ?? []) for (const m of p.models) if (m.capabilities.kind === kind) list.push(index.get(modelKey(p.id, m.id))!);
    return list.filter(Boolean);
  }, [providers, index, kind]);

  // Pick a sensible default model once providers load.
  useEffect(() => {
    if (!providers) return;
    const current = s.selected[kind].filter((k) => index.has(k));
    if (current.length) {
      if (current.length !== s.selected[kind].length) s.set({ selected: { ...s.selected, [kind]: current } });
      return;
    }
    const configured = kindModels.filter((e) => e.provider.configured);
    const pick = configured.find((e) => e.provider.id !== 'mock' && e.model.tags?.includes('recommended')) ?? configured.find((e) => e.provider.id !== 'mock') ?? configured[0] ?? kindModels[0];
    if (pick) s.set({ selected: { ...s.selected, [kind]: [pick.key] } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, kind]);

  const selectedEntries = s.selected[kind].map((k) => index.get(k)).filter((e): e is ModelEntry => Boolean(e));
  const primary = selectedEntries[0];
  const caps = primary?.model.capabilities;

  // Keep params valid for the primary model.
  useEffect(() => {
    if (!caps) return;
    const fixed = normalizeParams(params, caps);
    if (JSON.stringify(fixed) !== JSON.stringify(params)) s.setParams(kind, fixed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primary?.key]);

  const limit = (fn: (c: NonNullable<typeof caps>) => number) =>
    selectedEntries.length ? Math.min(...selectedEntries.map((e) => fn(e.model.capabilities))) : 0;
  const maxSources = limit((c) => c.maxSourceImages);
  const maxRefs = limit((c) => c.maxReferenceImages);
  const canFirst = selectedEntries.length > 0 && selectedEntries.every((e) => e.model.capabilities.firstFrame);
  const canLast = selectedEntries.length > 0 && selectedEntries.every((e) => e.model.capabilities.lastFrame);

  const inputs: GenerationInput[] =
    kind === 'image'
      ? s.sources.map((assetId) => ({ assetId, role: 'source' as const }))
      : [
          ...(s.firstFrame ? [{ assetId: s.firstFrame, role: 'first_frame' as const }] : []),
          ...(s.lastFrame && s.firstFrame ? [{ assetId: s.lastFrame, role: 'last_frame' as const }] : []),
          ...s.references.map((assetId) => ({ assetId, role: 'reference' as const })),
        ];

  const estimate = selectedEntries.reduce<number | null>((sum, e) => {
    const c = estimateCost(e.model, normalizeParams(params, e.model.capabilities));
    return c === null ? sum : (sum ?? 0) + c;
  }, null);

  const jobsPerClick = kind === 'video' ? (params.count ?? 1) * selectedEntries.length : selectedEntries.length;
  const unconfigured = selectedEntries.filter((e) => !e.provider.configured);

  const generate = async () => {
    if (!selectedEntries.length) return toast.error('Pick a model first');
    if (unconfigured.length) return toast.error(`${unconfigured[0]!.provider.name} has no API key yet — add it to .env`);
    setSubmitting(true);
    try {
      await api.createGenerations({
        kind,
        targets: selectedEntries.map((e) => ({
          ...splitKey(e.key),
          modelOverride: selectedEntries.length === 1 && s.modelOverride.trim() ? s.modelOverride.trim() : undefined,
        })),
        prompt: s.prompt,
        negativePrompt: s.negativePrompt || undefined,
        params,
        inputs,
        characterIds: s.characterIds,
      });
    } catch (err) {
      toast.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const enhance = async () => {
    setEnhancing(true);
    try {
      const res = await api.enhancePrompt(s.prompt, kind);
      s.set({ prompt: res.prompt });
      toast.success(`Prompt enhanced with ${res.provider}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setEnhancing(false);
    }
  };

  const addFiles = async (files: File[]) => {
    const assets = (await upload(files)).filter((a) => a.kind === 'image');
    if (!assets.length) return;
    const ids = assets.map((a) => a.id);
    if (kind === 'image') s.set({ sources: [...s.sources, ...ids].slice(0, Math.max(maxSources, 1)) });
    else if (!s.firstFrame && canFirst) s.set({ firstFrame: ids[0]!, references: [...s.references, ...ids.slice(1)].slice(0, maxRefs) });
    else s.set({ references: [...s.references, ...ids].slice(0, maxRefs) });
  };

  const feed = (generations?.items ?? []).filter((g) => feedFilter === 'all' || g.kind === feedFilter);

  return (
    <div className="flex h-full min-h-0">
      {/* ── Composer ───────────────────────────── */}
      <aside
        className="flex w-[440px] shrink-0 flex-col border-r border-line bg-panel/40"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void addFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <Segmented
            className="w-full [&>button]:flex-1 [&>button]:justify-center"
            value={kind}
            onChange={(v) => s.set({ kind: v })}
            options={[
              { value: 'image', label: <><ImageIcon className="size-4" /> Image</> },
              { value: 'video', label: <><Clapperboard className="size-4" /> Video</> },
            ]}
          />

          {/* Model picker */}
          <div className="relative">
            <button
              onClick={() => setModelMenu((v) => !v)}
              className="flex w-full items-center gap-3 rounded-xl border border-line bg-panel px-3.5 py-2.5 text-left transition hover:border-line-strong"
            >
              <div className="bg-brand flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-950">
                {s.compare ? <Layers className="size-4" /> : <Sparkles className="size-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {selectedEntries.length > 1 ? `Compare · ${selectedEntries.length} models` : (primary?.model.name ?? 'Choose a model')}
                </div>
                <div className="truncate text-xs text-muted">
                  {selectedEntries.length > 1 ? selectedEntries.map((e) => e.model.name).join(' · ') : (primary?.provider.name ?? '')}
                </div>
              </div>
              {unconfigured.length > 0 && <Badge tone="amber">No key</Badge>}
              <ChevronDown className="size-4 text-muted" />
            </button>
            {modelMenu && (
              <ModelMenu
                entries={kindModels}
                selected={s.selected[kind]}
                compare={s.compare}
                onCompare={(v) => s.set({ compare: v, selected: { ...s.selected, [kind]: v ? s.selected[kind] : s.selected[kind].slice(0, 1) } })}
                onSelect={(key) => {
                  if (s.compare) {
                    const cur = s.selected[kind];
                    const next = cur.includes(key) ? cur.filter((k) => k !== key) : cur.length < 4 ? [...cur, key] : cur;
                    s.set({ selected: { ...s.selected, [kind]: next.length ? next : cur } });
                  } else {
                    s.set({ selected: { ...s.selected, [kind]: [key] } });
                    setModelMenu(false);
                  }
                }}
                onClose={() => setModelMenu(false)}
              />
            )}
          </div>

          {/* Prompt */}
          <div className="space-y-2">
            <div className="relative rounded-xl border border-line bg-panel transition focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/15">
              <textarea
                ref={promptRef}
                value={s.prompt}
                onChange={(e) => s.set({ prompt: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void generate();
                  }
                }}
                onPaste={(e) => {
                  const files = filesFromClipboard(e);
                  if (files.length) {
                    e.preventDefault();
                    void addFiles(files);
                  }
                }}
                rows={6}
                placeholder={kind === 'image' ? 'Describe the image you imagine… (paste or drop images to edit them)' : 'Describe the shot: subject, action, camera, mood, sound…'}
                className="block w-full resize-none bg-transparent px-3.5 pt-3 pb-10 text-sm leading-relaxed outline-none placeholder:text-faint"
              />
              <div className="absolute right-2 bottom-2 left-2 flex items-center justify-between">
                <span className="pl-1.5 text-[11px] text-faint">{s.prompt.length ? `${s.prompt.length} chars` : 'Ctrl+Enter to generate'}</span>
                <div className="flex items-center gap-1">
                  {s.prompt && (
                    <IconButton label="Clear prompt" onClick={() => s.set({ prompt: '' })}>
                      <X className="size-3.5" />
                    </IconButton>
                  )}
                  <Button size="sm" variant="ghost" loading={enhancing} disabled={!s.prompt.trim()} onClick={enhance} icon={<Wand2 className="size-3.5" />}>
                    Enhance
                  </Button>
                </div>
              </div>
            </div>
            {!s.prompt && (
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLES[kind].map((ex) => (
                  <button key={ex} onClick={() => s.set({ prompt: ex })} className="rounded-md bg-white/[0.03] px-2 py-1 text-left text-[11px] text-muted hover:bg-white/[0.06] hover:text-fg">
                    {ex.length > 52 ? ex.slice(0, 52) + '…' : ex}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Inputs */}
          {kind === 'image' ? (
            <Field label="Input images" hint={maxSources ? `optional · up to ${maxSources} · refer to them as image 1, image 2…` : 'not supported by this model'}>
              <div className="grid grid-cols-5 gap-2">
                {s.sources.map((id, i) => (
                  <Slot key={id} assetId={id} label={`${i + 1}`} onRemove={() => s.set({ sources: s.sources.filter((x) => x !== id) })} />
                ))}
                {s.sources.length < maxSources && <AddSlot loading={uploading} onClick={() => setPicker('sources')} />}
              </div>
            </Field>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start frame" hint={canFirst ? 'optional' : 'n/a'}>
                  {s.firstFrame ? (
                    <Slot assetId={s.firstFrame} wide onRemove={() => s.set({ firstFrame: null, lastFrame: null })} />
                  ) : (
                    <AddSlot wide disabled={!canFirst} loading={uploading} onClick={() => setPicker('first')} />
                  )}
                </Field>
                <Field label="End frame" hint={canLast ? 'optional' : 'n/a'}>
                  {s.lastFrame ? (
                    <Slot assetId={s.lastFrame} wide onRemove={() => s.set({ lastFrame: null })} />
                  ) : (
                    <AddSlot wide disabled={!canLast || !s.firstFrame} onClick={() => setPicker('last')} />
                  )}
                </Field>
              </div>
              <Field label="Reference images" hint={maxRefs ? `subjects, products, styles · up to ${maxRefs}` : 'not supported by this model'}>
                <div className="grid grid-cols-5 gap-2">
                  {s.references.map((id) => (
                    <Slot key={id} assetId={id} onRemove={() => s.set({ references: s.references.filter((x) => x !== id) })} />
                  ))}
                  {s.references.length < maxRefs && <AddSlot onClick={() => setPicker('refs')} />}
                </div>
              </Field>
            </div>
          )}

          {/* Characters */}
          <Field
            label={
              <span className="flex items-center gap-1.5">
                <Users className="size-3.5" /> Characters
              </span>
            }
            hint={
              <Link to="/characters" className="hover:text-fg">
                Manage
              </Link>
            }
          >
            {characters?.length ? (
              <div className="flex flex-wrap gap-2">
                {characters.map((c) => {
                  const on = s.characterIds.includes(c.id);
                  const cover = c.assets.find((a) => a.id === c.coverAssetId) ?? c.assets[0];
                  return (
                    <button
                      key={c.id}
                      onClick={() => s.toggleCharacter(c.id)}
                      className={clsx(
                        'flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-xs font-medium transition',
                        on ? 'border-accent/60 bg-accent/15 text-fg' : 'border-line bg-panel text-muted hover:text-fg',
                      )}
                    >
                      {cover ? <img src={cover.thumbUrl} className="size-6 rounded-full object-cover" alt="" /> : <span className="size-6 rounded-full bg-line" />}
                      {c.name}
                      {on && <Check className="size-3 text-accent" />}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-faint">
                Create a character from a few photos to keep the same person consistent across images and videos.{' '}
                <Link to="/characters" className="text-accent hover:underline">
                  Create one
                </Link>
              </p>
            )}
          </Field>

          {/* Style */}
          <Field label="Style">
            <div className="flex flex-wrap gap-1.5">
              <Chip active={!params.style} onClick={() => s.setParams(kind, { style: undefined })}>
                None
              </Chip>
              {STYLE_PRESETS.map((st) => (
                <Chip key={st.id} active={params.style === st.id} onClick={() => s.setParams(kind, { style: st.id })}>
                  {st.name}
                </Chip>
              ))}
            </div>
          </Field>

          {/* Model settings */}
          {caps && (
            <div className="space-y-4">
              {caps.aspectRatios.length > 0 && (
                <Field label="Aspect ratio">
                  <div className="flex flex-wrap gap-1.5">
                    {caps.aspectRatios.map((r) => (
                      <Chip key={r} active={params.aspectRatio === r} onClick={() => s.setParams(kind, { aspectRatio: r })}>
                        {r}
                      </Chip>
                    ))}
                  </div>
                </Field>
              )}
              <div className="grid grid-cols-2 gap-4">
                {caps.resolutions.length > 0 && (
                  <Field label="Resolution">
                    <div className="flex flex-wrap gap-1.5">
                      {caps.resolutions.map((r) => (
                        <Chip key={r} active={params.resolution === r} onClick={() => s.setParams(kind, { resolution: r })}>
                          {r}
                        </Chip>
                      ))}
                    </div>
                  </Field>
                )}
                <Field label={kind === 'video' ? 'Videos' : 'Images'}>
                  <div className="flex gap-1.5">
                    {[1, 2, 3, 4].filter((n) => kind === 'video' || n <= caps.maxOutputs).map((n) => (
                      <Chip key={n} active={(params.count ?? 1) === n} onClick={() => s.setParams(kind, { count: n })}>
                        {n}
                      </Chip>
                    ))}
                  </div>
                </Field>
              </div>
              {caps.durations && (
                <Field label="Duration">
                  <div className="flex flex-wrap gap-1.5">
                    {caps.durations.map((d) => (
                      <Chip key={d} active={params.duration === d} onClick={() => s.setParams(kind, { duration: d })}>
                        {d}s
                      </Chip>
                    ))}
                  </div>
                </Field>
              )}
              {caps.qualities && (
                <Field label="Quality">
                  <div className="flex gap-1.5">
                    {caps.qualities.map((q) => (
                      <Chip key={q} active={(params.quality ?? 'auto') === q} onClick={() => s.setParams(kind, { quality: q })}>
                        {q}
                      </Chip>
                    ))}
                  </div>
                </Field>
              )}
              {(caps.audio || caps.promptExtend) && (
                <div className="space-y-2.5 rounded-xl border border-line bg-panel p-3">
                  {caps.audio && <Toggle label="Generate sound" checked={params.audio !== false} onChange={(v) => s.setParams(kind, { audio: v })} />}
                  {caps.promptExtend && (
                    <Toggle label="Let the provider expand my prompt" checked={params.promptExtend !== false} onChange={(v) => s.setParams(kind, { promptExtend: v })} />
                  )}
                </div>
              )}

              <button onClick={() => setAdvanced((v) => !v)} className="flex items-center gap-1.5 text-xs font-medium text-muted hover:text-fg">
                <Settings2 className="size-3.5" /> Advanced
                <ChevronDown className={clsx('size-3.5 transition', advanced && 'rotate-180')} />
              </button>
              {advanced && (
                <div className="space-y-4">
                  {caps.negativePrompt && (
                    <Field label="Negative prompt">
                      <input className={inputClass} value={s.negativePrompt} onChange={(e) => s.set({ negativePrompt: e.target.value })} placeholder="blurry, distorted hands, text, watermark" />
                    </Field>
                  )}
                  {caps.seed && (
                    <Field label="Seed" hint="same seed ≈ similar result">
                      <input
                        className={inputClass}
                        inputMode="numeric"
                        value={params.seed ?? ''}
                        onChange={(e) => {
                          const v = e.target.value.replace(/\D/g, '');
                          s.setParams(kind, { seed: v ? Math.min(Number(v), 2147483647) : undefined });
                        }}
                        placeholder="random"
                      />
                    </Field>
                  )}
                  <Field label="Custom model ID" hint="for brand-new models not in the list yet">
                    <input
                      className={inputClass}
                      value={s.modelOverride}
                      disabled={selectedEntries.length > 1}
                      onChange={(e) => s.set({ modelOverride: e.target.value })}
                      placeholder={primary?.model.providerModelId ?? ''}
                    />
                  </Field>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Generate */}
        <div className="border-t border-line bg-panel/80 p-4 backdrop-blur">
          <Button variant="primary" size="lg" className="w-full" loading={submitting} onClick={generate} icon={<Sparkles className="size-4" />}>
            Generate{jobsPerClick > 1 ? ` · ${jobsPerClick} jobs` : ''}
          </Button>
          <div className="mt-2 flex justify-between text-[11px] text-faint">
            <span>{estimate !== null ? `Est. ${usd(estimate)}` : 'Cost shown after the run when the provider reports it'}</span>
            {(s.sources.length > 0 || s.firstFrame || s.references.length > 0 || s.characterIds.length > 0) && (
              <button className="hover:text-fg" onClick={s.clearInputs}>
                Clear inputs
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* ── Feed ───────────────────────────── */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-bg/85 px-6 py-3 backdrop-blur">
          <h1 className="font-semibold">Creations</h1>
          <Segmented
            value={feedFilter}
            onChange={setFeedFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'image', label: 'Images' },
              { value: 'video', label: 'Videos' },
            ]}
          />
        </div>
        {feed.length ? (
          <div className="grid grid-cols-1 items-start gap-4 p-6 xl:grid-cols-2 2xl:grid-cols-3">
            {feed.map((g) => (
              <JobCard key={g.id} gen={g} onOpen={(id, ids) => setViewer({ id, ids })} />
            ))}
          </div>
        ) : generations ? (
          <Empty icon={<Sparkles className="size-5" />} title="Your creations will appear here">
            Pick a model, describe what you imagine and hit Generate. Use the <b>Mock</b> models to try things out for free.
          </Empty>
        ) : (
          <div className="flex justify-center py-20 text-muted">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}
      </main>

      <AssetPicker
        open={picker !== null}
        onClose={() => setPicker(null)}
        max={picker === 'sources' ? Math.max(1, maxSources - s.sources.length) : picker === 'refs' ? Math.max(1, maxRefs - s.references.length) : 1}
        title={picker === 'first' ? 'Choose the start frame' : picker === 'last' ? 'Choose the end frame' : picker === 'refs' ? 'Choose reference images' : 'Choose images to edit or combine'}
        onPick={(ids) => {
          if (picker === 'sources') s.set({ sources: [...s.sources, ...ids.filter((id) => !s.sources.includes(id))] });
          else if (picker === 'first') s.set({ firstFrame: ids[0] ?? null });
          else if (picker === 'last') s.set({ lastFrame: ids[0] ?? null });
          else if (picker === 'refs') s.set({ references: [...s.references, ...ids.filter((id) => !s.references.includes(id))] });
        }}
      />
      {viewer && <AssetViewer assetId={viewer.id} ids={viewer.ids} onNavigate={(id) => setViewer({ ...viewer, id })} onClose={() => setViewer(null)} />}
    </div>
  );
}

function ModelMenu({
  entries,
  selected,
  compare,
  onCompare,
  onSelect,
  onClose,
}: {
  entries: ModelEntry[];
  selected: string[];
  compare: boolean;
  onCompare: (v: boolean) => void;
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  const groups = new Map<string, ModelEntry[]>();
  for (const e of entries) groups.set(e.provider.id, [...(groups.get(e.provider.id) ?? []), e]);
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div className="absolute top-full right-0 left-0 z-30 mt-2 max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-panel-2 shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-line bg-panel-2 px-3 py-2.5">
          <Toggle label={<span className="flex items-center gap-1.5"><Layers className="size-3.5" /> Compare models (up to 4)</span>} checked={compare} onChange={onCompare} />
        </div>
        {[...groups.values()].map((list) => {
          const provider = list[0]!.provider;
          return (
            <div key={provider.id} className="border-b border-line/60 py-1.5 last:border-0">
              <div className="flex items-center justify-between px-3 py-1">
                <span className="text-[11px] font-semibold tracking-wide text-faint uppercase">{provider.name}</span>
                {!provider.configured && <span className="text-[10px] text-amber-300/80">add {provider.envKeys[0]} to .env</span>}
              </div>
              {list.map((e) => {
                const on = selected.includes(e.key);
                return (
                  <button
                    key={e.key}
                    onClick={() => onSelect(e.key)}
                    className={clsx('flex w-full items-start gap-3 px-3 py-2 text-left transition hover:bg-white/[0.04]', !provider.configured && 'opacity-55')}
                  >
                    <span
                      className={clsx(
                        'mt-0.5 flex size-4 shrink-0 items-center justify-center border',
                        compare ? 'rounded' : 'rounded-full',
                        on ? 'border-accent bg-accent text-zinc-950' : 'border-line-strong',
                      )}
                    >
                      {on && <Check className="size-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        {e.model.name}
                        {e.model.tags?.map((t) => (
                          <Badge key={t} tone={t === 'recommended' ? 'accent' : 'default'}>
                            {t}
                          </Badge>
                        ))}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted">{e.model.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
}

function Slot({ assetId, onRemove, label, wide }: { assetId: string; onRemove: () => void; label?: string; wide?: boolean }) {
  const { data } = useAsset(assetId);
  return (
    <div className={clsx('group checker relative overflow-hidden rounded-lg border border-line', wide ? 'aspect-video' : 'aspect-square')}>
      {data ? <img src={data.thumbUrl} alt="" className="size-full object-cover" /> : <div className="shimmer size-full" />}
      {label && <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] font-semibold text-white">{label}</span>}
      <button onClick={onRemove} className="absolute top-1 right-1 rounded-md bg-black/70 p-0.5 text-white opacity-0 transition group-hover:opacity-100" title="Remove">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function AddSlot({ onClick, disabled, loading, wide }: { onClick: () => void; disabled?: boolean; loading?: boolean; wide?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'flex items-center justify-center rounded-lg border border-dashed border-line-strong text-muted transition hover:border-accent/60 hover:bg-accent/5 hover:text-fg disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-line-strong disabled:hover:bg-transparent',
        wide ? 'aspect-video w-full' : 'aspect-square',
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
    </button>
  );
}
