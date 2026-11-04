import { Hono } from 'hono';
import { getDb, generateId, toRecordId } from '../db.ts';
import { mapEdge, touchProject } from '../mappers.ts';
import { nodesInProject, projectExists } from '../guards.ts';
import type { EdgeStyle } from '../../shared/types.ts';
import { normalizeHandle, optString, readBody } from '../validation.ts';

export const edgesRouter = new Hono();

// Create a native SurrealDB RELATE edge between two nodes
edgesRouter.post('/projects/:projectId/edges', async (c) => {
  const projectId = c.req.param('projectId');
  const body = await readBody<{
    sourceNodeId?: string;
    targetNodeId?: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
    label?: string;
    style?: EdgeStyle;
    directed?: boolean;
    notes?: string;
  }>(c);

  if (!body.sourceNodeId || !body.targetNodeId) {
    return c.json({ error: 'sourceNodeId et targetNodeId sont requis.' }, 400);
  }

  if (body.sourceNodeId === body.targetNodeId) {
    return c.json({ error: 'Un nœud ne peut pas être relié à lui-même.' }, 400);
  }

  const sourceNodeId = String(body.sourceNodeId);
  const targetNodeId = String(body.targetNodeId);

  const db = await getDb();
  if (!(await projectExists(db, projectId))) {
    return c.json({ error: 'Projet introuvable.' }, 404);
  }
  const owned = await nodesInProject(db, projectId, [sourceNodeId, targetNodeId]);
  if (!owned.has(sourceNodeId) || !owned.has(targetNodeId)) {
    return c.json({ error: 'Les deux nœuds doivent exister dans ce projet.' }, 400);
  }

  const id = generateId();
  const now = new Date().toISOString();
  const style: EdgeStyle = body.style === 'dashed' ? 'dashed' : 'solid';
  const directed = body.directed !== false;

  const [created] = await db
    .query<[Record<string, unknown> | undefined]>(
      `RELATE ONLY $from -> $relId -> $to CONTENT {
        projectId: $projectId,
        label: $label,
        style: $style,
        directed: $directed,
        notes: $notes,
        sourceHandle: $sourceHandle,
        targetHandle: $targetHandle,
        createdAt: $now,
        updatedAt: $now
      };`,
      {
        from: toRecordId('entity', sourceNodeId),
        relId: toRecordId('relation', id),
        to: toRecordId('entity', targetNodeId),
        projectId,
        label: (optString(body.label) ?? '').trim(),
        style,
        directed,
        notes: optString(body.notes) ?? '',
        sourceHandle: normalizeHandle(body.sourceHandle),
        targetHandle: normalizeHandle(body.targetHandle),
        now,
      }
    )
    .collect();

  if (!created) {
    return c.json({ error: 'Impossible de créer la relation.' }, 500);
  }

  await touchProject(db, projectId);
  return c.json({ edge: mapEdge(created) }, 201);
});

// Update edge properties (or reverse direction)
edgesRouter.patch('/edges/:id', async (c) => {
  const id = c.req.param('id');
  const body = await readBody<{
    label?: string;
    style?: EdgeStyle;
    directed?: boolean;
    notes?: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
    reverse?: boolean;
  }>(c);

  const db = await getDb();
  const now = new Date().toISOString();
  const relRef = toRecordId('relation', id);

  if (body.reverse) {
    const [existing] = await db
      .query<[Record<string, unknown> | undefined]>('SELECT * FROM ONLY $rid;', {
        rid: relRef,
      })
      .collect();

    if (!existing) {
      return c.json({ error: 'Relation introuvable.' }, 404);
    }

    const current = mapEdge(existing);

    // Delete and recreate in one transaction so a failure cannot lose the edge
    const newId = generateId();
    const results = await db
      .query<[undefined, unknown, Record<string, unknown> | undefined, undefined]>(
        `BEGIN TRANSACTION;
        DELETE $rid;
        RELATE ONLY $from -> $relId -> $to CONTENT {
          projectId: $projectId,
          label: $label,
          style: $style,
          directed: $directed,
          notes: $notes,
          sourceHandle: $sourceHandle,
          targetHandle: $targetHandle,
          createdAt: $createdAt,
          updatedAt: $now
        };
        COMMIT TRANSACTION;`,
        {
          rid: relRef,
          from: toRecordId('entity', current.targetNodeId),
          relId: toRecordId('relation', newId),
          to: toRecordId('entity', current.sourceNodeId),
          projectId: current.projectId,
          label: optString(body.label)?.trim() ?? current.label,
          style: body.style ? (body.style === 'dashed' ? 'dashed' : 'solid') : current.style,
          directed: typeof body.directed === 'boolean' ? body.directed : current.directed,
          notes: optString(body.notes) ?? current.notes ?? '',
          sourceHandle: current.targetHandle ?? null,
          targetHandle: current.sourceHandle ?? null,
          createdAt: current.createdAt,
          now,
        }
      )
      .collect();
    const recreated = results[2];

    if (!recreated) {
      return c.json({ error: 'Erreur lors de l’inversion du lien.' }, 500);
    }

    await touchProject(db, current.projectId);
    return c.json({ edge: mapEdge(recreated), replacedId: id });
  }

  const sets: string[] = ['updatedAt = $updatedAt'];
  const params: Record<string, unknown> = {
    rid: relRef,
    updatedAt: now,
  };

  if (typeof body.label === 'string') {
    sets.push('label = $label');
    params.label = body.label.trim();
  }
  if (body.style !== undefined) {
    sets.push('style = $style');
    params.style = body.style === 'dashed' ? 'dashed' : 'solid';
  }
  if (typeof body.directed === 'boolean') {
    sets.push('directed = $directed');
    params.directed = body.directed;
  }
  if (typeof body.notes === 'string') {
    sets.push('notes = $notes');
    params.notes = body.notes;
  }
  if (body.sourceHandle !== undefined) {
    sets.push('sourceHandle = $sourceHandle');
    params.sourceHandle = normalizeHandle(body.sourceHandle);
  }
  if (body.targetHandle !== undefined) {
    sets.push('targetHandle = $targetHandle');
    params.targetHandle = normalizeHandle(body.targetHandle);
  }

  const [updated] = await db
    .query<[Record<string, unknown> | undefined]>(
      `UPDATE ONLY $rid SET ${sets.join(', ')};`,
      params
    )
    .collect();

  if (!updated) {
    return c.json({ error: 'Relation introuvable.' }, 404);
  }

  const edge = mapEdge(updated);
  await touchProject(db, edge.projectId);

  return c.json({ edge });
});

// Delete edge
edgesRouter.delete('/edges/:id', async (c) => {
  const id = c.req.param('id');
  const db = await getDb();
  const relRef = toRecordId('relation', id);

  const [existing] = await db
    .query<[Record<string, unknown> | undefined]>('SELECT * FROM ONLY $rid;', {
      rid: relRef,
    })
    .collect();

  await db.query('DELETE $rid;', { rid: relRef }).collect();

  if (existing?.projectId) {
    await touchProject(db, String(existing.projectId));
  }

  return c.json({ deleted: true });
});
