import type { Surreal } from 'surrealdb';
import { generateId, toRecordId } from './db.ts';
import {
  mapCategory,
  mapEdge,
  mapNode,
  mapProject,
  sanitizeMetadata,
  sortCategoryRecords,
} from './mappers.ts';
import { insertProjectGraph } from './bulk.ts';
import {
  DEFAULT_CATEGORY_COLOR,
  DEFAULT_CATEGORY_ICON,
  DEFAULT_CATEGORY_SHAPE,
  type Project,
  type ProjectExportBundle,
  normalizeCategoryKeys,
  normalizeReliability,
} from '../shared/types.ts';
import {
  isCategoryIcon,
  isCategoryShape,
  isPlainObject,
  normalizeColor,
  normalizeHandle,
  optString,
} from './validation.ts';

// A whole project as a JSON bundle (export, snapshots), or null when it does not exist
export async function buildExportBundle(
  db: Surreal,
  projectId: string
): Promise<ProjectExportBundle | null> {
  const [rawProject, rawCategories, rawNodes, rawEdges] = await db
    .query<
      [
        Record<string, unknown> | undefined,
        Record<string, unknown>[],
        Record<string, unknown>[],
        Record<string, unknown>[],
      ]
    >(
      `
      SELECT * FROM ONLY $pid;
      SELECT * FROM category WHERE projectId = $projectId;
      SELECT * FROM entity WHERE projectId = $projectId;
      SELECT * FROM relation WHERE projectId = $projectId;
    `,
      {
        pid: toRecordId('project', projectId),
        projectId,
      }
    )
    .collect();

  if (!rawProject) return null;

  return {
    format: 'graphax-project',
    version: 1,
    exportedAt: new Date().toISOString(),
    project: mapProject(rawProject),
    categories: sortCategoryRecords(rawCategories ?? []).map(mapCategory),
    nodes: (rawNodes ?? []).map(mapNode),
    edges: (rawEdges ?? []).map(mapEdge),
  };
}

// Creates a new project from a bundle (import, snapshot restore). Returns null when the
// bundle does not have the expected shape. `name` replaces the bundle's project name.
export async function importProjectBundle(
  db: Surreal,
  bundle: Record<string, unknown>,
  name?: string
): Promise<Project | null> {
  if (!isPlainObject(bundle.project) || !Array.isArray(bundle.nodes) || !Array.isArray(bundle.edges)) {
    return null;
  }
  const newProjectId = generateId();
  const now = new Date().toISOString();
  const source = bundle.project;

  // Every record gets a fresh id so an import never collides with existing data.
  // Entries that are not objects are skipped and invalid values fall back to defaults.
  const project = {
    id: newProjectId,
    name: name ?? ((optString(source.name) ?? '').trim() || 'Projet importé'),
    description: (optString(source.description) ?? '').trim(),
    createdAt: optString(source.createdAt) || now,
    updatedAt: now,
  };

  const categoryIdMap = new Map<string, string>();
  const rawCategories = Array.isArray(bundle.categories) ? bundle.categories : [];
  const categories = rawCategories.filter(isPlainObject).map((cat) => {
    const id = generateId();
    categoryIdMap.set(String(cat.id), id);
    return {
      id,
      name: (optString(cat.name) ?? '').trim() || 'Catégorie',
      color: normalizeColor(cat.color) ?? DEFAULT_CATEGORY_COLOR,
      icon: isCategoryIcon(cat.icon) ? cat.icon : DEFAULT_CATEGORY_ICON,
      shape: isCategoryShape(cat.shape) ? cat.shape : DEFAULT_CATEGORY_SHAPE,
      ...normalizeCategoryKeys(cat.metadataKeys, cat.cardKeys),
    };
  });

  const nodeIdMap = new Map<string, string>();
  const nodes = bundle.nodes.filter(isPlainObject).map((node) => {
    const id = generateId();
    nodeIdMap.set(String(node.id), id);
    return {
      id,
      categoryId: node.categoryId ? (categoryIdMap.get(String(node.categoryId)) ?? null) : null,
      title: optString(node.title) || 'Indice',
      content: optString(node.content) ?? '',
      positionX: Number.isFinite(Number(node.positionX)) ? Number(node.positionX) : 0,
      positionY: Number.isFinite(Number(node.positionY)) ? Number(node.positionY) : 0,
      metadata: sanitizeMetadata(node.metadata),
      reliability: normalizeReliability(node.reliability),
      createdAt: optString(node.createdAt) || now,
      updatedAt: now,
    };
  });

  // Links whose ends are not in the bundle are skipped
  const edges = bundle.edges.filter(isPlainObject).flatMap((edge) => {
    const sourceNodeId = nodeIdMap.get(String(edge.sourceNodeId));
    const targetNodeId = nodeIdMap.get(String(edge.targetNodeId));
    if (!sourceNodeId || !targetNodeId) return [];
    return [
      {
        id: generateId(),
        sourceNodeId,
        targetNodeId,
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

  // One transaction: a failed import leaves no partial project behind
  await insertProjectGraph(db, { project, categories, nodes, edges });

  return {
    ...project,
    categoryCount: categories.length,
    nodeCount: nodes.length,
    edgeCount: edges.length,
  };
}
