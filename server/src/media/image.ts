import sharp from 'sharp';

export async function imageSize(buf: Buffer): Promise<{ width: number | null; height: number | null }> {
  try {
    const meta = await sharp(buf).metadata();
    return { width: meta.width ?? null, height: meta.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

export interface NormalizeOptions {
  /** Longest side in pixels. */
  maxSide?: number;
  format?: 'jpeg' | 'png' | 'webp';
  /** Remove transparency (some providers reject alpha channels). */
  flatten?: boolean;
}

/** Resize/convert an image into something every provider accepts. */
export async function normalizeImage(buf: Buffer, opts: NormalizeOptions = {}): Promise<{ buffer: Buffer; mime: string }> {
  const { maxSide = 2048, format = 'jpeg', flatten = format === 'jpeg' } = opts;
  let img = sharp(buf, { animated: false }).rotate();
  img = img.resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });
  if (flatten) img = img.flatten({ background: '#ffffff' });
  if (format === 'jpeg') img = img.jpeg({ quality: 92 });
  else if (format === 'png') img = img.png();
  else img = img.webp({ quality: 92 });
  return { buffer: await img.toBuffer(), mime: `image/${format}` };
}

export async function makeThumb(buf: Buffer): Promise<Buffer> {
  return sharp(buf, { animated: false })
    .rotate()
    .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
}
