// Markdown report of a project (A6): its nodes grouped by category, with their reliability,
// attributes and notes, then the links. A pure function, so it can be unit tested.

import type { Category, GraphEdge, GraphNode } from '../../shared/types.ts';
import { describeReliability } from '../../shared/types.ts';

export interface ReportInput {
  project: { name: string; description?: string };
  categories: Category[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Date written in the header; now by default */
  date?: Date;
}

// Text kept on one line inside a Markdown table cell
function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();
}

// Notes are shown as a quote, so their own headings stay inside the node's section
function quote(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
}

export function buildMarkdownReport({ project, categories, nodes, edges, date = new Date() }: ReportInput): string {
  const out: string[] = [];
  const titleOf = new Map(nodes.map((n) => [n.id, n.title || 'Sans titre']));
  out.push(`# ${project.name}`, '');
  if (project.description?.trim()) out.push(project.description.trim(), '');
  out.push(
    `*Rapport Graphax du ${date.toLocaleDateString('fr-FR', { dateStyle: 'long' })} : ${nodes.length} nœud${nodes.length > 1 ? 's' : ''}, ${edges.length} lien${edges.length > 1 ? 's' : ''}.*`,
    ''
  );

  // Categories in their order, then the unclassified nodes
  const groups: Array<{ name: string; nodes: GraphNode[] }> = categories.map((c) => ({
    name: c.name,
    nodes: nodes.filter((n) => n.categoryId === c.id),
  }));
  const known = new Set(categories.map((c) => c.id));
  groups.push({ name: 'Non classé', nodes: nodes.filter((n) => !n.categoryId || !known.has(n.categoryId)) });

  for (const group of groups) {
    if (group.nodes.length === 0) continue;
    out.push(`## ${group.name} (${group.nodes.length})`, '');
    for (const node of [...group.nodes].sort((a, b) => a.title.localeCompare(b.title, 'fr'))) {
      out.push(`### ${node.title || 'Sans titre'}`, '');
      const reliability = describeReliability(node.reliability);
      if (node.reliability && reliability) out.push(`**Fiabilité :** ${node.reliability} (${reliability})`, '');
      const attrs = Object.entries(node.metadata ?? {}).filter(([, v]) => v.trim());
      if (attrs.length > 0) {
        out.push('| Attribut | Valeur |', '| --- | --- |');
        for (const [k, v] of attrs) out.push(`| ${cell(k)} | ${cell(v)} |`);
        out.push('');
      }
      if (node.content?.trim()) out.push(quote(node.content), '');
    }
  }

  if (edges.length > 0) {
    out.push('## Liens', '', '| De | Relation | Vers | Nature |', '| --- | --- | --- | --- |');
    for (const e of edges) {
      const arrow = e.directed ? '→' : '—';
      const nature = e.style === 'dashed' ? 'Hypothèse' : 'Fait';
      out.push(
        `| ${cell(titleOf.get(e.sourceNodeId) ?? '?')} | ${cell(e.label ? `${arrow} ${e.label}` : arrow)} | ${cell(titleOf.get(e.targetNodeId) ?? '?')} | ${nature} |`
      );
    }
    out.push('');
  }
  return out.join('\n');
}
