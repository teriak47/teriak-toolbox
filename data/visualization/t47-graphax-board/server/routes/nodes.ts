import { Hono } from 'hono';
import { getDb, generateId, toRecordId } from '../db.ts';
import { mapNode, sanitizeMetadata, touchProject } from '../mappers.ts';

export const nodesRouter = new Hono();

// Create a node on the canvas
nodesRouter.post('/projects/:projectId/nodes', async (c) => {
  const projectId = c.req.param('projectId');
  const body = await c.req.json<{
    title?: string;
    categoryId?: string | null;
    content?: string;
    positionX?: number;
    positionY?: number;
    metadata?: Record<string, unknown>;
  }>();

  const db = await getDb();
  const id = generateId();
  const now = new Date().toISOString();

  const positionX = Number.isFinite(Number(body.positionX)) ? Number(body.positionX) : 0;
  const positionY = Number.isFinite(Number(body.positionY)) ? Number(body.positionY) : 0;
  const title = (body.title ?? '').trim() || 'Nouvel indice';

  const created = await db.create(toRecordId('entity', id)).content({
    projectId,
    categoryId: body.categoryId || null,
    title,
    content: body.content ?? '',
    positionX,
    positionY,
    metadata: sanitizeMetadata(body.metadata),
    createdAt: now,
    updatedAt: now,
  });

  await touchProject(db, projectId);

  return c.json(
    {
      node: mapNode({ ...(created as Record<string, unknown>), id }),
    },
    201
  );
});

// Update node content, title, category, metadata, or position
nodesRouter.patch('/nodes/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{
    title?: string;
    categoryId?: string | null;
    content?: string;
    positionX?: number;
    positionY?: number;
    metadata?: Record<string, unknown>;
  }>();

  const db = await getDb();
  const now = new Date().toISOString();

  const sets: string[] = ['updatedAt = $updatedAt'];
  const params: Record<string, unknown> = {
    nid: toRecordId('entity', id),
    updatedAt: now,
  };

  if (typeof body.title === 'string') {
    sets.push('title = $title');
    params.title = body.title.trim() || 'Sans titre';
  }
  if (body.categoryId !== undefined) {
    sets.push('categoryId = $categoryId');
    params.categoryId = body.categoryId || null;
  }
  if (typeof body.content === 'string') {
    sets.push('content = $content');
    params.content = body.content;
  }
  if (body.positionX !== undefined && Number.isFinite(Number(body.positionX))) {
    sets.push('positionX = $positionX');
    params.positionX = Number(body.positionX);
  }
  if (body.positionY !== undefined && Number.isFinite(Number(body.positionY))) {
    sets.push('positionY = $positionY');
    params.positionY = Number(body.positionY);
  }
  if (body.metadata !== undefined) {
    sets.push('metadata = $metadata');
    params.metadata = sanitizeMetadata(body.metadata);
  }

  const [updated] = await db
    .query<[Record<string, unknown> | undefined]>(
      `UPDATE ONLY $nid SET ${sets.join(', ')};`,
      params
    )
    .collect();

  if (!updated) {
    return c.json({ error: 'Nœud introuvable.' }, 404);
  }

  const node = mapNode(updated);
  await touchProject(db, node.projectId);

  return c.json({ node });
});

// Fast single-node position update (on drag stop)
nodesRouter.patch('/nodes/:id/position', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ positionX: number; positionY: number }>();

  const posX = Number(body.positionX);
  const posY = Number(body.positionY);
  if (!Number.isFinite(posX) || !Number.isFinite(posY)) {
    return c.json({ error: 'Coordonnées invalides.' }, 400);
  }

  const db = await getDb();
  const [updated] = await db
    .query<[Record<string, unknown> | undefined]>(
      'UPDATE ONLY $nid SET positionX = $posX, positionY = $posY, updatedAt = $now;',
      {
        nid: toRecordId('entity', id),
        posX,
        posY,
        now: new Date().toISOString(),
      }
    )
    .collect();

  if (!updated) {
    return c.json({ error: 'Nœud introuvable.' }, 404);
  }

  const node = mapNode(updated);
  await touchProject(db, node.projectId);

  return c.json({ node });
});

// Batch node positions update (multi-node drag or optional auto-align)
nodesRouter.patch('/projects/:projectId/positions', async (c) => {
  const projectId = c.req.param('projectId');
  const body = await c.req.json<{
    positions: Array<{ id: string; positionX: number; positionY: number }>;
  }>();

  if (!Array.isArray(body.positions)) {
    return c.json({ error: 'Liste de positions attendue.' }, 400);
  }

  const db = await getDb();
  const now = new Date().toISOString();

  for (const item of body.positions) {
    const posX = Number(item.positionX);
    const posY = Number(item.positionY);
    if (!item.id || !Number.isFinite(posX) || !Number.isFinite(posY)) continue;

    await db
      .query(
        'UPDATE ONLY $nid SET positionX = $posX, positionY = $posY, updatedAt = $now;',
        {
          nid: toRecordId('entity', item.id),
          posX,
          posY,
          now,
        }
      )
      .collect();
  }

  await touchProject(db, projectId);
  return c.json({ updated: body.positions.length });
});

// Delete node and all connected graph edges
nodesRouter.delete('/nodes/:id', async (c) => {
  const id = c.req.param('id');
  const db = await getDb();
  const nodeRef = toRecordId('entity', id);

  const [existing] = await db
    .query<[Record<string, unknown> | undefined]>('SELECT * FROM ONLY $nid;', {
      nid: nodeRef,
    })
    .collect();

  await db
    .query(
      `
      DELETE relation WHERE in = $nid OR out = $nid;
      DELETE $nid;
    `,
      {
        nid: nodeRef,
      }
    )
    .collect();

  if (existing?.projectId) {
    await touchProject(db, String(existing.projectId));
  }

  return c.json({ deleted: true });
});
