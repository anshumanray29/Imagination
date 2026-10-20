import { and, asc, eq } from 'drizzle-orm';
import { estimateCost } from '@imagination/shared';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import type { GenerationRow } from '../db/schema.js';
import { downloadBuffer } from '../lib/http.js';
import { errorMessage } from '../lib/util.js';
import { makeInputImage } from '../providers/inputs.js';
import { composePrompt, type PromptCharacter } from '../providers/prompt.js';
import { getProvider } from '../providers/registry.js';
import type { InputImage, JobContext, PollResult, ProviderOutput, SubmitResult } from '../providers/types.js';
import { getAssetRows, ingestAsset } from '../services/assets.js';
import { getCharacters } from '../services/characters.js';
import { emitGeneration, findModel } from '../services/generations.js';

const JOB_TIMEOUT_MS = 45 * 60_000;
const MAX_POLL_FAILURES = 6;

/** Character images are shared round-robin so every character keeps at least one reference within the cap. */
function pickCharacterImages(chars: ReturnType<typeof getCharacters>, room: number) {
  const picked = chars.map(() => [] as string[]);
  let added = 0;
  for (let round = 0; added < room; round++) {
    let any = false;
    chars.forEach((c, i) => {
      if (added < room && c.assets[round]) {
        picked[i]!.push(c.assets[round]!.id);
        added++;
        any = true;
      }
    });
    if (!any) break;
  }
  return picked;
}

/** `phase: 'poll'` tolerates inputs deleted after submission — the provider already has them. */
function buildContext(row: GenerationRow, signal: AbortSignal, phase: 'submit' | 'poll' = 'submit'): JobContext {
  const adapter = getProvider(row.provider);
  const model = findModel(row.provider, row.model);
  const caps = model.capabilities;

  const byRole = (role: string) => row.inputs.filter((i) => i.role === role).map((i) => i.assetId);
  const explicit = row.kind === 'image' ? [...byRole('source'), ...byRole('reference')] : byRole('reference');
  const cap = row.kind === 'image' ? caps.maxSourceImages : caps.maxReferenceImages;

  const chars = getCharacters(row.characterIds);
  const charPicks = pickCharacterImages(chars, Math.max(0, cap - explicit.length));
  const imageIds = [...explicit, ...charPicks.flat()];

  // In video requests, start/end frames come before references in most providers' numbering.
  const frameIds = [...byRole('first_frame'), ...byRole('last_frame')];
  const rows = new Map(getAssetRows([...imageIds, ...frameIds]).map((r) => [r.id, r]));
  if (phase === 'submit' && rows.size < new Set([...imageIds, ...frameIds]).size) {
    throw new Error('An input image was deleted before the job ran');
  }
  const toInput = (id: string): InputImage | null => {
    const r = rows.get(id);
    return r ? makeInputImage(r) : null;
  };
  const present = (x: InputImage | null): x is InputImage => x !== null;

  let offset = explicit.length;
  const promptChars: PromptCharacter[] = chars.map((c, i) => {
    const indexes = charPicks[i]!.map((_, j) => offset + j);
    offset += charPicks[i]!.length;
    return { name: c.name, description: c.description, imageIndexes: indexes };
  });

  const prompt =
    row.finalPrompt ??
    composePrompt({
      prompt: row.prompt,
      style: row.params.style,
      characters: promptChars,
      imageOffset: 0,
      label: (i) => adapter.imageLabel(i, row.kind),
    });

  const images = imageIds.map(toInput).filter(present);
  const first = byRole('first_frame')[0];
  const last = byRole('last_frame')[0];
  return {
    generationId: row.id,
    kind: row.kind,
    mode: row.mode as JobContext['mode'],
    model,
    providerModelId: row.providerModelId,
    prompt,
    negativePrompt: row.negativePrompt ?? undefined,
    params: row.params,
    sources: row.kind === 'image' ? images : [],
    references: row.kind === 'video' ? images : [],
    firstFrame: (first && toInput(first)) || undefined,
    lastFrame: (last && toInput(last)) || undefined,
    providerData: row.providerData ?? {},
    signal,
  };
}

function update(id: string, values: Partial<GenerationRow>, onlyIfRunning = true) {
  const where = onlyIfRunning
    ? and(eq(schema.generations.id, id), eq(schema.generations.status, 'running'))
    : eq(schema.generations.id, id);
  const res = db.update(schema.generations).set(values).where(where).run();
  if (res.changes) emitGeneration(id);
  return res.changes > 0;
}

function current(id: string) {
  return db.select().from(schema.generations).where(eq(schema.generations.id, id)).get();
}

class JobWorker {
  private busy = new Set<string>();
  private nextPollAt = new Map<string, number>();
  private pollFailures = new Map<string, number>();
  private aborts = new Map<string, AbortController>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  start() {
    // Jobs that were mid-submit when the server stopped can't be resumed safely (no task id yet).
    const stuck = db.select().from(schema.generations).where(eq(schema.generations.status, 'running')).all();
    for (const row of stuck) {
      if (!row.providerTaskId) {
        update(row.id, { status: 'failed', error: 'Interrupted — IMG restarted while this job was being submitted. Use Retry.', finishedAt: Date.now() });
      }
    }
    this.timer = setInterval(() => void this.tick(), 1000);
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    for (const a of this.aborts.values()) a.abort();
  }

  wake() {
    setImmediate(() => void this.tick());
  }

