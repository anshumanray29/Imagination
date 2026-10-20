import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Character } from '@imagination/shared';
import { db, schema } from '../db/index.js';
import type { CharacterRow } from '../db/schema.js';
import { newId, notFound, badRequest } from '../lib/util.js';
import { getAssetRows, toAssetDto } from './assets.js';
import { publish } from './events.js';

function assetIdsFor(characterId: string): string[] {
  return db
    .select({ assetId: schema.characterAssets.assetId })
    .from(schema.characterAssets)
    .where(eq(schema.characterAssets.characterId, characterId))
    .orderBy(asc(schema.characterAssets.position))
    .all()
    .map((r) => r.assetId);
}

function toDto(row: CharacterRow): Character {
  const assets = getAssetRows(assetIdsFor(row.id)).map(toAssetDto);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    coverAssetId: row.coverAssetId ?? assets[0]?.id ?? null,
    assets,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function getRow(id: string): CharacterRow {
  const row = db.select().from(schema.characters).where(eq(schema.characters.id, id)).get();
  if (!row) throw notFound('Character');
  return row;
}

export function listCharacters(): Character[] {
  return db.select().from(schema.characters).orderBy(desc(schema.characters.updatedAt)).all().map(toDto);
}

export function getCharacter(id: string): Character {
  return toDto(getRow(id));
}

export function getCharacters(ids: string[]): Character[] {
  if (!ids.length) return [];
  const rows = db.select().from(schema.characters).where(inArray(schema.characters.id, ids)).all();
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is CharacterRow => Boolean(r)).map(toDto);
}

export function createCharacter(input: { name: string; description?: string; assetIds?: string[] }): Character {
  const name = input.name.trim();
  if (!name) throw badRequest('Name is required');
  const now = Date.now();
  const id = newId();
  db.insert(schema.characters).values({ id, name, description: input.description?.trim() ?? '', createdAt: now, updatedAt: now }).run();
  if (input.assetIds?.length) addImages(id, input.assetIds);
  publish({ type: 'character', id });
  return getCharacter(id);
}

export function updateCharacter(id: string, patch: { name?: string; description?: string; coverAssetId?: string | null }): Character {
  getRow(id);
  const values: Partial<CharacterRow> = { updatedAt: Date.now() };
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw badRequest('Name is required');
    values.name = patch.name.trim();
  }
  if (patch.description !== undefined) values.description = patch.description.trim();
  if (patch.coverAssetId !== undefined) values.coverAssetId = patch.coverAssetId;
  db.update(schema.characters).set(values).where(eq(schema.characters.id, id)).run();
  publish({ type: 'character', id });
  return getCharacter(id);
}

export function deleteCharacter(id: string) {
  getRow(id);
  db.delete(schema.characters).where(eq(schema.characters.id, id)).run();
  publish({ type: 'character', id });
}

export function addImages(id: string, assetIds: string[]): Character {
  getRow(id);
  const rows = getAssetRows(assetIds);
  if (rows.some((r) => r.kind !== 'image')) throw badRequest('Characters can only hold images');
  const maxPos =
    db
      .select({ m: sql<number>`coalesce(max(${schema.characterAssets.position}), -1)` })
      .from(schema.characterAssets)
      .where(eq(schema.characterAssets.characterId, id))
      .get()?.m ?? -1;
  rows.forEach((row, i) => {
    db.insert(schema.characterAssets)
      .values({ characterId: id, assetId: row.id, position: maxPos + 1 + i })
      .onConflictDoNothing()
      .run();
  });
  db.update(schema.characters).set({ updatedAt: Date.now() }).where(eq(schema.characters.id, id)).run();
  publish({ type: 'character', id });
  return getCharacter(id);
}

export function removeImage(id: string, assetId: string): Character {
  getRow(id);
  db.delete(schema.characterAssets)
    .where(and(eq(schema.characterAssets.characterId, id), eq(schema.characterAssets.assetId, assetId)))
    .run();
  db.update(schema.characters).set({ updatedAt: Date.now() }).where(eq(schema.characters.id, id)).run();
  publish({ type: 'character', id });
  return getCharacter(id);
}

export function characterCount(): number {
  return db.select({ n: sql<number>`count(*)` }).from(schema.characters).get()?.n ?? 0;
}
