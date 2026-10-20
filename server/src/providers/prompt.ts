import { STYLE_PRESETS } from '@imagination/shared';

export interface PromptCharacter {
  name: string;
  description: string;
  /** 0-based positions of this character's images within the request's image list. */
  imageIndexes: number[];
}

/** Final prompt = user prompt + style + a character sheet that points at the reference images. */
export function composePrompt(opts: {
  prompt: string;
  style?: string;
  characters: PromptCharacter[];
  imageOffset: number;
  label: (index: number) => string;
}): string {
  let text = opts.prompt.trim();
  const style = STYLE_PRESETS.find((s) => s.id === opts.style);
  if (style) text = text ? `${text}\n\nStyle: ${style.suffix}.` : `Style: ${style.suffix}.`;

  if (opts.characters.length) {
    const lines = opts.characters.map((c) => {
      const refs = c.imageIndexes.map((i) => opts.label(i + opts.imageOffset));
      const shown = refs.length ? ` (shown in ${refs.join(', ')})` : '';
      return `- ${c.name}${shown}${c.description ? `: ${c.description}` : ''}`;
    });
    text +=
      `\n\nCharacters:\n${lines.join('\n')}\n` +
      `Keep each character's face, hair, body proportions and outfit consistent with their reference images.`;
  }
  return text;
}