  /** Abort an in-flight request for a job that the user canceled. */
  abort(id: string) {
    this.aborts.get(id)?.abort();
  }

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = Date.now();
      const running = db.select().from(schema.generations).where(eq(schema.generations.status, 'running')).all();
      for (const row of running) {
        if (this.busy.has(row.id)) continue;
        if (row.startedAt && now - row.startedAt > JOB_TIMEOUT_MS) {
          update(row.id, { status: 'failed', error: 'Timed out waiting for the provider', finishedAt: now });
          continue;
        }
        if (row.providerTaskId && (this.nextPollAt.get(row.id) ?? 0) <= now) void this.poll(row);
      }
      const slots = config.MAX_CONCURRENT_JOBS - running.length;
      if (slots > 0) {
        const queued = db
          .select()
          .from(schema.generations)
          .where(eq(schema.generations.status, 'queued'))
          .orderBy(asc(schema.generations.createdAt))
          .limit(slots)
          .all();
        for (const row of queued) void this.run(row);
      }
    } catch (err) {
      console.error('[worker] tick failed:', err);
    } finally {
      this.ticking = false;
    }
  }

  private async run(row: GenerationRow) {
    const claimed = db
      .update(schema.generations)
      .set({ status: 'running', startedAt: Date.now(), progress: 0 })
      .where(and(eq(schema.generations.id, row.id), eq(schema.generations.status, 'queued')))
      .run();
    if (!claimed.changes) return;
    emitGeneration(row.id);
    this.busy.add(row.id);
    const abort = new AbortController();
    this.aborts.set(row.id, abort);
    try {
      const ctx = buildContext(row, abort.signal);
      update(row.id, { finalPrompt: ctx.prompt });
      const adapter = getProvider(row.provider);
      const result: SubmitResult = await adapter.submit(ctx);
      if (current(row.id)?.status !== 'running') return; // canceled meanwhile
      if (result.status === 'completed') await this.finish(row.id, ctx, result.outputs, result.costUsd);
      else {
        update(row.id, { providerTaskId: result.taskId, providerData: { ...ctx.providerData, ...result.providerData }, progress: 1 });
        this.nextPollAt.set(row.id, Date.now() + 2500);
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        console.error(`[worker] ${row.provider}/${row.model} submit failed:`, errorMessage(err));
        update(row.id, { status: 'failed', error: errorMessage(err), finishedAt: Date.now() });
      }
    } finally {
      this.busy.delete(row.id);
      this.aborts.delete(row.id);
      this.wake();
    }
  }

  private async poll(row: GenerationRow) {
    this.busy.add(row.id);
    const abort = new AbortController();
    this.aborts.set(row.id, abort);
    try {
      const adapter = getProvider(row.provider);
      if (!adapter.poll) throw new Error(`${adapter.name} returned a task but has no poll() implementation`);
      const ctx = buildContext(row, abort.signal, 'poll');
      const result: PollResult = await adapter.poll(ctx, row.providerTaskId!);
      this.pollFailures.delete(row.id);
      if (result.status === 'pending') {
        const values: Partial<GenerationRow> = {};
        if (result.progress !== undefined && result.progress !== row.progress) values.progress = result.progress;
        if (result.providerData) values.providerData = { ...ctx.providerData, ...result.providerData };
        if (Object.keys(values).length) update(row.id, values);
        const age = Date.now() - (row.startedAt ?? Date.now());
        const interval = row.provider === 'mock' ? 1000 : age < 2 * 60_000 ? 4000 : 10_000;
        this.nextPollAt.set(row.id, Date.now() + interval);
      } else if (result.status === 'completed') {
        await this.finish(row.id, ctx, result.outputs, result.costUsd);
      } else {
        update(row.id, { status: 'failed', error: result.error, finishedAt: Date.now() });
      }
    } catch (err) {
      if (abort.signal.aborted) return;
      const failures = (this.pollFailures.get(row.id) ?? 0) + 1;
      this.pollFailures.set(row.id, failures);
      console.warn(`[worker] poll ${row.id} failed (${failures}/${MAX_POLL_FAILURES}):`, errorMessage(err));
      if (failures >= MAX_POLL_FAILURES) {
        update(row.id, { status: 'failed', error: `Lost contact with provider: ${errorMessage(err)}`, finishedAt: Date.now() });
      } else {
        this.nextPollAt.set(row.id, Date.now() + 10_000);
      }
    } finally {
      this.busy.delete(row.id);
      this.aborts.delete(row.id);
    }
  }

  private async finish(id: string, ctx: JobContext, outputs: ProviderOutput[], costUsd?: number) {
    const row = current(id);
    if (!row || row.status !== 'running') return;
    update(id, { progress: 99 });
    const assetIds: string[] = [];
    const errors: string[] = [];
    for (const out of outputs) {
      try {
        let buffer = out.data;
        let mime = out.mime ?? null;
        if (!buffer && out.url) {
          const dl = await downloadBuffer(out.url, { headers: out.headers, signal: ctx.signal });
          buffer = dl.buffer;
          mime = mime ?? dl.contentType;
        }
        if (!buffer?.length) throw new Error('empty output');
        const asset = await ingestAsset({
          buffer,
          mime,
          source: 'generated',
          prompt: row.prompt,
          generationId: id,
          provider: row.provider,
          model: row.model,
        });
        assetIds.push(asset.id);
      } catch (err) {
        errors.push(errorMessage(err));
      }
    }
    if (!assetIds.length) {
      update(id, { status: 'failed', error: `Could not save the result: ${errors[0] ?? 'no outputs'}`, finishedAt: Date.now(), costUsd: costUsd ?? null });
      return;
    }
    update(id, {
      status: 'succeeded',
      progress: 100,
      outputAssetIds: assetIds,
      // Providers that don't report spend fall back to the catalog's list price, if known.
      costUsd: costUsd ?? estimateCost(ctx.model, row.params),
      error: errors.length ? `${errors.length} output(s) could not be saved: ${errors[0]}` : null,
      finishedAt: Date.now(),
    });
    this.nextPollAt.delete(id);
  }
}

export const worker = new JobWorker();
