import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignHorizontalJustifyCenter,
  AlignVerticalJustifyCenter,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  Filter,
  LayoutGrid,
  Loader2,
  Orbit,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  X,
  GripVertical,
  Redo2,
  Undo2,
} from 'lucide-react';
import type {
  Category,
  EdgeStyle,
  GraphEdge,
  GraphNode,
  NodeMetadata,
  Project,
} from '@shared/types';
import { MAX_RESTORE_RECORDS } from '@shared/types';
import { api, type CategoryInput, type RestoreSnapshot } from '@/api/client';
import { GraphCanvas, type GraphCanvasHandle } from '@/components/GraphCanvas';
import {
  INSPECTOR_SAVE_DELAY_MS,
  InspectorSidebar,
  type TakePendingEdgeEdit,
  type TakePendingNodeEdit,
} from '@/components/InspectorSidebar';
import { downloadProjectExport } from '@/lib/exportProject';
import { useSaveQueue } from '@/hooks/useSaveQueue';
import {
  collectMetadataKeys,
  matchesMetadataQuery,
  parseMetadataQuery,
  withCategoryKeys,
} from '@/lib/metadata';
import { CategoryModal } from '@/components/CategoryModal';
import { MultiSelectionPanel } from '@/components/MultiSelectionPanel';
import { getCategoryIcon } from '@/lib/icons';
import { computeConstellationLayout } from '@/lib/forceLayout';
import { cn, moveItem } from '@/lib/utils';
import { UndoHistory, type HistoryEntry } from '@/lib/history';
import { AppFooter } from '@/components/AppFooter';
import logoWhite from '@/ds/assets/logo-white.svg';

const UNCLASSIFIED_FILTER_ID = '__unclassified__';

type EdgeFilterMode = 'all' | 'solid' | 'dashed';

interface WorkspaceProps {
  projectId: string;
  onBack: () => void;
}

type NodePatch = Partial<{
  title: string;
  categoryId: string | null;
  content: string;
  metadata: NodeMetadata;
}>;
type EdgePatch = Partial<{
  label: string;
  style: EdgeStyle;
  directed: boolean;
  color: string | null;
  notes: string;
  reverse: boolean;
}>;
type Positions = Array<{ id: string; positionX: number; positionY: number }>;

interface HistoryActions {
  updateNode: (nodeId: string, patch: NodePatch) => Promise<void>;
  /** Resolves to false when a reversal failed, so its history entry stays in place */
  updateEdge: (edgeId: string, patch: EdgePatch) => Promise<boolean>;
  applyPositions: (positions: Positions) => void;
  reorderCategories: (ids: string[]) => Promise<void>;
  // Each resolves to false when the server failed, so the history entry stays in place
  deleteNode: (nodeId: string) => Promise<boolean>;
  deleteNodes: (nodeIds: string[]) => Promise<boolean>;
  deleteEdge: (edgeId: string) => Promise<boolean>;
  deleteCategory: (categoryId: string) => Promise<boolean>;
  updateCategory: (categoryId: string, input: CategoryInput) => Promise<boolean>;
  restore: (snapshot: RestoreSnapshot) => Promise<boolean>;
}

function categoryInput(category: Category): CategoryInput {
  const { name, color, icon, shape, metadataKeys, cardKeys } = category;
  return { name, color, icon, shape, metadataKeys, cardKeys };
}

// Labels shown in the undo / redo tooltips
function nodeEditLabel(patch: NodePatch): string {
  if ('categoryId' in patch) return 'Changement de catégorie';
  if ('title' in patch) return 'Modification du titre';
  if ('content' in patch) return 'Modification des notes';
  if ('metadata' in patch) return 'Modification des attributs';
  return 'Modification du nœud';
}

function edgeEditLabel(patch: EdgePatch): string {
  if (patch.reverse) return 'Inversion du lien';
  if ('label' in patch) return 'Modification du libellé';
  if ('style' in patch) return 'Style du lien';
  if ('directed' in patch) return 'Orientation du lien';
  if ('color' in patch) return 'Couleur du lien';
  if ('notes' in patch) return 'Notes du lien';
  return 'Modification du lien';
}

