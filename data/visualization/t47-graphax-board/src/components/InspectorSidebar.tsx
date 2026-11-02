import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowLeftRight,
  ArrowRight,
  Eye,
  FileEdit,
  Minus,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { Category, EdgeStyle, GraphEdge, GraphNode, NodeMetadata } from '@shared/types';
import { cn } from '@/lib/utils';

interface InspectorSidebarProps {
  selectedNode: GraphNode | null;
  selectedEdge: GraphEdge | null;
  allNodes: GraphNode[];
  categories: Category[];
  onClose: () => void;
  onUpdateNode: (
    nodeId: string,
    patch: Partial<{
      title: string;
      categoryId: string | null;
      content: string;
      metadata: NodeMetadata;
    }>
  ) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onUpdateEdge: (
    edgeId: string,
    patch: Partial<{
      label: string;
      style: EdgeStyle;
      directed: boolean;
      notes: string;
      reverse: boolean;
    }>
  ) => Promise<void>;
  onDeleteEdge: (edgeId: string) => Promise<void>;
  onOpenNewCategory: () => void;
}

const METADATA_PRESETS: Array<{ key: string; defaultVal: string }> = [
  { key: 'Fiabilité', defaultVal: 'Confirmé' },
  { key: 'Statut', defaultVal: 'Actif' },
  { key: 'Date', defaultVal: new Date().toISOString().slice(0, 10) },
  { key: 'Source', defaultVal: '' },
  { key: 'IP / Hash', defaultVal: '' },
];

const EDGE_LABEL_SUGGESTIONS = [
  'communique avec',
  'confirme',
  'contredit',
  'appartient à',
  'a trahi',
  'lié à',
];

