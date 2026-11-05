import type { GraphEdge, GraphNode } from '@shared/types';

export interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinnedId?: boolean;
}

// Above this many nodes the repulsion uses the Barnes-Hut approximation (O1). Measured: it
// only beats the exact sum beyond about a thousand nodes (3,000 nodes: about 28 ms -> 12 ms per frame). Below,
// the exact all-pairs sum is faster, and small graphs behave exactly as before.
export const BARNES_HUT_THRESHOLD = 1000;
// Opening angle: a cell is treated as one mass when its size / distance is below this
const THETA = 0.9;
const MAX_DEPTH = 24;

interface QuadCell {
  x0: number;
  y0: number;
  size: number;
  mass: number;
  cx: number;
  cy: number;
  /** A leaf holds its nodes (several only when they share a point at the maximum depth) */
  nodes: SimNode[] | null;
  children: Array<QuadCell | undefined> | null;
}

function newCell(x0: number, y0: number, size: number): QuadCell {
  return { x0, y0, size, mass: 0, cx: 0, cy: 0, nodes: [], children: null };
}

function insert(cell: QuadCell, node: SimNode, depth: number): void {
  // Running centre of mass
  cell.cx = (cell.cx * cell.mass + node.x) / (cell.mass + 1);
  cell.cy = (cell.cy * cell.mass + node.y) / (cell.mass + 1);
  cell.mass += 1;
  if (cell.nodes) {
    if (cell.nodes.length === 0 || depth >= MAX_DEPTH) {
      cell.nodes.push(node);
      return;
    }
    // Split the leaf and push its node down
    const existing = cell.nodes;
    cell.nodes = null;
    cell.children = [undefined, undefined, undefined, undefined];
    for (const e of existing) insertChild(cell, e, depth);
  }
  insertChild(cell, node, depth);
}

function insertChild(cell: QuadCell, node: SimNode, depth: number): void {
  const half = cell.size / 2;
  const right = node.x >= cell.x0 + half ? 1 : 0;
  const bottom = node.y >= cell.y0 + half ? 1 : 0;
  const i = bottom * 2 + right;
  const children = cell.children!;
  children[i] ??= newCell(cell.x0 + right * half, cell.y0 + bottom * half, half);
  insert(children[i]!, node, depth + 1);
}

// Exact repulsion: every pair of nodes, each pair pushed apart once
export function applyExactRepulsion(
  simNodes: SimNode[],
  strength: number,
  pinned: (id: string) => boolean = () => false
): void {
  const n = simNodes.length;
  for (let i = 0; i < n; i++) {
    const a = simNodes[i];
    for (let j = i + 1; j < n; j++) {
      const b = simNodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distSq = dx * dx + dy * dy;
      if (distSq < 4) {
        dx = (Math.random() - 0.5) * 4;
        dy = (Math.random() - 0.5) * 4;
        distSq = dx * dx + dy * dy + 4;
      }
      const dist = Math.sqrt(distSq);
      const force = strength / distSq;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (!pinned(a.id)) {
        a.vx -= fx;
        a.vy -= fy;
      }
      if (!pinned(b.id)) {
        b.vx += fx;
        b.vy += fy;
      }
    }
  }
}

// Barnes-Hut repulsion: adds the push of every other node to each free node's velocity,
// far groups of nodes counting as one mass at their centre
export function applyBarnesHutRepulsion(
  simNodes: SimNode[],
  strength: number,
  pinned: (id: string) => boolean = () => false
): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const nd of simNodes) {
    if (nd.x < minX) minX = nd.x;
    if (nd.y < minY) minY = nd.y;
    if (nd.x > maxX) maxX = nd.x;
    if (nd.y > maxY) maxY = nd.y;
  }
  const size = Math.max(maxX - minX, maxY - minY, 1) + 1;
  const root = newCell(minX, minY, size);
  for (const nd of simNodes) insert(root, nd, 0);

  const stack: QuadCell[] = [];
  for (const a of simNodes) {
    if (pinned(a.id)) continue;
    stack.length = 0;
    stack.push(root);
    while (stack.length > 0) {
      const cell = stack.pop()!;
      if (cell.mass === 0) continue;
      if (cell.nodes) {
        // Leaf: exact force from each of its nodes
        for (const b of cell.nodes) {
          if (b === a) continue;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let distSq = dx * dx + dy * dy;
          if (distSq < 4) {
            dx = (Math.random() - 0.5) * 4;
            dy = (Math.random() - 0.5) * 4;
            distSq = dx * dx + dy * dy + 4;
          }
          const dist = Math.sqrt(distSq);
          const force = strength / distSq;
          a.vx -= (dx / dist) * force;
          a.vy -= (dy / dist) * force;
        }
        continue;
      }
      const dx = cell.cx - a.x;
      const dy = cell.cy - a.y;
      const distSq = dx * dx + dy * dy;
      const inside = a.x >= cell.x0 && a.x < cell.x0 + cell.size && a.y >= cell.y0 && a.y < cell.y0 + cell.size;
      if (!inside && cell.size * cell.size < THETA * THETA * distSq) {
        // Far enough: the whole cell pushes like one mass at its centre
        const dist = Math.sqrt(distSq);
        const force = (strength * cell.mass) / distSq;
        a.vx -= (dx / dist) * force;
        a.vy -= (dy / dist) * force;
        continue;
      }
      for (const child of cell.children!) if (child) stack.push(child);
    }
  }
}

