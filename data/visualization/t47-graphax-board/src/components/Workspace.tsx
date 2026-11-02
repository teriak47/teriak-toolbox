import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignHorizontalJustifyCenter,
  AlignVerticalJustifyCenter,
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
import { InspectorSidebar } from '@/components/InspectorSidebar';
import { CategoryModal } from '@/components/CategoryModal';
import { getCategoryIcon } from '@/lib/icons';
import { computeAutoLayout } from '@/lib/layout';
import { computeConstellationLayout } from '@/lib/forceLayout';
import { cn } from '@/lib/utils';

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
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');

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

      setSaveState('saving');
      try {
        const { node } = await api.createNode(projectId, {
          title: 'Nouvel indice',
          categoryId: defaultCategory,
          positionX: Math.round(positionX),
          positionY: Math.round(positionY),
          content: '',
          metadata: {},
        });
        setEntities((prev) => [...prev, node]);
        setSelectedEdgeId(null);
        setSelectedNodeId(node.id);
        return node;
      } catch (err) {
        console.error('[Graphax] Création du nœud impossible :', err);
        return null;
      } finally {
        setSaveState('saved');
      }
    },
    [projectId, categories, hiddenCategoryIds]
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

      setSaveState('saving');
      try {
        const { edge } = await api.createEdge(projectId, {
          sourceNodeId,
          targetNodeId,
          label: '',
          style: defaultStyle,
          directed: true,
        });
        setRelations((prev) => [...prev, edge]);
        setSelectedNodeId(null);
        setSelectedEdgeId(edge.id);
        setAutoEditEdgeId(edge.id);
      } finally {
        setSaveState('saved');
      }
    },
    [projectId, edgeFilter]
  );

  // Dragging a link wire into empty space -> spawns a new node already linked!
  const handleCreateLinkedNodeAt = useCallback(
    async (sourceNodeId: string, worldX: number, worldY: number) => {
      const defaultCategory =
        categories.find((c) => !hiddenCategoryIds.has(c.id))?.id ?? categories[0]?.id ?? null;
      const defaultStyle: EdgeStyle = edgeFilter === 'dashed' ? 'dashed' : 'solid';

      setSaveState('saving');
      try {
        const { node } = await api.createNode(projectId, {
          title: 'Nouvel indice',
          categoryId: defaultCategory,
          positionX: worldX,
          positionY: worldY,
          content: '',
          metadata: {},
        });
        const { edge } = await api.createEdge(projectId, {
          sourceNodeId,
          targetNodeId: node.id,
          label: '',
          style: defaultStyle,
          directed: true,
        });
        setEntities((prev) => [...prev, node]);
        setRelations((prev) => [...prev, edge]);
        setSelectedEdgeId(null);
        setSelectedNodeId(node.id);
      } finally {
        setSaveState('saved');
      }
    },
    [projectId, categories, hiddenCategoryIds, edgeFilter]
  );

  // Persist single node position
  const handleUpdateNodePosition = useCallback(
    async (nodeId: string, posX: number, posY: number) => {
      setEntities((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, positionX: posX, positionY: posY } : n))
      );
      setSaveState('saving');
      try {
        await api.updateNodePosition(nodeId, posX, posY);
      } finally {
        setSaveState('saved');
      }
    },
    []
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
      setSaveState('saving');
      try {
        await api.updateBatchPositions(projectId, positions);
      } finally {
        setSaveState('saved');
      }
    },
    [projectId]
  );

  // Commit inline edge label
  const handleCommitEdgeLabel = useCallback(async (edgeId: string, newLabel: string) => {
    setAutoEditEdgeId((curr) => (curr === edgeId ? null : curr));
    setRelations((prev) =>
      prev.map((e) => (e.id === edgeId ? { ...e, label: newLabel } : e))
    );
    setSaveState('saving');
    try {
      const { edge } = await api.updateEdge(edgeId, { label: newLabel });
      setRelations((prev) => prev.map((e) => (e.id === edgeId ? edge : e)));
    } finally {
      setSaveState('saved');
    }
  }, []);

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
      setSaveState('saving');
      try {
        const { node } = await api.updateNode(nodeId, patch);
        setEntities((prev) => prev.map((n) => (n.id === nodeId ? node : n)));
      } finally {
        setSaveState('saved');
      }
    },
    []
  );

  const handleDeleteNode = useCallback(async (nodeId: string) => {
    setEntities((prev) => prev.filter((n) => n.id !== nodeId));
    setRelations((prev) =>
      prev.filter((e) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId)
    );
    setSelectedNodeId((curr) => (curr === nodeId ? null : curr));

    setSaveState('saving');
    try {
      await api.deleteNode(nodeId);
    } finally {
      setSaveState('saved');
    }
  }, []);

  // Edge updates from Inspector
  const handleUpdateEdge = useCallback(
    async (
      edgeId: string,
      patch: Partial<{
        label: string;
        style: EdgeStyle;
        directed: boolean;
        notes: string;
        reverse: boolean;
      }>
    ) => {
      if (!patch.reverse) {
        setRelations((prev) =>
          prev.map((e) => (e.id === edgeId ? { ...e, ...patch } : e))
        );
      }
      setSaveState('saving');
      try {
        const { edge, replacedId } = await api.updateEdge(edgeId, patch);
        if (replacedId) {
          setRelations((prev) =>
            prev.map((e) => (e.id === replacedId ? edge : e))
          );
          setSelectedEdgeId(edge.id);
        } else {
          setRelations((prev) => prev.map((e) => (e.id === edgeId ? edge : e)));
        }
      } finally {
        setSaveState('saved');
      }
    },
    []
  );

  const handleDeleteEdge = useCallback(async (edgeId: string) => {
    setRelations((prev) => prev.filter((e) => e.id !== edgeId));
    setSelectedEdgeId((curr) => (curr === edgeId ? null : curr));

    setSaveState('saving');
    try {
      await api.deleteEdge(edgeId);
    } finally {
      setSaveState('saved');
    }
  }, []);

  // Category CRUD
  const handleSaveCategory = async (data: {
    name: string;
    color: string;
    icon: CategoryIconName;
    shape: CategoryShape;
  }) => {
    setSaveState('saving');
    try {
      if (editingCategory) {
        const { category } = await api.updateCategory(editingCategory.id, data);
        setCategories((prev) =>
          prev.map((c) => (c.id === category.id ? category : c))
        );
      } else {
        const { category } = await api.createCategory(projectId, data);
        setCategories((prev) => [...prev, category]);
      }
    } finally {
      setSaveState('saved');
    }
  };

  const handleDeleteCategory = async (categoryId: string) => {
    setSaveState('saving');
    try {
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
    } finally {
      setSaveState('saved');
    }
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

  // Export JSON directly from workspace
  const handleExportProject = async () => {
    if (!project) return;
    const bundle = await api.exportProject(project.id);
    const slug = project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `graphax-${slug || 'projet'}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const commitProjectTitle = async () => {
    setEditingProjectName(false);
    if (!project) return;
    const trimmed = projectNameDraft.trim();
    if (!trimmed || trimmed === project.name) {
      setProjectNameDraft(project.name);
      return;
    }
    setSaveState('saving');
    try {
      const { project: updated } = await api.updateProject(project.id, { name: trimmed });
      setProject(updated);
    } finally {
      setSaveState('saved');
    }
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
        <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
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
          className="px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs hover:bg-zinc-800"
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
      <header className="h-14 shrink-0 px-4 border-b border-zinc-800 bg-zinc-900/90 backdrop-blur-md flex items-center justify-between gap-4 z-30">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onBack}
            title="Retour au gestionnaire de projets"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-zinc-100 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 transition-colors shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Projets</span>
          </button>

          <button
            type="button"
            onClick={() => setLeftSidebarOpen((v) => !v)}
            title={leftSidebarOpen ? 'Masquer les filtres' : 'Afficher les filtres et catégories'}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 border border-transparent hover:border-zinc-700 transition-colors shrink-0"
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

          <span className="hidden lg:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-400 shrink-0">
            {saveState === 'saving' ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
                <span>Sauvegarde…</span>
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
              className="w-full pl-8 pr-16 py-1.5 text-xs rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-100 placeholder-zinc-500 focus:border-cyan-500 focus:outline-none transition-colors"
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
              <kbd className="hidden sm:inline-block absolute right-2.5 px-1.5 py-0.5 text-[10px] font-mono text-zinc-500 bg-zinc-900 border border-zinc-800 rounded">
                Ctrl+K
              </kbd>
            )}
          </div>

          {searchFocused && searchQuery.trim().length > 0 && (
            <div className="absolute left-0 right-0 mt-1.5 rounded-xl bg-zinc-900 border border-zinc-800 shadow-2xl overflow-hidden max-h-72 overflow-y-auto z-50">
              {searchMatches.length === 0 ? (
                <div className="px-3.5 py-3 text-xs text-zinc-400">
                  Aucun indice ne correspond à « {searchQuery} ».
                </div>
              ) : (
                <div className="divide-y divide-zinc-800/70">
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
                            <div className="text-[10.5px] font-mono text-zinc-400 truncate mt-0.5">
                              {Object.entries(node.metadata)
                                .slice(0, 2)
                                .map(([k, v]) => `${k}: ${v}`)
                                .join(' • ')}
                            </div>
                          )}
                        </div>
                        {cat && (
                          <span
                            className="px-2 py-0.5 rounded text-[10px] font-medium shrink-0"
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
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 transition-colors"
            >
              <LayoutGrid className="w-3.5 h-3.5 text-zinc-400" />
              <span className="hidden md:inline">Disposition</span>
            </button>

            {layoutMenuOpen && (
              <div className="absolute right-0 mt-1.5 w-60 rounded-xl bg-zinc-900 border border-zinc-800 shadow-2xl py-1 z-50">
                <div className="px-3 py-1.5 text-[10.5px] font-medium uppercase tracking-wider text-zinc-500">
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
            title="Exporter ce projet en .json"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-zinc-400" />
            <span className="hidden md:inline">Export .json</span>
          </button>
        </div>
      </header>

      {/* ==================== MAIN WORKSPACE BODY ==================== */}
      <div className="flex-1 flex min-h-0 relative">
        {/* LEFT SIDEBAR: Filters & Custom Categories */}
        {leftSidebarOpen && (
          <aside className="w-64 shrink-0 h-full bg-zinc-900/90 border-r border-zinc-800 flex flex-col justify-between overflow-hidden z-20">
            <div className="flex-1 overflow-y-auto p-3.5 space-y-5">
              {/* Edge Certainty Filter */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
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
                          ? 'bg-zinc-800 border-zinc-700 text-zinc-100 font-medium'
                          : 'bg-transparent border-transparent text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                      )}
                    >
                      <span>{opt.label}</span>
                      <span className="text-[10.5px] font-mono text-zinc-500">{opt.count}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Categories List & Toggles */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Catégories ({categories.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCategory(null);
                      setCategoryModalOpen(true);
                    }}
                    className="inline-flex items-center gap-0.5 text-[11px] font-medium text-cyan-400 hover:text-cyan-300"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Ajouter</span>
                  </button>
                </div>

                {hiddenCategoryIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setHiddenCategoryIds(new Set())}
                    className="w-full py-1 px-2 rounded-md bg-cyan-500/10 border border-cyan-500/30 text-[11px] text-cyan-300 hover:bg-cyan-500/15 transition-colors"
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
                          <span className="text-[10.5px] font-mono text-zinc-500 px-1">
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
                        <span className="w-2.5 h-2.5 rounded-full bg-zinc-500 ml-1" />
                        <span className="text-xs text-zinc-400 truncate">Non classé</span>
                      </button>
                      <span className="text-[10.5px] font-mono text-zinc-500 px-1">
                        {unclassifiedCount}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Updated Constellation Shortcuts Legend */}
            <div className="p-3 border-t border-zinc-800 bg-zinc-950/60 space-y-1 text-[10.5px] text-zinc-500">
              <div>
                <strong className="text-zinc-300">Double-clic fond :</strong> créer un nœud
              </div>
              <div>
                <strong className="text-zinc-300">Anneau halo / Shift+glisser :</strong> relier
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
