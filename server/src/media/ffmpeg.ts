import { spawn } from 'node:child_process';
import { config } from '../config.js';

const FFMPEG = config.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = config.FFPROBE_PATH || 'ffprobe';

function run(bin: string, args: string[], timeoutMs = 10 * 60_000): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    const out: Buffer[] = [];
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => {
      err += d.toString();
      if (err.length > 20_000) err = err.slice(-20_000);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr: err });
      else reject(new Error(`${bin} exited with code ${code}: ${err.split('\n').slice(-6).join(' ').trim()}`));
    });
  });
}

let versionCache: string | null | undefined;
export async function ffmpegVersion(): Promise<string | null> {
  if (versionCache !== undefined) return versionCache;
  try {
    const { stdout } = await run(FFMPEG, ['-version'], 10_000);
    versionCache = stdout.toString().split('\n')[0]?.replace(/^ffmpeg version\s*/, '').split(' ')[0] ?? 'unknown';
  } catch {
    versionCache = null;
  }
  return versionCache;
}

export interface VideoProbe {
  width: number | null;
  height: number | null;
  durationMs: number | null;
  hasAudio: boolean;
}

export async function probeVideo(file: string): Promise<VideoProbe> {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], 60_000);
  const info = JSON.parse(stdout.toString());
  const video = info.streams?.find((s: any) => s.codec_type === 'video');
  const duration = Number(info.format?.duration ?? video?.duration);
  return {
    width: video?.width ?? null,
    height: video?.height ?? null,
    durationMs: Number.isFinite(duration) ? Math.round(duration * 1000) : null,
    hasAudio: Boolean(info.streams?.some((s: any) => s.codec_type === 'audio')),
  };
}

/** Grab a single frame as PNG. `at` is seconds from start, or 'last'. */
export async function extractFrame(file: string, at: number | 'last'): Promise<Buffer> {
  const seek = at === 'last' ? ['-sseof', '-0.25'] : ['-ss', String(Math.max(0, at))];
  const args = ['-hide_banner', '-loglevel', 'error', ...seek, '-i', file, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'];
  const { stdout } = await run(FFMPEG, args, 60_000);
  if (!stdout.length && at === 'last') {
    // Very short clips can fail with -sseof; fall back to decoding the whole clip and keeping the final frame.
    const res = await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-update', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'], 120_000);
    return res.stdout;
  }
  return stdout;
}

/**
 * Concatenate clips into one MP4. Every clip is scaled/padded to the first clip's size and 30 fps;
 * clips without sound get silence so the audio track stays continuous.
 */
export async function concatVideos(files: string[], output: string): Promise<void> {
  const probes = await Promise.all(files.map(probeVideo));
  const W = (probes[0]?.width ?? 1280) & ~1;
  const H = (probes[0]?.height ?? 720) & ~1;
  const args: string[] = ['-hide_banner', '-loglevel', 'error', '-y'];
  files.forEach((f) => args.push('-i', f));
  // Silent clips get an extra generated-silence input of the same length.
  let nextInput = files.length;
  const audioIn = probes.map((p, i) => {
    if (p.hasAudio) return `[${i}:a]`;
    args.push('-f', 'lavfi', '-t', String((p.durationMs ?? 5000) / 1000), '-i', 'anullsrc=r=48000:cl=stereo');
    return `[${nextInput++}:a]`;
  });
  const filters: string[] = [];
  const pairs: string[] = [];
  probes.forEach((_, i) => {
    filters.push(
      `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`,
    );
    filters.push(`${audioIn[i]}aresample=48000,aformat=channel_layouts=stereo[a${i}]`);
    pairs.push(`[v${i}][a${i}]`);
  });
  filters.push(`${pairs.join('')}concat=n=${files.length}:v=1:a=1[outv][outa]`);
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[outv]', '-map', '[outa]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    output,
  );
  await run(FFMPEG, args, 30 * 60_000);
}

/** Generate a test-pattern clip (used by the mock provider). */
export async function makeTestVideo(output: string, opts: { width: number; height: number; seconds: number; hue: number }) {
  const { width, height, seconds, hue } = opts;
  await run(
    FFMPEG,
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}:rate=30:duration=${seconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=${220 + Math.round(hue)}:duration=${seconds}`,
      '-vf', `hue=h=${hue}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
      '-c:a', 'aac', '-shortest', '-movflags', '+faststart',
      output,
    ],
    120_000,
  );
}