export function InspectorSidebar({
  selectedNode,
  selectedEdge,
  allNodes,
  categories,
  onClose,
  onUpdateNode,
  onDeleteNode,
  onUpdateEdge,
  onDeleteEdge,
  onOpenNewCategory,
}: InspectorSidebarProps) {
  // Node draft state
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [metaRows, setMetaRows] = useState<Array<{ id: string; key: string; value: string }>>([]);
  const [noteTab, setNoteTab] = useState<'write' | 'preview'>('write');
  const [confirmDeleteNode, setConfirmDeleteNode] = useState(false);

  // Edge draft state
  const [edgeLabel, setEdgeLabel] = useState('');
  const [edgeNotes, setEdgeNotes] = useState('');
  const [confirmDeleteEdge, setConfirmDeleteEdge] = useState(false);

  // Pending flush refs to ensure zero data loss on rapid selection change
  const pendingNodeFlushRef = useRef<{
    nodeId: string;
    patch: Partial<{ title: string; content: string; metadata: NodeMetadata }>;
  } | null>(null);
  const nodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pendingEdgeFlushRef = useRef<{
    edgeId: string;
    patch: Partial<{ label: string; notes: string }>;
  } | null>(null);
  const edgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPendingNode = () => {
    if (nodeTimerRef.current) {
      clearTimeout(nodeTimerRef.current);
      nodeTimerRef.current = null;
    }
    if (pendingNodeFlushRef.current) {
      const { nodeId, patch } = pendingNodeFlushRef.current;
      pendingNodeFlushRef.current = null;
      void onUpdateNode(nodeId, patch);
    }
  };

  const flushPendingEdge = () => {
    if (edgeTimerRef.current) {
      clearTimeout(edgeTimerRef.current);
      edgeTimerRef.current = null;
    }
    if (pendingEdgeFlushRef.current) {
      const { edgeId, patch } = pendingEdgeFlushRef.current;
      pendingEdgeFlushRef.current = null;
      void onUpdateEdge(edgeId, patch);
    }
  };

  // Sync when selectedNode ID changes
  useEffect(() => {
    flushPendingNode();
    setConfirmDeleteNode(false);
    if (selectedNode) {
      setTitle(selectedNode.title);
      setCategoryId(selectedNode.categoryId);
      setContent(selectedNode.content);
      setMetaRows(
        Object.entries(selectedNode.metadata ?? {}).map(([k, v], idx) => ({
          id: `${idx}-${k}`,
          key: k,
          value: v,
        }))
      );
    }
    return () => {
      flushPendingNode();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode?.id]);

  // Sync when selectedEdge ID changes (or external inline label commit updates label)
  useEffect(() => {
    flushPendingEdge();
    setConfirmDeleteEdge(false);
    if (selectedEdge) {
      setEdgeLabel(selectedEdge.label);
      setEdgeNotes(selectedEdge.notes ?? '');
    }
    return () => {
      flushPendingEdge();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEdge?.id]);

  useEffect(() => {
    if (selectedEdge && !pendingEdgeFlushRef.current) {
      setEdgeLabel(selectedEdge.label);
    }
  }, [selectedEdge?.label, selectedEdge]);

  if (!selectedNode && !selectedEdge) return null;

  const scheduleNodePatch = (
    nodeId: string,
    patch: Partial<{ title: string; content: string; metadata: NodeMetadata }>
  ) => {
    const prev =
      pendingNodeFlushRef.current?.nodeId === nodeId ? pendingNodeFlushRef.current.patch : {};
    pendingNodeFlushRef.current = {
      nodeId,
      patch: { ...prev, ...patch },
    };
    if (nodeTimerRef.current) clearTimeout(nodeTimerRef.current);
    nodeTimerRef.current = setTimeout(() => {
      flushPendingNode();
    }, 350);
  };

  const scheduleEdgePatch = (
    edgeId: string,
    patch: Partial<{ label: string; notes: string }>
  ) => {
    const prev =
      pendingEdgeFlushRef.current?.edgeId === edgeId ? pendingEdgeFlushRef.current.patch : {};
    pendingEdgeFlushRef.current = {
      edgeId,
      patch: { ...prev, ...patch },
    };
    if (edgeTimerRef.current) clearTimeout(edgeTimerRef.current);
    edgeTimerRef.current = setTimeout(() => {
      flushPendingEdge();
    }, 350);
  };

  const rowsToMetadata = (
    rows: Array<{ id: string; key: string; value: string }>
  ): NodeMetadata => {
    const out: NodeMetadata = {};
    for (const r of rows) {
      const k = r.key.trim();
      if (k) out[k] = r.value;
    }
    return out;
  };

  const updateMetaRows = (nextRows: Array<{ id: string; key: string; value: string }>) => {
    setMetaRows(nextRows);
    if (selectedNode) {
      scheduleNodePatch(selectedNode.id, { metadata: rowsToMetadata(nextRows) });
    }
  };

  // ==================== NODE INSPECTOR ====================
  if (selectedNode) {
    const activeCat = categories.find((c) => c.id === categoryId) ?? null;

    return (
      <aside className="w-[390px] shrink-0 h-full bg-zinc-900/95 border-l border-zinc-800 flex flex-col overflow-hidden z-20">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950/50">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: activeCat?.color ?? '#71717a' }}
            />
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Inspection du Nœud
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10.5px] font-mono text-zinc-500">
              X:{Math.round(selectedNode.positionX)} Y:{Math.round(selectedNode.positionY)}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
              title="Fermer le panneau"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Title */}
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wider text-zinc-400 mb-1.5">
              Titre de l'entité / indice
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                scheduleNodePatch(selectedNode.id, { title: e.target.value });
              }}
              placeholder="Nom du personnage, IP, preuve, lieu…"
              className="w-full px-3 py-2 text-sm font-medium rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          {/* Category */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                Catégorie
              </label>
              <button
                type="button"
                onClick={onOpenNewCategory}
                className="text-[11px] text-cyan-400 hover:text-cyan-300 font-medium"
              >
                + Créer catégorie
              </button>
            </div>
            <select
              value={categoryId ?? ''}
              onChange={(e) => {
                const nextCat = e.target.value || null;
                setCategoryId(nextCat);
                void onUpdateNode(selectedNode.id, { categoryId: nextCat });
              }}
              className="w-full px-3 py-2 text-sm rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:border-cyan-500 focus:outline-none"
            >
              <option value="">— Non classé —</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          {/* Metadata Free Attributes */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                Métadonnées & Attributs
              </label>
              <button
                type="button"
                onClick={() =>
                  updateMetaRows([
                    ...metaRows,
                    { id: `${Date.now()}`, key: '', value: '' },
                  ])
                }
                className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 font-medium"
              >
                <Plus className="w-3 h-3" />
                <span>Attribut</span>
              </button>
            </div>

            {/* Quick Metadata Preset Chips */}
            <div className="flex flex-wrap gap-1">
              {METADATA_PRESETS.filter(
                (p) => !metaRows.some((r) => r.key.toLowerCase() === p.key.toLowerCase())
              ).map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() =>
                    updateMetaRows([
                      ...metaRows,
                      {
                        id: `${Date.now()}-${preset.key}`,
                        key: preset.key,
                        value: preset.defaultVal,
                      },
                    ])
                  }
                  className="px-2 py-0.5 rounded-md bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-[10.5px] text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  + {preset.key}
                </button>
              ))}
            </div>

            {metaRows.length === 0 ? (
              <p className="text-xs text-zinc-500 italic py-1">
                Aucun attribut (ex: date, fiabilité, IP, faction…).
              </p>
            ) : (
              <div className="space-y-1.5">
                {metaRows.map((row, index) => (
                  <div key={row.id} className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={row.key}
                      onChange={(e) => {
                        const copy = [...metaRows];
                        copy[index] = { ...row, key: e.target.value };
                        updateMetaRows(copy);
                      }}
                      placeholder="Clé"
                      className="w-[38%] px-2.5 py-1.5 text-xs font-mono rounded-md bg-zinc-950 border border-zinc-800 text-zinc-300 focus:border-cyan-500 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={row.value}
                      onChange={(e) => {
                        const copy = [...metaRows];
                        copy[index] = { ...row, value: e.target.value };
                        updateMetaRows(copy);
                      }}
                      placeholder="Valeur"
                      className="flex-1 px-2.5 py-1.5 text-xs font-mono rounded-md bg-zinc-950 border border-zinc-800 text-zinc-100 focus:border-cyan-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        updateMetaRows(metaRows.filter((_, idx) => idx !== index))
                      }
                      className="p-1.5 rounded-md text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 transition-colors"
                      title="Retirer cet attribut"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Rich Markdown Notes */}
          <div className="space-y-2 flex-1 flex flex-col">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                Notes détaillées (Markdown)
              </label>
              <div className="inline-flex rounded-lg bg-zinc-950 border border-zinc-800 p-0.5">
                <button
                  type="button"
                  onClick={() => setNoteTab('write')}
                  className={cn(
                    'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors',
                    noteTab === 'write'
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-200'
                  )}
                >
                  <FileEdit className="w-3 h-3" />
                  <span>Éditer</span>
                </button>
                <button
                  type="button"
                  onClick={() => setNoteTab('preview')}
                  className={cn(
                    'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors',
                    noteTab === 'preview'
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-200'
                  )}
                >
                  <Eye className="w-3 h-3" />
                  <span>Aperçu</span>
                </button>
              </div>
            </div>

            {noteTab === 'write' ? (
              <textarea
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  scheduleNodePatch(selectedNode.id, { content: e.target.value });
                }}
                rows={12}
                placeholder={
                  'Rédigez vos notes d’enquête ou de lore en Markdown…\n\n### Indices\n- Élément 1\n- `192.0.2.42`\n- **Conclusion provisoire**'
                }
                className="w-full min-h-[240px] px-3 py-2.5 text-xs font-mono leading-relaxed rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none resize-y"
              />
            ) : (
              <div className="w-full min-h-[240px] px-3.5 py-3 rounded-xl bg-zinc-950 border border-zinc-800 overflow-y-auto">
                {content.trim() ? (
                  <div className="markdown-preview">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500 italic">
                    Aucune note rédigée pour ce nœud. Basculez sur « Éditer » pour écrire.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer Delete Node */}
        <div className="px-4 py-3 border-t border-zinc-800 bg-zinc-950/60 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              if (!confirmDeleteNode) {
                setConfirmDeleteNode(true);
                return;
              }
              void onDeleteNode(selectedNode.id);
            }}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              confirmDeleteNode
                ? 'bg-rose-600 text-white hover:bg-rose-500'
                : 'text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/30'
            )}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{confirmDeleteNode ? 'Confirmer la suppression' : 'Supprimer le nœud'}</span>
          </button>

          {confirmDeleteNode && (
            <button
              type="button"
              onClick={() => setConfirmDeleteNode(false)}
              className="text-xs text-zinc-400 hover:text-zinc-200"
            >
              Annuler
            </button>
          )}
        </div>
      </aside>
    );
  }

  // ==================== EDGE INSPECTOR ====================
  if (selectedEdge) {
    const sourceNode = allNodes.find((n) => n.id === selectedEdge.sourceNodeId);
    const targetNode = allNodes.find((n) => n.id === selectedEdge.targetNodeId);

    return (
      <aside className="w-[370px] shrink-0 h-full bg-zinc-900/95 border-l border-zinc-800 flex flex-col overflow-hidden z-20">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950/50">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Inspection de la Relation
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Endpoints Summary + Reverse Button */}
          <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 truncate font-medium text-zinc-200">
                {sourceNode?.title ?? 'Source'}
              </div>
              <span className="text-zinc-500 shrink-0">
                {selectedEdge.directed ? (
                  <ArrowRight className="w-4 h-4 text-cyan-400" />
                ) : (
                  <Minus className="w-4 h-4 text-zinc-400" />
                )}
              </span>
              <div className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 truncate font-medium text-zinc-200">
                {targetNode?.title ?? 'Cible'}
              </div>
            </div>

            {selectedEdge.directed && (
              <button
                type="button"
                onClick={() => void onUpdateEdge(selectedEdge.id, { reverse: true })}
                className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-300 transition-colors"
              >
                <ArrowLeftRight className="w-3.5 h-3.5 text-cyan-400" />
                <span>Inverser le sens de la flèche</span>
              </button>
            )}
          </div>

          {/* Label */}
          <div className="space-y-2">
            <label className="block text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Label sur la flèche
            </label>
            <input
              type="text"
              value={edgeLabel}
              onChange={(e) => {
                setEdgeLabel(e.target.value);
                scheduleEdgePatch(selectedEdge.id, { label: e.target.value });
              }}
              placeholder="Ex: a trahi, communique avec, confirme…"
              className="w-full px-3 py-2 text-sm rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:border-cyan-500 focus:outline-none"
            />
            <div className="flex flex-wrap gap-1">
              {EDGE_LABEL_SUGGESTIONS.map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => {
                    setEdgeLabel(sug);
                    void onUpdateEdge(selectedEdge.id, { label: sug });
                  }}
                  className="px-2 py-0.5 rounded-md bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-[10.5px] text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  {sug}
                </button>
              ))}
            </div>
          </div>

          {/* Style: Proven (Solid) vs Hypothesis (Dashed) */}
          <div className="space-y-2">
            <label className="block text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Nature du lien (Certitude)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void onUpdateEdge(selectedEdge.id, { style: 'solid' })}
                className={cn(
                  'flex flex-col items-start gap-1 p-2.5 rounded-xl border text-left transition-all',
                  selectedEdge.style === 'solid'
                    ? 'bg-cyan-500/10 border-cyan-400 text-cyan-200'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                )}
              >
                <span className="text-xs font-semibold">━━ Fait prouvé</span>
                <span className="text-[10.5px] opacity-80">Trait plein confirmé</span>
              </button>

              <button
                type="button"
                onClick={() => void onUpdateEdge(selectedEdge.id, { style: 'dashed' })}
                className={cn(
                  'flex flex-col items-start gap-1 p-2.5 rounded-xl border text-left transition-all',
                  selectedEdge.style === 'dashed'
                    ? 'bg-amber-500/10 border-amber-400 text-amber-200'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                )}
              >
                <span className="inline-flex items-center gap-1 text-xs font-semibold">
                  <Sparkles className="w-3 h-3" />
                  <span>Hypothèse</span>
                </span>
                <span className="text-[10.5px] opacity-80">Pointillés / Théorie</span>
              </button>
            </div>
          </div>

          {/* Directed vs Undirected */}
          <div className="space-y-2">
            <label className="block text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Orientation
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void onUpdateEdge(selectedEdge.id, { directed: true })}
                className={cn(
                  'flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border text-xs font-medium transition-colors',
                  selectedEdge.directed
                    ? 'bg-zinc-800 border-cyan-400 text-zinc-100'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                )}
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>Orienté (Flèche)</span>
              </button>
              <button
                type="button"
                onClick={() => void onUpdateEdge(selectedEdge.id, { directed: false })}
                className={cn(
                  'flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border text-xs font-medium transition-colors',
                  !selectedEdge.directed
                    ? 'bg-zinc-800 border-cyan-400 text-zinc-100'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                )}
              >
                <Minus className="w-3.5 h-3.5" />
                <span>Non-orienté</span>
              </button>
            </div>
          </div>

          {/* Edge Context Notes */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Notes / Justification du lien
            </label>
            <textarea
              value={edgeNotes}
              onChange={(e) => {
                setEdgeNotes(e.target.value);
                scheduleEdgePatch(selectedEdge.id, { notes: e.target.value });
              }}
              rows={5}
              placeholder="Précisez la preuve, la chronologie ou la source justifiant cette relation…"
              className="w-full px-3 py-2 text-xs leading-relaxed rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none resize-y"
            />
          </div>
        </div>

        {/* Footer Delete Edge */}
        <div className="px-4 py-3 border-t border-zinc-800 bg-zinc-950/60 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              if (!confirmDeleteEdge) {
                setConfirmDeleteEdge(true);
                return;
              }
              void onDeleteEdge(selectedEdge.id);
            }}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              confirmDeleteEdge
                ? 'bg-rose-600 text-white hover:bg-rose-500'
                : 'text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/30'
            )}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{confirmDeleteEdge ? 'Confirmer la suppression' : 'Supprimer le lien'}</span>
          </button>

          {confirmDeleteEdge && (
            <button
              type="button"
              onClick={() => setConfirmDeleteEdge(false)}
              className="text-xs text-zinc-400 hover:text-zinc-200"
            >
              Annuler
            </button>
          )}
        </div>
      </aside>
    );
  }

  return null;
}
