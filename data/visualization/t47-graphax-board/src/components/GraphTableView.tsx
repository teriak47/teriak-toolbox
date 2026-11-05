import { useMemo, useState } from 'react';
import type { Category, GraphEdge, GraphNode } from '@shared/types';
import { cn } from '@/lib/utils';

type SortKey = 'title' | 'category' | 'reliability' | 'attributes' | 'links';

interface GraphTableViewProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  categories: Category[];
  linkTypes: Record<string, string>;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
}

// Table view (V4): the shown nodes and links as sortable lists; a click selects the row's
// node or link in the inspector
export function GraphTableView({
  nodes,
  edges,
  categories,
  linkTypes,
  selectedNodeId,
  onSelectNode,
  onSelectEdge,
}: GraphTableViewProps) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'title', desc: false });
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? 'Non classé';
  const titleOf = useMemo(() => new Map(nodes.map((n) => [n.id, n.title || 'Sans titre'])), [nodes]);
  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const e of edges) {
      d.set(e.sourceNodeId, (d.get(e.sourceNodeId) ?? 0) + 1);
      d.set(e.targetNodeId, (d.get(e.targetNodeId) ?? 0) + 1);
    }
    return d;
  }, [edges]);
  const attrCount = (n: GraphNode) => Object.values(n.metadata ?? {}).filter((v) => v.trim()).length;

  const rows = useMemo(() => {
    const value = (n: GraphNode): string | number => {
      switch (sort.key) {
        case 'category':
          return catName(n.categoryId);
        case 'reliability':
          return n.reliability ?? '~';
        case 'attributes':
          return attrCount(n);
        case 'links':
          return degree.get(n.id) ?? 0;
        default:
          return n.title;
      }
    };
    return [...nodes].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'fr');
      return sort.desc ? -cmp : cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, sort, degree, categories]);

  const header = (key: SortKey, label: string, align = 'text-left') => (
    <th className={cn('px-3 py-2 font-medium', align)}>
      <button
        type="button"
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : false }))}
        className="hover:text-zinc-100"
        aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}
      >
        {label}
        {sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  );

  return (
    <div className="absolute inset-0 overflow-auto bg-zinc-950 p-5 space-y-6" aria-label="Vue tableau">
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
          Nœuds ({nodes.length})
        </h2>
        <table className="w-full text-xs text-zinc-300 border border-filet">
          <thead className="bg-zinc-900 text-zinc-400">
            <tr>
              {header('title', 'Titre')}
              {header('category', 'Catégorie')}
              {header('reliability', 'Fiabilité')}
              {header('attributes', 'Attributs', 'text-right')}
              {header('links', 'Liens', 'text-right')}
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => (
              <tr
                key={n.id}
                onClick={() => onSelectNode(n.id)}
                className={cn(
                  'border-t border-filet cursor-pointer hover:bg-zinc-800/60',
                  n.id === selectedNodeId && 'bg-zinc-800'
                )}
              >
                <td className="px-3 py-1.5 text-zinc-100">{n.title || 'Sans titre'}</td>
                <td className="px-3 py-1.5">{catName(n.categoryId)}</td>
                <td className="px-3 py-1.5 font-mono">{n.reliability ?? '—'}</td>
                <td className="px-3 py-1.5 text-right font-mono">{attrCount(n)}</td>
                <td className="px-3 py-1.5 text-right font-mono">{degree.get(n.id) ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
          Liens ({edges.length})
        </h2>
        <table className="w-full text-xs text-zinc-300 border border-filet">
          <thead className="bg-zinc-900 text-zinc-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">De</th>
              <th className="px-3 py-2 text-left font-medium">Relation</th>
              <th className="px-3 py-2 text-left font-medium">Vers</th>
              <th className="px-3 py-2 text-left font-medium">Nature</th>
              <th className="px-3 py-2 text-left font-medium">Type</th>
            </tr>
          </thead>
          <tbody>
            {edges.map((e) => (
              <tr
                key={e.id}
                onClick={() => onSelectEdge(e.id)}
                className="border-t border-filet cursor-pointer hover:bg-zinc-800/60"
              >
                <td className="px-3 py-1.5">{titleOf.get(e.sourceNodeId) ?? '?'}</td>
                <td className="px-3 py-1.5 text-zinc-100">{e.label || (e.directed ? '→' : '—')}</td>
                <td className="px-3 py-1.5">{titleOf.get(e.targetNodeId) ?? '?'}</td>
                <td className="px-3 py-1.5">{e.style === 'dashed' ? 'Hypothèse' : 'Fait'}</td>
                <td className="px-3 py-1.5">
                  {e.color ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5" style={{ background: e.color }} />
                      {linkTypes[e.color] ?? ''}
                    </span>
                  ) : (
                    linkTypes.default ?? ''
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
