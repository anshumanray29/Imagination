import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import clsx from 'clsx';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Clapperboard,
  Dices,
  History,
  Image as ImageIcon,
  Images,
  Layers,
  Loader2,
  Maximize2,
  Palette,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Users,
  Wand2,
  Wrench,
  X,
} from 'lucide-react';
import { estimateCost, normalizeParams, STYLE_PRESETS, type GenerationInput, type MediaKind } from '@imagination/shared';
import { api } from '@/lib/api';
import { money, priceLabel } from '@/lib/format';
import { useModelIndex, type ModelEntry } from '@/lib/models';
import { capabilityChips } from '@/lib/providers';
import { useAsset, useCharacters, useGenerations, useProviders } from '@/lib/queries';
import { splitKey, useStudio } from '@/lib/studio';
import { filesFromClipboard, useUpload } from '@/lib/upload';
import { AssetPicker } from '@/components/AssetPicker';
import { AssetViewer } from '@/components/AssetViewer';
import { JobCard } from '@/components/JobCard';
import { ModelBrowser } from '@/components/ModelBrowser';
import { Badge, Button, Chip, Field, inputClass, Kbd, ProviderBadge, Section, Segmented, Toggle, Tooltip } from '@/components/ui';
import { toast } from '@/components/toast';

const EXAMPLES: Record<MediaKind, { title: string; prompt: string }[]> = {
  image: [
    { title: 'Cozy fantasy', prompt: 'A cozy reading nook inside a giant hollow tree, warm lantern light, rain falling outside, highly detailed' },
    { title: 'Product shot', prompt: 'Matte black perfume bottle on wet volcanic rock, moody rim light, droplets, luxury product photography' },
    { title: 'Portrait', prompt: 'Portrait of an elderly fisherman with a weathered face and knitted cap, golden hour, 85mm, shallow depth of field' },
    { title: 'Poster', prompt: 'Retro travel poster for Mars with the headline "VISIT OLYMPUS MONS", bold flat colors, 1960s print texture' },
  ],
  video: [
    { title: 'Storm', prompt: 'Slow dolly-in on a lighthouse during a thunderstorm, waves crashing on the rocks, lightning flashes, roaring wind' },
    { title: 'Macro', prompt: 'A paper boat drifting down a rainy city gutter, macro lens, reflections of neon signs, soft rain ambience' },
    { title: 'Wildlife', prompt: 'A red fox walks through a snowy forest at dawn, tracking shot at eye level, breath visible in the cold air' },
    { title: 'Drone', prompt: 'Drone shot flying low over turquoise rice terraces at sunrise, mist drifting between the hills, cinematic' },
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
  const [browser, setBrowser] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [viewer, setViewer] = useState<{ id: string; ids: string[] } | null>(null);
  const [feedFilter, setFeedFilter] = useState<'all' | MediaKind>('all');
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const kind = s.kind;
  const params = s.params[kind];

  const kindModels = useMemo(() => [...index.values()].filter((e) => e.model.capabilities.kind === kind), [index, kind]);

  // Pick a sensible default model once providers load.
  useEffect(() => {
    if (!providers) return;
    const current = s.selected[kind].filter((k) => index.has(k));
    if (current.length) {
      if (current.length !== s.selected[kind].length) s.set({ selected: { ...s.selected, [kind]: current } });
      return;
    }
    const configured = kindModels.filter((e) => e.provider.configured);
    const pick =
      configured.find((e) => e.provider.id !== 'mock' && e.model.tags?.includes('recommended')) ??
      configured.find((e) => e.provider.id !== 'mock') ??
      configured[0] ??
      kindModels[0];
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

  const limit = (fn: (c: NonNullable<typeof caps>) => number) => (selectedEntries.length ? Math.min(...selectedEntries.map((e) => fn(e.model.capabilities))) : 0);
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

  const promptHistory = useMemo(() => {
    const seen = new Set<string>();
    return (generations?.items ?? []).filter((g) => g.kind === kind && g.prompt && !seen.has(g.prompt) && seen.add(g.prompt)).slice(0, 12);
  }, [generations, kind]);

  const generate = async () => {
    if (!selectedEntries.length) return toast.error('Pick a model first');
    if (unconfigured.length) return toast.error(`${unconfigured[0]!.provider.name} has no API key yet — add ${unconfigured[0]!.provider.envKeys[0]} to .env`);
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
  const activeCount = (generations?.items ?? []).filter((g) => g.status === 'queued' || g.status === 'running').length;
  const inputCount = s.sources.length + (s.firstFrame ? 1 : 0) + (s.lastFrame ? 1 : 0) + s.references.length;

  return (
    <div className="flex h-full min-h-0">
      {/* ── Control panel ───────────────────────────── */}
      <aside
        className="relative flex w-[460px] shrink-0 flex-col border-r border-line bg-panel/30"
        onDragEnter={(e) => e.dataTransfer.types.includes('Files') && setDragging(true)}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles(Array.from(e.dataTransfer.files));
        }}
      >
        {dragging && (
          <div className="animate-fade-in pointer-events-none absolute inset-3 z-30 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-accent/60 bg-panel/90 text-sm font-medium backdrop-blur">
            <Upload className="size-6 text-accent" />
            Drop images to use them as {kind === 'image' ? 'inputs' : s.firstFrame ? 'references' : 'the start frame'}
          </div>
        )}

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {/* Mode */}
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['image', ImageIcon, 'Image', 'Create & edit stills'],
                ['video', Clapperboard, 'Video', 'Animate & direct clips'],
              ] as const
            ).map(([k, Icon, label, sub]) => (
              <button
                key={k}
                onClick={() => s.set({ kind: k })}
                className={clsx(
                  'raised flex items-center gap-3 rounded-2xl border p-3 text-left transition',
                  kind === k ? 'border-accent/50 bg-accent/[0.08] shadow-[0_0_0_1px_rgb(167_139_250/0.2)]' : 'border-line bg-panel/70 hover:border-line-strong',
                )}
              >
                <span className={clsx('flex size-9 items-center justify-center rounded-xl', kind === k ? 'bg-brand text-zinc-950' : 'bg-white/[0.05] text-muted')}>
                  <Icon className="size-[18px]" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="block text-[11px] text-muted">{sub}</span>
                </span>
              </button>
            ))}
          </div>

          {/* Model */}
          <button
            onClick={() => setBrowser(true)}
            className="group raised flex w-full items-center gap-3 rounded-2xl border border-line bg-panel/70 p-3 text-left transition hover:border-line-strong"
          >
            {selectedEntries.length > 1 ? (
              <span className="flex -space-x-1.5">
                {selectedEntries.map((e) => (
                  <ProviderBadge key={e.key} provider={e.provider.id} size="md" className="ring-2 ring-panel" />
                ))}
              </span>
            ) : primary ? (
              <ProviderBadge provider={primary.provider.id} size="lg" />
            ) : (
              <span className="size-9 rounded-xl bg-line" />
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                {selectedEntries.length > 1 ? (
                  <>
                    <Layers className="size-3.5 text-accent" /> Comparing {selectedEntries.length} models
                  </>
                ) : (
                  (primary?.model.name ?? 'Choose a model')
                )}
                {unconfigured.length > 0 && <Badge tone="amber">no key</Badge>}
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted">
                {selectedEntries.length > 1
                  ? selectedEntries.map((e) => e.model.name).join(' · ')
                  : primary
                    ? [primary.provider.name, priceLabel(primary.model.pricing, primary.provider.id)].filter(Boolean).join(' · ')
                    : ''}
              </span>
              {selectedEntries.length === 1 && primary && (
                <span className="mt-1.5 flex flex-wrap gap-1">
                  {capabilityChips(primary.model)
                    .slice(0, 4)
                    .map((c) => (
                      <span key={c} className="rounded border border-line px-1.5 py-px text-[10px] text-faint">
                        {c}
                      </span>
                    ))}
                </span>
              )}
            </span>
            <span className="flex items-center gap-1 text-xs font-medium text-muted group-hover:text-fg">
              Change <ChevronRight className="size-4" />
            </span>
          </button>

          {/* Prompt */}
          <div className="raised rounded-2xl border border-line bg-panel/70 transition focus-within:border-accent/50 focus-within:shadow-[0_0_0_3px_rgb(167_139_250/0.1)]">
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
              placeholder={kind === 'image' ? 'Describe the image you imagine… paste or drop photos to edit them' : 'Describe the shot — subject, action, camera, mood, sound…'}
              className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-sm leading-relaxed outline-none placeholder:text-faint"
            />
            {caps?.negativePrompt && (
              <input
                value={s.negativePrompt}
                onChange={(e) => s.set({ negativePrompt: e.target.value })}
                placeholder="Avoid… (negative prompt, optional)"
                className="mx-4 mb-2 block w-[calc(100%-2rem)] border-t border-line bg-transparent pt-2 text-xs outline-none placeholder:text-faint"
              />
            )}
            <div className="flex items-center gap-1 border-t border-line px-2 py-1.5">
              <Button size="sm" variant="ghost" loading={enhancing} disabled={!s.prompt.trim()} onClick={enhance} icon={<Wand2 className="size-3.5" />}>
                Enhance
              </Button>
              <div className="relative">
                <Button size="sm" variant="ghost" icon={<History className="size-3.5" />} disabled={!promptHistory.length} onClick={() => setHistoryOpen((v) => !v)}>
                  History
                </Button>
                {historyOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setHistoryOpen(false)} />
                    <div className="animate-pop-in absolute top-full left-0 z-40 mt-1 max-h-80 w-[380px] overflow-y-auto rounded-xl border border-line-strong bg-panel-2 p-1 shadow-2xl">
                      {promptHistory.map((g) => (
                        <button
                          key={g.id}
                          onClick={() => (s.set({ prompt: g.prompt }), setHistoryOpen(false))}
                          className="block w-full rounded-lg px-3 py-2 text-left text-xs leading-relaxed text-fg/85 hover:bg-white/[0.05]"
                        >
                          <span className="line-clamp-2">{g.prompt}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div className="flex-1" />
              <span className="pr-1 text-[11px] text-faint tabular-nums">{s.prompt.length || ''}</span>
              {s.prompt && (
                <button onClick={() => s.set({ prompt: '' })} className="rounded-md p-1 text-faint hover:bg-white/5 hover:text-fg" aria-label="Clear prompt">
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Inputs */}
          <Section
            icon={<Images className="size-3.5" />}
            title={kind === 'image' ? 'Input images' : 'Frames & references'}
            summary={inputCount ? `${inputCount} added` : 'optional'}
            defaultOpen
          >
            {kind === 'image' ? (
              <Field label="Edit or combine" hint={maxSources ? `up to ${maxSources} · refer to them as image 1, image 2…` : 'not supported by this model'}>
                <div className="grid grid-cols-5 gap-2">
                  {s.sources.map((id, i) => (
                    <Slot
                      key={id}
                      assetId={id}
                      label={`${i + 1}`}
                      onView={() => setViewer({ id, ids: s.sources })}
                      onRemove={() => s.set({ sources: s.sources.filter((x) => x !== id) })}
                    />
                  ))}
                  {s.sources.length < maxSources && <AddSlot loading={uploading} onClick={() => setPicker('sources')} />}
                </div>
              </Field>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Start frame" hint={canFirst ? 'optional' : 'n/a'}>
                    {s.firstFrame ? (
                      <Slot
                        assetId={s.firstFrame}
                        wide
                        onView={() => setViewer({ id: s.firstFrame!, ids: [s.firstFrame!, ...(s.lastFrame ? [s.lastFrame] : [])] })}
                        onRemove={() => s.set({ firstFrame: null, lastFrame: null })}
                      />
                    ) : (
                      <AddSlot wide disabled={!canFirst} loading={uploading} onClick={() => setPicker('first')} />
                    )}
                  </Field>
                  <Field label="End frame" hint={canLast ? 'optional' : 'n/a'}>
                    {s.lastFrame ? (
                      <Slot
                        assetId={s.lastFrame}
                        wide
                        onView={() => setViewer({ id: s.lastFrame!, ids: [...(s.firstFrame ? [s.firstFrame] : []), s.lastFrame!] })}
                        onRemove={() => s.set({ lastFrame: null })}
                      />
                    ) : (
                      <AddSlot wide disabled={!canLast || !s.firstFrame} onClick={() => setPicker('last')} />
                    )}
                  </Field>
                </div>
                <Field label="Reference images" hint={maxRefs ? `subjects, products, styles · up to ${maxRefs}` : 'not supported by this model'}>
                  <div className="grid grid-cols-5 gap-2">
                    {s.references.map((id) => (
                      <Slot
                        key={id}
                        assetId={id}
                        onView={() => setViewer({ id, ids: s.references })}
                        onRemove={() => s.set({ references: s.references.filter((x) => x !== id) })}
                      />
                    ))}
                    {s.references.length < maxRefs && <AddSlot onClick={() => setPicker('refs')} />}
                  </div>
                </Field>
              </>
            )}
          </Section>

          {/* Characters */}
          <Section
            icon={<Users className="size-3.5" />}
            title="Characters"
            summary={s.characterIds.length ? `${s.characterIds.length} selected` : 'none'}
            right={
              <Link to="/characters" className="text-[11px] font-medium text-faint hover:text-fg">
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
                        on ? 'border-accent/60 bg-accent/15 text-fg' : 'border-line bg-panel-2/60 text-muted hover:text-fg',
                      )}
                    >
                      {cover ? <img src={cover.thumbUrl} className="size-7 rounded-full object-cover" alt="" /> : <span className="size-7 rounded-full bg-line" />}
                      {c.name}
                      {on && <Check className="size-3 text-accent" />}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs leading-relaxed text-faint">
                Save a person from a few photos to keep them consistent across images and videos.{' '}
                <Link to="/characters" className="text-accent hover:underline">
                  Create a character
                </Link>
              </p>
            )}
          </Section>

          {/* Style */}
          <Section icon={<Palette className="size-3.5" />} title="Style" summary={STYLE_PRESETS.find((x) => x.id === params.style)?.name ?? 'none'} defaultOpen={false}>
            <div className="grid grid-cols-3 gap-1.5">
              <Chip active={!params.style} onClick={() => s.setParams(kind, { style: undefined })} className="justify-center">
                None
              </Chip>
              {STYLE_PRESETS.map((st) => (
                <Chip key={st.id} active={params.style === st.id} onClick={() => s.setParams(kind, { style: st.id })} className="justify-center">
                  {st.name}
                </Chip>
              ))}
            </div>
          </Section>

          {/* Settings */}
          {caps && (
            <Section
              icon={<SlidersHorizontal className="size-3.5" />}
              title="Settings"
              summary={[params.aspectRatio, params.resolution, params.duration && `${params.duration}s`, `×${params.count ?? 1}`].filter(Boolean).join(' · ')}
            >
              {caps.aspectRatios.length > 0 && (
                <Field label="Aspect ratio">
                  <div className="flex flex-wrap gap-1.5">
                    {caps.aspectRatios.map((r) => (
                      <Chip key={r} active={params.aspectRatio === r} onClick={() => s.setParams(kind, { aspectRatio: r })}>
                        <AspectIcon ratio={r} />
                        {r}
                      </Chip>
                    ))}
                  </div>
                </Field>
              )}
              <div className="grid grid-cols-2 gap-4">
                {caps.resolutions.length > 0 && (
                  <Field label="Resolution">
                    <Segmented
                      size="sm"
                      className="w-full [&>button]:flex-1"
                      value={params.resolution ?? caps.resolutions[0]!}
                      onChange={(v) => s.setParams(kind, { resolution: v })}
                      options={caps.resolutions.map((r) => ({ value: r, label: r }))}
                    />
                  </Field>
                )}
                <Field label={kind === 'video' ? 'Videos' : 'Images'}>
                  <Segmented
                    size="sm"
                    className="w-full [&>button]:flex-1"
                    value={String(params.count ?? 1)}
                    onChange={(v) => s.setParams(kind, { count: Number(v) })}
                    options={[1, 2, 3, 4].filter((n) => kind === 'video' || n <= caps.maxOutputs).map((n) => ({ value: String(n), label: String(n) }))}
                  />
                </Field>
              </div>
              {caps.durations && caps.durations.length > 0 && (
                <Field label="Duration" hint={<span className="font-semibold text-fg tabular-nums">{params.duration ?? caps.defaultDuration}s</span>}>
                  <input
                    type="range"
                    className="slider w-full"
                    min={0}
                    max={caps.durations.length - 1}
                    step={1}
                    value={Math.max(0, caps.durations.indexOf(params.duration ?? caps.defaultDuration ?? caps.durations[0]!))}
                    onChange={(e) => s.setParams(kind, { duration: caps.durations![Number(e.target.value)] })}
                  />
                  <div className="flex justify-between text-[10px] text-faint tabular-nums">
                    {caps.durations.map((d) => (
                      <span key={d}>{d}s</span>
                    ))}
                  </div>
                </Field>
              )}
              {caps.qualities && (
                <Field label="Quality">
                  <div className="flex flex-wrap gap-1.5">
                    {caps.qualities.map((q) => (
                      <Chip key={q} active={(params.quality ?? 'auto') === q} onClick={() => s.setParams(kind, { quality: q })}>
                        {q}
                      </Chip>
                    ))}
                  </div>
                </Field>
              )}
              {(caps.audio || caps.promptExtend || caps.transparentBackground) && (
                <div className="space-y-3 rounded-xl border border-line bg-panel-2/50 p-3">
                  {caps.audio && <Toggle label="Generate sound" hint="Dialogue, effects and ambience" checked={params.audio !== false} onChange={(v) => s.setParams(kind, { audio: v })} />}
                  {caps.promptExtend && (
                    <Toggle
                      label="Provider prompt rewriting"
                      hint="Off = your prompt is sent exactly as written"
                      checked={params.promptExtend === true}
                      onChange={(v) => s.setParams(kind, { promptExtend: v })}
                    />
                  )}
                  {caps.transparentBackground && (
                    <Toggle
                      label="Transparent background"
                      hint="PNG with alpha — logos, stickers, product cut-outs"
                      checked={params.background === 'transparent'}
                      onChange={(v) => s.setParams(kind, { background: v ? 'transparent' : undefined })}
                    />
                  )}
                </div>
              )}
            </Section>
          )}

          {/* Advanced */}
          <Section icon={<Wrench className="size-3.5" />} title="Advanced" summary={params.seed !== undefined ? `seed ${params.seed}` : 'seed, custom model'} defaultOpen={false}>
            {caps?.seed && (
              <Field label="Seed" hint="same seed ≈ similar result">
                <div className="flex gap-2">
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
                  <Button variant="secondary" icon={<Dices className="size-4" />} onClick={() => s.setParams(kind, { seed: Math.floor(Math.random() * 2147483647) })}>
                    Roll
                  </Button>
                </div>
              </Field>
            )}
            <Field label="Custom model ID" hint="try a brand-new model before it's in the list">
              <input
                className={inputClass}
                value={s.modelOverride}
                disabled={selectedEntries.length > 1}
                onChange={(e) => s.set({ modelOverride: e.target.value })}
                placeholder={primary?.model.providerModelId ?? ''}
              />
            </Field>
          </Section>
        </div>

        {/* Generate */}
        <div className="glass border-t border-line p-4">
          <Button variant="primary" size="lg" className="w-full text-[15px]" loading={submitting} onClick={generate} icon={<Sparkles className="size-[18px]" />}>
            Generate{jobsPerClick > 1 ? ` · ${jobsPerClick} jobs` : ''}
            {estimate !== null && <span className="rounded-md bg-black/15 px-1.5 py-0.5 text-xs font-semibold">≈ {money(estimate)}</span>}
          </Button>
          <div className="mt-2 flex items-center justify-between text-[11px] text-faint">
            <span className="flex items-center gap-1">
              <Kbd>Ctrl</Kbd>
              <Kbd>↵</Kbd> to generate
            </span>
            {inputCount + s.characterIds.length > 0 ? (
              <button className="hover:text-fg" onClick={s.clearInputs}>
                Clear inputs & characters
              </button>
            ) : (
              <span>{estimate === null ? 'Cost shown after the run' : 'Estimate from list prices'}</span>
            )}
          </div>
        </div>
      </aside>

      {/* ── Feed ───────────────────────────── */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="glass sticky top-0 z-10 flex items-center gap-3 border-b border-line px-6 py-3">
          <h2 className="text-[15px] font-semibold tracking-tight">Creations</h2>
          {activeCount > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-accent">
              <Loader2 className="size-3 animate-spin" /> {activeCount} in progress
            </span>
          )}
          <div className="flex-1" />
          <Segmented
            size="sm"
            value={feedFilter}
            onChange={setFeedFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'image', label: 'Images' },
              { value: 'video', label: 'Videos' },
            ]}
          />
          <Link to="/gallery" className="flex items-center gap-1 text-xs font-medium text-muted hover:text-fg">
            Gallery <ArrowRight className="size-3.5" />
          </Link>
        </div>
        {feed.length ? (
          <div className="grid grid-cols-1 items-start gap-4 p-6 xl:grid-cols-2 2xl:grid-cols-3">
            {feed.map((g) => (
              <JobCard key={g.id} gen={g} onOpen={(id, ids) => setViewer({ id, ids })} />
            ))}
          </div>
        ) : generations ? (
          <div className="mx-auto flex max-w-3xl flex-col items-center px-6 py-20 text-center">
            <div className="glow-brand mb-6 flex size-16 items-center justify-center rounded-2xl bg-panel-2">
              <Sparkles className="size-7 text-accent" />
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">
              What will you <span className="text-brand">imagine</span> today?
            </h1>
            <p className="mt-3 max-w-md text-sm text-muted">Pick a model, describe your idea and hit Generate. Try one of these to start:</p>
            <div className="mt-8 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
              {EXAMPLES[kind].map((ex) => (
                <button
                  key={ex.title}
                  onClick={() => (s.set({ prompt: ex.prompt }), promptRef.current?.focus())}
                  className="group raised rounded-2xl border border-line bg-panel/70 p-4 text-left transition hover:border-accent/40 hover:bg-panel-2"
                >
                  <span className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-accent">
                    {kind === 'image' ? <ImageIcon className="size-3.5" /> : <Clapperboard className="size-3.5" />}
                    {ex.title}
                  </span>
                  <span className="line-clamp-2 text-sm text-fg/80 group-hover:text-fg">{ex.prompt}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex justify-center py-20 text-muted">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}
      </main>

      <ModelBrowser
        open={browser}
        onClose={() => setBrowser(false)}
        kind={kind}
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
            setBrowser(false);
          }
        }}
      />
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

/** Tiny rectangle that previews an aspect ratio. */
function AspectIcon({ ratio }: { ratio: string }) {
  const [w, h] = ratio.includes(':') ? ratio.split(':').map(Number) : [0, 0];
  if (!w || !h) return <span className="inline-block size-3 rounded-[3px] border border-dashed border-current opacity-70" />;
  const max = 13;
  const width = w >= h ? max : Math.max(5, Math.round((max * w) / h));
  const height = h >= w ? max : Math.max(5, Math.round((max * h) / w));
  return <span className="inline-block rounded-[2px] border-[1.5px] border-current opacity-80" style={{ width, height }} />;
}

/** Input thumbnail: click to view full size, ✕ (always visible) to remove. */
function Slot({ assetId, onRemove, onView, label, wide }: { assetId: string; onRemove: () => void; onView: () => void; label?: string; wide?: boolean }) {
  const { data } = useAsset(assetId);
  return (
    <div className={clsx('group checker relative overflow-hidden rounded-xl border border-line transition hover:border-accent/50', wide ? 'aspect-video' : 'aspect-square')}>
      <button type="button" onClick={onView} className="absolute inset-0 cursor-zoom-in" aria-label="View image">
        {data ? <img src={data.thumbUrl} alt="" className="size-full object-cover" /> : <div className="shimmer size-full" />}
        <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition group-hover:opacity-100">
          <span className="flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            <Maximize2 className="size-3" /> {wide ? 'View' : ''}
          </span>
        </span>
      </button>
      {label && <span className="pointer-events-none absolute bottom-1 left-1 rounded-md bg-black/75 px-1.5 text-[10px] font-semibold text-white">{label}</span>}
      <span className="absolute top-1 right-1">
        <Tooltip label="Remove">
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove image"
            className="flex size-5 items-center justify-center rounded-md bg-black/75 text-white shadow transition hover:bg-red-500"
          >
            <X className="size-3.5" />
          </button>
        </Tooltip>
      </span>
    </div>
  );
}

function AddSlot({ onClick, disabled, loading, wide }: { onClick: () => void; disabled?: boolean; loading?: boolean; wide?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong text-[10px] text-muted transition hover:border-accent/60 hover:bg-accent/5 hover:text-fg disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-line-strong disabled:hover:bg-transparent',
        wide ? 'aspect-video w-full' : 'aspect-square',
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
      {wide && !loading && 'Add image'}
    </button>
  );
}
