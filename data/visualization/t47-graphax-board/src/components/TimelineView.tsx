import type { Category, GraphNode } from '@shared/types';
import { buildTimeline } from '@/lib/graphViews';
import { cn } from '@/lib/utils';

interface TimelineViewProps {
  nodes: GraphNode[];
  categories: Category[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}

// Timeline view (V4): every dated attribute of the shown nodes, oldest first, grouped by day
export function TimelineView({ nodes, categories, selectedNodeId, onSelectNode }: TimelineViewProps) {
  const entries = buildTimeline(nodes);
  const days: Array<{ day: string; items: typeof entries }> = [];
  for (const e of entries) {
    const day = e.sortKey.slice(0, 10);
    const last = days.at(-1);
    if (last?.day === day) last.items.push(e);
    else days.push({ day, items: [e] });
  }
  const formatDay = (day: string) =>
    new Date(`${day}T12:00:00Z`).toLocaleDateString('fr-FR', { dateStyle: 'long', timeZone: 'UTC' });
  const cat = (id: string | null) => categories.find((c) => c.id === id);

  return (
    <div className="absolute inset-0 overflow-auto bg-zinc-950 p-5" aria-label="Chronologie">
      {entries.length === 0 ? (
        <p className="text-sm text-zinc-400 max-w-md">
          Aucune date à afficher. La chronologie reprend les attributs dont la valeur est une date (AAAA-MM-JJ ou
          JJ/MM/AAAA), par exemple « Date » ou « Première vue ».
        </p>
      ) : (
        <ol className="relative border-l border-filet ml-3 space-y-5">
          {days.map(({ day, items }) => (
            <li key={day} className="ml-5">
              <span className="absolute -left-1.5 mt-1 w-3 h-3 bg-cyan-400" aria-hidden="true" />
              <h3 className="text-xs font-semibold text-zinc-200">{formatDay(day)}</h3>
              <ul className="mt-1.5 space-y-1">
                {items.map((e) => (
                  <li key={`${e.node.id}-${e.key}`}>
                    <button
                      type="button"
                      onClick={() => onSelectNode(e.node.id)}
                      className={cn(
                        'flex items-center gap-2 text-left text-xs px-2 py-1 border border-transparent hover:border-filet hover:bg-zinc-900',
                        e.node.id === selectedNodeId && 'border-filet-fort bg-zinc-900'
                      )}
                    >
                      <span className="w-2.5 h-2.5 shrink-0" style={{ background: cat(e.node.categoryId)?.color ?? 'var(--etat-clos)' }} />
                      <span className="text-zinc-100">{e.node.title || 'Sans titre'}</span>
                      <span className="text-zinc-500">
                        {e.key} : {e.value}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
