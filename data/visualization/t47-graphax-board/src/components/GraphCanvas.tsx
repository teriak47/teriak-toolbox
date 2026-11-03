import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Link2,
  Maximize2,
  MousePointer2,
  Orbit,
  Pause,
  Pencil,
  Play,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { Category, CategoryShape, GraphEdge, GraphNode } from '@shared/types';
import { getCategoryIcon } from '@/lib/icons';
import { stepForceSimulation, type SimNode } from '@/lib/forceLayout';
import { cn } from '@/lib/utils';

export interface GraphCanvasHandle {
  fitView: (animated?: boolean) => void;
  centerOnPoint: (worldX: number, worldY: number, targetZoom?: number) => void;
  getViewportCenter: () => { x: number; y: number };
}

interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

interface LinkingWireState {
  sourceId: string;
  startWorldX: number;
  startWorldY: number;
  cursorX: number;
  cursorY: number;
  snapTargetId: string | null;
  isClickLink?: boolean;
}

interface GraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  categories: Category[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  autoEditEdgeId: string | null;
  searchQuery: string;
  searchMatchIds: Set<string>;
  onSelectNode: (nodeId: string | null) => void;
  onSelectEdge: (edgeId: string | null) => void;
  onCreateNodeAt: (worldX: number, worldY: number) => Promise<GraphNode | null>;
  onCreateEdge: (sourceNodeId: string, targetNodeId: string) => Promise<void>;
  onCreateLinkedNodeAt: (
    sourceNodeId: string,
    worldX: number,
    worldY: number
  ) => Promise<void>;
  onUpdateNodePosition: (nodeId: string, x: number, y: number) => Promise<void>;
  onUpdateBatchPositions: (
    positions: Array<{ id: string; positionX: number; positionY: number }>
  ) => Promise<void>;
  onCommitEdgeLabel: (edgeId: string, label: string) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onDeleteEdge: (edgeId: string) => Promise<void>;
  onOrganizeConstellation: () => Promise<void>;
}

function clampFinite(val: number, fallback: number, min?: number, max?: number): number {
  if (!Number.isFinite(val)) return fallback;
  let out = val;
  if (min !== undefined && out < min) out = min;
  if (max !== undefined && out > max) out = max;
  return out;
}

function sanitizeViewport(vp: Viewport, fallback: Viewport = { x: 400, y: 300, zoom: 1 }): Viewport {
  return {
    x: clampFinite(vp.x, fallback.x, -50000, 50000),
    y: clampFinite(vp.y, fallback.y, -50000, 50000),
    zoom: clampFinite(vp.zoom, fallback.zoom, 0.16, 3.2),
  };
}

// SECTION 21 geometry: no curves. Nodes are square boxes; "cut" boxes lose two opposite
// corners along the 21 degree slope (width / height = tan 21 degrees).
const NODE_HALF_RATIO = 0.92;
const CUT_SLOPE = Math.tan((21 * Math.PI) / 180);

function nodeHalf(r: number): number {
  return r * NODE_HALF_RATIO;
}

// Distance from a box centre to its border along the unit direction (ux, uy)
function boxBoundary(half: number, ux: number, uy: number): number {
  const m = Math.max(Math.abs(ux), Math.abs(uy));
  return m > 0 ? half / m : half;
}

