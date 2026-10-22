import type { ModelInfo } from '@imagination/shared';

/**
 * One color per provider, used everywhere (badges, model browser, spend chart) so a provider
 * is recognizable at a glance. Hues/order validated for colorblind separation on the dark surface.
 */
export const PROVIDER_META: Record<string, { short: string; label: string; color: string; ink: string }> = {
  gemini: { short: 'G', label: 'Gemini', color: '#3987e5', ink: '#ffffff' },
  xai: { short: 'X', label: 'xAI', color: '#d95926', ink: '#ffffff' },
  openai: { short: 'O', label: 'OpenAI', color: '#199e70', ink: '#ffffff' },
  wan: { short: 'W', label: 'Wan', color: '#c98500', ink: '#0b0b10' },
  mock: { short: 'M', label: 'Mock', color: '#d55181', ink: '#ffffff' },
};

export const PROVIDER_ORDER = ['gemini', 'xai', 'openai', 'wan', 'mock'];

export function providerMeta(id: string) {
  return PROVIDER_META[id] ?? { short: id.slice(0, 1).toUpperCase(), label: id, color: '#71717a', ink: '#ffffff' };
}

/** Short capability chips shown on model cards. */
export function capabilityChips(model: ModelInfo): string[] {
  const c = model.capabilities;
  const chips: string[] = [];
  const top = (list: string[]) => list[list.length - 1];
  if (c.kind === 'image') {
    chips.push(c.maxSourceImages ? `Edit ×${c.maxSourceImages}` : 'Text → image');
    if (c.resolutions.length) chips.push(`up to ${top(c.resolutions)!.toUpperCase()}`);
    if (c.transparentBackground) chips.push('Transparent BG');
    if (c.qualities?.length) chips.push('Quality levels');
    if (c.seed) chips.push('Seed');
  } else {
    if (c.firstFrame && c.lastFrame) chips.push('Start + end frame');
    else if (c.firstFrame) chips.push('Start frame');
    if (c.maxReferenceImages) chips.push(`Refs ×${c.maxReferenceImages}`);
    chips.push(c.durations?.length ? `≤ ${Math.max(...c.durations)}s` : 'Auto length');
    if (c.resolutions.length) chips.push(top(c.resolutions)!);
    if (c.audio) chips.push('Sound');
  }
  return chips;
}
