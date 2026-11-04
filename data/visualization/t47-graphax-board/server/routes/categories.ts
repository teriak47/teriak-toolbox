import { Hono } from 'hono';
import { getDb, generateId, toRecordId } from '../db.ts';
import { mapCategory, touchProject } from '../mappers.ts';
import { projectExists } from '../guards.ts';
import {
  DEFAULT_CATEGORY_COLOR,
  DEFAULT_CATEGORY_ICON,
  DEFAULT_CATEGORY_SHAPE,
  type CategoryIconName,
  type CategoryShape,
  MAX_CATEGORY_KEYS,
  normalizeCategoryKeys,
  normalizeKeyList,
} from '../../shared/types.ts';
import {
  isCategoryIcon,
  isCategoryShape,
  normalizeColor,
  optString,
  readBody,
} from '../validation.ts';

type CategoryBody = {
  name: string;
  color: string;
  icon: CategoryIconName;
  shape: CategoryShape;
  metadataKeys: string[];
  cardKeys: string[];
};

// Default keys and card keys that were sent; a value that is not a list is a 400
function readCategoryKeys(
  body: Partial<Record<keyof CategoryBody, unknown>>
): { error: string } | { metadataKeys?: string[]; cardKeys?: string[] } {
  const out: { metadataKeys?: string[]; cardKeys?: string[] } = {};
  for (const field of ['metadataKeys', 'cardKeys'] as const) {
    const value = body[field];
    if (value === undefined) continue;
    if (!Array.isArray(value)) return { error: 'Liste de clés invalide.' };
    out[field] = normalizeKeyList(value, MAX_CATEGORY_KEYS);
  }
  return out;
}

// Checks the colour, icon and shape that were sent; missing fields are left undefined
function readCategoryStyle(
  body: Partial<Record<keyof CategoryBody, unknown>>
):
  | { error: string }
  | { color?: string; icon?: CategoryIconName; shape?: CategoryShape } {
  const style: { color?: string; icon?: CategoryIconName; shape?: CategoryShape } = {};
  if (body.color !== undefined) {
    const color = normalizeColor(body.color);
    if (!color) return { error: 'Couleur invalide : format #rrggbb attendu.' };
    style.color = color;
  }
  if (body.icon !== undefined) {
    if (!isCategoryIcon(body.icon)) return { error: 'Icône de catégorie inconnue.' };
    style.icon = body.icon;
  }
  if (body.shape !== undefined) {
    if (!isCategoryShape(body.shape)) return { error: 'Forme de catégorie inconnue.' };
    style.shape = body.shape;
  }
  return style;
}

export const categoriesRouter = new Hono();

// Create category in a project
categoriesRouter.post('/projects/:projectId/categories', async (c) => {
  const projectId = c.req.param('projectId');
  const body = await readBody<CategoryBody>(c);

  const name = (optString(body.name) ?? '').trim();
  if (!name) {
    return c.json({ error: 'Le nom de la catégorie est requis.' }, 400);
  }
  const style = readCategoryStyle(body);
  if ('error' in style) return c.json({ error: style.error }, 400);
  const keys = readCategoryKeys(body);
  if ('error' in keys) return c.json({ error: keys.error }, 400);

  const db = await getDb();
  if (!(await projectExists(db, projectId))) {
    return c.json({ error: 'Projet introuvable.' }, 404);
  }
  const id = generateId();

  const created = await db.create(toRecordId('category', id)).content({
    projectId,
    name,
    color: style.color ?? DEFAULT_CATEGORY_COLOR,
    icon: style.icon ?? DEFAULT_CATEGORY_ICON,
    shape: style.shape ?? DEFAULT_CATEGORY_SHAPE,
    ...normalizeCategoryKeys(keys.metadataKeys, keys.cardKeys),
  });

  await touchProject(db, projectId);

  return c.json(
    {
      category: mapCategory({ ...(created as Record<string, unknown>), id }),
    },
    201
  );
});

// Update category
categoriesRouter.patch('/categories/:id', async (c) => {
  const id = c.req.param('id');
  const body = await readBody<CategoryBody>(c);
  const style = readCategoryStyle(body);
  if ('error' in style) return c.json({ error: style.error }, 400);
  const keys = readCategoryKeys(body);
  if ('error' in keys) return c.json({ error: keys.error }, 400);

  const db = await getDb();
  const sets: string[] = [];
  const params: Record<string, unknown> = {
    cid: toRecordId('category', id),
  };

  if (typeof body.name === 'string' && body.name.trim()) {
    sets.push('name = $name');
    params.name = body.name.trim();
  }
  if (style.color) {
    sets.push('color = $color');
    params.color = style.color;
  }
  if (style.icon) {
    sets.push('icon = $icon');
    params.icon = style.icon;
  }
  if (style.shape) {
    sets.push('shape = $shape');
    params.shape = style.shape;
  }
  // Card keys are read back among the default keys (see mapCategory)
  if (keys.metadataKeys) {
    sets.push('metadataKeys = $metadataKeys');
    params.metadataKeys = keys.metadataKeys;
  }
  if (keys.cardKeys) {
    sets.push('cardKeys = $cardKeys');
    params.cardKeys = keys.cardKeys;
  }

  if (sets.length === 0) {
    const [existing] = await db
      .query<[Record<string, unknown> | undefined]>('SELECT * FROM ONLY $cid;', params)
      .collect();
    if (!existing) return c.json({ error: 'Catégorie introuvable.' }, 404);
    return c.json({ category: mapCategory(existing) });
  }

  const [updated] = await db
    .query<[Record<string, unknown> | undefined]>(
      `UPDATE ONLY $cid SET ${sets.join(', ')};`,
      params
    )
    .collect();

  if (!updated) {
    return c.json({ error: 'Catégorie introuvable.' }, 404);
  }

  const category = mapCategory(updated);
  await touchProject(db, category.projectId);

  return c.json({ category });
});

// Delete category and detach nodes using it
categoriesRouter.delete('/categories/:id', async (c) => {
  const id = c.req.param('id');
  const db = await getDb();

  const [existing] = await db
    .query<[Record<string, unknown> | undefined]>('SELECT * FROM ONLY $cid;', {
      cid: toRecordId('category', id),
    })
    .collect();

  await db
    .query(
      `
      BEGIN TRANSACTION;
      UPDATE entity SET categoryId = NONE WHERE categoryId = $catIdStr;
      DELETE $cid;
      COMMIT TRANSACTION;
    `,
      {
        catIdStr: id,
        cid: toRecordId('category', id),
      }
    )
    .collect();

  if (existing?.projectId) {
    await touchProject(db, String(existing.projectId));
  }

  return c.json({ deleted: true });
});
