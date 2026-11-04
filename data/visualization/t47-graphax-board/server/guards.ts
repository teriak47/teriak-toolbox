import type { Surreal } from 'surrealdb';
import { extractId, toRecordId } from './db.ts';

// Reference checks run before a write, so the API never stores a record that points
// to a missing project, node or category, or links data across two projects.

export async function projectExists(db: Surreal, projectId: string): Promise<boolean> {
  if (!projectId) return false;
  const [found] = await db
    .query<[unknown]>('SELECT VALUE id FROM ONLY $pid;', { pid: toRecordId('project', projectId) })
    .collect();
  return Boolean(found);
}

// Returns the ids, among `nodeIds`, of nodes that exist and belong to the project
export async function nodesInProject(
  db: Surreal,
  projectId: string,
  nodeIds: string[]
): Promise<Set<string>> {
  const ids = [...new Set(nodeIds.filter(Boolean))];
  if (!projectId || ids.length === 0) return new Set();
  const [found] = await db
    .query<[unknown[]]>('SELECT VALUE id FROM entity WHERE projectId = $projectId AND id IN $ids;', {
      projectId,
      ids: ids.map((id) => toRecordId('entity', id)),
    })
    .collect();
  return new Set((found ?? []).map(extractId));
}

export async function categoryInProject(
  db: Surreal,
  projectId: string,
  categoryId: string
): Promise<boolean> {
  if (!projectId || !categoryId) return false;
  const [found] = await db
    .query<[unknown]>('SELECT VALUE projectId FROM ONLY $cid;', {
      cid: toRecordId('category', categoryId),
    })
    .collect();
  return found === projectId;
}