/**
 * Runs a single frame of an Obsidian-style force-directed constellation simulation.
 * Returns the maximum velocity magnitude so callers know when the graph has settled.
 */
export function stepForceSimulation(
  simNodes: SimNode[],
  edges: GraphEdge[],
  // Nodes held by the user (one dragged node, or a dragged group): no force moves them
  draggedNodeId: string | null | ReadonlySet<string> = null,
  alpha = 0.85
): number {
  const n = simNodes.length;
  if (n === 0) return 0;
  const pinned =
    draggedNodeId === null
      ? () => false
      : typeof draggedNodeId === 'string'
        ? (id: string) => id === draggedNodeId
        : (id: string) => draggedNodeId.has(id);

  const REPULSION = 38000;
  const SPRING_LENGTH = 230;
  const SPRING_K = 0.038;
  const CENTER_GRAVITY = 0.0045;
  const DAMPING = 0.78;

  // Compute centroid for gentle centering gravity
  let cx = 0;
  let cy = 0;
  for (const node of simNodes) {
    cx += node.x;
    cy += node.y;
  }
  cx /= n;
  cy /= n;

  // 1. Coulomb repulsion: every pair on small graphs; on large ones a Barnes-Hut quadtree
  // replaces far groups of nodes by their centre of mass (O(n log n) instead of O(n²))
  if (n > BARNES_HUT_THRESHOLD) applyBarnesHutRepulsion(simNodes, REPULSION * alpha, pinned);
  else applyExactRepulsion(simNodes, REPULSION * alpha, pinned);

  // 2. Hooke spring attraction along edges
  const byId = new Map<string, SimNode>();
  for (const node of simNodes) byId.set(node.id, node);

  for (const edge of edges) {
    const source = byId.get(edge.sourceNodeId);
    const target = byId.get(edge.targetNodeId);
    if (!source || !target || source === target) continue;

    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const dist = Math.hypot(dx, dy) || 1;
    const displacement = dist - SPRING_LENGTH;
    const force = displacement * SPRING_K * alpha;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;

    if (!pinned(source.id)) {
      source.vx += fx;
      source.vy += fy;
    }
    if (!pinned(target.id)) {
      target.vx -= fx;
      target.vy -= fy;
    }
  }

  // 3. Gentle centering pull + velocity integration
  let maxSpeed = 0;
  for (const node of simNodes) {
    if (pinned(node.id)) {
      node.vx = 0;
      node.vy = 0;
      continue;
    }

    node.vx -= (node.x - cx) * CENTER_GRAVITY * alpha;
    node.vy -= (node.y - cy) * CENTER_GRAVITY * alpha;

    node.vx *= DAMPING;
    node.vy *= DAMPING;

    // Clamp max step to avoid sudden jumps
    const speed = Math.hypot(node.vx, node.vy);
    if (speed > 28) {
      node.vx = (node.vx / speed) * 28;
      node.vy = (node.vy / speed) * 28;
    }

    node.x += node.vx;
    node.y += node.vy;

    if (speed > maxSpeed) maxSpeed = speed;
  }

  return maxSpeed;
}

/**
 * Computes an instant balanced organic constellation layout (300 iterations offline)
 * and returns clean integer coordinates.
 */
export function computeConstellationLayout(
  nodes: GraphNode[],
  edges: GraphEdge[]
): Array<{ id: string; positionX: number; positionY: number }> {
  if (nodes.length === 0) return [];

  // Initialize from current positions (or golden-angle spiral if stacked)
  const simNodes: SimNode[] = nodes.map((node, i) => {
    const angle = i * 2.399963; // golden angle
    const radius = 90 * Math.sqrt(i + 1);
    const hasPos = Number.isFinite(node.positionX) && Number.isFinite(node.positionY);
    return {
      id: node.id,
      x: hasPos ? node.positionX : Math.cos(angle) * radius,
      y: hasPos ? node.positionY : Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    };
  });

  const STEPS = 260;
  for (let step = 0; step < STEPS; step++) {
    const alpha = Math.max(0.12, 1 - step / STEPS);
    const maxV = stepForceSimulation(simNodes, edges, null, alpha);
    if (step > 60 && maxV < 0.08) break;
  }

  return simNodes.map((sn) => ({
    id: sn.id,
    positionX: Math.round(sn.x),
    positionY: Math.round(sn.y),
  }));
}
