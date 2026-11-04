import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { GraphEdge, GraphNode } from '@shared/types';
import { clampFinite } from '@/lib/canvasGeometry';
import { stepForceSimulation, type SimNode } from '@/lib/forceLayout';

type Point = { x: number; y: number };
type PositionUpdate = { id: string; positionX: number; positionY: number };

// Live physics stops animating once every node moves slower than this for a few frames
const PHYSICS_SETTLE_SPEED = 0.15;
const PHYSICS_SETTLE_FRAMES = 30;
// While nodes still move, their positions are saved at most this often
const PHYSICS_PERSIST_INTERVAL_MS = 5000;

interface PhysicsOptions {
  active: boolean;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Node currently dragged by the user: it follows the cursor, not the forces */
  draggedNodeIdRef: RefObject<{
    nodeId: string;
    x?: number;
    y?: number;
    startX?: number;
    startY?: number;
    /** Other nodes dragged with it (multiple selection), held at the same offset */
    group?: Array<{ id: string; startX: number; startY: number }>;
  } | null>;
  livePositionsRef: RefObject<Map<string, Point>>;
  setLivePositions: Dispatch<SetStateAction<Map<string, Point>>>;
  onUpdateBatchPositions: (positions: PositionUpdate[]) => Promise<void>;
}

// Live force-directed layout. Runs while `active`, goes to sleep once the graph settles
// (no rendering at rest), wakes on drag or link changes, and saves only moved nodes.
export function usePhysicsSimulation({
  active,
  nodes,
  edges,
  draggedNodeIdRef,
  livePositionsRef,
  setLivePositions,
  onUpdateBatchPositions,
}: PhysicsOptions) {
  // True once the running simulation has settled and stopped animating
  const [physicsSettled, setPhysicsSettled] = useState(false);
  const simNodesRef = useRef<SimNode[]>([]);
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  // Wakes the physics loop after it went to sleep on a settled graph (set while active)
  const physicsWakeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!active) return;

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

    // Last saved position of each node, so only nodes that actually moved are sent
    const saved = new Map(
      nodes
        .filter((n) => Boolean(n?.id))
        .map((n) => [
          n.id,
          {
            x: Math.round(clampFinite(Number(n.positionX), 0)),
            y: Math.round(clampFinite(Number(n.positionY), 0)),
          },
        ])
    );
    const persistMoved = () => {
      const moved: Array<{ id: string; positionX: number; positionY: number }> = [];
      for (const sn of simNodesRef.current) {
        const x = Math.round(clampFinite(sn.x, 0));
        const y = Math.round(clampFinite(sn.y, 0));
        const last = saved.get(sn.id);
        if (!last || last.x !== x || last.y !== y) {
          moved.push({ id: sn.id, positionX: x, positionY: y });
          saved.set(sn.id, { x, y });
        }
      }
      if (moved.length > 0) void onUpdateBatchPositions(moved);
    };

    let rafId = 0;
    let sleeping = false;
    let calmFrames = 0;
    let lastPersist = performance.now();

    const loop = (now: number) => {
      const dragged = draggedNodeIdRef.current;
      const draggedId = dragged?.nodeId ?? null;
      if (draggedId) {
        // The cursor position is read from the drag itself: the rendered live positions can
        // be one move behind, and this frame replaces them all
        const live =
          dragged?.x !== undefined && dragged?.y !== undefined
            ? { x: dragged.x, y: dragged.y }
            : livePositionsRef.current.get(draggedId);
        const simTarget = simNodesRef.current.find((s) => s.id === draggedId);
        if (live && simTarget) {
          simTarget.x = clampFinite(live.x, simTarget.x);
          simTarget.y = clampFinite(live.y, simTarget.y);
        }
        // The rest of a dragged group keeps its offset from the dragged node on every frame
        const group = dragged?.group ?? [];
        if (live && group.length > 0 && dragged?.startX !== undefined && dragged?.startY !== undefined) {
          const dx = live.x - dragged.startX;
          const dy = live.y - dragged.startY;
          const byId = new Map(simNodesRef.current.map((sn) => [sn.id, sn]));
          for (const g of group) {
            const sn = byId.get(g.id);
            if (!sn) continue;
            sn.x = clampFinite(g.startX + dx, sn.x);
            sn.y = clampFinite(g.startY + dy, sn.y);
            sn.vx = 0;
            sn.vy = 0;
          }
        }
      }

      const groupIds = dragged?.group?.length
        ? new Set([dragged.nodeId, ...dragged.group.map((g) => g.id)])
        : null;
      const maxSpeed = stepForceSimulation(
        simNodesRef.current,
        edgesRef.current,
        groupIds ?? draggedId,
        0.72
      );

      const nextMap = new Map<string, { x: number; y: number }>();
      for (const sn of simNodesRef.current) {
        nextMap.set(sn.id, {
          x: clampFinite(sn.x, 0),
          y: clampFinite(sn.y, 0),
        });
      }
      setLivePositions(nextMap);

      // Settled: save the moved nodes once and stop animating until something changes
      calmFrames = !draggedId && maxSpeed < PHYSICS_SETTLE_SPEED ? calmFrames + 1 : 0;
      if (calmFrames >= PHYSICS_SETTLE_FRAMES) {
        persistMoved();
        lastPersist = now;
        sleeping = true;
        setPhysicsSettled(true);
        return;
      }

      // While still moving, save the moved nodes from time to time
      if (now - lastPersist > PHYSICS_PERSIST_INTERVAL_MS) {
        lastPersist = now;
        persistMoved();
      }

      rafId = requestAnimationFrame(loop);
    };

    physicsWakeRef.current = () => {
      if (!sleeping) return;
      sleeping = false;
      calmFrames = 0;
      setPhysicsSettled(false);
      rafId = requestAnimationFrame(loop);
    };

    setPhysicsSettled(false);
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      physicsWakeRef.current = null;
      // Save the final coordinates of the nodes that moved
      persistMoved();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, nodes.length]);

  // Added, removed or reversed links change the forces: resume a sleeping simulation.
  // Keyed on the link structure, because the edges array is rebuilt on every save.
  const edgeStructureKey = useMemo(
    () => edges.map((e) => `${e.id}:${e.sourceNodeId}>${e.targetNodeId}`).join('|'),
    [edges]
  );
  useEffect(() => {
    physicsWakeRef.current?.();
  }, [edgeStructureKey]);

  const wakePhysics = useCallback(() => physicsWakeRef.current?.(), []);

  // Moves nodes inside the simulation too (undo / redo), so the next frame does not put back
  // the old coordinates; their speed is reset
  const setSimulationPositions = useCallback((positions: PositionUpdate[]) => {
    const byId = new Map(positions.map((p) => [p.id, p]));
    for (const sn of simNodesRef.current) {
      const p = byId.get(sn.id);
      if (!p) continue;
      sn.x = clampFinite(p.positionX, sn.x);
      sn.y = clampFinite(p.positionY, sn.y);
      sn.vx = 0;
      sn.vy = 0;
    }
  }, []);

  return { physicsSettled, wakePhysics, setSimulationPositions };
}
