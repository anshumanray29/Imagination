import { sqliteTable, text, integer, real, index, primaryKey } from 'drizzle-orm/sqlite-core';
import type { GenerationInput, GenerationParams } from '@imagination/shared';

export const assets = sqliteTable(
  'assets',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['image', 'video'] }).notNull(),
    source: text('source', { enum: ['upload', 'generated', 'derived'] }).notNull(),
    name: text('name'),
    /** Which storage driver holds the original file. Lets local and R2 files coexist. */
    storageDriver: text('storage_driver', { enum: ['local', 'r2'] }).notNull(),
    storageKey: text('storage_key').notNull(),
    mime: text('mime').notNull(),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    sizeBytes: integer('size_bytes').notNull(),
    prompt: text('prompt'),
    generationId: text('generation_id'),
    provider: text('provider'),
    model: text('model'),
    favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('assets_created_idx').on(t.createdAt),
    index('assets_generation_idx').on(t.generationId),
    index('assets_kind_idx').on(t.kind, t.createdAt),
  ],
);

export const generations = sqliteTable(
  'generations',
  {
    id: text('id').primaryKey(),
    /** Jobs created by one "Generate" click share a batch (compare mode creates several). */
    batchId: text('batch_id').notNull(),
    kind: text('kind', { enum: ['image', 'video'] }).notNull(),
    mode: text('mode').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    providerModelId: text('provider_model_id').notNull(),
    prompt: text('prompt').notNull(),
    finalPrompt: text('final_prompt'),
    negativePrompt: text('negative_prompt'),
    params: text('params', { mode: 'json' }).$type<GenerationParams>().notNull(),
    inputs: text('inputs', { mode: 'json' }).$type<GenerationInput[]>().notNull(),
    characterIds: text('character_ids', { mode: 'json' }).$type<string[]>().notNull(),
    status: text('status', { enum: ['queued', 'running', 'succeeded', 'failed', 'canceled'] }).notNull(),
    progress: integer('progress'),
    error: text('error'),
    providerTaskId: text('provider_task_id'),
    providerData: text('provider_data', { mode: 'json' }).$type<Record<string, unknown>>(),
    costUsd: real('cost_usd'),
    outputAssetIds: text('output_asset_ids', { mode: 'json' }).$type<string[]>().notNull(),
    createdAt: integer('created_at').notNull(),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
  },
  (t) => [index('generations_created_idx').on(t.createdAt), index('generations_status_idx').on(t.status)],
);

export const characters = sqliteTable('characters', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  coverAssetId: text('cover_asset_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const characterAssets = sqliteTable(
  'character_assets',
  {
    characterId: text('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.assetId] })],
);

export type AssetRow = typeof assets.$inferSelect;
export type GenerationRow = typeof generations.$inferSelect;
export type CharacterRow = typeof characters.$inferSelect;
