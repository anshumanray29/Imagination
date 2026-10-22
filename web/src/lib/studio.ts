import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Generation, GenerationParams, MediaKind } from '@imagination/shared';

/** "provider:model" */
export type ModelKey = string;
export const modelKey = (provider: string, model: string): ModelKey => `${provider}:${model}`;
export const splitKey = (key: ModelKey) => {
  const i = key.indexOf(':');
  return { provider: key.slice(0, i), model: key.slice(i + 1) };
};

interface StudioState {
  kind: MediaKind;
  prompt: string;
  negativePrompt: string;
  /** Selected models per mode. More than one = compare mode. */
  selected: Record<MediaKind, ModelKey[]>;
  compare: boolean;
  params: Record<MediaKind, GenerationParams>;
  modelOverride: string;
  /** Image mode: images to edit/combine. */
  sources: string[];
  /** Video mode. */
  firstFrame: string | null;
  lastFrame: string | null;
  references: string[];
  characterIds: string[];

  set: (patch: Partial<Omit<StudioState, 'set' | 'setParams' | 'addSource' | 'animate' | 'remix' | 'toggleCharacter' | 'clearInputs'>>) => void;
  setParams: (kind: MediaKind, patch: Partial<GenerationParams>) => void;
  addSource: (assetId: string) => void;
  animate: (assetId: string) => void;
  remix: (gen: Generation) => void;
  toggleCharacter: (id: string) => void;
  clearInputs: () => void;
}

export const useStudio = create<StudioState>()(
  persist(
    (set, get) => ({
      kind: 'image',
      prompt: '',
      negativePrompt: '',
      selected: { image: [], video: [] },
      compare: false,
      params: { image: { count: 1 }, video: { count: 1, audio: true, promptExtend: false } },
      modelOverride: '',
      sources: [],
      firstFrame: null,
      lastFrame: null,
      references: [],
      characterIds: [],

      set: (patch) => set(patch),
      setParams: (kind, patch) => set({ params: { ...get().params, [kind]: { ...get().params[kind], ...patch } } }),
      addSource: (assetId) => {
        const sources = get().sources.includes(assetId) ? get().sources : [...get().sources, assetId];
        set({ kind: 'image', sources });
      },
      animate: (assetId) => set({ kind: 'video', firstFrame: assetId }),
      toggleCharacter: (id) => {
        const ids = get().characterIds;
        set({ characterIds: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] });
      },
      clearInputs: () => set({ sources: [], firstFrame: null, lastFrame: null, references: [], characterIds: [] }),
      remix: (gen) => {
        const by = (role: string) => gen.inputs.filter((i) => i.role === role).map((i) => i.assetId);
        const key = modelKey(gen.provider, gen.model);
        set({
          kind: gen.kind,
          prompt: gen.prompt,
          negativePrompt: gen.negativePrompt ?? '',
          selected: { ...get().selected, [gen.kind]: [key] },
          compare: false,
          params: { ...get().params, [gen.kind]: { ...gen.params } },
          modelOverride: '',
          ...(gen.kind === 'image'
            ? { sources: [...by('source'), ...by('reference')] }
            : { firstFrame: by('first_frame')[0] ?? null, lastFrame: by('last_frame')[0] ?? null, references: by('reference') }),
          characterIds: gen.characterIds,
        });
      },
    }),
    {
      name: 'img-studio',
      version: 2,
      // v2: provider prompt rewriting is off by default — prompts are sent exactly as written.
      migrate: (persisted, version) => {
        const state = persisted as Partial<StudioState>;
        if (version < 2 && state.params?.video) state.params.video.promptExtend = false;
        return state as StudioState;
      },
      partialize: (s) => ({
        kind: s.kind,
        prompt: s.prompt,
        negativePrompt: s.negativePrompt,
        selected: s.selected,
        compare: s.compare,
        params: s.params,
        sources: s.sources,
        firstFrame: s.firstFrame,
        lastFrame: s.lastFrame,
        references: s.references,
        characterIds: s.characterIds,
      }),
    },
  ),
);
