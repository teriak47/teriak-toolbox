import { Hono } from 'hono';
import { extractId, getDb, generateId, toRecordId } from '../db.ts';
import { mapCategory, sortCategoryRecords, touchProject } from '../mappers.ts';
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
  // A new category goes after the others. In a project created before categories had a
  // position, it gets none either, so it is sorted by name with them as before.
  const [positions] = await db
    .query<[unknown[]]>('SELECT VALUE position FROM category WHERE projectId = $projectId;', {
      projectId,
    })
    .collect();
  const isPos = (p: unknown): p is number => typeof p === 'number' && Number.isFinite(p);
  const all = positions ?? [];
  const position = all.every(isPos) ? Math.max(-1, ...all) + 1 : undefined;

  const created = await db.create(toRecordId('category', id)).content({
    projectId,
    ...(position === undefined ? {} : { position }),
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

// Reorder a project's categories: `ids` in the new order. Categories left out keep their
// relative order after the listed ones; unknown or foreign ids are a 400.
categoriesRouter.put('/projects/:projectId/categories/order', async (c) => {
  const projectId = c.req.param('projectId');
  const body = await readBody<{ ids: unknown }>(c);
  if (!Array.isArray(body.ids) || !body.ids.every((id) => typeof id === 'string')) {
    return c.json({ error: 'Liste d\'identifiants attendue.' }, 400);
  }
  const db = await getDb();
  if (!(await projectExists(db, projectId))) {
    return c.json({ error: 'Projet introuvable.' }, 404);
  }
  const [raws] = await db
    .query<[Record<string, unknown>[]]>('SELECT * FROM category WHERE projectId = $projectId;', {
      projectId,
    })
    .collect();
  const current = sortCategoryRecords(raws ?? []).map(mapCategory);
  const known = new Set(current.map((cat) => cat.id));
  const listed = [...new Set(body.ids as string[])];
  if (listed.some((id) => !known.has(id))) {
    return c.json({ error: 'Catégorie inconnue dans ce projet.' }, 400);
  }
  const order = [...listed, ...current.map((cat) => cat.id).filter((id) => !listed.includes(id))];

  await db
    .query(
      `BEGIN TRANSACTION;
      FOR $u IN $updates {
        UPDATE $u.cid SET position = $u.position;
      };
      COMMIT TRANSACTION;`,
      {
        updates: order.map((id, position) => ({ cid: toRecordId('category', id), position })),
      }
    )
    .collect();
  await touchProject(db, projectId);

  const byId = new Map(current.map((cat) => [cat.id, cat]));
  return c.json({ categories: order.map((id) => byId.get(id)) });
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

// Merge a category into another one of the same project (V5): its nodes move to the target,
// the target gets the source's default keys it lacks, and the source is deleted, all in
// one transaction. Returns the updated target and the ids of the moved nodes.
categoriesRouter.post('/categories/:id/merge', async (c) => {
  const id = c.req.param('id');
  const body = await readBody<{ targetId?: unknown }>(c);
  const targetId = optString(body.targetId);
  if (!targetId) return c.json({ error: 'Catégorie cible (targetId) attendue.' }, 400);
  if (targetId === id) return c.json({ error: 'Une catégorie ne peut pas être fusionnée avec elle-même.' }, 400);

  const db = await getDb();
  const [source, target] = await db
    .query<[Record<string, unknown> | undefined, Record<string, unknown> | undefined]>(
      'SELECT * FROM ONLY $sid; SELECT * FROM ONLY $tid;',
      { sid: toRecordId('category', id), tid: toRecordId('category', targetId) }
    )
    .collect();
  if (!source || !target) return c.json({ error: 'Catégorie introuvable.' }, 404);
  if (String(source.projectId) !== String(target.projectId)) {
    return c.json({ error: 'Les deux catégories doivent appartenir au même projet.' }, 400);
  }

  const src = mapCategory(source);
  const dst = mapCategory(target);
  const merged = normalizeCategoryKeys([...dst.metadataKeys, ...src.metadataKeys], dst.cardKeys);
  const [moved] = await db
    .query<[unknown[]]>(
      `SELECT VALUE id FROM entity WHERE categoryId = $sourceStr AND projectId = $projectId;`,
      { sourceStr: id, projectId: dst.projectId }
    )
    .collect();
  const results = await db
    .query<[undefined, unknown, unknown, Record<string, unknown> | undefined, unknown, undefined]>(
      `BEGIN TRANSACTION;
      UPDATE entity SET categoryId = $targetStr WHERE categoryId = $sourceStr AND projectId = $projectId;
      DELETE $sid;
      UPDATE ONLY $tid SET metadataKeys = $metadataKeys, cardKeys = $cardKeys;
      COMMIT TRANSACTION;`,
      {
        targetStr: targetId,
        sourceStr: id,
        projectId: dst.projectId,
        sid: toRecordId('category', id),
        tid: toRecordId('category', targetId),
        metadataKeys: merged.metadataKeys,
        cardKeys: merged.cardKeys,
      }
    )
    .collect();
  const updated = results.find(
    (r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r) && 'name' in r
  );
  await touchProject(db, dst.projectId);

  return c.json({
    category: updated ? mapCategory(updated) : { ...dst, ...merged },
    movedNodeIds: (moved ?? []).map((v) => extractId(v)),
  });
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
