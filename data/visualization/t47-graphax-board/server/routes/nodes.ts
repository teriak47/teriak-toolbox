import { Hono } from 'hono';
import { getDb, generateId, toRecordId } from '../db.ts';
import { mapNode, sanitizeMetadata, touchProject } from '../mappers.ts';
import { categoryInProject, nodesInProject, projectExists } from '../guards.ts';
import { optString, readBody } from '../validation.ts';
import { MAX_RESTORE_RECORDS, normalizeReliability } from '../../shared/types.ts';

const UNKNOWN_CATEGORY = "Cette catégorie n'existe pas dans ce projet.";
const INVALID_RELIABILITY =
  'Fiabilité invalide : une lettre A à F suivie d’un chiffre 1 à 6 est attendue (ex. B2).';

// A reliability sent by the client: undefined when absent, null to clear it, false when invalid
function readReliability(value: unknown): string | null | undefined | false {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return normalizeReliability(value) ?? false;
}

export const nodesRouter = new Hono();

// Create a node on the canvas
nodesRouter.post('/projects/:projectId/nodes', async (c) => {
  const projectId = c.req.param('projectId');
  const body = await readBody<{
    title?: string;
    categoryId?: string | null;
    content?: string;
    positionX?: number;
    positionY?: number;
    metadata?: Record<string, unknown>;
    reliability?: string | null;
  }>(c);
  const reliability = readReliability(body.reliability);
  if (reliability === false) return c.json({ error: INVALID_RELIABILITY }, 400);

  const db = await getDb();
  if (!(await projectExists(db, projectId))) {
    return c.json({ error: 'Projet introuvable.' }, 404);
  }
  const categoryId = body.categoryId ? String(body.categoryId) : null;
  if (categoryId && !(await categoryInProject(db, projectId, categoryId))) {
    return c.json({ error: UNKNOWN_CATEGORY }, 400);
  }

  const id = generateId();
  const now = new Date().toISOString();

  const positionX = Number.isFinite(Number(body.positionX)) ? Number(body.positionX) : 0;
  const positionY = Number.isFinite(Number(body.positionY)) ? Number(body.positionY) : 0;
  const title = (optString(body.title) ?? '').trim() || 'Nouvel indice';

  const created = await db.create(toRecordId('entity', id)).content({
    projectId,
    categoryId,
    title,
    content: optString(body.content) ?? '',
    positionX,
    positionY,
    metadata: sanitizeMetadata(body.metadata),
    reliability: reliability ?? null,
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
  const body = await readBody<{
    title?: string;
    categoryId?: string | null;
    content?: string;
    positionX?: number;
    positionY?: number;
    metadata?: Record<string, unknown>;
    reliability?: string | null;
  }>(c);
  const reliability = readReliability(body.reliability);
  if (reliability === false) return c.json({ error: INVALID_RELIABILITY }, 400);

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
    const categoryId = body.categoryId ? String(body.categoryId) : null;
    if (categoryId) {
      const [projectId] = await db
        .query<[unknown]>('SELECT VALUE projectId FROM ONLY $nid;', { nid: params.nid })
        .collect();
      if (projectId === undefined || projectId === null) {
        return c.json({ error: 'Nœud introuvable.' }, 404);
      }
      if (!(await categoryInProject(db, String(projectId), categoryId))) {
        return c.json({ error: UNKNOWN_CATEGORY }, 400);
      }
    }
    sets.push('categoryId = $categoryId');
    params.categoryId = categoryId;
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
  if (reliability !== undefined) {
    sets.push('reliability = $reliability');
    params.reliability = reliability;
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
  const body = await readBody<{ positionX: number; positionY: number }>(c);

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
  const body = await readBody<{
    positions: Array<{ id: string; positionX: number; positionY: number }>;
  }>(c);

  if (!Array.isArray(body.positions)) {
    return c.json({ error: 'Liste de positions attendue.' }, 400);
  }

  const valid = body.positions.flatMap((item) => {
    const posX = Number(item?.positionX);
    const posY = Number(item?.positionY);
    if (!item?.id || !Number.isFinite(posX) || !Number.isFinite(posY)) return [];
    return [{ id: String(item.id), x: posX, y: posY }];
  });

  const db = await getDb();
  if (!(await projectExists(db, projectId))) {
    return c.json({ error: 'Projet introuvable.' }, 404);
  }

  // Only nodes of this project are moved; unknown ids and other projects' nodes are ignored
  const owned = await nodesInProject(db, projectId, valid.map((p) => p.id));
  const updates = valid
    .filter((p) => owned.has(p.id))
    .map((p) => ({ nid: toRecordId('entity', p.id), x: p.x, y: p.y }));

  if (updates.length > 0) {
    await db
      .query(
        `BEGIN TRANSACTION;
        FOR $p IN $updates {
          UPDATE $p.nid SET positionX = $p.x, positionY = $p.y, updatedAt = $now;
        };
        COMMIT TRANSACTION;`,
        { updates, now: new Date().toISOString() }
      )
      .collect();
    await touchProject(db, projectId);
  }

  return c.json({ updated: updates.length });
});

// Delete several nodes of a project and all their links, in one transaction (multiple
// selection). Ids of other projects or of missing nodes are ignored.
const MAX_BATCH_DELETE = MAX_RESTORE_RECORDS;

nodesRouter.post('/projects/:projectId/nodes/delete', async (c) => {
  const projectId = c.req.param('projectId');
  const body = await readBody<{ ids?: unknown }>(c);
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return c.json({ error: 'Une liste de nœuds (ids) est attendue.' }, 400);
  }
  if (body.ids.length > MAX_BATCH_DELETE) {
    return c.json({ error: 'Trop de nœuds à supprimer en une fois.' }, 400);
  }
  const ids = [...new Set(body.ids.filter((id): id is string => typeof id === 'string' && id !== ''))];

  const db = await getDb();
  if (!(await projectExists(db, projectId))) {
    return c.json({ error: 'Projet introuvable.' }, 404);
  }
  const owned = [...(await nodesInProject(db, projectId, ids))];
  if (owned.length > 0) {
    // Nodes plus their links must fit in one restore, so that the deletion can be undone
    const [links] = await db
      .query<[number]>('RETURN count(SELECT id FROM relation WHERE in IN $nids OR out IN $nids);', {
        nids: owned.map((id) => toRecordId('entity', id)),
      })
      .collect();
    if (owned.length + Number(links ?? 0) > MAX_RESTORE_RECORDS) {
      return c.json(
        { error: `Trop d’éléments à supprimer en une fois (plus de ${MAX_RESTORE_RECORDS} nœuds et liens).` },
        400
      );
    }
    await db
      .query(
        `
        BEGIN TRANSACTION;
        DELETE relation WHERE in IN $nids OR out IN $nids;
        DELETE entity WHERE id IN $nids;
        COMMIT TRANSACTION;
      `,
        { nids: owned.map((id) => toRecordId('entity', id)) }
      )
      .collect();
    await touchProject(db, projectId);
  }

  return c.json({ deleted: owned.length });
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
      BEGIN TRANSACTION;
      DELETE relation WHERE in = $nid OR out = $nid;
      DELETE $nid;
      COMMIT TRANSACTION;
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
