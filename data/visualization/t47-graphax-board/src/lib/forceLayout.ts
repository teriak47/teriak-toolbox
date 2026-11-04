import type { GraphEdge, GraphNode } from '@shared/types';

export interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinnedId?: boolean;
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

  // 1. All-pairs Coulomb repulsion
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
      const force = (REPULSION * alpha) / distSq;
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
