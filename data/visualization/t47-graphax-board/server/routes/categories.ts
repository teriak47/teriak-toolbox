import { Hono } from 'hono';
import { getDb, generateId, toRecordId } from '../db.ts';
import { mapCategory, touchProject } from '../mappers.ts';
import type { CategoryIconName, CategoryShape } from '../../shared/types.ts';

export const categoriesRouter = new Hono();

// Create category in a project
categoriesRouter.post('/projects/:projectId/categories', async (c) => {
  const projectId = c.req.param('projectId');
  const body = await c.req.json<{
    name?: string;
    color?: string;
    icon?: CategoryIconName;
    shape?: CategoryShape;
  }>();

  const name = (body.name ?? '').trim();
  if (!name) {
    return c.json({ error: 'Le nom de la catégorie est requis.' }, 400);
  }

  const db = await getDb();
  const id = generateId();

  const created = await db.create(toRecordId('category', id)).content({
    projectId,
    name,
    color: (body.color ?? '#38bdf8').trim(),
    icon: body.icon ?? 'tag',
    shape: body.shape ?? 'rounded',
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
  const body = await c.req.json<{
    name?: string;
    color?: string;
    icon?: CategoryIconName;
    shape?: CategoryShape;
  }>();

  const db = await getDb();
  const sets: string[] = [];
  const params: Record<string, unknown> = {
    cid: toRecordId('category', id),
  };

  if (typeof body.name === 'string' && body.name.trim()) {
    sets.push('name = $name');
    params.name = body.name.trim();
  }
  if (typeof body.color === 'string' && body.color.trim()) {
    sets.push('color = $color');
    params.color = body.color.trim();
  }
  if (typeof body.icon === 'string') {
    sets.push('icon = $icon');
    params.icon = body.icon;
  }
  if (typeof body.shape === 'string') {
    sets.push('shape = $shape');
    params.shape = body.shape;
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
      UPDATE entity SET categoryId = NONE WHERE categoryId = $catIdStr;
      DELETE $cid;
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
