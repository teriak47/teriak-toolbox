import { Hono } from 'hono';
import { extractId, getDb, toRecordId } from '../db.ts';
import {
  mapCategory,
  mapEdge,
  mapNode,
  sanitizeMetadata,
  sortCategoryRecords,
  touchProject,
} from '../mappers.ts';
import { projectExists } from '../guards.ts';
import {
  DEFAULT_CATEGORY_COLOR,
  DEFAULT_CATEGORY_ICON,
  DEFAULT_CATEGORY_SHAPE,
  MAX_RESTORE_RECORDS,
  normalizeCategoryKeys,
} from '../../shared/types.ts';
import {
  isCategoryIcon,
  isCategoryShape,
  isPlainObject,
  normalizeColor,
  normalizeHandle,
  optString,
  readBody,
} from '../validation.ts';

// Restores records removed by the user, with their former ids, so that undo can bring back
// a deleted node (with its links), link or category, and redo a creation. Everything is
// written in one transaction. Restoring the same records twice gives the same result, so a
// retried request is harmless.

export const restoreRouter = new Hono();

const RECORD_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_RESTORED = MAX_RESTORE_RECORDS;

const validId = (value: unknown): value is string => typeof value === 'string' && RECORD_ID.test(value);

const objects = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isPlainObject) : [];

// Projects that already hold some of these records, so a restore never takes over
// another project's data
async function ownersOf(
  db: Awaited<ReturnType<typeof getDb>>,
  table: string,
  ids: string[]
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const [rows] = await db
    .query<[Array<{ id: unknown; projectId: unknown }>]>(
      `SELECT id, projectId FROM ${table} WHERE id IN $ids;`,
      { ids: ids.map((id) => toRecordId(table, id)) }
    )
    .collect();
  return new Map((rows ?? []).map((r) => [extractId(r.id), String(r.projectId ?? '')]));
}

