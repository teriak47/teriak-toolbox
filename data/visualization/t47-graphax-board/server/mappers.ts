import type { Surreal } from 'surrealdb';
import {
  DEFAULT_CATEGORY_COLOR,
  DEFAULT_CATEGORY_ICON,
  DEFAULT_CATEGORY_SHAPE,
  type Category,
  type EdgeStyle,
  type GraphEdge,
  type GraphNode,
  type NodeMetadata,
  type Project,
} from '../shared/types.ts';
import { extractId, toRecordId } from './db.ts';
import { isCategoryIcon, isCategoryShape, normalizeColor } from './validation.ts';

export function mapProject(raw: Record<string, unknown>): Project {
  return {
    id: extractId(raw.id),
    name: String(raw.name ?? 'Projet sans titre'),
    description: String(raw.description ?? ''),
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
    updatedAt: String(raw.updatedAt ?? new Date().toISOString()),
  };
}

export function mapCategory(raw: Record<string, unknown>): Category {
  return {
    id: extractId(raw.id),
    projectId: String(raw.projectId ?? ''),
    name: String(raw.name ?? 'Catégorie'),
    // Older records may hold any value: unknown ones fall back to the defaults
    color: normalizeColor(raw.color) ?? DEFAULT_CATEGORY_COLOR,
    icon: isCategoryIcon(raw.icon) ? raw.icon : DEFAULT_CATEGORY_ICON,
    shape: isCategoryShape(raw.shape) ? raw.shape : DEFAULT_CATEGORY_SHAPE,
  };
}

export function sanitizeMetadata(input: unknown): NodeMetadata {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }
  const clean: NodeMetadata = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const key = k.trim();
    if (!key) continue;
    clean[key] = v === null || v === undefined ? '' : String(v);
  }
  return clean;
}

export function mapNode(raw: Record<string, unknown>): GraphNode {
  const posX = Number(raw.positionX);
  const posY = Number(raw.positionY);
  return {
    id: extractId(raw.id),
    projectId: String(raw.projectId ?? ''),
    categoryId: raw.categoryId ? extractId(raw.categoryId) : null,
    title: String(raw.title ?? 'Nouvel indice'),
    content: String(raw.content ?? ''),
    positionX: Number.isFinite(posX) ? posX : 0,
    positionY: Number.isFinite(posY) ? posY : 0,
    metadata: sanitizeMetadata(raw.metadata),
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
    updatedAt: String(raw.updatedAt ?? new Date().toISOString()),
  };
}

export function mapEdge(raw: Record<string, unknown>): GraphEdge {
  const style: EdgeStyle = raw.style === 'dashed' ? 'dashed' : 'solid';
  return {
    id: extractId(raw.id),
    projectId: String(raw.projectId ?? ''),
    sourceNodeId: extractId(raw.in ?? raw.sourceNodeId),
    targetNodeId: extractId(raw.out ?? raw.targetNodeId),
    sourceHandle: raw.sourceHandle ? String(raw.sourceHandle) : null,
    targetHandle: raw.targetHandle ? String(raw.targetHandle) : null,
    label: String(raw.label ?? ''),
    style,
    directed: raw.directed !== false,
    color: normalizeColor(raw.color),
    notes: raw.notes ? String(raw.notes) : '',
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
    updatedAt: String(raw.updatedAt ?? new Date().toISOString()),
  };
}

export async function touchProject(db: Surreal, projectId: string): Promise<void> {
  if (!projectId) return;
  try {
    await db
      .query('UPDATE $pid MERGE { updatedAt: $now };', {
        pid: toRecordId('project', projectId),
        now: new Date().toISOString(),
      })
      .collect();
  } catch {
    // Non-blocking timestamp update
  }
}
