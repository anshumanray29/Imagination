import { and, desc, eq, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { modeFor, normalizeParams, type CreateGenerationBody, type Generation, type JobStatus, type ModelInfo, type Page } from '@imagination/shared';
import { db, schema } from '../db/index.js';
import type { GenerationRow } from '../db/schema.js';
import { badRequest, newId, notFound } from '../lib/util.js';
import { getProvider } from '../providers/registry.js';
import { getAssetRows } from './assets.js';
import { getCharacters } from './characters.js';
import { publish } from './events.js';

export function toGenerationDto(row: GenerationRow): Generation {
  return {
    id: row.id,
    batchId: row.batchId,
    kind: row.kind,
    mode: row.mode as Generation['mode'],
    provider: row.provider,
    model: row.model,
    providerModelId: row.providerModelId,
    prompt: row.prompt,
    finalPrompt: row.finalPrompt,
    negativePrompt: row.negativePrompt,
    params: row.params,
    inputs: row.inputs,
    characterIds: row.characterIds,
    status: row.status,
    progress: row.progress,
    error: row.error,
    costUsd: row.costUsd,
    outputAssetIds: row.outputAssetIds,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export function getGenerationRow(id: string): GenerationRow {
  const row = db.select().from(schema.generations).where(eq(schema.generations.id, id)).get();
  if (!row) throw notFound('Generation');
  return row;
}

export function emitGeneration(id: string) {
  const row = db.select().from(schema.generations).where(eq(schema.generations.id, id)).get();
  if (row) publish({ type: 'generation', data: toGenerationDto(row) });
}

export function findModel(providerId: string, modelId: string): ModelInfo {
  const model = getProvider(providerId).models.find((m) => m.id === modelId);
  if (!model) throw badRequest(`Unknown model "${modelId}" for provider "${providerId}"`);
  return model;
}

/** Check one target against the request; returns a reason it can't run, or null. */
function validateTarget(body: CreateGenerationBody, providerId: string, model: ModelInfo, characterImageCount: number): string | null {
  const caps = model.capabilities;
  const name = model.name;
  if (caps.kind !== body.kind) return `${name} generates ${caps.kind}s, not ${body.kind}s`;
  const count = (role: string) => body.inputs.filter((i) => i.role === role).length;
  if (body.kind === 'image') {
    const sources = count('source') + count('reference');
    if (sources > caps.maxSourceImages) {
      return caps.maxSourceImages === 0 ? `${name} can't take input images` : `${name} accepts at most ${caps.maxSourceImages} input images`;
    }
    if (characterImageCount && caps.maxSourceImages === 0) return `${name} can't use character references`;
  } else {
    const frames = count('first_frame') + count('last_frame');
    if (count('first_frame') && !caps.firstFrame) return `${name} can't start from an image`;
    if (count('last_frame') && !caps.lastFrame) return `${name} doesn't support a last frame`;
    if (count('last_frame') && !count('first_frame')) return 'A last frame needs a first frame too';
    const refs = count('reference');
    if (refs > caps.maxReferenceImages) {
      return caps.maxReferenceImages === 0 ? `${name} doesn't support reference images` : `${name} accepts at most ${caps.maxReferenceImages} reference images`;
    }
    if (characterImageCount && caps.maxReferenceImages === 0) return `${name} doesn't support reference images, which characters need`;
    if (frames && (refs || characterImageCount) && !caps.framesWithReferences) {
      return `${name} can't combine start/end frames with references or characters`;
    }
  }
  const getP = getProvider(providerId);
  if (!getP.isConfigured()) return `${getP.name} is not configured — add its API key to .env`;
  return null;
}

export function createGenerations(body: CreateGenerationBody): Generation[] {
  if (!body.targets.length) throw badRequest('Pick at least one model');
  const hasInputs = body.inputs.length > 0 || body.characterIds.length > 0;
  if (!body.prompt.trim() && !hasInputs) throw badRequest('Write a prompt first');

  const inputRows = getAssetRows(body.inputs.map((i) => i.assetId));
  if (inputRows.length !== body.inputs.length) throw badRequest('One of the input assets no longer exists');
  if (inputRows.some((r) => r.kind !== 'image')) throw badRequest('Only images can be used as inputs');
  const validRoles = body.kind === 'image' ? ['source', 'reference'] : ['first_frame', 'last_frame', 'reference'];
  if (body.inputs.some((i) => !validRoles.includes(i.role))) throw badRequest('Invalid input role for this mode');
  if (body.inputs.filter((i) => i.role === 'first_frame').length > 1 || body.inputs.filter((i) => i.role === 'last_frame').length > 1) {
    throw badRequest('Only one first frame and one last frame are allowed');
  }

  const characters = getCharacters(body.characterIds);
  if (characters.length !== body.characterIds.length) throw badRequest('One of the selected characters no longer exists');
  const characterImageCount = characters.reduce((n, c) => n + c.assets.length, 0);

  const resolved = body.targets.map((t) => {
    const model = findModel(t.provider, t.model);
    const problem = validateTarget(body, t.provider, model, characterImageCount);
    if (problem) throw badRequest(problem);
    return { target: t, model };
  });

  const batchId = newId();
  const mode = modeFor(body.kind, body.inputs);
  const now = Date.now();
  const rows: GenerationRow[] = [];
  for (const { target, model } of resolved) {
    const caps = model.capabilities;
    const requested = Math.max(1, Math.min(body.params.count ?? 1, 4));
    // Image models return several outputs per request; video jobs are repeated instead.
    const jobs = caps.kind === 'video' ? requested : 1;
    const params = normalizeParams({ ...body.params, count: caps.kind === 'video' ? 1 : Math.min(requested, caps.maxOutputs) }, caps);
    for (let i = 0; i < jobs; i++) {
      rows.push({
        id: newId(),
        batchId,
        kind: body.kind,
        mode,
        provider: target.provider,
        model: model.id,
        providerModelId: target.modelOverride?.trim() || model.providerModelId,
        prompt: body.prompt.trim(),
        finalPrompt: null,
        negativePrompt: body.negativePrompt?.trim() || null,
        params,
        inputs: body.inputs,
        characterIds: body.characterIds,
        status: 'queued',
        progress: null,
        error: null,
        providerTaskId: null,
        providerData: null,
        costUsd: null,
        outputAssetIds: [],
        createdAt: now + rows.length, // keeps creation order stable
        startedAt: null,
        finishedAt: null,
      });
    }
  }
  db.transaction((tx) => {
    for (const r of rows) tx.insert(schema.generations).values(r).run();
  });
  const dtos = rows.map(toGenerationDto);
  dtos.forEach((d) => publish({ type: 'generation', data: d }));
  return dtos;
}

export function listGenerations(q: { status?: string; active?: boolean; batchId?: string; cursor?: string; limit?: number }): Page<Generation> {
  const g = schema.generations;
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const conds: SQL[] = [];
  if (q.active) conds.push(inArray(g.status, ['queued', 'running']));
  else if (q.status) conds.push(eq(g.status, q.status as JobStatus));
  if (q.batchId) conds.push(eq(g.batchId, q.batchId));
  if (q.cursor) {
    const sep = q.cursor.indexOf('_');
    const ts = Number(q.cursor.slice(0, sep));
    const id = q.cursor.slice(sep + 1);
    conds.push(or(lt(g.createdAt, ts), and(eq(g.createdAt, ts), lt(g.id, id)))!);
  }
  const rows = db.select().from(g).where(conds.length ? and(...conds) : undefined).orderBy(desc(g.createdAt), desc(g.id)).limit(limit + 1).all();
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items: items.map(toGenerationDto), nextCursor: rows.length > limit && last ? `${last.createdAt}_${last.id}` : null };
}

export function cancelGeneration(id: string): Generation {
  const row = getGenerationRow(id);
  if (row.status !== 'queued' && row.status !== 'running') throw badRequest(`Job is already ${row.status}`);
  db.update(schema.generations)
    .set({ status: 'canceled', finishedAt: Date.now(), error: row.status === 'running' ? 'Canceled (the provider may still finish and bill the request)' : null })
    .where(and(eq(schema.generations.id, id), inArray(schema.generations.status, ['queued', 'running'])))
    .run();
  emitGeneration(id);
  return toGenerationDto(getGenerationRow(id));
}

export function retryGeneration(id: string): Generation {
  const row = getGenerationRow(id);
  if (row.status === 'queued' || row.status === 'running') throw badRequest('Job is still in progress');
  const copy: GenerationRow = {
    ...row,
    id: newId(),
    batchId: newId(),
    finalPrompt: null,
    status: 'queued',
    progress: null,
    error: null,
    providerTaskId: null,
    providerData: null,
    costUsd: null,
    outputAssetIds: [],
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
  };
  db.insert(schema.generations).values(copy).run();
  emitGeneration(copy.id);
  return toGenerationDto(copy);
}

export function deleteGeneration(id: string) {
  const row = getGenerationRow(id);
  if (row.status === 'queued' || row.status === 'running') throw badRequest('Cancel the job before deleting it');
  db.delete(schema.generations).where(eq(schema.generations.id, id)).run();
}

export function spendByProvider() {
  const g = schema.generations;
  return db
    .select({ provider: g.provider, costUsd: sql<number>`coalesce(sum(${g.costUsd}), 0)`, jobs: sql<number>`count(*)` })
    .from(g)
    .where(eq(g.status, 'succeeded'))
    .groupBy(g.provider)
    .all();
}

export function generationCount(): number {
  return db.select({ n: sql<number>`count(*)` }).from(schema.generations).get()?.n ?? 0;
}
