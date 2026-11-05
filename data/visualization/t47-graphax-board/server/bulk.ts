import type { Surreal } from 'surrealdb';
import { toRecordId } from './db.ts';
import type { SavedView } from '../shared/types.ts';

export interface ProjectRecord {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  linkTypes?: Record<string, string>;
  savedViews?: SavedView[];
}

export interface CategoryRecord {
  id: string;
  name: string;
  color: string;
  icon: string;
  shape: string;
  metadataKeys?: string[];
  cardKeys?: string[];
  position?: number;
}

export interface NodeRecord {
  id: string;
  categoryId: string | null;
  title: string;
  content: string;
  positionX: number;
  positionY: number;
  metadata: Record<string, string>;
  reliability?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EdgeRecord {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  label: string;
  style: string;
  directed: boolean;
  color?: string | null;
  notes: string;
  sourceHandle: string | null;
  targetHandle: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectGraphRecords {
  project: ProjectRecord;
  categories: CategoryRecord[];
  nodes: NodeRecord[];
  edges: EdgeRecord[];
}

// Writes a whole project (project, categories, nodes and links) in one transaction:
// either everything is stored or, if any statement fails, nothing is.
export async function insertProjectGraph(db: Surreal, graph: ProjectGraphRecords): Promise<void> {
  const projectId = graph.project.id;
  const statements = ['BEGIN TRANSACTION;', 'CREATE $pid CONTENT $project;'];
  const params: Record<string, unknown> = {
    pid: toRecordId('project', projectId),
    project: {
      name: graph.project.name,
      description: graph.project.description,
      createdAt: graph.project.createdAt,
      updatedAt: graph.project.updatedAt,
      linkTypes: graph.project.linkTypes ?? {},
      savedViews: graph.project.savedViews ?? [],
    },
  };

  if (graph.categories.length > 0) {
    statements.push('INSERT INTO category $categories;');
    // Categories keep the order they are given in (presets, demo, import)
    params.categories = graph.categories.map(({ id, ...cat }, index) => ({
      ...cat,
      position: cat.position ?? index,
      id: toRecordId('category', id),
      projectId,
    }));
  }

  if (graph.nodes.length > 0) {
    statements.push('INSERT INTO entity $nodes;');
    params.nodes = graph.nodes.map(({ id, ...node }) => ({
      ...node,
      id: toRecordId('entity', id),
      projectId,
    }));
  }

  if (graph.edges.length > 0) {
    statements.push('INSERT RELATION INTO relation $edges;');
    params.edges = graph.edges.map(({ id, sourceNodeId, targetNodeId, ...edge }) => ({
      ...edge,
      id: toRecordId('relation', id),
      in: toRecordId('entity', sourceNodeId),
      out: toRecordId('entity', targetNodeId),
      projectId,
    }));
  }

  statements.push('COMMIT TRANSACTION;');
  await db.query(statements.join('\n'), params).collect();
}