restoreRouter.post('/projects/:projectId/restore', async (c) => {
  const projectId = c.req.param('projectId');
  const body = await readBody(c);
  const rawCategories = objects(body.categories);
  const rawNodes = objects(body.nodes);
  const rawEdges = objects(body.edges);
  const rawAssignments = objects(body.assignments);

  const all = [...rawCategories, ...rawNodes, ...rawEdges];
  if (all.length + rawAssignments.length === 0) {
    return c.json({ error: 'Rien à restaurer.' }, 400);
  }
  if (all.length > MAX_RESTORED) {
    return c.json({ error: 'Trop d’éléments à restaurer en une fois.' }, 400);
  }
  if (!all.every((r) => validId(r.id))) {
    return c.json({ error: 'Identifiant d’élément invalide.' }, 400);
  }

  const db = await getDb();
  if (!(await projectExists(db, projectId))) {
    return c.json({ error: 'Projet introuvable.' }, 404);
  }

  const categoryIds = rawCategories.map((r) => String(r.id));
  const nodeIds = rawNodes.map((r) => String(r.id));
  const edgeIds = rawEdges.map((r) => String(r.id));
  const owners = [
    ...(await ownersOf(db, 'category', categoryIds)).values(),
    ...(await ownersOf(db, 'entity', nodeIds)).values(),
    ...(await ownersOf(db, 'relation', edgeIds)).values(),
  ];
  if (owners.some((owner) => owner !== projectId)) {
    return c.json({ error: 'Ces éléments appartiennent à un autre projet.' }, 400);
  }

  // What the project holds besides the restored records: categories (in order) and nodes
  const [existingCategories, existingNodeIds] = await db
    .query<[Record<string, unknown>[], unknown[]]>(
      `SELECT * FROM category WHERE projectId = $projectId;
       SELECT VALUE id FROM entity WHERE projectId = $projectId;`,
      { projectId }
    )
    .collect();
  const restoredCategoryIds = new Set(categoryIds);
  const keptCategories = sortCategoryRecords(existingCategories ?? []).filter(
    (r) => !restoredCategoryIds.has(extractId(r.id))
  );
  const knownCategories = new Set([...keptCategories.map((r) => extractId(r.id)), ...categoryIds]);
  const knownNodes = new Set([...(existingNodeIds ?? []).map(extractId), ...nodeIds]);

  const now = new Date().toISOString();
  const categories = rawCategories.map((cat) => ({
    id: String(cat.id),
    index: Number.isInteger(cat.index) ? Number(cat.index) : Infinity,
    record: {
      projectId,
      name: (optString(cat.name) ?? '').trim() || 'Catégorie',
      color: normalizeColor(cat.color) ?? DEFAULT_CATEGORY_COLOR,
      icon: isCategoryIcon(cat.icon) ? cat.icon : DEFAULT_CATEGORY_ICON,
      shape: isCategoryShape(cat.shape) ? cat.shape : DEFAULT_CATEGORY_SHAPE,
      ...normalizeCategoryKeys(cat.metadataKeys, cat.cardKeys),
    },
  }));

  const nodes = rawNodes.map((node) => {
    const categoryId = optString(node.categoryId) ?? null;
    return {
      id: toRecordId('entity', String(node.id)),
      projectId,
      // A category deleted since is not brought back with the node
      categoryId: categoryId && knownCategories.has(categoryId) ? categoryId : null,
      title: optString(node.title) || 'Indice',
      content: optString(node.content) ?? '',
      positionX: Number.isFinite(Number(node.positionX)) ? Number(node.positionX) : 0,
      positionY: Number.isFinite(Number(node.positionY)) ? Number(node.positionY) : 0,
      metadata: sanitizeMetadata(node.metadata),
      createdAt: optString(node.createdAt) || now,
      updatedAt: now,
    };
  });

  // A link comes back only when both of its nodes exist (or come back with it)
  const edges = rawEdges.flatMap((edge) => {
    const sourceNodeId = optString(edge.sourceNodeId);
    const targetNodeId = optString(edge.targetNodeId);
    if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) return [];
    if (!knownNodes.has(sourceNodeId) || !knownNodes.has(targetNodeId)) return [];
    return [
      {
        id: toRecordId('relation', String(edge.id)),
        in: toRecordId('entity', sourceNodeId),
        out: toRecordId('entity', targetNodeId),
        projectId,
        label: optString(edge.label) ?? '',
        style: edge.style === 'dashed' ? 'dashed' : 'solid',
        directed: edge.directed !== false,
        color: normalizeColor(edge.color),
        notes: optString(edge.notes) ?? '',
        sourceHandle: normalizeHandle(edge.sourceHandle),
        targetHandle: normalizeHandle(edge.targetHandle),
        createdAt: optString(edge.createdAt) || now,
        updatedAt: now,
      },
    ];
  });

  // Nodes that lost a category when it was deleted get it back, unless they got another since
  const assignments = rawAssignments.flatMap((a) => {
    const categoryId = optString(a.categoryId);
    if (!categoryId || !knownCategories.has(categoryId) || !Array.isArray(a.nodeIds)) return [];
    const ids = a.nodeIds.filter(validId).filter((id) => knownNodes.has(id));
    return ids.length > 0 ? [{ categoryId, nodeIds: ids.map((id) => toRecordId('entity', id)) }] : [];
  });

  // Restored categories go back to their former place in the list; positions are rewritten
  // for the whole project so that the order shown is the order stored
  const order = keptCategories.map((r) => extractId(r.id));
  for (const cat of [...categories].sort((a, b) => a.index - b.index)) {
    order.splice(Math.min(cat.index, order.length), 0, cat.id);
  }
  const positions = order.map((id, position) => ({ id: toRecordId('category', id), position }));

  const statements = ['BEGIN TRANSACTION;'];
  const params: Record<string, unknown> = { projectId };
  if (categories.length > 0) {
    statements.push('DELETE category WHERE id IN $categoryIds;', 'INSERT INTO category $categories;');
    params.categoryIds = categories.map((cat) => toRecordId('category', cat.id));
    params.categories = categories.map((cat) => ({ ...cat.record, id: toRecordId('category', cat.id) }));
  }
  if (nodes.length > 0) {
    statements.push('DELETE entity WHERE id IN $nodeIds;', 'INSERT INTO entity $nodes;');
    params.nodeIds = nodes.map((n) => n.id);
    params.nodes = nodes;
  }
  if (edges.length > 0) {
    statements.push('DELETE relation WHERE id IN $edgeIds;', 'INSERT RELATION INTO relation $edges;');
    params.edgeIds = edges.map((e) => e.id);
    params.edges = edges;
  }
  if (assignments.length > 0) {
    statements.push(
      `FOR $a IN $assignments {
        UPDATE entity SET categoryId = $a.categoryId, updatedAt = $now
          WHERE id IN $a.nodeIds AND projectId = $projectId AND (categoryId = NONE OR categoryId = NULL);
      };`
    );
    params.assignments = assignments;
    params.now = now;
  }
  if (categories.length > 0) {
    statements.push('FOR $p IN $positions { UPDATE $p.id SET position = $p.position; };');
    params.positions = positions;
  }
  statements.push('COMMIT TRANSACTION;');
  await db.query(statements.join('\n'), params).collect();
  await touchProject(db, projectId);

  // The stored result: the project's categories in order, the restored nodes (and those
  // given their category back) and the restored links
  const changedNodeIds = [
    ...nodes.map((n) => n.id),
    ...assignments.flatMap((a) => a.nodeIds),
  ];
  const [catRows, nodeRows, edgeRows] = await db
    .query<[Record<string, unknown>[], Record<string, unknown>[], Record<string, unknown>[]]>(
      `SELECT * FROM category WHERE projectId = $projectId;
       SELECT * FROM entity WHERE id IN $nodeIds;
       SELECT * FROM relation WHERE id IN $edgeIds;`,
      { projectId, nodeIds: changedNodeIds, edgeIds: edges.map((e) => e.id) }
    )
    .collect();

  return c.json({
    categories: sortCategoryRecords(catRows ?? []).map(mapCategory),
    nodes: (nodeRows ?? []).map(mapNode),
    edges: (edgeRows ?? []).map(mapEdge),
  });
});
