// Graph views (V4): pure functions behind the neighbourhood focus, the shortest path, the
// timeline and the grouped layout. No React here, so they can be unit tested.

import type { GraphEdge, GraphNode } from '../../shared/types.ts';
import { detectValueType } from './metadata.ts';

type Link = Pick<GraphEdge, 'sourceNodeId' | 'targetNodeId'>;

function adjacency(links: Link[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  const add = (a: string, b: string) => {
    const list = adj.get(a);
    if (list) list.push(b);
    else adj.set(a, [b]);
  };
  for (const l of links) {
    if (l.sourceNodeId === l.targetNodeId) continue;
    add(l.sourceNodeId, l.targetNodeId);
    add(l.targetNodeId, l.sourceNodeId);
  }
  return adj;
}

// Nodes at most `depth` links away from the start (directions ignored), the start included
export function neighbourhood(startId: string, links: Link[], depth: number): Set<string> {
  const adj = adjacency(links);
  const seen = new Set([startId]);
  let frontier = [startId];
  for (let level = 0; level < depth && frontier.length > 0; level++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const other of adj.get(id) ?? []) {
        if (!seen.has(other)) {
          seen.add(other);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

// One of the shortest chains of links from `fromId` to `toId` (directions ignored), as the
// list of node ids from one end to the other; null when they are not connected
export function shortestPath(fromId: string, toId: string, links: Link[]): string[] | null {
  if (fromId === toId) return [fromId];
  const adj = adjacency(links);
  const previous = new Map<string, string>([[fromId, fromId]]);
  let frontier = [fromId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const other of adj.get(id) ?? []) {
        if (previous.has(other)) continue;
        previous.set(other, id);
        if (other === toId) {
          const path = [toId];
          let cur = toId;
          while (cur !== fromId) {
            cur = previous.get(cur)!;
            path.unshift(cur);
          }
          return path;
        }
        next.push(other);
      }
    }
    frontier = next;
  }
  return null;
}

// Links of a node list given as a path: the ones joining consecutive nodes
export function pathEdgeIds(path: string[], edges: GraphEdge[]): Set<string> {
  const pairs = new Set<string>();
  for (let i = 1; i < path.length; i++) {
    pairs.add(`${path[i - 1]}|${path[i]}`);
    pairs.add(`${path[i]}|${path[i - 1]}`);
  }
  return new Set(edges.filter((e) => pairs.has(`${e.sourceNodeId}|${e.targetNodeId}`)).map((e) => e.id));
}

export interface TimelineEntry {
  node: GraphNode;
  /** The attribute the date comes from */
  key: string;
  /** As written in the node */
  value: string;
  /** Sortable form, YYYY-MM-DD (time kept when written) */
  sortKey: string;
}

// Turns a date written as YYYY-MM-DD[ HH:MM] or DD/MM/YYYY into a sortable string
function sortableDate(value: string): string | null {
  const v = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(v);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}${iso[4] ? ` ${iso[4]}:${iso[5]}` : ''}`;
  const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`;
  return null;
}

// Every dated attribute of the nodes, oldest first (a node with several dates appears once
// per date, so an event with a start and an end shows both)
export function buildTimeline(nodes: GraphNode[]): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const node of nodes) {
    for (const [key, value] of Object.entries(node.metadata ?? {})) {
      if (detectValueType(value) !== 'date') continue;
      const sortKey = sortableDate(value);
      if (sortKey) out.push({ node, key, value: value.trim(), sortKey });
    }
  }
  return out.sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.node.title.localeCompare(b.node.title, 'fr'));
}

// Grouped layout: one column of nodes per category (in the category order, unclassified
// last), nodes sorted by title, so a graph can be read category by category
export function groupedLayout(
  nodes: GraphNode[],
  categoryOrder: string[],
  options: { columnGap?: number; rowGap?: number } = {}
): Array<{ id: string; positionX: number; positionY: number }> {
  const columnGap = options.columnGap ?? 280;
  const rowGap = options.rowGap ?? 150;
  const columns = [...categoryOrder, '__none__'];
  const known = new Set(categoryOrder);
  const out: Array<{ id: string; positionX: number; positionY: number }> = [];
  let col = 0;
  for (const catId of columns) {
    const group = nodes
      .filter((n) => (catId === '__none__' ? !n.categoryId || !known.has(n.categoryId) : n.categoryId === catId))
      .sort((a, b) => a.title.localeCompare(b.title, 'fr'));
    if (group.length === 0) continue;
    group.forEach((n, row) => out.push({ id: n.id, positionX: col * columnGap, positionY: row * rowGap }));
    col += 1;
  }
  return out;
}