export function Workspace({ projectId, onBack }: WorkspaceProps) {
  const canvasRef = useRef<GraphCanvasHandle>(null);
  // Lets a change made on the canvas take the inspector's unsaved edits (see InspectorSidebar)
  const takePendingEditRef = useRef<TakePendingNodeEdit | null>(null);
  const takePendingEdgeEditRef = useRef<TakePendingEdgeEdit | null>(null);

  // Core domain state
  const [project, setProject] = useState<Project | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;
  const [entities, setEntities] = useState<GraphNode[]>([]);
  const [relations, setRelations] = useState<GraphEdge[]>([]);

  // Undo / redo (A1). Entries replay the same handlers as the user's actions, through
  // actionsRef so they never call a stale closure.
  const historyRef = useRef(new UndoHistory());
  const [, setHistoryVersion] = useState(0);
  historyRef.current.onChange = () => setHistoryVersion((v) => v + 1);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;
  const relationsRef = useRef(relations);
  relationsRef.current = relations;
  const actionsRef = useRef<HistoryActions | null>(null);
  const recordHistory = useCallback((entry: Omit<HistoryEntry, 'at'>) => {
    if (historyRef.current.isApplying) return;
    historyRef.current.record(entry);
    setHistoryVersion((v) => v + 1);
  }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const {
    saveState,
    saveError,
    runSave,
    retryFailedSaves,
    dismissSaveError,
    keepForRetry,
    hasRetryableSaves,
    hasUnsavedChanges,
    waitForIdle,
  } = useSaveQueue();

  // Unsaved edits kept per node, and a per-edge queue so a reversal can never
  // overtake a label edit on the same link
  const nodePatchesRef = useRef(new Map<string, Record<string, unknown>>());
  // Pending save of each node, so its saves never overlap
  const nodeQueuesRef = useRef(new Map<string, Promise<unknown>>());
  // Unsaved field edits per link; a retry always sends the latest merged values
  const edgePatchesRef = useRef(new Map<string, Record<string, unknown>>());
  // Unsaved node positions: single drags and batch layouts share one latest-value map
  const pendingPositionsRef = useRef(
    new Map<string, { id: string; positionX: number; positionY: number }>()
  );
  const positionQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const edgeQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const edgeAliasRef = useRef(new Map<string, string>());

  // Serialize operations on links; ids replaced by a reversal are mapped to the new id
  const enqueueEdgeOp = useCallback(<T,>(op: () => Promise<T>): Promise<T> => {
    const next = edgeQueueRef.current.then(op);
    edgeQueueRef.current = next.catch(() => undefined);
    return next;
  }, []);

  const resolveEdgeId = useCallback((edgeId: string): string => {
    let current = edgeId;
    while (edgeAliasRef.current.has(current)) current = edgeAliasRef.current.get(current)!;
    return current;
  }, []);

  // A link as it is now stored: a reversal saved after the copy was taken gave it a new id
  // and swapped its ends (each alias is one reversal)
  const currentEdgeState = useCallback((edge: GraphEdge): GraphEdge => {
    let id = edge.id;
    let flips = 0;
    while (edgeAliasRef.current.has(id)) {
      id = edgeAliasRef.current.get(id)!;
      flips += 1;
    }
    if (flips % 2 === 0) return { ...edge, id };
    return {
      ...edge,
      id,
      sourceNodeId: edge.targetNodeId,
      targetNodeId: edge.sourceNodeId,
      sourceHandle: edge.targetHandle,
      targetHandle: edge.sourceHandle,
    };
  }, []);

  // Selection & inline editing state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const selectedNodeIdRef = useRef(selectedNodeId);
  selectedNodeIdRef.current = selectedNodeId;
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  // Multiple selection (A2): two nodes or more, chosen with Ctrl+click or a Shift+drag box.
  // While it holds nodes, no single node or link is selected.
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  // Selecting one node or link (a click, a creation) ends the multiple selection
  useEffect(() => {
    if (selectedNodeId || selectedEdgeId) setSelectedNodeIds([]);
  }, [selectedNodeId, selectedEdgeId]);
  const selectNodes = useCallback((ids: string[]) => {
    const unique = [...new Set(ids)];
    if (unique.length >= 2) {
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setSelectedNodeIds(unique);
    } else {
      setSelectedNodeIds([]);
      setSelectedEdgeId(null);
      setSelectedNodeId(unique[0] ?? null);
    }
  }, []);
  const [autoEditEdgeId, setAutoEditEdgeId] = useState<string | null>(null);

  // Filters & search state
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [hiddenCategoryIds, setHiddenCategoryIds] = useState<Set<string>>(new Set());
  const [edgeFilter, setEdgeFilter] = useState<EdgeFilterMode>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  // Modals / Menus
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const [editingProjectName, setEditingProjectName] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<{
    kind: 'error' | 'warning';
    message: string;
  } | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load full project graph
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .getProjectGraph(projectId)
      .then((payload) => {
        if (cancelled) return;
        setProject(payload.project);
        setProjectNameDraft(payload.project.name);
        historyRef.current.clear();
        setHistoryVersion((v) => v + 1);
        setCategories(payload.categories);
        setEntities(payload.nodes);
        setRelations(payload.edges);
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        setHiddenCategoryIds(new Set());
        setTimeout(() => {
          canvasRef.current?.fitView(false);
        }, 50);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Erreur de chargement du projet.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Ctrl+K shortcut for instant search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const categoryMap = useMemo(() => {
    const map = new Map<string, Category>();
    for (const c of categories) map.set(c.id, c);
    return map;
  }, [categories]);

  // Visible entities after category filter
  const visibleEntities = useMemo(() => {
    return entities.filter((n) => {
      const key = n.categoryId ?? UNCLASSIFIED_FILTER_ID;
      return !hiddenCategoryIds.has(key);
    });
  }, [entities, hiddenCategoryIds]);

  const visibleEntityIds = useMemo(
    () => new Set(visibleEntities.map((n) => n.id)),
    [visibleEntities]
  );

  // Filtered relations
  const visibleRelations = useMemo(() => {
    return relations.filter((rel) => {
      if (!visibleEntityIds.has(rel.sourceNodeId) || !visibleEntityIds.has(rel.targetNodeId)) {
        return false;
      }
      if (edgeFilter === 'solid' && rel.style !== 'solid') return false;
      if (edgeFilter === 'dashed' && rel.style !== 'dashed') return false;
      return true;
    });
  }, [relations, visibleEntityIds, edgeFilter]);

  // Search matches across title, content, metadata, category. "Clé:valeur" searches the
  // value of a metadata key, and "Clé:" finds nodes that have that key.
  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const metaQuery = parseMetadataQuery(searchQuery);
    if (metaQuery) return entities.filter((n) => matchesMetadataQuery(n.metadata, metaQuery));
    return entities.filter((n) => {
      if (n.title.toLowerCase().includes(q)) return true;
      if (n.content.toLowerCase().includes(q)) return true;
      const cat = n.categoryId ? categoryMap.get(n.categoryId) : null;
      if (cat && cat.name.toLowerCase().includes(q)) return true;
      for (const [k, v] of Object.entries(n.metadata ?? {})) {
        if (k.toLowerCase().includes(q) || v.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [entities, searchQuery, categoryMap]);

  // Category being dragged in the sidebar, and the row it is over
  const [dragCategory, setDragCategory] = useState<{ from: number; over: number } | null>(null);

  // Keys used in the project, offered when editing a category's default keys
  const projectMetadataKeys = useMemo(
    () => (categoryModalOpen ? collectMetadataKeys(entities) : []),
    [categoryModalOpen, entities]
  );

  const searchMatchIds = useMemo(
    () => new Set(searchMatches.map((n) => n.id)),
    [searchMatches]
  );

  // ---- Creations and deletions in the history (A1.2) ----
  // What undo needs to bring a record back, read from the current state
  const nodesSnapshot = useCallback((nodeIds: string[]): RestoreSnapshot | null => {
    const ids = new Set(nodeIds);
    const nodes = entitiesRef.current.filter((n) => ids.has(n.id));
    if (nodes.length === 0) return null;
    const edges = relationsRef.current.filter(
      (e) => ids.has(e.sourceNodeId) || ids.has(e.targetNodeId)
    );
    return { nodes, edges };
  }, []);

  const nodeSnapshot = useCallback(
    (nodeId: string): RestoreSnapshot | null => nodesSnapshot([nodeId]),
    [nodesSnapshot]
  );

  const edgeSnapshot = useCallback(
    (edgeId: string): RestoreSnapshot | null => {
      const edge = relationsRef.current.find((e) => e.id === resolveEdgeId(edgeId));
      return edge ? { edges: [edge] } : null;
    },
    [resolveEdgeId]
  );

  const categorySnapshot = useCallback((categoryId: string): RestoreSnapshot | null => {
    const index = categoriesRef.current.findIndex((c) => c.id === categoryId);
    if (index < 0) return null;
    const nodeIds = entitiesRef.current.filter((n) => n.categoryId === categoryId).map((n) => n.id);
    return {
      categories: [{ ...categoriesRef.current[index], index }],
      assignments: nodeIds.length > 0 ? [{ categoryId, nodeIds }] : [],
    };
  }, []);

  // One entry for a record that a creation added or a deletion removed. Undoing a creation
  // deletes the record, redoing it restores it (and the other way round for a deletion).
  // The snapshot is taken again each time the record is removed, so edits made after an
  // undo are not lost by the next one.
  const recordPresence = useCallback(
    (
      label: string,
      kind: 'created' | 'deleted',
      initial: RestoreSnapshot,
      take: () => RestoreSnapshot | null,
      remove: () => Promise<unknown> | undefined
    ) => {
      let snapshot = initial;
      const removeNow = async () => {
        snapshot = take() ?? snapshot;
        return (await remove()) !== false;
      };
      const restoreNow = () => actionsRef.current?.restore(snapshot);
      recordHistory({
        label,
        undo: kind === 'created' ? removeNow : restoreNow,
        redo: kind === 'created' ? restoreNow : removeNow,
      });
    },
    [recordHistory]
  );

  // Brings deleted records back with their ids. Shown once the server has stored them;
  // it runs in the same queue as deletions, so it always comes after the one it undoes.
  const restoreSnapshot = useCallback(
    async (snapshot: RestoreSnapshot) => {
      const res = await runSave(() => enqueueEdgeOp(() => api.restore(projectId, snapshot)));
      if (!res) return false;
      if (snapshot.categories?.length) setCategories(res.categories);
      if (res.nodes.length > 0) {
        setEntities((prev) => {
          const back = new Map(res.nodes.map((n) => [n.id, n]));
          // A node still on screen only gets its category back (it may hold unsaved edits)
          const next = prev.map((n) => {
            const r = back.get(n.id);
            if (!r) return n;
            back.delete(n.id);
            return { ...n, categoryId: r.categoryId };
          });
          return [...next, ...back.values()];
        });
      }
      if (res.edges.length > 0) {
        const ids = new Set(res.edges.map((e) => e.id));
        setRelations((prev) => [...prev.filter((e) => !ids.has(e.id)), ...res.edges]);
      }
      return true;
    },
    [projectId, runSave, enqueueEdgeOp]
  );

  // Create node at world coordinates
  const createNodeAt = useCallback(
    async (positionX: number, positionY: number): Promise<GraphNode | null> => {
      const defaultCategory =
        categories.find((c) => !hiddenCategoryIds.has(c.id))?.id ?? categories[0]?.id ?? null;

      // A new node starts with the category's default keys, empty
      const metadata = withCategoryKeys(categories.find((c) => c.id === defaultCategory), {});
      const created = await runSave(() =>
        api.createNode(projectId, {
          title: 'Nouvel indice',
          categoryId: defaultCategory,
          positionX: Math.round(positionX),
          positionY: Math.round(positionY),
          content: '',
          metadata,
        })
      );
      if (!created) return null;
      const nodeId = created.node.id;
      setEntities((prev) => [...prev, created.node]);
      setSelectedEdgeId(null);
      setSelectedNodeId(nodeId);
      recordPresence(
        'Création du nœud',
        'created',
        { nodes: [created.node], edges: [] },
        () => nodeSnapshot(nodeId),
        () => actionsRef.current?.deleteNode(nodeId)
      );
      return created.node;
    },
    [projectId, categories, hiddenCategoryIds, runSave, recordPresence, nodeSnapshot]
  );

  const handleCreateNodeCenter = useCallback(() => {
    const center = canvasRef.current?.getViewportCenter() ?? { x: 0, y: 0 };
    const jitterX = Math.round((Math.random() - 0.5) * 60);
    const jitterY = Math.round((Math.random() - 0.5) * 60);
    void createNodeAt(center.x + jitterX, center.y + jitterY);
  }, [createNodeAt]);

  // Create native SurrealDB RELATE edge between two nodes
  const handleCreateEdge = useCallback(
    async (sourceNodeId: string, targetNodeId: string) => {
      if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) return;
      const defaultStyle: EdgeStyle = edgeFilter === 'dashed' ? 'dashed' : 'solid';

      const created = await runSave(() =>
        api.createEdge(projectId, {
          sourceNodeId,
          targetNodeId,
          label: '',
          style: defaultStyle,
          directed: true,
        })
      );
      if (!created) return;
      const edgeId = created.edge.id;
      setRelations((prev) => [...prev, created.edge]);
      setSelectedNodeId(null);
      setSelectedEdgeId(edgeId);
      setAutoEditEdgeId(edgeId);
      recordPresence(
        'Création du lien',
        'created',
        { edges: [created.edge] },
        () => edgeSnapshot(edgeId),
        () => actionsRef.current?.deleteEdge(edgeId)
      );
    },
    [projectId, edgeFilter, runSave, recordPresence, edgeSnapshot]
  );

  // Dragging a link wire into empty space -> spawns a new node already linked!
  const handleCreateLinkedNodeAt = useCallback(
    async (sourceNodeId: string, worldX: number, worldY: number) => {
      const defaultCategory =
        categories.find((c) => !hiddenCategoryIds.has(c.id))?.id ?? categories[0]?.id ?? null;
      const defaultStyle: EdgeStyle = edgeFilter === 'dashed' ? 'dashed' : 'solid';

      const metadata = withCategoryKeys(categories.find((c) => c.id === defaultCategory), {});
      const created = await runSave(async () => {
        const { node } = await api.createNode(projectId, {
          title: 'Nouvel indice',
          categoryId: defaultCategory,
          positionX: worldX,
          positionY: worldY,
          content: '',
          metadata,
        });
        try {
          const { edge } = await api.createEdge(projectId, {
            sourceNodeId,
            targetNodeId: node.id,
            label: '',
            style: defaultStyle,
            directed: true,
          });
          return { node, edge };
        } catch (err) {
          // Do not leave an orphan node behind when the link could not be saved
          await api.deleteNode(node.id).catch(() => undefined);
          throw err;
        }
      });
      if (!created) return;
      const nodeId = created.node.id;
      setEntities((prev) => [...prev, created.node]);
      setRelations((prev) => [...prev, created.edge]);
      setSelectedEdgeId(null);
      setSelectedNodeId(nodeId);
      // Undone in one step: deleting the node also deletes its link
      recordPresence(
        'Création du nœud lié',
        'created',
        { nodes: [created.node], edges: [created.edge] },
        () => nodeSnapshot(nodeId),
        () => actionsRef.current?.deleteNode(nodeId)
      );
    },
    [projectId, categories, hiddenCategoryIds, edgeFilter, runSave, recordPresence, nodeSnapshot]
  );

  // Persists the latest unsaved positions. Single drags and batches write into the same map,
  // so a retry can never replay coordinates older than a later successful save.
  const savePositions = useCallback(
    () =>
      runSave(
        () => {
          const next = positionQueueRef.current.then(async () => {
            const sent = [...pendingPositionsRef.current.values()];
            if (sent.length === 0) return;
            await api.updateBatchPositions(projectId, sent);
            for (const p of sent) {
              if (pendingPositionsRef.current.get(p.id) === p) {
                pendingPositionsRef.current.delete(p.id);
              }
            }
          });
          positionQueueRef.current = next.catch(() => undefined);
          return next;
        },
        { retryKey: `positions:${projectId}` }
      ),
    [projectId, runSave]
  );

  // Persist single node position
  const handleUpdateNodePosition = useCallback(
    async (nodeId: string, posX: number, posY: number, from?: { x: number; y: number }) => {
      const node = entitiesRef.current.find((n) => n.id === nodeId);
      // The drag start is the undo position: during a long drag, the live physics may have
      // already saved intermediate coordinates of the dragged node
      const startX = from?.x ?? node?.positionX;
      const startY = from?.y ?? node?.positionY;
      if (node && startX !== undefined && startY !== undefined && (startX !== posX || startY !== posY)) {
        const before = [{ id: nodeId, positionX: startX, positionY: startY }];
        const after = [{ id: nodeId, positionX: posX, positionY: posY }];
        recordHistory({
          label: 'Déplacement du nœud',
          undo: () => actionsRef.current?.applyPositions(before),
          redo: () => actionsRef.current?.applyPositions(after),
        });
      }
      setEntities((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, positionX: posX, positionY: posY } : n))
      );
      pendingPositionsRef.current.set(nodeId, { id: nodeId, positionX: posX, positionY: posY });
      await savePositions();
    },
    [savePositions, recordHistory]
  );

  // Persist batch node positions (from live physics or layout)
  // Live physics saves without a label (not undoable); a layout passes one and can be undone
  const handleUpdateBatchPositions = useCallback(
    async (
      positions: Array<{ id: string; positionX: number; positionY: number }>,
      historyLabel?: string,
      // Where a group drag started (the live physics may have saved positions meanwhile)
      from?: Array<{ id: string; positionX: number; positionY: number }>
    ) => {
      if (positions.length === 0) return;
      if (historyLabel) {
        const byId = new Map(entitiesRef.current.map((n) => [n.id, n]));
        const before =
          from ??
          positions.flatMap((p) => {
            const n = byId.get(p.id);
            return n ? [{ id: p.id, positionX: n.positionX, positionY: n.positionY }] : [];
          });
        const after = positions.map((p) => ({ ...p }));
        recordHistory({
          label: historyLabel,
          undo: () => actionsRef.current?.applyPositions(before),
          redo: () => actionsRef.current?.applyPositions(after),
        });
      }
      const map = new Map(positions.map((p) => [p.id, p]));
      setEntities((prev) =>
        prev.map((n) => {
          const p = map.get(n.id);
          return p ? { ...n, positionX: p.positionX, positionY: p.positionY } : n;
        })
      );
      for (const p of positions) pendingPositionsRef.current.set(p.id, { ...p });
      await savePositions();
    },
    [savePositions, recordHistory]
  );

  // Sends the merged unsaved field edits of a link. Overlapping edits supersede each other,
  // so replaying a failed save can never restore an older value.
  // Throws on failure, so callers (runSave, retryFailedSaves) see the real outcome
  const edgeFieldsOp = useCallback(
    (edgeId: string) =>
      enqueueEdgeOp(async () => {
        const currentId = resolveEdgeId(edgeId);
        const patch = edgePatchesRef.current.get(currentId);
        if (!patch) return;
        const { edge } = await api.updateEdge(currentId, patch);
        if (edgePatchesRef.current.get(currentId) === patch) {
          edgePatchesRef.current.delete(currentId);
        }
        setRelations((prev) => prev.map((e) => (e.id === currentId ? edge : e)));
      }),
    [enqueueEdgeOp, resolveEdgeId]
  );

  const saveEdgeFields = useCallback(
    (edgeId: string) =>
      runSave(() => edgeFieldsOp(edgeId), { retryKey: `edge:${resolveEdgeId(edgeId)}` }),
    [runSave, edgeFieldsOp, resolveEdgeId]
  );

  const queueEdgeFields = useCallback(
    (edgeId: string, fields: Record<string, unknown>) => {
      const currentId = resolveEdgeId(edgeId);
      edgePatchesRef.current.set(currentId, {
        ...(edgePatchesRef.current.get(currentId) ?? {}),
        ...fields,
      });
      return saveEdgeFields(currentId);
    },
    [resolveEdgeId, saveEdgeFields]
  );

  // Commit inline edge label
  const handleCommitEdgeLabel = useCallback(
    async (edgeId: string, newLabel: string) => {
      setAutoEditEdgeId((curr) => (curr === edgeId ? null : curr));
      const edge = relationsRef.current.find((e) => e.id === resolveEdgeId(edgeId));
      if (edge && edge.label !== newLabel) {
        const before = edge.label;
        recordHistory({
          label: 'Modification du libellé',
          mergeKey: `edge:${edgeId}:label`,
          undo: () => actionsRef.current?.updateEdge(resolveEdgeId(edgeId), { label: before }),
          redo: () => actionsRef.current?.updateEdge(resolveEdgeId(edgeId), { label: newLabel }),
        });
      }
      setRelations((prev) =>
        prev.map((e) => (e.id === edgeId ? { ...e, label: newLabel } : e))
      );
      await queueEdgeFields(edgeId, { label: newLabel });
    },
    [queueEdgeFields, resolveEdgeId, recordHistory]
  );

  // Node updates from Inspector
  const handleUpdateNode = useCallback(
    async (
      nodeId: string,
      patch: Partial<{
        title: string;
        categoryId: string | null;
        content: string;
        metadata: NodeMetadata;
      }>
    ) => {
      const node = entitiesRef.current.find((n) => n.id === nodeId);
      if (node) {
        const keys = Object.keys(patch) as Array<keyof typeof patch>;
        const before = Object.fromEntries(keys.map((k) => [k, node[k]])) as typeof patch;
        recordHistory({
          label: nodeEditLabel(patch),
          mergeKey: `node:${nodeId}:${[...keys].sort().join(',')}`,
          undo: () => void actionsRef.current?.updateNode(nodeId, before),
          redo: () => void actionsRef.current?.updateNode(nodeId, patch),
        });
      }
      setEntities((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, ...patch } : n))
      );
      // Merge with any unsent or failed patch, so a retry never loses a field
      nodePatchesRef.current.set(nodeId, { ...(nodePatchesRef.current.get(nodeId) ?? {}), ...patch });
      await runSave(
        () => {
          // Saves of one node run one after the other and each sends the latest merged
          // patch, so an older request can never finish last and overwrite an undo
          const previous = nodeQueuesRef.current.get(nodeId) ?? Promise.resolve();
          const next = previous.then(async () => {
            const sent = nodePatchesRef.current.get(nodeId);
            if (!sent) return;
            const { node } = await api.updateNode(nodeId, sent);
            if (nodePatchesRef.current.get(nodeId) !== sent) return; // a newer edit follows
            nodePatchesRef.current.delete(nodeId);
            setEntities((prev) => prev.map((n) => (n.id === nodeId ? node : n)));
          });
          const settled = next.catch(() => undefined);
          nodeQueuesRef.current.set(nodeId, settled);
          void settled.then(() => {
            if (nodeQueuesRef.current.get(nodeId) === settled) nodeQueuesRef.current.delete(nodeId);
          });
          return next;
        },
        { retryKey: `node:${nodeId}` }
      );
    },
    [runSave, recordHistory]
  );

  // Category picked on the canvas (menu or number key): the node also gets the new
  // category's missing default keys, as when the category is changed in the inspector
  const handleChangeNodeCategory = useCallback(
    (nodeId: string, categoryId: string | null) => {
      const node = entities.find((n) => n.id === nodeId);
      if (!node) return;
      // Edits typed in the inspector and not saved yet go in this request, so its delayed
      // save cannot replace the default keys added here
      const pending = takePendingEditRef.current?.(nodeId) ?? {};
      const base = pending.metadata ?? node.metadata ?? {};
      const cat = categories.find((c) => c.id === categoryId);
      const metadata = withCategoryKeys(cat, base);
      const added = Object.keys(metadata).length !== Object.keys(base).length;
      void handleUpdateNode(nodeId, {
        ...pending,
        categoryId,
        ...(added || pending.metadata ? { metadata } : {}),
      });
    },
    [entities, categories, handleUpdateNode]
  );

  // New category order from the sidebar (drag and drop or arrow keys)
  // Category order: the latest wanted order, and a queue so saves never overlap. Each save
  // sends the latest order. The order is already shown, so the answer is not applied: its
  // category objects could be older than a category created or edited meanwhile.
  const categoryOrderRef = useRef<{ ids: string[]; version: number } | null>(null);
  const categoryOrderVersionRef = useRef(0);
  const categoryOrderQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  // Saves a category order (ids); categories missing from the list keep their place after it
  const applyCategoryOrder = useCallback(
    async (ids: string[]) => {
      const byId = new Map(categoriesRef.current.map((c) => [c.id, c]));
      const listed = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
      const next = [...listed, ...categoriesRef.current.filter((c) => !ids.includes(c.id))];
      setCategories(next);
      categoryOrderVersionRef.current += 1;
      categoryOrderRef.current = { ids: next.map((c) => c.id), version: categoryOrderVersionRef.current };
      await runSave(
        () => {
          const op = categoryOrderQueueRef.current.then(async () => {
            const wanted = categoryOrderRef.current;
            if (!wanted) return; // already saved by an earlier queued save
            // A category deleted since the order was asked is left out (the API refuses it)
            const existing = new Set(categoriesRef.current.map((c) => c.id));
            await api.reorderCategories(
              projectId,
              wanted.ids.filter((id) => existing.has(id))
            );
            if (categoryOrderRef.current?.version === wanted.version) categoryOrderRef.current = null;
          });
          categoryOrderQueueRef.current = op.catch(() => undefined);
          return op;
        },
        { retryKey: 'category-order' }
      );
    },
    [projectId, runSave]
  );

  const handleReorderCategories = useCallback(
    async (from: number, to: number) => {
      if (from === to) return;
      const before = categoriesRef.current.map((c) => c.id);
      const after = moveItem(before, from, to);
      recordHistory({
        label: 'Ordre des catégories',
        undo: () => void actionsRef.current?.reorderCategories(before),
        redo: () => void actionsRef.current?.reorderCategories(after),
      });
      await applyCategoryOrder(after);
    },
    [applyCategoryOrder, recordHistory]
  );

  // A deletion is recorded once the server has done it: a failed one stays queued for
  // "Réessayer" and cannot be undone. Undo and redo replaying it record nothing.
  // A deletion made by the user is shown at once, kept for "Réessayer" if it fails, and
  // recorded once the server has done it. Replayed by undo or redo, it is not kept for
  // "Réessayer" (a later retry could delete a record restored since): on failure the
  // record comes back on screen and the history entry stays in place.
  const handleDeleteNode = useCallback(
    async (nodeId: string): Promise<boolean> => {
      const replaying = historyRef.current.isApplying;
      const snapshot = nodeSnapshot(nodeId);
      setEntities((prev) => prev.filter((n) => n.id !== nodeId));
      setRelations((prev) =>
        prev.filter((e) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId)
      );
      setSelectedNodeId((curr) => (curr === nodeId ? null : curr));

      const done = await runSave(
        () => enqueueEdgeOp(() => api.deleteNode(nodeId)),
        replaying ? {} : { retryKey: `delete-node:${nodeId}` }
      );
      if (!done) {
        if (replaying && snapshot) {
          setEntities((prev) => [...prev.filter((n) => n.id !== nodeId), ...(snapshot.nodes ?? [])]);
          setRelations((prev) => [...prev, ...(snapshot.edges ?? []).map(currentEdgeState)]);
        }
        return false;
      }
      if (snapshot && !replaying) {
        // Links reversed while the deletion waited in the queue are kept as stored
        const stored = { ...snapshot, edges: (snapshot.edges ?? []).map(currentEdgeState) };
        recordPresence(
          'Suppression du nœud',
          'deleted',
          stored,
          () => nodeSnapshot(nodeId),
          () => actionsRef.current?.deleteNode(nodeId)
        );
      }
      return true;
    },
    [runSave, enqueueEdgeOp, nodeSnapshot, recordPresence, currentEdgeState]
  );

  // Several nodes at once (multiple selection): one request, one history entry
  const handleDeleteNodes = useCallback(
    async (nodeIds: string[]): Promise<boolean> => {
      if (nodeIds.length === 1) return handleDeleteNode(nodeIds[0]);
      const replaying = historyRef.current.isApplying;
      const snapshot = nodesSnapshot(nodeIds);
      // The whole deletion must fit in one restore, otherwise it could not be undone
      const size = (snapshot?.nodes?.length ?? 0) + (snapshot?.edges?.length ?? 0);
      if (size > MAX_RESTORE_RECORDS) {
        setHistoryNotice(
          `Trop d’éléments pour une seule suppression (${size} nœuds et liens, ${MAX_RESTORE_RECORDS} au plus) : supprimez en plusieurs fois.`
        );
        return false;
      }
      const ids = new Set(nodeIds);
      setEntities((prev) => prev.filter((n) => !ids.has(n.id)));
      setRelations((prev) =>
        prev.filter((e) => !ids.has(e.sourceNodeId) && !ids.has(e.targetNodeId))
      );
      setSelectedNodeIds([]);
      setSelectedNodeId((curr) => (curr && ids.has(curr) ? null : curr));

      const done = await runSave(
        () => enqueueEdgeOp(() => api.deleteNodes(projectId, nodeIds)),
        replaying ? {} : { retryKey: `delete-nodes:${[...nodeIds].sort().join(',')}` }
      );
      if (!done) {
        if (replaying && snapshot) {
          setEntities((prev) => [...prev.filter((n) => !ids.has(n.id)), ...(snapshot.nodes ?? [])]);
          const back = (snapshot.edges ?? []).map(currentEdgeState);
          const backIds = new Set(back.map((e) => e.id));
          setRelations((prev) => [...prev.filter((e) => !backIds.has(e.id)), ...back]);
        }
        return false;
      }
      if (snapshot && !replaying) {
        const stored = { ...snapshot, edges: (snapshot.edges ?? []).map(currentEdgeState) };
        const count = snapshot.nodes?.length ?? nodeIds.length;
        recordPresence(
          `Suppression de ${count} nœuds`,
          'deleted',
          stored,
          () => nodesSnapshot(nodeIds),
          () => actionsRef.current?.deleteNodes(nodeIds)
        );
      }
      return true;
    },
    [projectId, runSave, enqueueEdgeOp, nodesSnapshot, recordPresence, currentEdgeState, handleDeleteNode]
  );

  // Edge updates from Inspector
  const handleUpdateEdge = useCallback(
    async (
      edgeId: string,
      patch: Partial<{
        label: string;
        style: EdgeStyle;
        directed: boolean;
        color: string | null;
        notes: string;
        reverse: boolean;
      }>
    ) => {
      const { reverse, ...fields } = patch;
      const hasFields = Object.keys(fields).length > 0;

      // A reversal is not applied optimistically: it is recorded only once the server has
      // done it, otherwise undoing it would flip a link that never changed. An undo or redo
      // replaying it must not be recorded, so this is decided now, before any await.
      const replaying = historyRef.current.isApplying;
      const edge = relationsRef.current.find((e) => e.id === resolveEdgeId(edgeId));
      const record = (withReverse: boolean) => {
        if (!edge || replaying) return;
        const keys = Object.keys(fields) as Array<keyof typeof fields>;
        if (!withReverse && keys.length === 0) return;
        const before = Object.fromEntries(
          keys.map((k) => [k, edge[k] ?? (k === 'color' ? null : k === 'notes' ? '' : edge[k])])
        ) as typeof fields;
        recordHistory({
          label: edgeEditLabel(withReverse ? patch : fields),
          mergeKey: withReverse ? undefined : `edge:${edgeId}:${[...keys].sort().join(',')}`,
          // Undoing a reversal reverses the link again (its id changes each time)
          undo: () =>
            actionsRef.current?.updateEdge(
              resolveEdgeId(edgeId),
              withReverse ? { ...before, reverse: true } : before
            ),
          redo: () =>
            actionsRef.current?.updateEdge(resolveEdgeId(edgeId), withReverse ? patch : fields),
        });
      };

      if (!reverse) {
        record(false);
        setRelations((prev) =>
          prev.map((e) => (e.id === edgeId ? { ...e, ...fields } : e))
        );
        // Field edits are shown at once and kept for "Réessayer" when they fail
        await queueEdgeFields(edgeId, fields);
        return true;
      }

      // The unsaved fields travel with the reversal and stay queued if it fails
      const startId = resolveEdgeId(edgeId);
      if (hasFields) {
        edgePatchesRef.current.set(startId, {
          ...(edgePatchesRef.current.get(startId) ?? {}),
          ...fields,
        });
      }
      const reversed = await runSave(() =>
        enqueueEdgeOp(async () => {
          const currentId = resolveEdgeId(edgeId);
          const pending = edgePatchesRef.current.get(currentId);
          const { edge, replacedId } = await api.updateEdge(currentId, {
            ...(pending ?? {}),
            reverse: true,
          });
          if (pending && edgePatchesRef.current.get(currentId) === pending) {
            edgePatchesRef.current.delete(currentId);
          }
          if (replacedId) {
            edgeAliasRef.current.set(replacedId, edge.id);
            // Edits queued during the request were stored under the old id
            const newer = edgePatchesRef.current.get(replacedId);
            if (newer) {
              edgePatchesRef.current.delete(replacedId);
              edgePatchesRef.current.set(edge.id, {
                ...newer,
                ...(edgePatchesRef.current.get(edge.id) ?? {}),
              });
            }
            setRelations((prev) => prev.map((e) => (e.id === replacedId ? edge : e)));
            setSelectedEdgeId((curr) => (curr === replacedId ? edge.id : curr));
          }
          return true as const;
        })
      );
      // Done: the reversal (with its fields) can be undone. Failed: only the fields, which
      // stay queued for the retry, are recorded
      record(Boolean(reversed));
      // A reversal is not replayed (it would flip the link twice), but its fields are
      if (!reversed && edgePatchesRef.current.has(startId)) {
        keepForRetry(`edge:${startId}`, () => edgeFieldsOp(startId));
      }
      return Boolean(reversed);
    },
    [runSave, enqueueEdgeOp, resolveEdgeId, queueEdgeFields, edgeFieldsOp, recordHistory]
  );

  // Moves nodes on screen at once (also while the physics runs), then saves them
  const applyPositions = useCallback(
    (positions: Array<{ id: string; positionX: number; positionY: number }>) => {
      canvasRef.current?.setNodePositions(positions);
      void handleUpdateBatchPositions(positions);
    },
    [handleUpdateBatchPositions]
  );
  // Entries about a node, link or category that is gone (deleted and not restored) are skipped
  actionsRef.current = {
    updateNode: async (nodeId, patch) => {
      if (!entitiesRef.current.some((n) => n.id === nodeId)) return;
      // A category deleted since cannot be given back: the node is left without one, as the
      // deletion would have done had the node still used it
      const gone =
        patch.categoryId && !categoriesRef.current.some((c) => c.id === patch.categoryId);
      await handleUpdateNode(nodeId, gone ? { ...patch, categoryId: null } : patch);
    },
    updateEdge: async (edgeId, patch) => {
      if (!relationsRef.current.some((e) => e.id === edgeId)) return true; // skipped: link gone
      return handleUpdateEdge(edgeId, patch);
    },
    applyPositions: (positions) => {
      const existing = new Set(entitiesRef.current.map((n) => n.id));
      const kept = positions.filter((p) => existing.has(p.id));
      if (kept.length > 0) applyPositions(kept);
    },
    reorderCategories: applyCategoryOrder,
    deleteNode: async (nodeId) => {
      if (!entitiesRef.current.some((n) => n.id === nodeId)) return true;
      return handleDeleteNode(nodeId);
    },
    deleteNodes: async (nodeIds) => {
      const existing = nodeIds.filter((id) => entitiesRef.current.some((n) => n.id === id));
      if (existing.length === 0) return true;
      return handleDeleteNodes(existing);
    },
    deleteEdge: async (edgeId) => {
      const id = resolveEdgeId(edgeId);
      if (!relationsRef.current.some((e) => e.id === id)) return true;
      return handleDeleteEdge(id);
    },
    deleteCategory: async (categoryId) => {
      if (!categoriesRef.current.some((c) => c.id === categoryId)) return true;
      // A failed deletion throws (the editor relies on it), which counts as a failure here
      return deleteCategory(categoryId).then(
        () => true,
        () => false
      );
    },
    updateCategory: async (categoryId, input) => {
      if (!categoriesRef.current.some((c) => c.id === categoryId)) return true;
      return updateCategory(categoryId, input, { rethrow: true }).then(
        () => true,
        () => false
      );
    },
    restore: restoreSnapshot,
  };

  // Edits still waiting in the inspector are saved (and recorded) first: before an undo
  // they are what gets undone, and before a redo they drop the redo list, as any new edit does
  const flushPendingEdits = useCallback(() => {
    const nodeId = selectedNodeIdRef.current;
    if (nodeId) {
      const pending = takePendingEditRef.current?.(nodeId) ?? {};
      if (Object.keys(pending).length > 0) void handleUpdateNode(nodeId, pending);
    }
    const pendingEdge = takePendingEdgeEditRef.current?.();
    if (pendingEdge && Object.keys(pendingEdge.patch).length > 0) {
      void handleUpdateEdge(pendingEdge.edgeId, pendingEdge.patch);
    }
  }, [handleUpdateNode, handleUpdateEdge]);

  const undo = useCallback(() => {
    flushPendingEdits();
    const label = historyRef.current.undo();
    setHistoryVersion((v) => v + 1);
    if (label) setHistoryNotice(`Annulé : ${label}`);
  }, [flushPendingEdits]);

  const redo = useCallback(() => {
    flushPendingEdits();
    const label = historyRef.current.redo();
    setHistoryVersion((v) => v + 1);
    if (label) setHistoryNotice(`Rétabli : ${label}`);
  }, [flushPendingEdits]);

  useEffect(() => {
    if (!historyNotice) return;
    const timer = setTimeout(() => setHistoryNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [historyNotice]);

  // Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z); inside a text field the browser's own undo applies
  const undoRedoRef = useRef({ undo, redo });
  undoRedoRef.current = { undo, redo };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoRedoRef.current.undo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        undoRedoRef.current.redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleDeleteEdge = useCallback(
    async (edgeId: string): Promise<boolean> => {
      const replaying = historyRef.current.isApplying;
      const snapshot = edgeSnapshot(edgeId)?.edges?.[0];
      setRelations((prev) => prev.filter((e) => e.id !== edgeId));
      setSelectedEdgeId((curr) => (curr === edgeId ? null : curr));

      const done = await runSave(
        () => enqueueEdgeOp(() => api.deleteEdge(resolveEdgeId(edgeId))),
        replaying ? {} : { retryKey: `delete-edge:${edgeId}` }
      );
      if (!done) {
        if (replaying && snapshot) {
          const back = currentEdgeState(snapshot);
          setRelations((prev) => [...prev.filter((e) => e.id !== back.id), back]);
        }
        return false;
      }
      if (snapshot && !replaying) {
        // A reversal saved while the deletion waited gave the link a new id and direction
        const stored = currentEdgeState(snapshot);
        recordPresence(
          'Suppression du lien',
          'deleted',
          { edges: [stored] },
          () => edgeSnapshot(stored.id),
          () => actionsRef.current?.deleteEdge(stored.id)
        );
      }
      return true;
    },
    [runSave, enqueueEdgeOp, resolveEdgeId, edgeSnapshot, recordPresence, currentEdgeState]
  );

  // Category CRUD. Each change is recorded once the server has stored it; `rethrow`
  // keeps the editor open when it fails
  const updateCategory = useCallback(
    async (categoryId: string, data: CategoryInput, opts: { rethrow?: boolean } = {}) => {
      const replaying = historyRef.current.isApplying;
      const before = categoriesRef.current.find((c) => c.id === categoryId);
      const saved = await runSave(
        async () => {
          const { category } = await api.updateCategory(categoryId, data);
          setCategories((prev) => prev.map((c) => (c.id === category.id ? category : c)));
          return category;
        },
        { rethrow: opts.rethrow }
      );
      if (saved && before && !replaying) {
        const undoInput = categoryInput(before);
        recordHistory({
          label: 'Modification de la catégorie',
          undo: () => actionsRef.current?.updateCategory(categoryId, undoInput),
          redo: () => actionsRef.current?.updateCategory(categoryId, data),
        });
      }
    },
    [runSave, recordHistory]
  );

  const createCategory = useCallback(
    async (data: CategoryInput) => {
      const created = await runSave(
        async () => {
          const { category } = await api.createCategory(projectId, data);
          setCategories((prev) => [...prev, category]);
          return category;
        },
        { rethrow: true }
      );
      if (!created) return;
      const categoryId = created.id;
      recordPresence(
        'Création de la catégorie',
        'created',
        { categories: [{ ...created, index: categoriesRef.current.length }], assignments: [] },
        () => categorySnapshot(categoryId),
        () => actionsRef.current?.deleteCategory(categoryId)
      );
    },
    [projectId, runSave, recordPresence, categorySnapshot]
  );

  // Its nodes lose the category; undo gives it back to those that have not got another since
  const deleteCategory = useCallback(
    async (categoryId: string) => {
      const replaying = historyRef.current.isApplying;
      const snapshot = categorySnapshot(categoryId);
      const done = await runSave(
        async () => {
          await enqueueEdgeOp(() => api.deleteCategory(categoryId));
          setCategories((prev) => prev.filter((c) => c.id !== categoryId));
          setEntities((prev) =>
            prev.map((n) => (n.categoryId === categoryId ? { ...n, categoryId: null } : n))
          );
          setHiddenCategoryIds((prev) => {
            const next = new Set(prev);
            next.delete(categoryId);
            return next;
          });
          return true;
        },
        { rethrow: true }
      );
      if (done && snapshot && !replaying) {
        recordPresence(
          'Suppression de la catégorie',
          'deleted',
          snapshot,
          () => categorySnapshot(categoryId),
          () => actionsRef.current?.deleteCategory(categoryId)
        );
      }
    },
    [runSave, enqueueEdgeOp, categorySnapshot, recordPresence]
  );

  const handleSaveCategory = async (data: CategoryInput) => {
    if (editingCategory) await updateCategory(editingCategory.id, data, { rethrow: true });
    else await createCategory(data);
  };

  const handleDeleteCategory = (categoryId: string) => deleteCategory(categoryId);

  // Layouts: Constellation (Force) or Hierarchical (Dagre)
  const handleOrganizeConstellation = useCallback(async () => {
    setLayoutMenuOpen(false);
    if (visibleEntities.length === 0) return;

    const newPositions = computeConstellationLayout(visibleEntities, relations);
    await handleUpdateBatchPositions(newPositions, 'Disposition en constellation');
    setTimeout(() => {
      canvasRef.current?.fitView(true);
    }, 30);
  }, [visibleEntities, relations, handleUpdateBatchPositions]);

  const handleAutoAlign = async (direction: 'LR' | 'TB') => {
    setLayoutMenuOpen(false);
    if (visibleEntities.length === 0) return;

    // dagre is only loaded the first time a hierarchical layout is requested
    const { computeAutoLayout } = await import('@/lib/layout');
    const newPositions = computeAutoLayout(visibleEntities, relations, direction);
    await handleUpdateBatchPositions(newPositions, 'Disposition hiérarchique');
    setTimeout(() => {
      canvasRef.current?.fitView(true);
    }, 30);
  };

  // Focus camera onto searched node
  const focusNode = (node: GraphNode) => {
    const catKey = node.categoryId ?? UNCLASSIFIED_FILTER_ID;
    if (hiddenCategoryIds.has(catKey)) {
      setHiddenCategoryIds((prev) => {
        const next = new Set(prev);
        next.delete(catKey);
        return next;
      });
    }
    setSelectedEdgeId(null);
    setSelectedNodeId(node.id);
    setSearchFocused(false);
    canvasRef.current?.centerOnPoint(node.positionX, node.positionY, 1.35);
  };

  // Export JSON directly from workspace. The file is built by the API, so recent edits are
  // given time to reach it first: the inspector's typing delay, then any save in flight.
  const handleExportProject = async () => {
    if (!project || exporting) return;
    setExporting(true);
    setExportNotice(null);
    try {
      await new Promise((r) => setTimeout(r, INSPECTOR_SAVE_DELAY_MS + 50));
      await waitForIdle(10_000);
      const unsaved = hasUnsavedChanges();

      await downloadProjectExport(project.id, project.name);
      if (unsaved) {
        setExportNotice({
          kind: 'warning',
          message:
            "Export effectué, mais certaines modifications ne sont pas enregistrées : elles ne figurent pas dans le fichier. Réessayez l'enregistrement puis exportez à nouveau.",
        });
      }
    } catch (err) {
      console.error('[Graphax] Export impossible :', err);
      setExportNotice({
        kind: 'error',
        message: `Export impossible : ${err instanceof Error ? err.message : 'erreur inconnue.'}`,
      });
    } finally {
      setExporting(false);
    }
  };

  const commitProjectTitle = async () => {
    setEditingProjectName(false);
    if (!project) return;
    const trimmed = projectNameDraft.trim();
    if (!trimmed || trimmed === project.name) {
      setProjectNameDraft(project.name);
      return;
    }
    await runSave(
      async () => {
        const { project: updated } = await api.updateProject(project.id, { name: trimmed });
        setProject(updated);
      },
      { retryKey: `project-name:${project.id}` }
    );
  };

  const toggleCategoryVisibility = (catId: string) => {
    setHiddenCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  const selectedNode = useMemo(
    () => entities.find((n) => n.id === selectedNodeId) ?? null,
    [entities, selectedNodeId]
  );

  const selectedEdge = useMemo(
    () => relations.find((e) => e.id === selectedEdgeId) ?? null,
    [relations, selectedEdgeId]
  );

  // Nodes of the multiple selection that still exist and are shown
  const multiSelectedNodes = useMemo(() => {
    if (selectedNodeIds.length < 2) return [];
    const ids = new Set(selectedNodeIds);
    return visibleEntities.filter((n) => ids.has(n.id));
  }, [selectedNodeIds, visibleEntities]);
  const multiSelectedIds = useMemo(
    () => new Set(multiSelectedNodes.length >= 2 ? multiSelectedNodes.map((n) => n.id) : []),
    [multiSelectedNodes]
  );

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of entities) {
      const k = n.categoryId ?? UNCLASSIFIED_FILTER_ID;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }, [entities]);

  if (loading) {
    return (
      <div className="h-screen w-screen bg-zinc-950 flex items-center justify-center gap-3 text-zinc-300">
        <span className="s21-slit" aria-hidden="true" />
        <span className="text-sm">Chargement du graphe depuis SurrealDB…</span>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="h-screen w-screen bg-zinc-950 flex flex-col items-center justify-center gap-4 text-zinc-200">
        <p className="text-sm text-rose-400">{error ?? 'Projet introuvable.'}</p>
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 rounded-xl bg-zinc-900 border border-filet text-xs hover:bg-zinc-800"
        >
          Retour aux projets
        </button>
      </div>
    );
  }

  const unclassifiedCount = categoryCounts.get(UNCLASSIFIED_FILTER_ID) ?? 0;

  return (
    <div className="h-screen w-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* ==================== TOP BAR ==================== */}
      <header className="h-14 shrink-0 px-4 border-b border-filet bg-zinc-900/90 flex items-center justify-between gap-4 z-30">
        <div className="flex items-center gap-2.5 min-w-0">
          <img src={logoWhite} alt="Teriak47" className="w-7 h-7 shrink-0" />
          <button
            type="button"
            onClick={onBack}
            title="Retour au gestionnaire de projets"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-zinc-100 bg-zinc-950 hover:bg-zinc-800 border border-filet transition-colors shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Projets</span>
          </button>

          <button
            type="button"
            onClick={() => setLeftSidebarOpen((v) => !v)}
            title={leftSidebarOpen ? 'Masquer les filtres' : 'Afficher les filtres et catégories'}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 border border-transparent hover:border-filet-fort transition-colors shrink-0"
          >
            {leftSidebarOpen ? (
              <PanelLeftClose className="w-4 h-4" />
            ) : (
              <PanelLeftOpen className="w-4 h-4" />
            )}
          </button>

          <div className="h-4 w-px bg-zinc-800 shrink-0" />

          {editingProjectName ? (
            <input
              type="text"
              autoFocus
              value={projectNameDraft}
              onChange={(e) => setProjectNameDraft(e.target.value)}
              onBlur={() => void commitProjectTitle()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitProjectTitle();
                if (e.key === 'Escape') {
                  setProjectNameDraft(project.name);
                  setEditingProjectName(false);
                }
              }}
              className="px-2 py-1 text-sm font-semibold rounded bg-zinc-950 border border-cyan-500 text-zinc-100 outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingProjectName(true)}
              title="Cliquer pour renommer le projet"
              className="text-sm font-semibold text-zinc-100 hover:text-cyan-300 truncate max-w-[240px] transition-colors"
            >
              {project.name}
            </button>
          )}

          <span className="hidden lg:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-950 border border-filet text-xs text-zinc-400 shrink-0">
            {saveState === 'saving' ? (
              <>
                <span className="s21-slit" aria-hidden="true" />
                <span>Sauvegarde…</span>
              </>
            ) : saveState === 'error' ? (
              <>
                <AlertTriangle className="w-3 h-3 text-red-400" />
                <span
                  className="text-red-300 truncate max-w-[220px]"
                  title={saveError ?? undefined}
                >
                  Échec de l'enregistrement
                </span>
                {hasRetryableSaves() && (
                  <button
                    type="button"
                    onClick={() => void retryFailedSaves()}
                    className="underline text-cyan-300 hover:text-cyan-200"
                  >
                    Réessayer
                  </button>
                )}
                <button
                  type="button"
                  onClick={dismissSaveError}
                  title="Masquer le message"
                  className="text-zinc-500 hover:text-zinc-300"
                >
                  <X className="w-3 h-3" />
                </button>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                <span>Sauvegardé</span>
              </>
            )}
          </span>
        </div>

        {/* Center: Instant Search Bar */}
        <div className="relative flex-1 max-w-md">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 180)}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchFocused(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchMatches.length > 0) {
                  focusNode(searchMatches[0]);
                } else if (e.key === 'Escape') {
                  setSearchQuery('');
                  searchInputRef.current?.blur();
                }
              }}
              placeholder="Rechercher… ou Clé:valeur, ex. IP:192.0.2 (Ctrl+K)"
              title="Recherche dans les titres, notes, catégories et attributs. « Clé:valeur » cherche dans un attribut précis, « Clé: » trouve les nœuds qui l’ont."
              className="w-full pl-8 pr-16 py-1.5 text-xs rounded-xl bg-zinc-950 border border-filet text-zinc-100 placeholder-zinc-500 focus:border-cyan-500 focus:outline-none transition-colors"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 text-zinc-400 hover:text-zinc-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <kbd className="hidden sm:inline-block absolute right-2.5 px-1.5 py-0.5 text-xs font-mono text-zinc-500 bg-zinc-900 border border-filet rounded">
                Ctrl+K
              </kbd>
            )}
          </div>

          {searchFocused && searchQuery.trim().length > 0 && (
            <div className="absolute left-0 right-0 mt-1.5 rounded-xl bg-zinc-900 border border-filet shadow-2xl overflow-hidden max-h-72 overflow-y-auto z-50">
              {searchMatches.length === 0 ? (
                <div className="px-3.5 py-3 text-xs text-zinc-400">
                  Aucun indice ne correspond à « {searchQuery} ».
                </div>
              ) : (
                <div className="divide-y divide-filet/70">
                  {searchMatches.map((node) => {
                    const cat = node.categoryId ? categoryMap.get(node.categoryId) : null;
                    return (
                      <button
                        key={node.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          focusNode(node);
                        }}
                        className="w-full px-3.5 py-2.5 text-left hover:bg-zinc-800/80 flex items-center justify-between gap-3 transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-zinc-100 truncate">
                            {node.title}
                          </div>
                          {Object.keys(node.metadata).length > 0 && (
                            <div className="text-xs font-mono text-zinc-400 truncate mt-0.5">
                              {Object.entries(node.metadata)
                                .slice(0, 2)
                                .map(([k, v]) => `${k}: ${v}`)
                                .join(' • ')}
                            </div>
                          )}
                        </div>
                        {cat && (
                          <span
                            className="px-2 py-0.5 rounded text-xs font-medium shrink-0"
                            style={{
                              backgroundColor: `${cat.color}22`,
                              color: cat.color,
                            }}
                          >
                            {cat.name}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Quick Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {historyNotice && (
            <span role="status" className="hidden lg:inline text-xs text-zinc-400 max-w-[220px] truncate">
              {historyNotice}
            </span>
          )}
          <div className="flex items-center rounded-xl border border-filet bg-zinc-950 overflow-hidden">
            <button
              type="button"
              onClick={undo}
              disabled={!historyRef.current.canUndo}
              title={
                historyRef.current.canUndo
                  ? `Annuler : ${historyRef.current.undoLabel} (Ctrl+Z)`
                  : 'Rien à annuler'
              }
              aria-label="Annuler"
              className="px-2 py-1.5 text-zinc-300 hover:bg-zinc-800 disabled:text-zinc-600 disabled:hover:bg-transparent transition-colors"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!historyRef.current.canRedo}
              title={
                historyRef.current.canRedo
                  ? `Rétablir : ${historyRef.current.redoLabel} (Ctrl+Y)`
                  : 'Rien à rétablir'
              }
              aria-label="Rétablir"
              className="px-2 py-1.5 border-l border-filet text-zinc-300 hover:bg-zinc-800 disabled:text-zinc-600 disabled:hover:bg-transparent transition-colors"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={handleCreateNodeCenter}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-zinc-950 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nœud</span>
          </button>

          {/* Layout Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setLayoutMenuOpen((v) => !v)}
              title="Organiser le graphe"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-zinc-950 hover:bg-zinc-800 border border-filet text-zinc-300 transition-colors"
            >
              <LayoutGrid className="w-3.5 h-3.5 text-zinc-400" />
              <span className="hidden md:inline">Disposition</span>
            </button>

            {layoutMenuOpen && (
              <div className="absolute right-0 mt-1.5 w-60 rounded-xl bg-zinc-900 border border-filet shadow-2xl py-1 z-50">
                <div className="px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Disposition du graphe
                </div>
                <button
                  type="button"
                  onClick={() => void handleOrganizeConstellation()}
                  className="w-full px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800 flex items-center gap-2"
                >
                  <Orbit className="w-3.5 h-3.5 text-amber-400" />
                  <span>Constellation organique (Force)</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleAutoAlign('LR')}
                  className="w-full px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800 flex items-center gap-2"
                >
                  <AlignHorizontalJustifyCenter className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Hiérarchie Horizontale (G → D)</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleAutoAlign('TB')}
                  className="w-full px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800 flex items-center gap-2"
                >
                  <AlignVerticalJustifyCenter className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Hiérarchie Verticale (H → B)</span>
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => void handleExportProject()}
            disabled={exporting}
            aria-busy={exporting}
            title="Exporter ce projet en .json"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-zinc-950 hover:bg-zinc-800 border border-filet text-zinc-300 transition-colors disabled:opacity-60 disabled:cursor-wait"
          >
            {exporting ? (
              <Loader2 className="w-3.5 h-3.5 text-zinc-400 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5 text-zinc-400" />
            )}
            <span className="hidden md:inline">{exporting ? 'Export…' : 'Export .json'}</span>
          </button>
        </div>
      </header>

      {exportNotice && (
        <div
          role="alert"
          className={cn(
            'shrink-0 flex items-center justify-between gap-3 px-4 py-2 text-xs border-b z-20',
            exportNotice.kind === 'error'
              ? 'bg-rose-950/60 border-rose-500/40 text-rose-200'
              : 'bg-amber-950/50 border-amber-500/40 text-amber-200'
          )}
        >
          <span className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{exportNotice.message}</span>
          </span>
          <button
            type="button"
            onClick={() => setExportNotice(null)}
            title="Masquer le message"
            className="shrink-0 text-zinc-400 hover:text-zinc-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ==================== MAIN WORKSPACE BODY ==================== */}
      <div className="flex-1 flex min-h-0 relative">
        {/* LEFT SIDEBAR: Filters & Custom Categories */}
        {leftSidebarOpen && (
          <aside className="w-64 shrink-0 h-full bg-zinc-900/90 border-r border-filet flex flex-col justify-between overflow-hidden z-20">
            <div className="flex-1 overflow-y-auto p-3.5 space-y-5">
              {/* Edge Certainty Filter */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  <Filter className="w-3 h-3 text-cyan-400" />
                  <span>Filtre des Relations</span>
                </div>
                <div className="grid grid-cols-1 gap-1">
                  {(
                    [
                      { value: 'all', label: 'Tous les liens', count: relations.length },
                      {
                        value: 'solid',
                        label: '━━ Faits prouvés',
                        count: relations.filter((r) => r.style === 'solid').length,
                      },
                      {
                        value: 'dashed',
                        label: '╌╌ Hypothèses / Théories',
                        count: relations.filter((r) => r.style === 'dashed').length,
                      },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setEdgeFilter(opt.value)}
                      className={cn(
                        'flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors border',
                        edgeFilter === opt.value
                          ? 'bg-zinc-800 border-filet-fort text-zinc-100 font-medium'
                          : 'bg-transparent border-transparent text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                      )}
                    >
                      <span>{opt.label}</span>
                      <span className="text-xs font-mono text-zinc-500">{opt.count}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Categories List & Toggles */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Catégories ({categories.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCategory(null);
                      setCategoryModalOpen(true);
                    }}
                    className="inline-flex items-center gap-0.5 text-xs font-medium text-cyan-400 hover:text-cyan-300"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Ajouter</span>
                  </button>
                </div>

                {hiddenCategoryIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setHiddenCategoryIds(new Set())}
                    className="w-full py-1 px-2 rounded-md bg-cyan-500/10 border border-cyan-500/30 text-xs text-cyan-300 hover:bg-cyan-500/15 transition-colors"
                  >
                    Réafficher toutes les catégories ({hiddenCategoryIds.size} masquée
                    {hiddenCategoryIds.size > 1 ? 's' : ''})
                  </button>
                )}

                <div className="space-y-1">
                  {categories.map((cat, index) => {
                    const Icon = getCategoryIcon(cat.icon);
                    const hidden = hiddenCategoryIds.has(cat.id);
                    const count = categoryCounts.get(cat.id) ?? 0;
                    const isDropTarget =
                      dragCategory !== null && dragCategory.over === index && dragCategory.from !== index;

                    return (
                      <div
                        key={cat.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', cat.id);
                          setDragCategory({ from: index, over: index });
                        }}
                        onDragOver={(e) => {
                          if (!dragCategory) return;
                          e.preventDefault();
                          if (dragCategory.over !== index) setDragCategory({ ...dragCategory, over: index });
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragCategory) void handleReorderCategories(dragCategory.from, index);
                          setDragCategory(null);
                        }}
                        onDragEnd={() => setDragCategory(null)}
                        className={cn(
                          'group flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-lg hover:bg-zinc-800/70 transition-colors',
                          hidden && 'opacity-45',
                          dragCategory?.from === index && 'opacity-40',
                          isDropTarget &&
                            (dragCategory.from > index
                              ? 'shadow-[inset_0_2px_0_var(--accent-fort)]'
                              : 'shadow-[inset_0_-2px_0_var(--accent-fort)]')
                        )}
                      >
                        <button
                          type="button"
                          aria-label={`Déplacer « ${cat.name} » (flèches haut et bas)`}
                          title="Glisser pour réordonner, ou flèches ↑ ↓"
                          onKeyDown={(e) => {
                            if (e.key === 'ArrowUp' && index > 0) {
                              e.preventDefault();
                              void handleReorderCategories(index, index - 1);
                            } else if (e.key === 'ArrowDown' && index < categories.length - 1) {
                              e.preventDefault();
                              void handleReorderCategories(index, index + 1);
                            }
                          }}
                          className="-ml-1 p-0.5 rounded text-zinc-600 hover:text-zinc-300 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                        >
                          <GripVertical className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleCategoryVisibility(cat.id)}
                          className="flex items-center gap-2 min-w-0 flex-1 text-left"
                          title={hidden ? 'Afficher cette catégorie' : 'Masquer cette catégorie'}
                        >
                          <span
                            className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 border"
                            style={{
                              backgroundColor: `${cat.color}22`,
                              borderColor: `${cat.color}77`,
                              color: cat.color,
                            }}
                          >
                            <Icon className="w-3 h-3" />
                          </span>
                          <span className="text-xs text-zinc-200 truncate">{cat.name}</span>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-xs font-mono text-zinc-500 px-1">
                            {count}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCategory(cat);
                              setCategoryModalOpen(true);
                            }}
                            title="Modifier la catégorie"
                            className="p-1 rounded text-zinc-500 hover:text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleCategoryVisibility(cat.id)}
                            title={hidden ? 'Afficher' : 'Masquer'}
                            className="p-1 rounded text-zinc-500 hover:text-zinc-200"
                          >
                            {hidden ? (
                              <EyeOff className="w-3.5 h-3.5 text-amber-400" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {unclassifiedCount > 0 && (
                    <div
                      className={cn(
                        'flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-lg hover:bg-zinc-800/70 transition-colors',
                        hiddenCategoryIds.has(UNCLASSIFIED_FILTER_ID) && 'opacity-45'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleCategoryVisibility(UNCLASSIFIED_FILTER_ID)}
                        className="flex items-center gap-2 min-w-0 flex-1 text-left"
                      >
                        <span className="s21-slit s21-slit--dim ml-1" aria-hidden="true" />
                        <span className="text-xs text-zinc-400 truncate">Non classé</span>
                      </button>
                      <span className="text-xs font-mono text-zinc-500 px-1">
                        {unclassifiedCount}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Updated Constellation Shortcuts Legend */}
            <div className="p-3 border-t border-filet bg-zinc-950/60 space-y-1 text-xs text-zinc-500">
              <div>
                <strong className="text-zinc-300">Double-clic fond :</strong> créer un nœud
              </div>
              <div>
                <strong className="text-zinc-300">Cadre autour du nœud / Shift+glisser :</strong> relier
              </div>
              <div>
                <strong className="text-zinc-300">Tirer dans le vide :</strong> créer nœud relié
              </div>
              <div>
                <strong className="text-zinc-300">Double-clic lien :</strong> éditer le label
              </div>
              <div>
                <strong className="text-zinc-300">Clic droit nœud :</strong> changer de catégorie
              </div>
              <div>
                <strong className="text-zinc-300">Ctrl+clic / Maj+glisser fond :</strong> sélection multiple
              </div>
            </div>
          </aside>
        )}

        {/* CENTER: Constellation Network Graph Canvas */}
        <div
          className="flex-1 h-full relative"
          onClick={() => {
            if (layoutMenuOpen) setLayoutMenuOpen(false);
          }}
        >
          <GraphCanvas
            ref={canvasRef}
            nodes={visibleEntities}
            edges={visibleRelations}
            categories={categories}
            selectedNodeId={selectedNodeId}
            selectedNodeIds={multiSelectedIds}
            selectedEdgeId={selectedEdgeId}
            autoEditEdgeId={autoEditEdgeId}
            searchQuery={searchQuery}
            searchMatchIds={searchMatchIds}
            onSelectNode={setSelectedNodeId}
            onSelectEdge={setSelectedEdgeId}
            onSelectNodes={selectNodes}
            onCreateNodeAt={createNodeAt}
            onCreateEdge={handleCreateEdge}
            onCreateLinkedNodeAt={handleCreateLinkedNodeAt}
            onUpdateNodePosition={handleUpdateNodePosition}
            onUpdateBatchPositions={handleUpdateBatchPositions}
            onCommitEdgeLabel={handleCommitEdgeLabel}
            onDeleteNode={handleDeleteNode}
            onDeleteNodes={handleDeleteNodes}
            onDeleteEdge={handleDeleteEdge}
            onOrganizeConstellation={handleOrganizeConstellation}
            onChangeNodeCategory={handleChangeNodeCategory}
          />
        </div>

        {/* RIGHT SIDEBAR: Node / Edge Inspector, or the multiple selection */}
        {multiSelectedNodes.length >= 2 && (
          <MultiSelectionPanel
            nodes={multiSelectedNodes}
            categories={categories}
            onClear={() => setSelectedNodeIds([])}
            onDelete={(ids) => void handleDeleteNodes(ids)}
          />
        )}
        <InspectorSidebar
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          allNodes={entities}
          categories={categories}
          takePendingEditRef={takePendingEditRef}
          takePendingEdgeEditRef={takePendingEdgeEditRef}
          onClose={() => {
            setSelectedNodeId(null);
            setSelectedEdgeId(null);
          }}
          onUpdateNode={handleUpdateNode}
          onDeleteNode={handleDeleteNode}
          onUpdateEdge={handleUpdateEdge}
          onDeleteEdge={handleDeleteEdge}
          onOpenNewCategory={() => {
            setEditingCategory(null);
            setCategoryModalOpen(true);
          }}
        />
      </div>

      {/* Category Create/Edit Modal */}
      <AppFooter />

      <CategoryModal
        isOpen={categoryModalOpen}
        initialCategory={editingCategory}
        onClose={() => setCategoryModalOpen(false)}
        onSave={handleSaveCategory}
        onDelete={handleDeleteCategory}
        knownKeys={projectMetadataKeys}
        usedBy={
          editingCategory
            ? entities.filter((n) => n.categoryId === editingCategory.id).map((n) => n.title)
            : []
        }
      />
    </div>
  );
}
