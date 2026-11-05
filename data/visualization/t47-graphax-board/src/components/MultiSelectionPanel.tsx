import { useEffect, useState } from 'react';
import { Route, Trash2, X } from 'lucide-react';
import type { Category, GraphNode } from '@shared/types';
import { cn } from '@/lib/utils';

const PREVIEW = 8;

interface MultiSelectionPanelProps {
  nodes: GraphNode[];
  categories: Category[];
  onClear: () => void;
  onDelete: (nodeIds: string[]) => void;
  /** Shows the shortest chain of links between the two selected nodes (V4) */
  onShortestPath?: (fromId: string, toId: string) => void;
}

// Right panel shown instead of the inspector when several nodes are selected (A2)
export function MultiSelectionPanel({
  nodes,
  categories,
  onClear,
  onDelete,
  onShortestPath,
}: MultiSelectionPanelProps) {
  const [confirm, setConfirm] = useState(false);
  const ids = nodes.map((n) => n.id).join(',');
  // A confirmation only applies to the selection it was asked for
  useEffect(() => setConfirm(false), [ids]);

  const byCategory = new Map<string | null, number>();
  for (const n of nodes) byCategory.set(n.categoryId, (byCategory.get(n.categoryId) ?? 0) + 1);
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? 'Non classé';
  const catColor = (id: string | null) =>
    categories.find((c) => c.id === id)?.color ?? 'var(--etat-clos)';

  return (
    <aside
      aria-label="Sélection multiple"
      className="w-[370px] shrink-0 h-full bg-zinc-900/95 border-l border-filet flex flex-col overflow-hidden z-20"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-filet bg-zinc-950/50">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          {nodes.length} nœuds sélectionnés
        </span>
        <button
          type="button"
          onClick={onClear}
          className="p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          title="Tout désélectionner (Échap)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="space-y-1.5">
          {[...byCategory.entries()].map(([id, count]) => (
            <div key={id ?? 'none'} className="flex items-center gap-2 text-xs text-zinc-300">
              <span className="s21-slit shrink-0" aria-hidden="true" style={{ background: catColor(id) }} />
              <span className="truncate flex-1">{catName(id)}</span>
              <span className="font-mono text-zinc-500">{count}</span>
            </div>
          ))}
        </div>

        <ul className="space-y-1 text-xs text-zinc-400">
          {nodes.slice(0, PREVIEW).map((n) => (
            <li key={n.id} className="truncate">
              {n.title || 'Sans titre'}
            </li>
          ))}
          {nodes.length > PREVIEW && <li className="text-zinc-500">… et {nodes.length - PREVIEW} autres</li>}
        </ul>

        {nodes.length === 2 && onShortestPath && (
          <button
            type="button"
            onClick={() => onShortestPath(nodes[0].id, nodes[1].id)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-filet text-zinc-200 hover:bg-zinc-800"
          >
            <Route className="w-3.5 h-3.5 text-cyan-400" />
            Plus court chemin entre les deux
          </button>
        )}

        <div className="text-xs text-zinc-500 space-y-1 border-t border-filet pt-3">
          <p>Glisser un nœud de la sélection déplace tout le groupe.</p>
          <p>Ctrl+clic ajoute ou retire un nœud ; Maj+glisser sur le fond sélectionne une zone.</p>
        </div>
      </div>

      <div className="px-4 py-3 border-t border-filet bg-zinc-950/60">
        <button
          type="button"
          onClick={() => {
            if (!confirm) {
              setConfirm(true);
              return;
            }
            onDelete(nodes.map((n) => n.id));
          }}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
            confirm
              ? 'bg-rose-600 text-white hover:bg-rose-500'
              : 'text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/30'
          )}
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>
            {confirm
              ? `Confirmer : supprimer ${nodes.length} nœuds et leurs liens`
              : `Supprimer les ${nodes.length} nœuds`}
          </span>
        </button>
      </div>
    </aside>
  );
}
