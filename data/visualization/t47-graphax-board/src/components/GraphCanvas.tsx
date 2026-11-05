import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  Check,
  Link2,
  Pencil,
} from 'lucide-react';
import type { Category, CategoryShape, GraphEdge, GraphNode } from '@shared/types';
import { buildGraphSvg } from '@/lib/graphImage';
import { CanvasDock } from './canvas/CanvasDock';
import { DeleteConfirmBar, type PendingDelete } from './canvas/DeleteConfirmBar';
import { EdgeView } from './canvas/EdgeView';
import { MiniMap } from './canvas/MiniMap';
import { NodeCategoryMenu } from './canvas/NodeCategoryMenu';
import { NodeView } from './canvas/NodeView';
import { cn } from '@/lib/utils';
import { useViewport } from '@/hooks/useViewport';
import { computeEdgeGeometry } from '@/lib/edgeGeometry';
import { usePhysicsSimulation } from '@/hooks/usePhysicsSimulation';
import {
  clampFinite,
  nodeHalf,
  shapeExtent,
  type Viewport,
} from '@/lib/canvasGeometry';

export interface GraphCanvasHandle {
  fitView: (animated?: boolean) => void;
  centerOnPoint: (worldX: number, worldY: number, targetZoom?: number) => void;
  getViewportCenter: () => { x: number; y: number };
  /** Current framing (pan and zoom), for saved views (V4) */
  getViewport: () => { x: number; y: number; zoom: number };
  /** Moves the framing to a saved one, animated */
  showViewport: (target: { x: number; y: number; zoom: number }) => void;
  /** Moves nodes on screen at once (undo/redo), even while the live physics runs */
  setNodePositions: (positions: Array<{ id: string; positionX: number; positionY: number }>) => void;
  /** The whole graph as a standalone SVG (A6), or null when it is empty */
  exportSvg: () => string | null;
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
    // The group moved by the camera: it holds the whole graph (picture export)
    const contentRef = useRef<SVGGElement>(null);

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
        getViewport: () => ({ ...viewportRef.current }),
        showViewport: (target) =>
          animateViewportTo({ x: target.x, y: target.y, zoom: clampFinite(target.zoom, 1, 0.16, 3.2) }),
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
        exportSvg: () => {
          if (!svgRef.current || !contentRef.current || !containerRef.current) return null;
          const background = getComputedStyle(containerRef.current).backgroundColor || '#0b0b0d';
          return buildGraphSvg(svgRef.current, contentRef.current, background);
        },
      }),
      [fitView, centerOnPoint, getViewportCenter, animateViewportTo, viewportRef]
    );

    // Keyboard deletion is never immediate: Delete/Backspace asks first, then
    // Enter (or Delete/Backspace again) confirms and Escape cancels
    const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

    // A confirmation only applies to the item that was selected when it was asked. The
    // multiple selection is compared by content: the set is rebuilt whenever the nodes change
    // (a saved position, for instance), which must not dismiss the confirmation.
    const selectionKey = [...selectedNodeIds].sort().join(',');
    useEffect(() => {
      setPendingDelete(null);
    }, [selectedNodeId, selectedEdgeId, selectionKey]);

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
        // No shortcuts while the canvas is hidden (table or timeline view)
        if (!containerRef.current?.offsetParent) return;
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

    // ---- Pointer handlers given to the node and link components (O6) ----

    const hoverEdge = useCallback((edgeId: string, hovered: boolean) => {
      setHoveredEdgeId((curr) => (hovered ? edgeId : curr === edgeId ? null : curr));
    }, []);

    const selectEdgeOnCanvas = useCallback(
      (edgeId: string) => {
        onSelectNode(null);
        onSelectEdge(edgeId);
      },
      [onSelectNode, onSelectEdge]
    );

    const startEdgeLabelEdit = useCallback(
      (edgeId: string, label: string) => {
        setEditingEdgeId(edgeId);
        setEdgeLabelDraft(label);
      },
      [setEditingEdgeId]
    );

    const hoverNode = (nodeId: string, hovered: boolean) => {
      if (hovered) {
        setHoveredNodeId(nodeId);
        return;
      }
      setHoveredNodeId((curr) => (curr === nodeId ? null : curr));
      setHoveredHaloNodeId((curr) => (curr === nodeId ? null : curr));
    };

    const hoverHalo = (nodeId: string, hovered: boolean) =>
      setHoveredHaloNodeId((curr) => (hovered ? nodeId : curr === nodeId ? null : curr));

    const selectNodeOnCanvas = (nodeId: string) => {
      onSelectEdge(null);
      onSelectNode(nodeId);
    };

    const startWireFromNode = (node: GraphNode, clientX: number, clientY: number, isClick = false) => {
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

    const handleNodeDoubleClick = (e: ReactMouseEvent, node: GraphNode) => {
      // A double click on a node never creates another node underneath it
      e.stopPropagation();
      dragNodeRef.current = null;
      setLinkingWire(null);
      onSelectEdge(null);
      onSelectNode(node.id);
      const pos = getNodePos(node);
      centerOnPoint(pos.x, pos.y, Math.max(viewportRef.current.zoom, 1.25));
    };

    const handleHaloMouseDown = (e: ReactMouseEvent, node: GraphNode) => {
      e.stopPropagation();
      if (e.button === 0 || e.button === 2) startWireFromNode(node, e.clientX, e.clientY, false);
    };

    const handleNodeMouseDown = (e: ReactMouseEvent, node: GraphNode) => {
      e.stopPropagation();

      // Second click of a two-click link
      const activeWire = linkingWireRef.current;
      if (activeWire?.isClickLink && activeWire.sourceId !== node.id) {
        const srcId = activeWire.sourceId;
        setLinkingWire(null);
        void onCreateEdge(srcId, node.id);
        return;
      }

      // Shift+drag, right drag or the link tool draw a link
      if (e.shiftKey || e.button === 2 || toolMode === 'link') {
        startWireFromNode(node, e.clientX, e.clientY, toolMode === 'link');
        return;
      }

      // Left button: prepare the drag of the node (and of the multiple selection it belongs to)
      if (e.button === 0) {
        const pos = getNodePos(node);
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
    };

    const handleNodeClick = (e: ReactMouseEvent, node: GraphNode) => {
      e.stopPropagation();
      if (toolMode === 'link') return;
      // Ctrl+click (Cmd on Mac) adds the node to the selection, or removes it
      if (e.ctrlKey || e.metaKey) {
        const current =
          selectedNodeIds.size > 0 ? [...selectedNodeIds] : selectedNodeId ? [selectedNodeId] : [];
        onSelectNodes(
          current.includes(node.id) ? current.filter((id) => id !== node.id) : [...current, node.id]
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
    };

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

          <g ref={contentRef} transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.zoom})`}>
            {/* 1. EDGES LAYER */}
            {renderedEdges.map((geometry) => {
              const { edge } = geometry;
              const isSelected = edge.id === selectedEdgeId;
              const isIncidentSpotlight = spotlightEdges?.has(edge.id) ?? false;
              return (
                <EdgeView
                  key={edge.id}
                  geometry={geometry}
                  selectedNodeId={selectedNodeId}
                  selected={isSelected}
                  hovered={edge.id === hoveredEdgeId}
                  spotlighted={isIncidentSpotlight}
                  dimmed={
                    (spotlightEdges !== null && !isIncidentSpotlight && !isSelected) ||
                    (hasSearch &&
                      !searchMatchIds.has(edge.sourceNodeId) &&
                      !searchMatchIds.has(edge.targetNodeId))
                  }
                  editing={editingEdgeId === edge.id}
                  onHover={hoverEdge}
                  onSelect={selectEdgeOnCanvas}
                  onEditLabel={startEdgeLabelEdit}
                />
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

            {/* 3. NODES LAYER */}
            {nodes.map((node) => {
              if (!node?.id) return null;
              const isSelected = node.id === selectedNodeId || selectedNodeIds.has(node.id);
              const isSearchHit = hasSearch && searchMatchIds.has(node.id);
              return (
                <NodeView
                  key={node.id}
                  node={node}
                  pos={getNodePos(node)}
                  r={getNodeRadius(node.id)}
                  category={node.categoryId ? (categoryMap.get(node.categoryId) ?? null) : null}
                  toolMode={toolMode}
                  selected={isSelected}
                  hovered={node.id === hoveredNodeId}
                  haloHovered={node.id === hoveredHaloNodeId}
                  linkSource={linkingWire?.sourceId === node.id}
                  searchHit={isSearchHit}
                  dimmed={
                    (spotlightNeighbors !== null &&
                      !spotlightNeighbors.has(node.id) &&
                      !isSelected &&
                      !linkingWire) ||
                    (hasSearch && !isSearchHit)
                  }
                  onHover={hoverNode}
                  onHaloHover={hoverHalo}
                  onSelect={selectNodeOnCanvas}
                  onDoubleClick={handleNodeDoubleClick}
                  onHaloMouseDown={handleHaloMouseDown}
                  onBodyMouseDown={handleNodeMouseDown}
                  onBodyClick={handleNodeClick}
                />
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

        {/* ==================== NODE CATEGORY MENU (RIGHT CLICK) ==================== */}
        {nodeMenu &&
          (() => {
            const menuNode = nodes.find((n) => n.id === nodeMenu.nodeId);
            if (!menuNode) return null;
            const rect = containerRef.current?.getBoundingClientRect();
            return (
              <NodeCategoryMenu
                node={menuNode}
                categories={categories}
                x={nodeMenu.x}
                y={nodeMenu.y}
                bounds={{ width: rect?.width ?? 0, height: rect?.height ?? 0 }}
                onPick={pickCategory}
              />
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

        {/* ==================== KEYBOARD DELETE CONFIRMATION (TOP CENTER) ==================== */}
        {pendingDelete && (
          <DeleteConfirmBar
            pending={pendingDelete}
            onConfirm={confirmPendingDelete}
            onCancel={() => setPendingDelete(null)}
          />
        )}

        {/* ==================== FLOATING DOCK (BOTTOM CENTER) ==================== */}
        <CanvasDock
          toolMode={toolMode}
          onSelectMode={() => {
            setToolMode('select');
            setLinkingWire(null);
          }}
          onToggleLinkMode={() => {
            setToolMode((m) => (m === 'link' ? 'select' : 'link'));
            setLinkingWire(null);
          }}
          physicsActive={physicsActive}
          physicsSettled={physicsSettled}
          onTogglePhysics={() => setPhysicsActive((v) => !v)}
          onOrganize={() => void onOrganizeConstellation()}
          zoom={viewport.zoom}
          onZoomOut={() => setViewport((prev) => ({ ...prev, zoom: Math.max(0.16, prev.zoom / 1.25) }))}
          onZoomIn={() => setViewport((prev) => ({ ...prev, zoom: Math.min(3.2, prev.zoom * 1.25) }))}
          onFitView={() => fitView(true)}
        />

        {/* ==================== MINI-MAP (BOTTOM RIGHT) ==================== */}
        {miniMapData && (
          <MiniMap
            layout={miniMapData}
            nodes={nodes}
            edges={edges}
            getNodePos={getNodePos}
            categoryMap={categoryMap}
            selectedNodeId={selectedNodeId}
            onPick={(wx, wy) => centerOnPoint(wx, wy, viewport.zoom)}
          />
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
