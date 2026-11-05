import { Hono } from 'hono';
import type { Surreal } from 'surrealdb';
import { extractId, generateId, getDb, toRecordId } from '../db.ts';
import { mapCategory, sortCategoryRecords } from '../mappers.ts';
import { projectExists } from '../guards.ts';
import {
  DEFAULT_CATEGORY_COLOR,
  DEFAULT_CATEGORY_ICON,
  DEFAULT_CATEGORY_SHAPE,
  MAX_PRESET_NAME_LENGTH,
  type PresetCategory,
  type UserPreset,
  normalizeCategoryKeys,
} from '../../shared/types.ts';
import { isCategoryIcon, isCategoryShape, isPlainObject, normalizeColor, optString, readBody } from '../validation.ts';

// Presets saved by the user (V5): a project's categories, offered when creating a project
export const presetsRouter = new Hono();

function mapPresetCategories(value: unknown): PresetCategory[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isPlainObject).map((cat) => ({
    name: (optString(cat.name) ?? '').trim() || 'Catégorie',
    color: normalizeColor(cat.color) ?? DEFAULT_CATEGORY_COLOR,
    icon: isCategoryIcon(cat.icon) ? cat.icon : DEFAULT_CATEGORY_ICON,
    shape: isCategoryShape(cat.shape) ? cat.shape : DEFAULT_CATEGORY_SHAPE,
    ...normalizeCategoryKeys(cat.metadataKeys, cat.cardKeys),
  }));
}

function mapPreset(raw: Record<string, unknown>): UserPreset {
  return {
    id: extractId(raw.id),
    name: String(raw.name ?? 'Preset'),
    categories: mapPresetCategories(raw.categories),
    createdAt: String(raw.createdAt ?? ''),
  };
}

// The categories of a saved preset, or null when it does not exist
export async function loadUserPreset(db: Surreal, presetId: string): Promise<UserPreset | null> {
  const [raw] = await db
    .query<[Record<string, unknown> | undefined]>('SELECT * FROM ONLY $id;', {
      id: toRecordId('user_preset', presetId),
    })
    .collect();
  return raw ? mapPreset(raw) : null;
}

presetsRouter.get('/presets', async (c) => {
  const db = await getDb();
  const [rows] = await db
    .query<[Record<string, unknown>[]]>('SELECT * FROM user_preset ORDER BY createdAt;')
    .collect();
  return c.json({ presets: (rows ?? []).map(mapPreset) });
});

// Saves the project's categories (in their order) as a new preset
presetsRouter.post('/projects/:projectId/presets', async (c) => {
  const projectId = c.req.param('projectId');
  const body = await readBody<{ name?: unknown }>(c);
  const name = (optString(body.name) ?? '').trim().slice(0, MAX_PRESET_NAME_LENGTH);
  if (!name) return c.json({ error: 'Nom du preset attendu.' }, 400);

  const db = await getDb();
  if (!(await projectExists(db, projectId))) return c.json({ error: 'Projet introuvable.' }, 404);
  const [rows] = await db
    .query<[Record<string, unknown>[]]>('SELECT * FROM category WHERE projectId = $projectId;', {
      projectId,
    })
    .collect();
  const categories = sortCategoryRecords(rows ?? [])
    .map(mapCategory)
    .map(({ name: n, color, icon, shape, metadataKeys, cardKeys }) => ({
      name: n,
      color,
      icon,
      shape,
      metadataKeys,
      cardKeys,
    }));
  if (categories.length === 0) return c.json({ error: 'Ce projet n’a aucune catégorie.' }, 400);

  const id = generateId();
  const createdAt = new Date().toISOString();
  await db.create(toRecordId('user_preset', id)).content({ name, categories, createdAt });
  return c.json({ preset: { id, name, categories, createdAt } satisfies UserPreset }, 201);
});

presetsRouter.delete('/presets/:id', async (c) => {
  const db = await getDb();
  const preset = await loadUserPreset(db, c.req.param('id'));
  if (!preset) return c.json({ error: 'Preset introuvable.' }, 404);
  await db.query('DELETE $id;', { id: toRecordId('user_preset', preset.id) }).collect();
  return c.json({ deleted: true });
});
