import dagre from '@dagrejs/dagre';
import type { GraphEdge, GraphNode } from '@shared/types';

const ORB_SIZE = 72;

export function computeAutoLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  direction: 'LR' | 'TB' = 'LR'
): Array<{ id: string; positionX: number; positionY: number }> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 130,
    ranksep: 190,
    marginx: 80,
    marginy: 80,
  });

  const nodeSet = new Set(nodes.map((n) => n.id));

  for (const node of nodes) {
    g.setNode(node.id, { width: ORB_SIZE, height: ORB_SIZE });
  }

  for (const edge of edges) {
    if (nodeSet.has(edge.sourceNodeId) && nodeSet.has(edge.targetNodeId)) {
      g.setEdge(edge.sourceNodeId, edge.targetNodeId);
    }
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    if (!pos) {
      return { id: node.id, positionX: node.positionX, positionY: node.positionY };
    }
    return {
      id: node.id,
      positionX: Math.round(pos.x),
      positionY: Math.round(pos.y),
    };
  });
}
