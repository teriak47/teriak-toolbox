import { Check } from 'lucide-react';
import type { Category, GraphNode } from '@shared/types';
import { cn } from '@/lib/utils';

interface NodeCategoryMenuProps {
  node: GraphNode;
  categories: Category[];
  /** Where the right click happened, in canvas pixels */
  x: number;
  y: number;
  /** Size of the canvas, to keep the menu inside it */
  bounds: { width: number; height: number };
  onPick: (nodeId: string, categoryId: string | null) => void;
}

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

// Category menu opened by a right click on a node (O6)
export function NodeCategoryMenu({ node, categories, x, y, bounds, onPick }: NodeCategoryMenuProps) {
  // Keep the menu inside the canvas; a long list scrolls instead of being cut
  const maxHeight = Math.max(120, bounds.height - 16);
  const height = Math.min(maxHeight, (categories.length + 2) * 30 + 40);
  const left = Math.min(x, bounds.width - 236);
  const top = Math.min(y, bounds.height - height - 8);

  const item = (categoryId: string | null, label: string, color: string) => {
    const current = node.categoryId === categoryId;
    return (
      <button
        key={categoryId ?? 'none'}
        type="button"
        role="menuitemradio"
        aria-checked={current}
        onClick={() => onPick(node.id, categoryId)}
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
      onMouseDown={stop}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: Math.max(8, left), top: Math.max(8, top), maxHeight }}
      className="absolute z-30 w-56 py-1 overflow-y-auto rounded-xl bg-zinc-900 border border-filet-fort shadow-2xl"
    >
      <p className="px-2.5 pt-1 pb-1.5 text-[11px] uppercase tracking-wider text-zinc-500 truncate">
        Catégorie de « {String(node.title ?? '')} »
      </p>
      {categories.map((c) => item(c.id, c.name, c.color))}
      <div className="my-1 border-t border-filet" />
      {item(null, 'Non classé', 'var(--etat-clos)')}
    </div>
  );
}
