import type { Category, GraphEdge, GraphNode } from '@shared/types';

export interface MiniMapLayout {
  MM_W: number;
  MM_H: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  /** The part of the graph shown on the canvas, in mini-map pixels */
  vpRect: { x: number; y: number; w: number; h: number };
}

interface MiniMapProps {
  layout: MiniMapLayout;
  nodes: GraphNode[];
  edges: GraphEdge[];
  getNodePos: (node: GraphNode) => { x: number; y: number };
  categoryMap: Map<string, Category>;
  selectedNodeId: string | null;
  /** A click moves the camera to that point of the graph (world coordinates) */
  onPick: (worldX: number, worldY: number) => void;
}

// Mini-map in the bottom right corner of the canvas (O6)
export function MiniMap({ layout, nodes, edges, getNodePos, categoryMap, selectedNodeId, onPick }: MiniMapProps) {
  const { MM_W, MM_H, scale, offsetX, offsetY, vpRect } = layout;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        onPick((e.clientX - rect.left - offsetX) / scale, (e.clientY - rect.top - offsetY) / scale);
      }}
      title="Mini-carte de la constellation (cliquer pour déplacer la caméra)"
      className="hidden md:block absolute bottom-4 right-4 rounded-xl bg-zinc-900/90 border border-filet shadow-2xl overflow-hidden cursor-pointer z-20"
      style={{ width: MM_W, height: MM_H }}
    >
      <svg width={MM_W} height={MM_H}>
        {edges.map((e) => {
          if (!e?.id) return null;
          const s = byId.get(e.sourceNodeId);
          const t = byId.get(e.targetNodeId);
          if (!s || !t) return null;
          const ps = getNodePos(s);
          const pt = getNodePos(t);
          return (
            <line
              key={e.id}
              x1={ps.x * scale + offsetX}
              y1={ps.y * scale + offsetY}
              x2={pt.x * scale + offsetX}
              y2={pt.y * scale + offsetY}
              stroke="var(--filet-fort)"
              strokeWidth={0.8}
            />
          );
        })}

        {nodes.map((n) => {
          if (!n?.id) return null;
          const p = getNodePos(n);
          const cat = n.categoryId ? categoryMap.get(n.categoryId) : null;
          const half = n.id === selectedNodeId ? 3.5 : 2.5;
          return (
            <rect
              key={n.id}
              x={p.x * scale + offsetX - half}
              y={p.y * scale + offsetY - half}
              width={half * 2}
              height={half * 2}
              fill={cat?.color ?? 'var(--texte)'}
            />
          );
        })}

        <rect
          x={vpRect.x}
          y={vpRect.y}
          width={Math.max(8, vpRect.w)}
          height={Math.max(6, vpRect.h)}
          fill="color-mix(in oklab, var(--accent) 8%, transparent)"
          stroke="var(--accent-fort)"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}
