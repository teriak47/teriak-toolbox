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
} from 'lucide-react';
import type {
  Category,
  CategoryIconName,
  CategoryShape,
  EdgeStyle,
  GraphEdge,
  GraphNode,
  NodeMetadata,
  Project,
} from '@shared/types';
import { api } from '@/api/client';
import { GraphCanvas, type GraphCanvasHandle } from '@/components/GraphCanvas';
import { INSPECTOR_SAVE_DELAY_MS, InspectorSidebar } from '@/components/InspectorSidebar';
import { downloadProjectExport } from '@/lib/exportProject';
import { useSaveQueue } from '@/hooks/useSaveQueue';
import { CategoryModal } from '@/components/CategoryModal';
import { getCategoryIcon } from '@/lib/icons';
import { computeConstellationLayout } from '@/lib/forceLayout';
import { cn } from '@/lib/utils';
import { AppFooter } from '@/components/AppFooter';
import logoWhite from '@/ds/assets/logo-white.svg';

const UNCLASSIFIED_FILTER_ID = '__unclassified__';

type EdgeFilterMode = 'all' | 'solid' | 'dashed';

interface WorkspaceProps {
  projectId: string;
  onBack: () => void;
}

export function Workspace({ projectId, onBack }: WorkspaceProps) {
  const canvasRef = useRef<GraphCanvasHandle>(null);

  // Core domain state
  const [project, setProject] = useState<Project | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [entities, setEntities] = useState<GraphNode[]>([]);
  const [relations, setRelations] = useState<GraphEdge[]>([]);
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

  // Selection & inline editing state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
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

  // Search matches across title, content, metadata, category
  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
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

  const searchMatchIds = useMemo(
    () => new Set(searchMatches.map((n) => n.id)),
    [searchMatches]
  );

  // Create node at world coordinates
  const createNodeAt = useCallback(
    async (positionX: number, positionY: number): Promise<GraphNode | null> => {
      const defaultCategory =
        categories.find((c) => !hiddenCategoryIds.has(c.id))?.id ?? categories[0]?.id ?? null;

      const created = await runSave(() =>
        api.createNode(projectId, {
          title: 'Nouvel indice',
          categoryId: defaultCategory,
          positionX: Math.round(positionX),
          positionY: Math.round(positionY),
          content: '',
          metadata: {},
        })
      );
      if (!created) return null;
      setEntities((prev) => [...prev, created.node]);
      setSelectedEdgeId(null);
      setSelectedNodeId(created.node.id);
      return created.node;
    },
    [projectId, categories, hiddenCategoryIds, runSave]
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
      setRelations((prev) => [...prev, created.edge]);
      setSelectedNodeId(null);
      setSelectedEdgeId(created.edge.id);
      setAutoEditEdgeId(created.edge.id);
    },
    [projectId, edgeFilter, runSave]
  );

  // Dragging a link wire into empty space -> spawns a new node already linked!
  const handleCreateLinkedNodeAt = useCallback(
    async (sourceNodeId: string, worldX: number, worldY: number) => {
      const defaultCategory =
        categories.find((c) => !hiddenCategoryIds.has(c.id))?.id ?? categories[0]?.id ?? null;
      const defaultStyle: EdgeStyle = edgeFilter === 'dashed' ? 'dashed' : 'solid';

      const created = await runSave(async () => {
        const { node } = await api.createNode(projectId, {
          title: 'Nouvel indice',
          categoryId: defaultCategory,
          positionX: worldX,
          positionY: worldY,
          content: '',
          metadata: {},
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
      setEntities((prev) => [...prev, created.node]);
      setRelations((prev) => [...prev, created.edge]);
      setSelectedEdgeId(null);
      setSelectedNodeId(created.node.id);
    },
    [projectId, categories, hiddenCategoryIds, edgeFilter, runSave]
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
    async (nodeId: string, posX: number, posY: number) => {
      setEntities((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, positionX: posX, positionY: posY } : n))
      );
      pendingPositionsRef.current.set(nodeId, { id: nodeId, positionX: posX, positionY: posY });
      await savePositions();
    },
    [savePositions]
  );

  // Persist batch node positions (from live physics or layout)
  const handleUpdateBatchPositions = useCallback(
    async (positions: Array<{ id: string; positionX: number; positionY: number }>) => {
      if (positions.length === 0) return;
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
    [savePositions]
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
      setRelations((prev) =>
        prev.map((e) => (e.id === edgeId ? { ...e, label: newLabel } : e))
      );
      await queueEdgeFields(edgeId, { label: newLabel });
    },
    [queueEdgeFields]
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
      setEntities((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, ...patch } : n))
      );
      // Merge with any earlier patch that failed, so a retry never loses a field
      const merged = { ...(nodePatchesRef.current.get(nodeId) ?? {}), ...patch };
      nodePatchesRef.current.set(nodeId, merged);
      await runSave(
        async () => {
          const { node } = await api.updateNode(nodeId, merged);
          nodePatchesRef.current.delete(nodeId);
          setEntities((prev) => prev.map((n) => (n.id === nodeId ? node : n)));
        },
        { retryKey: `node:${nodeId}` }
      );
    },
    [runSave]
  );

  const handleDeleteNode = useCallback(async (nodeId: string) => {
    setEntities((prev) => prev.filter((n) => n.id !== nodeId));
    setRelations((prev) =>
      prev.filter((e) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId)
    );
    setSelectedNodeId((curr) => (curr === nodeId ? null : curr));

    await runSave(() => api.deleteNode(nodeId), { retryKey: `delete-node:${nodeId}` });
  }, [runSave]);

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

      if (!reverse) {
        setRelations((prev) =>
          prev.map((e) => (e.id === edgeId ? { ...e, ...fields } : e))
        );
        await queueEdgeFields(edgeId, fields);
        return;
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
      // A reversal is not replayed (it would flip the link twice), but its fields are
      if (!reversed && edgePatchesRef.current.has(startId)) {
        keepForRetry(`edge:${startId}`, () => edgeFieldsOp(startId));
      }
    },
    [runSave, enqueueEdgeOp, resolveEdgeId, queueEdgeFields, edgeFieldsOp]
  );

  const handleDeleteEdge = useCallback(async (edgeId: string) => {
    setRelations((prev) => prev.filter((e) => e.id !== edgeId));
    setSelectedEdgeId((curr) => (curr === edgeId ? null : curr));

    await runSave(
      () => enqueueEdgeOp(() => api.deleteEdge(resolveEdgeId(edgeId))),
      { retryKey: `delete-edge:${edgeId}` }
    );
  }, [runSave, enqueueEdgeOp, resolveEdgeId]);

  // Category CRUD
  const handleSaveCategory = async (data: {
    name: string;
    color: string;
    icon: CategoryIconName;
    shape: CategoryShape;
  }) => {
    await runSave(
      async () => {
        if (editingCategory) {
          const { category } = await api.updateCategory(editingCategory.id, data);
          setCategories((prev) =>
            prev.map((c) => (c.id === category.id ? category : c))
          );
        } else {
          const { category } = await api.createCategory(projectId, data);
          setCategories((prev) => [...prev, category]);
        }
      },
      { rethrow: true }
    );
  };

  const handleDeleteCategory = async (categoryId: string) => {
    await runSave(
      async () => {
        await api.deleteCategory(categoryId);
        setCategories((prev) => prev.filter((c) => c.id !== categoryId));
        setEntities((prev) =>
          prev.map((n) => (n.categoryId === categoryId ? { ...n, categoryId: null } : n))
        );
        setHiddenCategoryIds((prev) => {
          const next = new Set(prev);
          next.delete(categoryId);
          return next;
        });
      },
      { rethrow: true }
    );
  };

  // Layouts: Constellation (Force) or Hierarchical (Dagre)
  const handleOrganizeConstellation = useCallback(async () => {
    setLayoutMenuOpen(false);
    if (visibleEntities.length === 0) return;

    const newPositions = computeConstellationLayout(visibleEntities, relations);
    await handleUpdateBatchPositions(newPositions);
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
    await handleUpdateBatchPositions(newPositions);
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
              placeholder="Rechercher un nœud, une note, une IP, un attribut… (Ctrl+K)"
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
                  {categories.map((cat) => {
                    const Icon = getCategoryIcon(cat.icon);
                    const hidden = hiddenCategoryIds.has(cat.id);
                    const count = categoryCounts.get(cat.id) ?? 0;

                    return (
                      <div
                        key={cat.id}
                        className={cn(
                          'group flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-lg hover:bg-zinc-800/70 transition-colors',
                          hidden && 'opacity-45'
                        )}
                      >
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
            selectedEdgeId={selectedEdgeId}
            autoEditEdgeId={autoEditEdgeId}
            searchQuery={searchQuery}
            searchMatchIds={searchMatchIds}
            onSelectNode={setSelectedNodeId}
            onSelectEdge={setSelectedEdgeId}
            onCreateNodeAt={createNodeAt}
            onCreateEdge={handleCreateEdge}
            onCreateLinkedNodeAt={handleCreateLinkedNodeAt}
            onUpdateNodePosition={handleUpdateNodePosition}
            onUpdateBatchPositions={handleUpdateBatchPositions}
            onCommitEdgeLabel={handleCommitEdgeLabel}
            onDeleteNode={handleDeleteNode}
            onDeleteEdge={handleDeleteEdge}
            onOrganizeConstellation={handleOrganizeConstellation}
          />
        </div>

        {/* RIGHT SIDEBAR: Node / Edge Inspector */}
        <InspectorSidebar
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          allNodes={entities}
          categories={categories}
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
      />
    </div>
  );
}
