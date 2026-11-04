import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SVGProps,
} from 'react';
import {
  Check,
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
import { describeReliability } from '@shared/types';
import { getCategoryIcon } from '@/lib/icons';
import { cardEntries } from '@/lib/metadata';
import { cn } from '@/lib/utils';
import { useViewport } from '@/hooks/useViewport';
import { computeEdgeGeometry, edgeLabelHalfSize } from '@/lib/edgeGeometry';
import { usePhysicsSimulation } from '@/hooks/usePhysicsSimulation';
import {
  circleRadius,
  clampFinite,
  nodeHalf,
  shapeExtent,
  shapePoints,
  type Viewport,
} from '@/lib/canvasGeometry';

export interface GraphCanvasHandle {
  fitView: (animated?: boolean) => void;
  centerOnPoint: (worldX: number, worldY: number, targetZoom?: number) => void;
  getViewportCenter: () => { x: number; y: number };
  /** Moves nodes on screen at once (undo/redo), even while the live physics runs */
  setNodePositions: (positions: Array<{ id: string; positionX: number; positionY: number }>) => void;
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

interface PendingDelete {
  kind: 'node' | 'edge' | 'nodes';
  id: string;
  label: string;
  /** For 'nodes': the multiple selection being deleted */
  ids?: string[];
}

type Positions = Array<{ id: string; positionX: number; positionY: number }>;

interface GraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  categories: Category[];
  selectedNodeId: string | null;
  /** Multiple selection (two nodes or more); empty otherwise */
  selectedNodeIds: Set<string>;
  selectedEdgeId: string | null;
  autoEditEdgeId: string | null;
  searchQuery: string;
  searchMatchIds: Set<string>;
  onSelectNode: (nodeId: string | null) => void;
  onSelectEdge: (edgeId: string | null) => void;
  /** Replaces the selection: none, one node, or a multiple selection */
  onSelectNodes: (nodeIds: string[]) => void;
  onCreateNodeAt: (worldX: number, worldY: number) => Promise<GraphNode | null>;
  onCreateEdge: (sourceNodeId: string, targetNodeId: string) => Promise<void>;
  onCreateLinkedNodeAt: (
    sourceNodeId: string,
    worldX: number,
    worldY: number
  ) => Promise<void>;
  /** `from` is where the drag started, used as the undo position */
  onUpdateNodePosition: (
    nodeId: string,
    x: number,
    y: number,
    from?: { x: number; y: number }
  ) => Promise<void>;
  /** A label makes the move undoable; `from` is where a group drag started */
  onUpdateBatchPositions: (positions: Positions, historyLabel?: string, from?: Positions) => Promise<void>;
  onCommitEdgeLabel: (edgeId: string, label: string) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<unknown>;
  onDeleteNodes: (nodeIds: string[]) => Promise<unknown>;
  onDeleteEdge: (edgeId: string) => Promise<unknown>;
  onOrganizeConstellation: () => Promise<void>;
  /** Moves a node to another category (null: unclassified) */
  onChangeNodeCategory: (nodeId: string, categoryId: string | null) => void;
}

// Draws a node shape (or a ring around it) centred on 0,0
function ShapeOutline({
  shape,
  half,
  children,
  ...props
}: {
  shape: CategoryShape | undefined;
  half: number;
  children?: ReactNode;
} & SVGProps<SVGPolygonElement> & SVGProps<SVGCircleElement>) {
  if (shape === 'circle') {
    return (
      <circle r={circleRadius(half)} {...(props as SVGProps<SVGCircleElement>)}>
        {children}
      </circle>
    );
  }
  return (
    <polygon
      points={shapePoints(shape, half)}
      strokeLinejoin="miter"
      {...(props as SVGProps<SVGPolygonElement>)}
    >
      {children}
    </polygon>
  );
}

function renderNodeShape(
  shape: CategoryShape | undefined,
  r: number,
  fill: string,
  stroke: string,
  strokeWidth: number
) {
  return (
    <ShapeOutline
      shape={shape}
      half={nodeHalf(r)}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
    />
  );
}

export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(
  function GraphCanvas(
    {
      nodes,
      edges,
      categories,
      onChangeNodeCategory,
      selectedNodeId,
      selectedNodeIds,
      selectedEdgeId,
      autoEditEdgeId,
      searchQuery,
      searchMatchIds,
      onSelectNode,
      onSelectEdge,
      onSelectNodes,
      onCreateNodeAt,
      onCreateEdge,
      onCreateLinkedNodeAt,
      onUpdateNodePosition,
      onUpdateBatchPositions,
      onCommitEdgeLabel,
      onDeleteNode,
      onDeleteNodes,
      onDeleteEdge,
      onOrganizeConstellation,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);

    const {
      viewport,
      viewportRef,
      setViewport,
      screenToWorld,
      animateViewportTo,
      centerOnPoint,
      getViewportCenter,
    } = useViewport(containerRef);

    // Live node positions during drag or physics simulation
    const [livePositions, setLivePositions] = useState<Map<string, { x: number; y: number }>>(
      () => new Map()
    );

    // Interaction tool mode: 'select' (move + halo link) or 'link' (click/drag node A -> node B)
    const [toolMode, setToolMode] = useState<'select' | 'link'>('select');
    const [physicsActive, setPhysicsActive] = useState(false);
    const physicsActiveRef = useRef(physicsActive);
    physicsActiveRef.current = physicsActive;
    // Set when a group drag moved, so the click that ends it keeps the group selected
    const dragMovedRef = useRef(false);

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
      /** Latest position under the cursor; the live physics reads it every frame */
      x?: number;
      y?: number;
      /** Other nodes of the multiple selection, moved by the same amount */
      group?: Array<{ id: string; startX: number; startY: number }>;
    } | null>(null);

    // Shift+drag on the background draws a selection box (container pixels)
    const [selectionBox, setSelectionBox] = useState<{
      x0: number;
      y0: number;
      x1: number;
      y1: number;
    } | null>(null);
    const selectionBoxRef = useRef(selectionBox);
    selectionBoxRef.current = selectionBox;
    // The click that ends a box selection must not clear it
    const suppressBackgroundClickRef = useRef(false);

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

    // Shape of each node, from its category (for drawing and for clipping links)
    const nodeShapes = useMemo(() => {
      const m = new Map<string, CategoryShape | undefined>();
      for (const n of nodes) {
        if (n?.id) m.set(n.id, n.categoryId ? categoryMap.get(n.categoryId)?.shape : undefined);
      }
      return m;
    }, [nodes, categoryMap]);
    const getNodeShape = useCallback((nodeId: string) => nodeShapes.get(nodeId), [nodeShapes]);

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

    // Filled once the physics hook exists (below): a programmatic move also updates the
    // simulation's own coordinates, then wakes it
    const wakePhysicsRef = useRef<(() => void) | null>(null);
    const setSimulationPositionsRef = useRef<
      ((positions: Array<{ id: string; positionX: number; positionY: number }>) => void) | null
    >(null);

    useImperativeHandle(
      ref,
      () => ({
        fitView,
        centerOnPoint,
        getViewportCenter,
        setNodePositions: (positions) => {
          setLivePositions((prev) => {
            const next = new Map(prev);
            for (const p of positions) {
              next.set(p.id, { x: clampFinite(p.positionX, 0), y: clampFinite(p.positionY, 0) });
            }
            return next;
          });
          setSimulationPositionsRef.current?.(positions);
          wakePhysicsRef.current?.();
        },
      }),
      [fitView, centerOnPoint, getViewportCenter]
    );

    // Keyboard deletion is never immediate: Delete/Backspace asks first, then
    // Enter (or Delete/Backspace again) confirms and Escape cancels
    const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

    // A confirmation only applies to the item that was selected when it was asked
    useEffect(() => {
      setPendingDelete(null);
    }, [selectedNodeId, selectedEdgeId, selectedNodeIds]);

    const requestDeleteSelection = useCallback(() => {
      if (selectedNodeIds.size >= 2) {
        setPendingDelete({
          kind: 'nodes',
          id: '',
          label: String(selectedNodeIds.size),
          ids: [...selectedNodeIds],
        });
      } else if (selectedNodeId) {
        const node = nodes.find((n) => n.id === selectedNodeId);
        setPendingDelete({
          kind: 'node',
          id: selectedNodeId,
          label: node?.title || 'Sans titre',
        });
      } else if (selectedEdgeId) {
        const edge = edges.find((e) => e.id === selectedEdgeId);
        setPendingDelete({ kind: 'edge', id: selectedEdgeId, label: edge?.label ?? '' });
      }
    }, [selectedNodeId, selectedNodeIds, selectedEdgeId, nodes, edges]);

    // Category menu opened by a right click (without dragging) on a node, in container pixels
    const [nodeMenu, setNodeMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);

    // Selecting another node or a link closes the menu (nodes stop mousedown from bubbling)
    useEffect(() => {
      setNodeMenu((menu) => (menu && menu.nodeId !== selectedNodeId ? null : menu));
    }, [selectedNodeId]);

    const pickCategory = useCallback(
      (nodeId: string, categoryId: string | null) => {
        setNodeMenu(null);
        const node = nodes.find((n) => n.id === nodeId);
        if (node && node.categoryId !== categoryId) onChangeNodeCategory(nodeId, categoryId);
      },
      [nodes, onChangeNodeCategory]
    );

    const confirmPendingDelete = useCallback(() => {
      if (!pendingDelete) return;
      setPendingDelete(null);
      if (pendingDelete.kind === 'nodes') void onDeleteNodes(pendingDelete.ids ?? []);
      else if (pendingDelete.kind === 'node') void onDeleteNode(pendingDelete.id);
      else void onDeleteEdge(pendingDelete.id);
    }, [pendingDelete, onDeleteNode, onDeleteNodes, onDeleteEdge]);

    // Keyboard shortcuts: V (Select/Move), L (Link tool), Escape (cancel link/deselect),
    // Delete/Backspace (ask to remove the selection)
    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
          return;
        }

        if (nodeMenu && e.key === 'Escape') {
          e.preventDefault();
          setNodeMenu(null);
          return;
        }

        if (pendingDelete) {
          // Enter on a focused button (e.g. "Annuler") activates that button, not the shortcut
          if (e.key === 'Enter' && tag === 'BUTTON') return;
          if (e.key === 'Enter' || e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            confirmPendingDelete();
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            setPendingDelete(null);
            return;
          }
        }

        if (e.key === 'v' || e.key === 'V') {
          setToolMode('select');
          setLinkingWire(null);
        } else if (e.key === 'l' || e.key === 'L') {
          setToolMode((m) => (m === 'link' ? 'select' : 'link'));
          setLinkingWire(null);
        } else if (e.key === 'Escape') {
          setLinkingWire(null);
          setToolMode('select');
          if (selectedNodeIds.size > 0) onSelectNodes([]);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          if (selectedNodeId || selectedEdgeId || selectedNodeIds.size >= 2) {
            e.preventDefault();
            requestDeleteSelection();
          }
        }
      };

      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }, [
      selectedNodeId,
      selectedNodeIds,
      onSelectNodes,
      selectedEdgeId,
      pendingDelete,
      requestDeleteSelection,
      confirmPendingDelete,
      setLinkingWire,
      nodeMenu,
    ]);

    const livePositionsRef = useRef(livePositions);
    livePositionsRef.current = livePositions;

    // Live Obsidian-style force physics (when toggled ON); sleeps once the graph settles
    const { physicsSettled, wakePhysics, setSimulationPositions } = usePhysicsSimulation({
      active: physicsActive,
      nodes,
      edges,
      draggedNodeIdRef: dragNodeRef,
      livePositionsRef,
      setLivePositions,
      onUpdateBatchPositions,
    });
    wakePhysicsRef.current = wakePhysics;
    setSimulationPositionsRef.current = setSimulationPositions;

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
        // 0. Drawing a selection box
        if (selectionBoxRef.current) {
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect) {
            const box = selectionBoxRef.current;
            setSelectionBox({ ...box, x1: e.clientX - rect.left, y1: e.clientY - rect.top });
          }
          return;
        }

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
            // Dragging a node disturbs a settled simulation
            wakePhysics();
          }
          const nid = dragNodeRef.current.nodeId;
          dragNodeRef.current.x = nx;
          dragNodeRef.current.y = ny;
          const group = dragNodeRef.current.group ?? [];
          const dx = nx - dragNodeRef.current.startX;
          const dy = ny - dragNodeRef.current.startY;
          setLivePositions((prev) => {
            const next = new Map(prev);
            next.set(nid, { x: nx, y: ny });
            for (const g of group) next.set(g.id, { x: g.startX + dx, y: g.startY + dy });
            return next;
          });
          // With live physics, the simulation follows the rest of the group too
          if (group.length > 0 && physicsActiveRef.current) {
            setSimulationPositionsRef.current?.(
              group.map((g) => ({ id: g.id, positionX: g.startX + dx, positionY: g.startY + dy }))
            );
          }
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
        const box = selectionBoxRef.current;
        if (box) {
          setSelectionBox(null);
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect && Math.hypot(box.x1 - box.x0, box.y1 - box.y0) > 4) {
            suppressBackgroundClickRef.current = true;
            const a = screenToWorld(rect.left + Math.min(box.x0, box.x1), rect.top + Math.min(box.y0, box.y1));
            const b = screenToWorld(rect.left + Math.max(box.x0, box.x1), rect.top + Math.max(box.y0, box.y1));
            const inside = nodes
              .filter((n) => {
                const p = livePositionsRef.current.get(n.id) ?? { x: n.positionX, y: n.positionY };
                return p.x >= a.x && p.x <= b.x && p.y >= a.y && p.y <= b.y;
              })
              .map((n) => n.id);
            onSelectNodes(inside);
          }
          return;
        }

        if (panStateRef.current?.active) {
          const moved = panStateRef.current.moved;
          panStateRef.current = null;
          if (!moved && e.button === 0 && linkingWireRef.current?.isClickLink) {
            setLinkingWire(null);
          }
          return;
        }

        if (dragNodeRef.current) {
          const { nodeId, moved, startX, startY, group } = dragNodeRef.current;
          dragNodeRef.current = null;
          dragMovedRef.current = moved && Boolean(group?.length);
          if (moved && group && group.length > 0) {
            // A group move is saved and undone as one step
            const round = (v: number) => Math.round(v * 100) / 100;
            const ids = [nodeId, ...group.map((g) => g.id)];
            const after = ids.flatMap((id) => {
              const p = livePositionsRef.current.get(id);
              return p && Number.isFinite(p.x) && Number.isFinite(p.y)
                ? [{ id, positionX: round(p.x), positionY: round(p.y) }]
                : [];
            });
            const before = [
              { id: nodeId, positionX: round(startX), positionY: round(startY) },
              ...group.map((g) => ({ id: g.id, positionX: round(g.startX), positionY: round(g.startY) })),
            ];
            void onUpdateBatchPositions(after, `Déplacement de ${ids.length} nœuds`, before);
            return;
          }
          if (moved) {
            const finalPos = livePositionsRef.current.get(nodeId);
            if (finalPos && Number.isFinite(finalPos.x) && Number.isFinite(finalPos.y)) {
              void onUpdateNodePosition(
                nodeId,
                Math.round(finalPos.x * 100) / 100,
                Math.round(finalPos.y * 100) / 100,
                { x: Math.round(startX * 100) / 100, y: Math.round(startY * 100) / 100 }
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
        // Ignore micro-clicks (< 10px) on the halo ring so a click or double-click on a node never fires a link.
        // A right click without dragging opens the node's category menu instead.
        if (dragDist < 10) {
          if (e.button === 2) {
            const rect = containerRef.current?.getBoundingClientRect();
            onSelectEdge(null);
            onSelectNode(curr.sourceId);
            setNodeMenu({
              nodeId: curr.sourceId,
              x: e.clientX - (rect?.left ?? 0),
              y: e.clientY - (rect?.top ?? 0),
            });
          }
          return;
        }

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
    const renderedEdges = useMemo(
      () => computeEdgeGeometry(nodes, edges, getNodePos, getNodeRadius, getNodeShape),
      [nodes, edges, getNodePos, getNodeRadius, getNodeShape]
    );

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

    // Directed links leaving and reaching the selected node (for the legend)
    const selectedDirections = useMemo(() => {
      let outgoing = 0;
      let incoming = 0;
      if (selectedNodeId) {
        for (const e of edges) {
          if (!e.directed) continue;
          if (e.sourceNodeId === selectedNodeId) outgoing++;
          else if (e.targetNodeId === selectedNodeId) incoming++;
        }
      }
      return { outgoing, incoming };
    }, [edges, selectedNodeId]);

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
        onMouseDownCapture={() => {
          // SVG elements do not take focus: leave a field of the inspector or the toolbar so the
          // canvas shortcuts (V, L, Delete) apply instead of typing into that field.
          // Capture phase, because nodes and labels stop the event from bubbling.
          const active = document.activeElement;
          if (active instanceof HTMLElement && !containerRef.current?.contains(active)) active.blur();
        }}
        onMouseDown={(e) => {
          setNodeMenu(null);
          // Shift+drag on the background draws a selection box
          if (isCanvasBackground(e.target) && e.button === 0 && e.shiftKey && toolMode === 'select') {
            const rect = containerRef.current?.getBoundingClientRect();
            if (rect) {
              const x = e.clientX - rect.left;
              const y = e.clientY - rect.top;
              setSelectionBox({ x0: x, y0: y, x1: x, y1: y });
            }
            return;
          }
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
          if (suppressBackgroundClickRef.current) {
            suppressBackgroundClickRef.current = false;
            return;
          }
          if (isCanvasBackground(e.target)) {
            if (!panStateRef.current?.moved) {
              onSelectNodes([]);
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
            {renderedEdges.map(({ edge, pathD, mx, my, arrowPoints, midArrowPoints }) => {
              const isSelected = edge.id === selectedEdgeId;
              const isHovered = edge.id === hoveredEdgeId;
              const isDashed = edge.style === 'dashed';
              const isIncidentSpotlight = spotlightEdges?.has(edge.id) ?? false;
              const labelText = String(edge.label ?? '');

              // Links of the selected node: outgoing and incoming in two colours of the same
              // family, so the direction of every relation reads at a glance
              const relation = !selectedNodeId
                ? null
                : edge.sourceNodeId === selectedNodeId
                  ? edge.directed
                    ? 'outgoing'
                    : 'linked'
                  : edge.targetNodeId === selectedNodeId
                    ? edge.directed
                      ? 'incoming'
                      : 'linked'
                    : null;
              // Moving dashes show the direction of the link being looked at
              const showFlow = edge.directed && (isSelected || isHovered || relation !== null);

              const isDimmed =
                (spotlightEdges !== null && !isIncidentSpotlight && !isSelected) ||
                (hasSearch &&
                  !searchMatchIds.has(edge.sourceNodeId) &&
                  !searchMatchIds.has(edge.targetNodeId));

              // A custom colour stays visible when the link is selected or hovered; the
              // direction colours of a selected node take over, then fall back to it
              const customColor = edge.color ?? null;
              const strokeColor =
                relation === 'incoming'
                  ? 'var(--lien-entrant)'
                  : relation !== null
                    ? 'var(--lien-sortant)'
                    : customColor
                      ? customColor
                      : isSelected
                        ? 'var(--accent-fort)'
                        : isIncidentSpotlight || isHovered
                          ? 'var(--accent)'
                          : 'var(--filet-fort)';

              const strokeWidth =
                isSelected || isHovered
                  ? 2.4
                  : relation !== null
                    ? 2.2
                    : isIncidentSpotlight
                      ? 2.0
                      : 1.45;

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

                  {/* Moving dashes along the direction of the link */}
                  {showFlow && (
                    <path
                      d={pathD}
                      fill="none"
                      stroke="var(--surface-puits)"
                      strokeWidth={Math.max(1, strokeWidth - 1)}
                      className="graphax-edge-flow pointer-events-none"
                    />
                  )}

                  {/* Direction: arrow along the link and arrowhead at the target */}
                  {edge.directed && (
                    <>
                      {midArrowPoints && (
                        <polygon
                          points={midArrowPoints}
                          fill={strokeColor}
                          className="pointer-events-none"
                        />
                      )}
                      <polygon points={arrowPoints} fill={strokeColor} />
                    </>
                  )}

                  {/* Clean Midpoint Edge Label */}
                  {editingEdgeId !== edge.id && (labelText || isSelected || isHovered) && (
                    <g transform={`translate(${mx.toFixed(1)}, ${my.toFixed(1)})`}>
                      {labelText ? (
                        <>
                          <rect
                            x={-edgeLabelHalfSize(labelText).halfWidth}
                            y={-edgeLabelHalfSize(labelText).halfHeight}
                            width={edgeLabelHalfSize(labelText).halfWidth * 2}
                            height={edgeLabelHalfSize(labelText).halfHeight * 2}
                            fill="var(--surface-puits)"
                            stroke={
                              isSelected
                                ? 'var(--accent-fort)'
                                : (customColor ?? 'var(--filet)')
                            }
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
                            x={-edgeLabelHalfSize('').halfWidth}
                            y={-edgeLabelHalfSize('').halfHeight}
                            width={edgeLabelHalfSize('').halfWidth * 2}
                            height={edgeLabelHalfSize('').halfHeight * 2}
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
                      const halfBox = snapNode
                        ? shapeExtent(getNodeShape(snapNode.id), nodeHalf(getNodeRadius(snapNode.id))) + 7
                        : 5;
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

              const isSelected = node.id === selectedNodeId || selectedNodeIds.has(node.id);
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

              // Empty fields (a category's default keys not filled yet) are not details
              const metaEntries = Object.entries(nodeMeta).filter(([, v]) => String(v ?? '').trim());
              const hasDetails = nodeContent.trim().length > 0 || metaEntries.length > 0;
              // Values chosen in the category for the card, then the first other value on hover
              const card = cardEntries(cat, nodeMeta);
              const cardLine = card.map((e) => e.value).join(' · ');
              const shownKeys = new Set(card.map((e) => e.key));
              const firstMeta = metaEntries.find(([k]) => !shownKeys.has(k));

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
                    <ShapeOutline
                      shape={cat?.shape}
                      half={nodeHalf(r) + 8}
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
                    </ShapeOutline>
                  )}

                  {/* Subtle dashed visual ring when hovered */}
                  {(isHovered || isHaloHovered || isLinkSource) && (
                    <ShapeOutline
                      shape={cat?.shape}
                      half={nodeHalf(r) + 9}
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
                    <ShapeOutline
                      shape={cat?.shape}
                      half={nodeHalf(r) + 4.5}
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
                      // (the whole multiple selection when the node belongs to it)
                      if (e.button === 0) {
                        const world = screenToWorld(e.clientX, e.clientY);
                        const group = selectedNodeIds.has(node.id)
                          ? nodes
                              .filter((n) => n.id !== node.id && selectedNodeIds.has(n.id))
                              .map((n) => {
                                const p = getNodePos(n);
                                return { id: n.id, startX: p.x, startY: p.y };
                              })
                          : undefined;
                        dragNodeRef.current = {
                          nodeId: node.id,
                          offsetX: world.x - pos.x,
                          offsetY: world.y - pos.y,
                          startX: pos.x,
                          startY: pos.y,
                          moved: false,
                          group,
                        };
                      }
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (toolMode === 'link') return;
                      // Ctrl+click (Cmd on Mac) adds the node to the selection, or removes it
                      if (e.ctrlKey || e.metaKey) {
                        const current =
                          selectedNodeIds.size > 0
                            ? [...selectedNodeIds]
                            : selectedNodeId
                              ? [selectedNodeId]
                              : [];
                        onSelectNodes(
                          current.includes(node.id)
                            ? current.filter((id) => id !== node.id)
                            : [...current, node.id]
                        );
                        return;
                      }
                      // A plain click on a node of the group after dragging it keeps the group
                      if (selectedNodeIds.has(node.id) && dragMovedRef.current) {
                        dragMovedRef.current = false;
                        return;
                      }
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

                    {/* Reliability badge (Admiralty code, A3) on the top-left corner */}
                    {node.reliability && (
                      <g
                        transform={`translate(${-nodeHalf(r) - 6}, ${-nodeHalf(r) - 7})`}
                        aria-label={`Fiabilité ${node.reliability}`}
                      >
                        <title>{`Fiabilité ${node.reliability} : ${describeReliability(node.reliability) ?? ''}`}</title>
                        <rect
                          x={-11}
                          y={-7}
                          width={22}
                          height={14}
                          fill="var(--surface-puits)"
                          stroke={color}
                          strokeWidth={1.2}
                        />
                        <text
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize={9}
                          fontFamily="var(--font-mono, ui-monospace, monospace)"
                          fill="var(--texte-fort)"
                        >
                          {node.reliability}
                        </text>
                      </g>
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

                    {/* Card values chosen in the category, always shown */}
                    {cardLine && (
                      <text
                        y={15}
                        textAnchor="middle"
                        fill={color}
                        fontSize={12}
                        fontFamily="var(--font-mono)"
                        style={{
                          paintOrder: 'stroke',
                          stroke: 'var(--surface-puits)',
                          strokeWidth: 4,
                        }}
                      >
                        <title>{card.map((e) => `${e.key} : ${e.value}`).join('\n')}</title>
                        {cardLine.length > 34 ? `${cardLine.slice(0, 32)}…` : cardLine}
                      </text>
                    )}

                    {/* Subtle tactical subtitle on hover/selection if metadata exists */}
                    {firstMeta && (isHovered || isSelected) && (
                      <text
                        y={cardLine ? 30 : 15}
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

        {/* ==================== DIRECTION LEGEND (SELECTED NODE) ==================== */}
        {selectedDirections.outgoing + selectedDirections.incoming > 0 && (
          <div
            aria-label="Sens des liens du nœud sélectionné"
            className="pointer-events-none absolute top-3 left-3 flex items-center gap-3 px-3 py-1.5 bg-zinc-900/90 border border-filet text-xs text-zinc-300 z-10"
          >
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-0.5" style={{ background: 'var(--lien-sortant)' }} />
              Sortants ({selectedDirections.outgoing})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-0.5" style={{ background: 'var(--lien-entrant)' }} />
              Entrants ({selectedDirections.incoming})
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

        {/* ==================== KEYBOARD DELETE CONFIRMATION (TOP CENTER) ==================== */}
        {nodeMenu && (() => {
          const menuNode = nodes.find((n) => n.id === nodeMenu.nodeId);
          if (!menuNode) return null;
          const rect = containerRef.current?.getBoundingClientRect();
          // Keep the menu inside the canvas; a long list scrolls instead of being cut
          const maxHeight = Math.max(120, (rect?.height ?? 0) - 16);
          const height = Math.min(maxHeight, (categories.length + 2) * 30 + 40);
          const left = Math.min(nodeMenu.x, (rect?.width ?? 0) - 236);
          const top = Math.min(nodeMenu.y, (rect?.height ?? 0) - height - 8);
          const item = (categoryId: string | null, label: string, color: string) => {
            const current = menuNode.categoryId === categoryId;
            return (
              <button
                key={categoryId ?? 'none'}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                onClick={() => pickCategory(menuNode.id, categoryId)}
                className={cn(
                  'w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors',
                  current ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-300 hover:bg-zinc-800/70'
                )}
              >
                <span className="w-2.5 h-2.5 shrink-0" style={{ background: color }} aria-hidden="true" />
                <span className="flex-1 truncate">{label}</span>
                {current && <Check className="w-3 h-3 text-cyan-300 shrink-0" aria-hidden="true" />}
              </button>
            );
          };
          return (
            <div
              role="menu"
              aria-label="Changer la catégorie"
              data-canvas-scrollable=""
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.preventDefault()}
              style={{ left: Math.max(8, left), top: Math.max(8, top), maxHeight }}
              className="absolute z-30 w-56 py-1 overflow-y-auto rounded-xl bg-zinc-900 border border-filet-fort shadow-2xl"
            >
              <p className="px-2.5 pt-1 pb-1.5 text-[11px] uppercase tracking-wider text-zinc-500 truncate">
                Catégorie de « {String(menuNode.title ?? '')} »
              </p>
              {categories.map((c) => item(c.id, c.name, c.color))}
              <div className="my-1 border-t border-filet" />
              {item(null, 'Non classé', 'var(--etat-clos)')}
            </div>
          );
        })()}

        {selectionBox && (
          <div
            aria-hidden="true"
            className="absolute pointer-events-none border border-cyan-400/80 bg-cyan-400/10 rounded-sm z-20"
            style={{
              left: Math.min(selectionBox.x0, selectionBox.x1),
              top: Math.min(selectionBox.y0, selectionBox.y1),
              width: Math.abs(selectionBox.x1 - selectionBox.x0),
              height: Math.abs(selectionBox.y1 - selectionBox.y0),
            }}
          />
        )}

        {pendingDelete && (
          <div
            role="alertdialog"
            aria-labelledby="graphax-delete-confirm-title"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-zinc-900/95 border border-rose-500/40 shadow-2xl z-30 max-w-[calc(100%-2rem)]"
          >
            <p id="graphax-delete-confirm-title" className="text-xs text-zinc-200 min-w-0">
              {pendingDelete.kind === 'nodes' ? (
                <>
                  Supprimer les <strong className="text-zinc-50">{pendingDelete.label} nœuds</strong>{' '}
                  sélectionnés et tous leurs liens ?
                </>
              ) : pendingDelete.kind === 'node' ? (
                <>
                  Supprimer le nœud{' '}
                  <strong className="text-zinc-50 break-words">« {pendingDelete.label} »</strong> et
                  tous ses liens ?
                </>
              ) : pendingDelete.label ? (
                <>
                  Supprimer le lien{' '}
                  <strong className="text-zinc-50 break-words">« {pendingDelete.label} »</strong> ?
                </>
              ) : (
                <>Supprimer ce lien ?</>
              )}
              <span className="block text-[11px] text-zinc-400 mt-0.5">
                Entrée pour confirmer, Échap pour annuler.
              </span>
            </p>
            <button
              type="button"
              autoFocus
              onClick={confirmPendingDelete}
              className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-600 text-white hover:bg-rose-500"
            >
              Supprimer
            </button>
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              className="shrink-0 text-xs text-zinc-400 hover:text-zinc-200"
            >
              Annuler
            </button>
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
            title={
              physicsActive && physicsSettled
                ? 'Simulation stable : en pause automatique jusqu’au prochain déplacement. Cliquer pour la désactiver.'
                : 'Activer / figer la simulation physique élastique (style Obsidian Graph View)'
            }
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