function boxPoints(half: number, cut: boolean): string {
  if (!cut) {
    return `${-half},${-half} ${half},${-half} ${half},${half} ${-half},${half}`;
  }
  const w = half * 0.38;
  const h = Math.min(w / CUT_SLOPE, half * 1.6);
  const pts: Array<[number, number]> = [
    [-half, -half],
    [half - w, -half],
    [half, -half + h],
    [half, half],
    [-half + w, half],
    [-half, half - h],
  ];
  return pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

function renderNodeShape(
  shape: CategoryShape | undefined,
  r: number,
  fill: string,
  stroke: string,
  strokeWidth: number
) {
  // Legacy "rounded" and "pill" categories are drawn as plain square boxes
  return (
    <polygon
      points={boxPoints(nodeHalf(r), shape === 'cut')}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinejoin="miter"
    />
  );
}

export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(
  function GraphCanvas(
    {
      nodes,
      edges,
      categories,
      selectedNodeId,
      selectedEdgeId,
      autoEditEdgeId,
      searchQuery,
      searchMatchIds,
      onSelectNode,
      onSelectEdge,
      onCreateNodeAt,
      onCreateEdge,
      onCreateLinkedNodeAt,
      onUpdateNodePosition,
      onUpdateBatchPositions,
      onCommitEdgeLabel,
      onDeleteNode,
      onDeleteEdge,
      onOrganizeConstellation,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);

    const [viewport, setViewportState] = useState<Viewport>({ x: 400, y: 300, zoom: 1 });
    const viewportRef = useRef<Viewport>(viewport);
    viewportRef.current = viewport;

    const setViewport = useCallback(
      (updater: Viewport | ((prev: Viewport) => Viewport)) => {
        setViewportState((prev) => {
          const next = typeof updater === 'function' ? updater(prev) : updater;
          return sanitizeViewport(next, prev);
        });
      },
      []
    );

    // Live node positions during drag or physics simulation
    const [livePositions, setLivePositions] = useState<Map<string, { x: number; y: number }>>(
      () => new Map()
    );

    // Interaction tool mode: 'select' (move + halo link) or 'link' (click/drag node A -> node B)
    const [toolMode, setToolMode] = useState<'select' | 'link'>('select');
    const [physicsActive, setPhysicsActive] = useState(false);

    // Hover states for Obsidian neighbor spotlight & halo feedback
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [hoveredHaloNodeId, setHoveredHaloNodeId] = useState<string | null>(null);
    const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

    // Active drag / pan / link wire states
    const panStateRef = useRef<{
      active: boolean;
      startClientX: number;
      startClientY: number;
      startVpX: number;
      startVpY: number;
      moved: boolean;
    } | null>(null);

    const dragNodeRef = useRef<{
      nodeId: string;
      offsetX: number;
      offsetY: number;
      startX: number;
      startY: number;
      moved: boolean;
    } | null>(null);

    const [linkingWire, setLinkingWireState] = useState<LinkingWireState | null>(null);
    const linkingWireRef = useRef<LinkingWireState | null>(null);

    const setLinkingWire = useCallback(
      (
        updater:
          | LinkingWireState
          | null
          | ((prev: LinkingWireState | null) => LinkingWireState | null)
      ) => {
        setLinkingWireState((prev) => {
          const next = typeof updater === 'function' ? updater(prev) : updater;
          linkingWireRef.current = next;
          return next;
        });
      },
      []
    );

    // Inline edge label editing
    const [editingEdgeId, setEditingEdgeIdState] = useState<string | null>(null);
    const editingEdgeIdRef = useRef<string | null>(null);
    const setEditingEdgeId = useCallback((id: string | null) => {
      editingEdgeIdRef.current = id;
      setEditingEdgeIdState(id);
    }, []);

    const [edgeLabelDraft, setEdgeLabelDraft] = useState('');
    const edgeLabelDraftRef = useRef('');
    edgeLabelDraftRef.current = edgeLabelDraft;
    const labelInputRef = useRef<HTMLInputElement>(null);

    // Check if an event target is strictly the empty canvas background (and NOT a node, dock button, or mini-map SVG)
    const isCanvasBackground = useCallback((target: EventTarget | null): boolean => {
      if (!target) return false;
      if (target === containerRef.current || target === svgRef.current) return true;
      if (target instanceof Element) {
        return target.getAttribute('data-canvas-bg') === 'true';
      }
      return false;
    }, []);

    // Sync livePositions from canonical nodes when not mid-drag/physics
    useEffect(() => {
      setLivePositions((prev) => {
        const next = new Map<string, { x: number; y: number }>();
        for (const n of nodes) {
          if (!n?.id) continue;
          if (
            (physicsActive || dragNodeRef.current?.nodeId === n.id) &&
            prev.has(n.id)
          ) {
            const p = prev.get(n.id)!;
            next.set(n.id, {
              x: clampFinite(p.x, 0),
              y: clampFinite(p.y, 0),
            });
          } else {
            next.set(n.id, {
              x: clampFinite(Number(n.positionX), 0),
              y: clampFinite(Number(n.positionY), 0),
            });
          }
        }
        return next;
      });
    }, [nodes, physicsActive]);

    // Auto-open inline label editor when a new edge is created
    useEffect(() => {
      if (autoEditEdgeId) {
        const target = edges.find((e) => e.id === autoEditEdgeId);
        if (target) {
          setEditingEdgeId(target.id);
          setEdgeLabelDraft(String(target.label ?? ''));
        }
      }
    }, [autoEditEdgeId, edges, setEditingEdgeId]);

    useEffect(() => {
      if (editingEdgeId) {
        const t = setTimeout(() => {
          labelInputRef.current?.focus();
          labelInputRef.current?.select();
        }, 20);
        return () => clearTimeout(t);
      }
    }, [editingEdgeId]);

    // Category lookup
    const categoryMap = useMemo(() => {
      const m = new Map<string, Category>();
      for (const c of categories) {
        if (c?.id) m.set(c.id, c);
      }
      return m;
    }, [categories]);

    // Degree count & neighbor adjacency (for Obsidian node sizing & spotlight hover)
    const { degreeMap, neighborMap, incidentEdgesMap } = useMemo(() => {
      const deg = new Map<string, number>();
      const neigh = new Map<string, Set<string>>();
      const inc = new Map<string, Set<string>>();

      for (const n of nodes) {
        if (!n?.id) continue;
        deg.set(n.id, 0);
        neigh.set(n.id, new Set([n.id]));
        inc.set(n.id, new Set());
      }

      for (const e of edges) {
        if (!e?.id) continue;
        deg.set(e.sourceNodeId, (deg.get(e.sourceNodeId) ?? 0) + 1);
        deg.set(e.targetNodeId, (deg.get(e.targetNodeId) ?? 0) + 1);
        neigh.get(e.sourceNodeId)?.add(e.targetNodeId);
        neigh.get(e.targetNodeId)?.add(e.sourceNodeId);
        inc.get(e.sourceNodeId)?.add(e.id);
        inc.get(e.targetNodeId)?.add(e.id);
      }

      return { degreeMap: deg, neighborMap: neigh, incidentEdgesMap: inc };
    }, [nodes, edges]);

    const getNodeRadius = useCallback(
      (nodeId: string) => {
        const deg = degreeMap.get(nodeId) ?? 0;
        return 21 + Math.min(deg * 2.3, 13);
      },
      [degreeMap]
    );

    const getNodePos = useCallback(
      (node: GraphNode) => {
        const live = livePositions.get(node.id);
        if (live && Number.isFinite(live.x) && Number.isFinite(live.y)) {
          return live;
        }
        return {
          x: clampFinite(Number(node.positionX), 0),
          y: clampFinite(Number(node.positionY), 0),
        };
      },
      [livePositions]
    );

    // Coordinate transforms
    const screenToWorld = useCallback((clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const sx = clientX - (rect?.left ?? 0);
      const sy = clientY - (rect?.top ?? 0);
      const vp = viewportRef.current;
      const z = clampFinite(vp.zoom, 1, 0.16, 3.2);
      return {
        x: clampFinite((sx - vp.x) / z, 0),
        y: clampFinite((sy - vp.y) / z, 0),
      };
    }, []);

    // Smooth camera animation helper
    const animFrameRef = useRef<number | null>(null);
    const animateViewportTo = useCallback(
      (rawTarget: Viewport, duration = 360) => {
        const target = sanitizeViewport(rawTarget, viewportRef.current);
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        const start = viewportRef.current;
        const startTime = performance.now();

        const tick = (now: number) => {
          const t = Math.min(1, Math.max(0, (now - startTime) / Math.max(16, duration)));
          const ease = 1 - Math.pow(1 - t, 3);
          setViewport({
            x: start.x + (target.x - start.x) * ease,
            y: start.y + (target.y - start.y) * ease,
            zoom: start.zoom + (target.zoom - start.zoom) * ease,
          });
          if (t < 1) {
            animFrameRef.current = requestAnimationFrame(tick);
          } else {
            animFrameRef.current = null;
          }
        };
        animFrameRef.current = requestAnimationFrame(tick);
      },
      [setViewport]
    );

    useEffect(() => {
      return () => {
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      };
    }, []);

    const fitView = useCallback(
      (animated = true) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return;

        if (nodes.length === 0) {
          const target = { x: rect.width / 2, y: rect.height / 2, zoom: 1 };
          if (animated) animateViewportTo(target);
          else setViewport(target);
          return;
        }

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const n of nodes) {
          if (!n?.id) continue;
          const pos = getNodePos(n);
          minX = Math.min(minX, pos.x - 80);
          minY = Math.min(minY, pos.y - 80);
          maxX = Math.max(maxX, pos.x + 80);
          maxY = Math.max(maxY, pos.y + 95);
        }

        if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;

        const bw = Math.max(240, maxX - minX);
        const bh = Math.max(240, maxY - minY);
        const availW = Math.max(120, rect.width - 160);
        const availH = Math.max(120, rect.height - 160);
        const zoom = clampFinite(Math.min(availW / bw, availH / bh), 1, 0.2, 1.35);

        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const target: Viewport = {
          x: rect.width / 2 - cx * zoom,
          y: rect.height / 2 - cy * zoom,
          zoom,
        };

        if (animated) animateViewportTo(target);
        else setViewport(target);
      },
      [nodes, getNodePos, animateViewportTo, setViewport]
    );

    const centerOnPoint = useCallback(
      (worldX: number, worldY: number, targetZoom = 1.25) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return;
        const wx = clampFinite(worldX, 0);
        const wy = clampFinite(worldY, 0);
        const z = clampFinite(targetZoom, 1.25, 0.16, 3.2);
        animateViewportTo(
          {
            x: rect.width / 2 - wx * z,
            y: rect.height / 2 - wy * z,
            zoom: z,
          },
          420
        );
      },
      [animateViewportTo]
    );

    const getViewportCenter = useCallback(() => {
      const rect = containerRef.current?.getBoundingClientRect();
      const vp = viewportRef.current;
      const cx = (rect?.width && rect.width > 0 ? rect.width : 900) / 2;
      const cy = (rect?.height && rect.height > 0 ? rect.height : 650) / 2;
      const z = clampFinite(vp.zoom, 1, 0.16, 3.2);
      return {
        x: clampFinite((cx - vp.x) / z, 0),
        y: clampFinite((cy - vp.y) / z, 0),
      };
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        fitView,
        centerOnPoint,
        getViewportCenter,
      }),
      [fitView, centerOnPoint, getViewportCenter]
    );

    // Wheel zoom centered on mouse cursor
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        setViewport((prev) => {
          const factor = Math.exp(-clampFinite(e.deltaY, 0, -500, 500) * 0.0014);
          const nextZoom = clampFinite(prev.zoom * factor, prev.zoom, 0.16, 3.2);
          const scale = nextZoom / prev.zoom;
          return {
            zoom: nextZoom,
            x: mx - (mx - prev.x) * scale,
            y: my - (my - prev.y) * scale,
          };
        });
      };

      el.addEventListener('wheel', onWheel, { passive: false });
      return () => el.removeEventListener('wheel', onWheel);
    }, [setViewport]);

    // Keyboard shortcuts: V (Select/Move), L (Link tool), Escape (cancel link/deselect), Delete (remove selected)
    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        if (e.key === 'v' || e.key === 'V') {
          setToolMode('select');
          setLinkingWire(null);
        } else if (e.key === 'l' || e.key === 'L') {
          setToolMode((m) => (m === 'link' ? 'select' : 'link'));
          setLinkingWire(null);
        } else if (e.key === 'Escape') {
          setLinkingWire(null);
          setToolMode('select');
        } else if (e.key === 'Delete') {
          if (selectedNodeId) void onDeleteNode(selectedNodeId);
          else if (selectedEdgeId) void onDeleteEdge(selectedEdgeId);
        }
      };

      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }, [selectedNodeId, selectedEdgeId, onDeleteNode, onDeleteEdge, setLinkingWire]);

    // Live Obsidian-style Force Physics Loop (when toggled ON)
    const simNodesRef = useRef<SimNode[]>([]);
    const edgesRef = useRef(edges);
    edgesRef.current = edges;

    const livePositionsRef = useRef(livePositions);
    livePositionsRef.current = livePositions;

    useEffect(() => {
      if (!physicsActive) return;

      // Seed simNodes from current live positions
      const existing = new Map(simNodesRef.current.map((s) => [s.id, s]));
      simNodesRef.current = nodes
        .filter((n) => Boolean(n?.id))
        .map((n) => {
          const prevSim = existing.get(n.id);
          const live = livePositionsRef.current.get(n.id) ?? {
            x: clampFinite(Number(n.positionX), 0),
            y: clampFinite(Number(n.positionY), 0),
          };
          return {
            id: n.id,
            x: clampFinite(live.x, 0),
            y: clampFinite(live.y, 0),
            vx: clampFinite(prevSim?.vx ?? 0, 0),
            vy: clampFinite(prevSim?.vy ?? 0, 0),
          };
        });

      let rafId = 0;
      let lastPersist = performance.now();

      const loop = (now: number) => {
        const draggedId = dragNodeRef.current?.nodeId ?? null;
        if (draggedId) {
          const live = livePositionsRef.current.get(draggedId);
          const simTarget = simNodesRef.current.find((s) => s.id === draggedId);
          if (live && simTarget) {
            simTarget.x = clampFinite(live.x, simTarget.x);
            simTarget.y = clampFinite(live.y, simTarget.y);
          }
        }

        stepForceSimulation(simNodesRef.current, edgesRef.current, draggedId, 0.72);

        const nextMap = new Map<string, { x: number; y: number }>();
        for (const sn of simNodesRef.current) {
          nextMap.set(sn.id, {
            x: clampFinite(sn.x, 0),
            y: clampFinite(sn.y, 0),
          });
        }
        setLivePositions(nextMap);

        // Periodically persist every 1.8s while physics runs
        if (now - lastPersist > 1800 && simNodesRef.current.length > 0) {
          lastPersist = now;
          void onUpdateBatchPositions(
            simNodesRef.current.map((sn) => ({
              id: sn.id,
              positionX: Math.round(clampFinite(sn.x, 0)),
              positionY: Math.round(clampFinite(sn.y, 0)),
            }))
          );
        }

        rafId = requestAnimationFrame(loop);
      };

      rafId = requestAnimationFrame(loop);

      return () => {
        cancelAnimationFrame(rafId);
        // Save final settled coordinates when physics stops
        if (simNodesRef.current.length > 0) {
          void onUpdateBatchPositions(
            simNodesRef.current.map((sn) => ({
              id: sn.id,
              positionX: Math.round(clampFinite(sn.x, 0)),
              positionY: Math.round(clampFinite(sn.y, 0)),
            }))
          );
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [physicsActive, nodes.length]);

    // Find closest snap target node for magnetic linking
    const findSnapNodeAt = useCallback(
      (wx: number, wy: number, excludeNodeId: string): string | null => {
        let bestId: string | null = null;
        let bestDist = Infinity;
        for (const n of nodes) {
          if (!n?.id || n.id === excludeNodeId) continue;
          const pos = livePositionsRef.current.get(n.id) ?? {
            x: clampFinite(Number(n.positionX), 0),
            y: clampFinite(Number(n.positionY), 0),
          };
          const r = getNodeRadius(n.id);
          const d = Math.hypot(wx - pos.x, wy - pos.y);
          if (d <= r + 20 && d < bestDist) {
            bestDist = d;
            bestId = n.id;
          }
        }
        return bestId;
      },
      [nodes, getNodeRadius]
    );

    // Global mouse move & mouse up for dragging, panning, and linking (NO side-effects inside setState updaters!)
    useEffect(() => {
      const onMouseMove = (e: MouseEvent) => {
        // 1. Panning canvas
        if (panStateRef.current?.active) {
          const dx = e.clientX - panStateRef.current.startClientX;
          const dy = e.clientY - panStateRef.current.startClientY;
          if (Math.hypot(dx, dy) > 3) panStateRef.current.moved = true;
          const nextX = panStateRef.current.startVpX + dx;
          const nextY = panStateRef.current.startVpY + dy;
          setViewport((prev) => ({
            ...prev,
            x: nextX,
            y: nextY,
          }));
          return;
        }

        // 2. Dragging a node
        if (dragNodeRef.current) {
          const world = screenToWorld(e.clientX, e.clientY);
          const nx = clampFinite(world.x - dragNodeRef.current.offsetX, dragNodeRef.current.startX);
          const ny = clampFinite(world.y - dragNodeRef.current.offsetY, dragNodeRef.current.startY);
          if (
            Math.hypot(
              nx - dragNodeRef.current.startX,
              ny - dragNodeRef.current.startY
            ) > 2
          ) {
            dragNodeRef.current.moved = true;
          }
          const nid = dragNodeRef.current.nodeId;
          setLivePositions((prev) => {
            const next = new Map(prev);
            next.set(nid, { x: nx, y: ny });
            return next;
          });
          return;
        }

        // 3. Drawing a link wire (either drag-link or click-link preview)
        const currWire = linkingWireRef.current;
        if (currWire) {
          const world = screenToWorld(e.clientX, e.clientY);
          const snapId = findSnapNodeAt(world.x, world.y, currWire.sourceId);
          setLinkingWire({
            ...currWire,
            cursorX: world.x,
            cursorY: world.y,
            snapTargetId: snapId,
          });
        }
      };

      const onMouseUp = (e: MouseEvent) => {
        if (panStateRef.current?.active) {
          const moved = panStateRef.current.moved;
          panStateRef.current = null;
          if (!moved && e.button === 0 && linkingWireRef.current?.isClickLink) {
            setLinkingWire(null);
          }
          return;
        }

        if (dragNodeRef.current) {
          const { nodeId, moved } = dragNodeRef.current;
          dragNodeRef.current = null;
          if (moved) {
            const finalPos = livePositionsRef.current.get(nodeId);
            if (finalPos && Number.isFinite(finalPos.x) && Number.isFinite(finalPos.y)) {
              void onUpdateNodePosition(
                nodeId,
                Math.round(finalPos.x * 100) / 100,
                Math.round(finalPos.y * 100) / 100
              );
            }
          }
          return;
        }

        // Finish drag-based linking wire (outside setState updater so StrictMode never double-fires!)
        const curr = linkingWireRef.current;
        if (!curr || curr.isClickLink) return;

        setLinkingWire(null);

        const world = screenToWorld(e.clientX, e.clientY);
        const dragDist = Math.hypot(world.x - curr.startWorldX, world.y - curr.startWorldY);
        // Ignore micro-clicks (< 10px) on the halo ring so a click or double-click on a node never fires a link
        if (dragDist < 10) return;

        const targetId = findSnapNodeAt(world.x, world.y, curr.sourceId);
        if (targetId) {
          void onCreateEdge(curr.sourceId, targetId);
          return;
        }

        // If dragged cleanly out into empty space (> 70px away from source node center), create a new linked node
        const srcNode = nodes.find((n) => n.id === curr.sourceId);
        if (srcNode) {
          const srcPos = livePositionsRef.current.get(srcNode.id) ?? {
            x: clampFinite(Number(srcNode.positionX), 0),
            y: clampFinite(Number(srcNode.positionY), 0),
          };
          if (Math.hypot(world.x - srcPos.x, world.y - srcPos.y) > 70) {
            void onCreateLinkedNodeAt(
              curr.sourceId,
              Math.round(world.x),
              Math.round(world.y)
            );
          }
        }
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      return () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };
    }, [
      nodes,
      screenToWorld,
      findSnapNodeAt,
      onUpdateNodePosition,
      onCreateEdge,
      onCreateLinkedNodeAt,
      setViewport,
      setLinkingWire,
    ]);

    // Precompute edge geometries (parallel curve separation + exact perimeter clipping)
    const renderedEdges = useMemo(() => {
      const nodeById = new Map<string, GraphNode>();
      for (const n of nodes) {
        if (n?.id) nodeById.set(n.id, n);
      }

      // Group edges by unordered node pair for clean parallel curve separation
      const pairGroups = new Map<string, string[]>();
      for (const e of edges) {
        if (!e?.id) continue;
        const key =
          e.sourceNodeId < e.targetNodeId
            ? `${e.sourceNodeId}::${e.targetNodeId}`
            : `${e.targetNodeId}::${e.sourceNodeId}`;
        const list = pairGroups.get(key) ?? [];
        list.push(e.id);
        pairGroups.set(key, list);
      }

      return edges
        .map((edge) => {
          if (!edge?.id) return null;
          const srcNode = nodeById.get(edge.sourceNodeId);
          const tgtNode = nodeById.get(edge.targetNodeId);
          if (!srcNode || !tgtNode) return null;

          const p1 = getNodePos(srcNode);
          const p2 = getNodePos(tgtNode);
          const r1 = getNodeRadius(srcNode.id);
          const r2 = getNodeRadius(tgtNode.id);

          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const dist = Math.hypot(dx, dy);
          if (!Number.isFinite(dist) || dist < 1) return null;

          const pairKey =
            edge.sourceNodeId < edge.targetNodeId
              ? `${edge.sourceNodeId}::${edge.targetNodeId}`
              : `${edge.targetNodeId}::${edge.sourceNodeId}`;
          const siblings = pairGroups.get(pairKey) ?? [edge.id];
          const idx = siblings.indexOf(edge.id);
          const curveStep = siblings.length > 1 ? (idx - (siblings.length - 1) / 2) * 48 : 0;

          // Canonical normal so A->B and B->A curve to opposite sides!
          const canonA = edge.sourceNodeId < edge.targetNodeId ? p1 : p2;
          const canonB = edge.sourceNodeId < edge.targetNodeId ? p2 : p1;
          const cdx = canonB.x - canonA.x;
          const cdy = canonB.y - canonA.y;
          const cdist = Math.hypot(cdx, cdy) || 1;
          const nx = -cdy / cdist;
          const ny = cdx / cdist;

          const cx = (p1.x + p2.x) / 2 + nx * curveStep;
          const cy = (p1.y + p2.y) / 2 + ny * curveStep;

          // Start tangent p1 -> control
          const sdx = cx - p1.x;
          const sdy = cy - p1.y;
          const sLen = Math.hypot(sdx, sdy) || 1;
          const b1 = boxBoundary(nodeHalf(r1), sdx / sLen, sdy / sLen);
          const sx = p1.x + (sdx / sLen) * (b1 + 3);
          const sy = p1.y + (sdy / sLen) * (b1 + 3);

          // End tangent control -> p2
          const edx = p2.x - cx;
          const edy = p2.y - cy;
          const eLen = Math.hypot(edx, edy) || 1;
          const eux = edx / eLen;
          const euy = edy / eLen;
          const b2 = boxBoundary(nodeHalf(r2), eux, euy);
          const endPad = edge.directed ? b2 + 5 : b2 + 3;
          const tx = p2.x - eux * endPad;
          const ty = p2.y - euy * endPad;

          if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(tx) || !Number.isFinite(ty)) {
            return null;
          }

          const pathD =
            Math.abs(curveStep) < 0.5
              ? `M ${sx.toFixed(1)} ${sy.toFixed(1)} L ${tx.toFixed(1)} ${ty.toFixed(1)}`
              : `M ${sx.toFixed(1)} ${sy.toFixed(1)} L ${cx.toFixed(1)} ${cy.toFixed(1)} L ${tx.toFixed(1)} ${ty.toFixed(1)}`;

          // Parallel links bend at a single point; the label sits on that bend
          const mx = Math.abs(curveStep) < 0.5 ? (sx + tx) / 2 : cx;
          const my = Math.abs(curveStep) < 0.5 ? (sy + ty) / 2 : cy;

          // Arrowhead polygon at (tx, ty)
          const arrowLen = 9.5;
          const arrowHalfW = 4.3;
          const bx = tx - eux * arrowLen;
          const by = ty - euy * arrowLen;
          const pnx = -euy;
          const pny = eux;
          const arrowPoints = `${(tx + eux * 2).toFixed(1)},${(ty + euy * 2).toFixed(1)} ${(
            bx +
            pnx * arrowHalfW
          ).toFixed(1)},${(by + pny * arrowHalfW).toFixed(1)} ${(
            bx -
            pnx * arrowHalfW
          ).toFixed(1)},${(by - pny * arrowHalfW).toFixed(1)}`;

          return {
            edge,
            pathD,
            mx: clampFinite(mx, 0),
            my: clampFinite(my, 0),
            arrowPoints,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);
    }, [nodes, edges, getNodePos, getNodeRadius]);

    // Commit inline edge label safely (ref-guarded so Enter + unmount blur never double-fires)
    const commitInlineLabel = useCallback(() => {
      const targetId = editingEdgeIdRef.current;
      if (!targetId) return;
      const trimmed = edgeLabelDraftRef.current.trim();
      setEditingEdgeId(null);
      void onCommitEdgeLabel(targetId, trimmed);
    }, [onCommitEdgeLabel, setEditingEdgeId]);

    const editingEdgeGeometry = useMemo(
      () => renderedEdges.find((re) => re.edge.id === editingEdgeId) ?? null,
      [renderedEdges, editingEdgeId]
    );

    const hasSearch = (searchQuery ?? '').trim().length > 0;
    const spotlightNodeId = hoveredNodeId;
    const spotlightNeighbors = spotlightNodeId ? (neighborMap.get(spotlightNodeId) ?? null) : null;
    const spotlightEdges = spotlightNodeId ? (incidentEdgesMap.get(spotlightNodeId) ?? null) : null;

    // Prevent overlapping rapid double-click node creations
    const creatingNodeLockRef = useRef(false);

    // Mini-map bounds computation
    const miniMapData = useMemo(() => {
      if (nodes.length === 0) return null;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const n of nodes) {
        if (!n?.id) continue;
        const p = getNodePos(n);
        minX = Math.min(minX, p.x - 100);
        minY = Math.min(minY, p.y - 100);
        maxX = Math.max(maxX, p.x + 100);
        maxY = Math.max(maxY, p.y + 100);
      }

      if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

      const w = Math.max(400, maxX - minX);
      const h = Math.max(300, maxY - minY);
      const MM_W = 164;
      const MM_H = 112;
      const scale = clampFinite(Math.min(MM_W / w, MM_H / h), 0.1, 0.0001, 10);
      const offsetX = clampFinite((MM_W - w * scale) / 2 - minX * scale, 0);
      const offsetY = clampFinite((MM_H - h * scale) / 2 - minY * scale, 0);

      const rect = containerRef.current?.getBoundingClientRect();
      const z = clampFinite(viewport.zoom, 1, 0.16, 3.2);
      const vw = (rect?.width && rect.width > 0 ? rect.width : 1000) / z;
      const vh = (rect?.height && rect.height > 0 ? rect.height : 700) / z;
      const vx = -viewport.x / z;
      const vy = -viewport.y / z;

      return {
        MM_W,
        MM_H,
        scale,
        offsetX,
        offsetY,
        vpRect: {
          x: clampFinite(vx * scale + offsetX, 0),
          y: clampFinite(vy * scale + offsetY, 0),
          w: clampFinite(vw * scale, 40),
          h: clampFinite(vh * scale, 30),
        },
      };
    }, [nodes, getNodePos, viewport]);

    return (
      <div
        ref={containerRef}
        onContextMenu={(e) => e.preventDefault()}
        onMouseDown={(e) => {
          // Middle-click or Left-click strictly on empty canvas background starts Pan
          if (isCanvasBackground(e.target)) {
            if (e.button === 0 || e.button === 1) {
              panStateRef.current = {
                active: true,
                startClientX: e.clientX,
                startClientY: e.clientY,
                startVpX: viewportRef.current.x,
                startVpY: viewportRef.current.y,
                moved: false,
              };
            }
          }
        }}
        onClick={(e) => {
          if (isCanvasBackground(e.target)) {
            if (!panStateRef.current?.moved) {
              onSelectNode(null);
              onSelectEdge(null);
              setLinkingWire(null);
            }
          }
        }}
        onDoubleClick={(e) => {
          if (!isCanvasBackground(e.target)) return;
          e.preventDefault();
          panStateRef.current = null;
          dragNodeRef.current = null;
          setLinkingWire(null);

          if (creatingNodeLockRef.current) return;
          creatingNodeLockRef.current = true;
          const world = screenToWorld(e.clientX, e.clientY);
          void onCreateNodeAt(Math.round(world.x), Math.round(world.y)).finally(() => {
            creatingNodeLockRef.current = false;
          });
        }}
        className={cn(
          'relative w-full h-full overflow-hidden select-none bg-zinc-950',
          toolMode === 'link' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
        )}
      >
        {/* ==================== VECTOR CONSTELLATION SVG ==================== */}
        <svg ref={svgRef} className="w-full h-full block">
          {/* Dedicated Canvas Background Hit-Target */}
          <rect
            data-canvas-bg="true"
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="transparent"
          />

          <g transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.zoom})`}>
            {/* 1. EDGES LAYER */}
            {renderedEdges.map(({ edge, pathD, mx, my, arrowPoints }) => {
              const isSelected = edge.id === selectedEdgeId;
              const isHovered = edge.id === hoveredEdgeId;
              const isDashed = edge.style === 'dashed';
              const isIncidentSpotlight = spotlightEdges?.has(edge.id) ?? false;
              const labelText = String(edge.label ?? '');

              const isDimmed =
                (spotlightEdges !== null && !isIncidentSpotlight && !isSelected) ||
                (hasSearch &&
                  !searchMatchIds.has(edge.sourceNodeId) &&
                  !searchMatchIds.has(edge.targetNodeId));

              const strokeColor = isSelected
                ? 'var(--accent-fort)'
                : isIncidentSpotlight || isHovered
                  ? 'var(--accent)'
                  : 'var(--filet-fort)';

              const strokeWidth =
                isSelected || isHovered ? 2.4 : isIncidentSpotlight ? 2.0 : 1.45;

              return (
                <g
                  key={edge.id}
                  className="transition-opacity duration-150 cursor-pointer"
                  style={{ opacity: isDimmed ? 0.16 : 1 }}
                  onMouseEnter={() => setHoveredEdgeId(edge.id)}
                  onMouseLeave={() =>
                    setHoveredEdgeId((curr) => (curr === edge.id ? null : curr))
                  }
                  onMouseDown={(e) => {
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectNode(null);
                    onSelectEdge(edge.id);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onSelectNode(null);
                    onSelectEdge(edge.id);
                    setEditingEdgeId(edge.id);
                    setEdgeLabelDraft(labelText);
                  }}
                >
                  {/* Wide transparent hit area so thin constellation lines are effortless to click */}
                  <path d={pathD} fill="none" stroke="transparent" strokeWidth={18} />

                  {/* Visible Graph Link */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    strokeDasharray={isDashed ? '6 5' : undefined}
                    strokeLinecap="butt"
                  />

                  {/* Perimeter-aligned Directional Arrowhead */}
                  {edge.directed && <polygon points={arrowPoints} fill={strokeColor} />}

                  {/* Clean Midpoint Edge Label */}
                  {editingEdgeId !== edge.id && (labelText || isSelected || isHovered) && (
                    <g transform={`translate(${mx.toFixed(1)}, ${my.toFixed(1)})`}>
                      {labelText ? (
                        <>
                          <rect
                            x={-(labelText.length * 3.7 + 10)}
                            y={-10.5}
                            width={labelText.length * 7.4 + 20}
                            height={21}
                            fill="var(--surface-puits)"
                            stroke={isSelected ? 'var(--accent-fort)' : 'var(--filet)'}
                            strokeWidth={1}
                            strokeDasharray={isDashed ? '3 2' : undefined}
                          />
                          <text
                            textAnchor="middle"
                            dominantBaseline="central"
                            fill="var(--texte-fort)"
                            fontSize={12}
                            fontWeight={500}
                            className="pointer-events-none"
                          >
                            {labelText}
                          </text>
                        </>
                      ) : (
                        <g>
                          <rect
                            x={-34}
                            y={-9}
                            width={68}
                            height={18}
                            fill="var(--surface-carte)"
                            stroke="var(--filet-fort)"
                            strokeWidth={1}
                          />
                          <text
                            textAnchor="middle"
                            dominantBaseline="central"
                            fill="var(--texte)"
                            fontSize={12}
                          >
                            + label
                          </text>
                        </g>
                      )}
                    </g>
                  )}
                </g>
              );
            })}

            {/* 2. LIVE LINKING WIRE PREVIEW */}
            {linkingWire &&
              (() => {
                const src = nodes.find((n) => n?.id === linkingWire.sourceId);
                if (!src) return null;
                const p1 = getNodePos(src);
                const snapNode = linkingWire.snapTargetId
                  ? nodes.find((n) => n?.id === linkingWire.snapTargetId)
                  : null;
                const p2 = snapNode
                  ? getNodePos(snapNode)
                  : { x: linkingWire.cursorX, y: linkingWire.cursorY };

                return (
                  <g className="pointer-events-none">
                    <line
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                      stroke="var(--accent-fort)"
                      strokeWidth={2.2}
                      strokeDasharray="6 4"
                    />
                    {(() => {
                      const halfBox = snapNode ? nodeHalf(getNodeRadius(snapNode.id)) + 7 : 5;
                      return (
                        <rect
                          x={p2.x - halfBox}
                          y={p2.y - halfBox}
                          width={halfBox * 2}
                          height={halfBox * 2}
                          fill={
                            snapNode
                              ? 'color-mix(in oklab, var(--accent) 14%, transparent)'
                              : 'var(--accent-fort)'
                          }
                          stroke="var(--accent-fort)"
                          strokeWidth={1.8}
                        />
                      );
                    })()}
                  </g>
                );
              })()}

            {/* 3. CONSTELLATION NODES LAYER */}
            {nodes.map((node) => {
              if (!node?.id) return null;
              const pos = getNodePos(node);
              const r = getNodeRadius(node.id);
              const cat = node.categoryId ? (categoryMap.get(node.categoryId) ?? null) : null;
              const color = cat?.color ?? 'var(--texte)';
              const Icon = getCategoryIcon(cat?.icon);
              const nodeTitle = String(node.title ?? 'Indice');
              const nodeContent = String(node.content ?? '');
              const nodeMeta =
                node.metadata && typeof node.metadata === 'object' ? node.metadata : {};

              const isSelected = node.id === selectedNodeId;
              const isHovered = node.id === hoveredNodeId;
              const isHaloHovered = node.id === hoveredHaloNodeId;
              const isSnapTarget = linkingWire?.snapTargetId === node.id;
              const isLinkSource = linkingWire?.sourceId === node.id;
              const isSearchHit = hasSearch && searchMatchIds.has(node.id);

              const isDimmed =
                (spotlightNeighbors !== null &&
                  !spotlightNeighbors.has(node.id) &&
                  !isSelected &&
                  !linkingWire) ||
                (hasSearch && !isSearchHit);

              const metaEntries = Object.entries(nodeMeta);
              const hasDetails = nodeContent.trim().length > 0 || metaEntries.length > 0;
              const firstMeta = metaEntries[0];

              const startWireFromNode = (clientX: number, clientY: number, isClick = false) => {
                const world = screenToWorld(clientX, clientY);
                setLinkingWire({
                  sourceId: node.id,
                  startWorldX: world.x,
                  startWorldY: world.y,
                  cursorX: world.x,
                  cursorY: world.y,
                  snapTargetId: null,
                  isClickLink: isClick,
                });
              };

              return (
                <g
                  key={node.id}
                  transform={`translate(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)})`}
                  className="transition-opacity duration-150"
                  style={{ opacity: isDimmed ? 0.2 : 1 }}
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() => {
                    setHoveredNodeId((curr) => (curr === node.id ? null : curr));
                    setHoveredHaloNodeId((curr) => (curr === node.id ? null : curr));
                  }}
                  onDoubleClick={(e) => {
                    // Stop propagation so double-clicking a node NEVER creates another node underneath it!
                    e.stopPropagation();
                    dragNodeRef.current = null;
                    setLinkingWire(null);
                    onSelectEdge(null);
                    onSelectNode(node.id);
                    centerOnPoint(pos.x, pos.y, Math.max(viewportRef.current.zoom, 1.25));
                  }}
                >
                  {/* 360° OUTER LINK HALO RING — Drag anywhere on this ring to link effortlessly! */}
                  {toolMode === 'select' && (
                    <rect
                      x={-(nodeHalf(r) + 8)}
                      y={-(nodeHalf(r) + 8)}
                      width={(nodeHalf(r) + 8) * 2}
                      height={(nodeHalf(r) + 8) * 2}
                      fill="none"
                      stroke={isHaloHovered || isLinkSource ? 'var(--accent-fort)' : color}
                      strokeWidth={11}
                      strokeOpacity={
                        isHaloHovered || isLinkSource ? 0.42 : isHovered ? 0.18 : 0
                      }
                      className="cursor-crosshair transition-opacity"
                      onMouseEnter={() => setHoveredHaloNodeId(node.id)}
                      onMouseLeave={() =>
                        setHoveredHaloNodeId((curr) => (curr === node.id ? null : curr))
                      }
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        if (e.button === 0 || e.button === 2) {
                          startWireFromNode(e.clientX, e.clientY, false);
                        }
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectEdge(null);
                        onSelectNode(node.id);
                      }}
                    >
                      <title>Glisser ce cadre vers un autre nœud pour créer un lien</title>
                    </rect>
                  )}

                  {/* Subtle dashed visual ring when hovered */}
                  {(isHovered || isHaloHovered || isLinkSource) && (
                    <rect
                      x={-(nodeHalf(r) + 9)}
                      y={-(nodeHalf(r) + 9)}
                      width={(nodeHalf(r) + 9) * 2}
                      height={(nodeHalf(r) + 9) * 2}
                      fill="none"
                      stroke={isHaloHovered || isLinkSource ? 'var(--accent-fort)' : color}
                      strokeWidth={1.3}
                      strokeDasharray="4 3"
                      opacity={0.75}
                      className="pointer-events-none"
                    />
                  )}

                  {/* Selection / Search outer ring */}
                  {(isSelected || isSearchHit) && (
                    <rect
                      x={-(nodeHalf(r) + 4.5)}
                      y={-(nodeHalf(r) + 4.5)}
                      width={(nodeHalf(r) + 4.5) * 2}
                      height={(nodeHalf(r) + 4.5) * 2}
                      fill="none"
                      stroke={isSelected ? 'var(--accent-fort)' : 'var(--attention)'}
                      strokeWidth={2}
                      className="pointer-events-none"
                    />
                  )}

                  {/* INNER NODE ORB — Drag to move (or Shift+Drag / Right-Drag / Link-Mode to link!) */}
                  <g
                    className={cn(
                      toolMode === 'link' ? 'cursor-crosshair' : 'cursor-pointer'
                    )}
                    onMouseDown={(e) => {
                      e.stopPropagation();

                      // Complete a 2-click link if one is active!
                      const activeWire = linkingWireRef.current;
                      if (activeWire?.isClickLink && activeWire.sourceId !== node.id) {
                        const srcId = activeWire.sourceId;
                        setLinkingWire(null);
                        void onCreateEdge(srcId, node.id);
                        return;
                      }

                      // Shift+Drag, Right-Click Drag, or Link Tool Mode -> draw link wire!
                      if (e.shiftKey || e.button === 2 || toolMode === 'link') {
                        startWireFromNode(
                          e.clientX,
                          e.clientY,
                          toolMode === 'link'
                        );
                        return;
                      }

                      // Standard Left-Click -> select & prepare smooth node drag
                      if (e.button === 0) {
                        const world = screenToWorld(e.clientX, e.clientY);
                        dragNodeRef.current = {
                          nodeId: node.id,
                          offsetX: world.x - pos.x,
                          offsetY: world.y - pos.y,
                          startX: pos.x,
                          startY: pos.y,
                          moved: false,
                        };
                      }
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (toolMode === 'link') return;
                      onSelectEdge(null);
                      onSelectNode(node.id);
                    }}
                  >
                    {/* Base dark fill */}
                    {renderNodeShape(cat?.shape, r, 'var(--surface-carte)', color, isSelected ? 2.6 : 2)}
                    {/* Translucent category tint overlay */}
                    {renderNodeShape(
                      cat?.shape,
                      r - 1,
                      `color-mix(in oklab, ${color} 17%, transparent)`,
                      'none',
                      0
                    )}

                    {/* Centered Vector Category Icon */}
                    <g
                      transform={`translate(${-9}, ${-9})`}
                      style={{ color: isSelected ? 'var(--texte-fort)' : color }}
                      className="pointer-events-none"
                    >
                      <Icon width={18} height={18} strokeWidth={2} />
                    </g>

                    {/* Subtle detail badge dot (indicates Markdown notes or metadata) */}
                    {hasDetails && (
                      <rect
                        x={nodeHalf(r) - 4}
                        y={-nodeHalf(r) - 4}
                        width={8}
                        height={8}
                        fill={color}
                        stroke="var(--surface-puits)"
                        strokeWidth={1.5}
                        className="pointer-events-none"
                      />
                    )}
                  </g>

                  {/* FLOATING CONSTELLATION LABEL BELOW NODE (Interactive: click/double-click selects node instead of hitting canvas bg!) */}
                  <g
                    transform={`translate(0, ${r + 15})`}
                    className="cursor-pointer"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectEdge(null);
                      onSelectNode(node.id);
                    }}
                  >
                    <text
                      textAnchor="middle"
                      fill={isSelected || isHovered ? 'var(--texte-fort)' : 'var(--txt-1)'}
                      fontSize={12}
                      fontWeight={isSelected || isHovered ? 600 : 500}
                      style={{
                        paintOrder: 'stroke',
                        stroke: 'var(--surface-puits)',
                        strokeWidth: 4.5,
                        strokeLinejoin: 'miter',
                      }}
                    >
                      {nodeTitle.length > 34 ? `${nodeTitle.slice(0, 32)}…` : nodeTitle}
                    </text>

                    {/* Subtle tactical subtitle on hover/selection if metadata exists */}
                    {firstMeta && (isHovered || isSelected) && (
                      <text
                        y={15}
                        textAnchor="middle"
                        fill="var(--texte)"
                        fontSize={12}
                        fontFamily="var(--font-mono)"
                        style={{
                          paintOrder: 'stroke',
                          stroke: 'var(--surface-puits)',
                          strokeWidth: 4,
                        }}
                      >
                        {String(firstMeta[0])}: {String(firstMeta[1] ?? '').slice(0, 26)}
                      </text>
                    )}
                  </g>
                </g>
              );
            })}
          </g>
        </svg>

        {/* ==================== INLINE EDGE LABEL HTML OVERLAY ==================== */}
        {editingEdgeGeometry && (
          <div
            style={{
              position: 'absolute',
              left: editingEdgeGeometry.mx * viewport.zoom + viewport.x,
              top: editingEdgeGeometry.my * viewport.zoom + viewport.y,
              transform: 'translate(-50%, -50%)',
            }}
            className="z-30"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-900 border border-cyan-400 shadow-2xl">
              <Pencil className="w-3 h-3 text-cyan-400 shrink-0" />
              <input
                ref={labelInputRef}
                type="text"
                value={edgeLabelDraft}
                onChange={(e) => setEdgeLabelDraft(e.target.value)}
                onBlur={commitInlineLabel}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitInlineLabel();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setEditingEdgeId(null);
                  }
                }}
                placeholder="Relation (ex: confirme, a trahi)…"
                className="bg-transparent text-xs text-zinc-100 placeholder-zinc-500 outline-none min-w-[175px]"
              />
            </div>
          </div>
        )}

        {/* ==================== LINK MODE ACTIVE BANNER ==================== */}
        {(toolMode === 'link' || linkingWire) && (
          <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 px-3.5 py-1.5 rounded-full bg-cyan-950/90 border border-cyan-500/50 text-xs text-cyan-200 flex items-center gap-2 z-20">
            <Link2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>
              {linkingWire
                ? 'Glissez ou cliquez sur un nœud cible (ou lâchez dans le vide pour créer un nœud relié)'
                : 'Mode Liaison actif : cliquez ou glissez d’un nœud A vers un nœud B (Échap pour quitter)'}
            </span>
          </div>
        )}

        {/* ==================== EMPTY CANVAS OVERLAY ==================== */}
        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="px-6 py-4 rounded-2xl bg-zinc-900/85 border border-filet text-center max-w-sm shadow-2xl">
              <p className="text-sm font-medium text-zinc-200 mb-1">
                Graphe de constellation prêt
              </p>
              <p className="text-xs text-zinc-400">
                <strong className="text-cyan-400">Double-cliquez n'importe où</strong> sur le fond
                pour faire apparaître votre premier nœud.
              </p>
            </div>
          </div>
        )}

        {/* ==================== FLOATING CONSTELLATION DOCK (BOTTOM CENTER) ==================== */}
        <div
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 p-1.5 rounded-2xl bg-zinc-900/92 border border-filet shadow-2xl z-20"
        >
          <button
            type="button"
            onClick={() => {
              setToolMode('select');
              setLinkingWire(null);
            }}
            title="Mode Sélection & Déplacement (V) — Astuce : tirez l'anneau extérieur d'un nœud ou Shift+Glisser pour relier"
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors',
              toolMode === 'select'
                ? 'bg-zinc-800 text-zinc-100 border border-filet-fort'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            )}
          >
            <MousePointer2 className="w-3.5 h-3.5" />
            <span>Déplacer</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setToolMode((m) => (m === 'link' ? 'select' : 'link'));
              setLinkingWire(null);
            }}
            title="Mode Liaison rapide (L) — Cliquez Nœud A puis Nœud B"
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors',
              toolMode === 'link'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            )}
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>Relier</span>
          </button>

          <div className="h-4 w-px bg-zinc-800 mx-1" />

          {/* Live Obsidian-style Force Simulation Toggle */}
          <button
            type="button"
            onClick={() => setPhysicsActive((v) => !v)}
            title="Activer / figer la simulation physique élastique (style Obsidian Graph View)"
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors',
              physicsActive
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            )}
          >
            {physicsActive ? (
              <Pause className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            <span>Physique</span>
          </button>

          {/* 1-Click Organic Constellation Auto-Spacing */}
          <button
            type="button"
            onClick={() => void onOrganizeConstellation()}
            title="Espacer harmonieusement le graphe en constellation"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium text-zinc-400 hover:text-amber-300 hover:bg-zinc-800/50 transition-colors"
          >
            <Orbit className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Constellation</span>
          </button>

          <div className="h-4 w-px bg-zinc-800 mx-1" />

          {/* Zoom & Fit Controls */}
          <button
            type="button"
            onClick={() =>
              setViewport((prev) => ({
                ...prev,
                zoom: Math.max(0.16, prev.zoom / 1.25),
              }))
            }
            title="Dézoomer"
            className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          <span className="px-1.5 text-xs font-mono text-zinc-400 min-w-[42px] text-center">
            {Math.round(viewport.zoom * 100)}%
          </span>

          <button
            type="button"
            onClick={() =>
              setViewport((prev) => ({
                ...prev,
                zoom: Math.min(3.2, prev.zoom * 1.25),
              }))
            }
            title="Zoomer"
            className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => fitView(true)}
            title="Recentrer sur tout le graphe"
            className="p-1.5 rounded-xl text-zinc-400 hover:text-cyan-300 hover:bg-zinc-800/60"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* ==================== CONSTELLATION MINI-MAP (BOTTOM RIGHT) ==================== */}
        {miniMapData && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              const mx = e.clientX - rect.left;
              const my = e.clientY - rect.top;
              const wx = (mx - miniMapData.offsetX) / miniMapData.scale;
              const wy = (my - miniMapData.offsetY) / miniMapData.scale;
              centerOnPoint(wx, wy, viewport.zoom);
            }}
            title="Mini-carte de la constellation (cliquer pour déplacer la caméra)"
            className="hidden md:block absolute bottom-4 right-4 rounded-xl bg-zinc-900/90 border border-filet shadow-2xl overflow-hidden cursor-pointer z-20"
            style={{ width: miniMapData.MM_W, height: miniMapData.MM_H }}
          >
            <svg width={miniMapData.MM_W} height={miniMapData.MM_H}>
              {edges.map((e) => {
                if (!e?.id) return null;
                const s = nodes.find((n) => n?.id === e.sourceNodeId);
                const t = nodes.find((n) => n?.id === e.targetNodeId);
                if (!s || !t) return null;
                const ps = getNodePos(s);
                const pt = getNodePos(t);
                return (
                  <line
                    key={e.id}
                    x1={ps.x * miniMapData.scale + miniMapData.offsetX}
                    y1={ps.y * miniMapData.scale + miniMapData.offsetY}
                    x2={pt.x * miniMapData.scale + miniMapData.offsetX}
                    y2={pt.y * miniMapData.scale + miniMapData.offsetY}
                    stroke="var(--filet-fort)"
                    strokeWidth={0.8}
                  />
                );
              })}

              {nodes.map((n) => {
                if (!n?.id) return null;
                const p = getNodePos(n);
                const cat = n.categoryId ? categoryMap.get(n.categoryId) : null;
                return (
                  <rect
                    key={n.id}
                    x={p.x * miniMapData.scale + miniMapData.offsetX - (n.id === selectedNodeId ? 3.5 : 2.5)}
                    y={p.y * miniMapData.scale + miniMapData.offsetY - (n.id === selectedNodeId ? 3.5 : 2.5)}
                    width={n.id === selectedNodeId ? 7 : 5}
                    height={n.id === selectedNodeId ? 7 : 5}
                    fill={cat?.color ?? 'var(--texte)'}
                  />
                );
              })}

              <rect
                x={miniMapData.vpRect.x}
                y={miniMapData.vpRect.y}
                width={Math.max(8, miniMapData.vpRect.w)}
                height={Math.max(6, miniMapData.vpRect.h)}
                fill="color-mix(in oklab, var(--accent) 8%, transparent)"
                stroke="var(--accent-fort)"
                strokeWidth={1}
              />
            </svg>
          </div>
        )}

        {/* Quick Halo Hint Pill (Bottom Left) */}
        <div className="hidden xl:flex items-center gap-1.5 absolute bottom-4 left-4 px-3 py-1.5 rounded-xl bg-zinc-900/80 border border-filet/80 text-xs text-zinc-400 pointer-events-none z-10">
          <span className="text-cyan-400 shrink-0">▸</span>
          <span>
            Tirez <strong className="text-zinc-200">le cadre autour d'un nœud</strong> (ou{' '}
            <strong className="text-zinc-200">Shift + glisser</strong>) pour relier
          </span>
        </div>
      </div>
    );
  }
);
