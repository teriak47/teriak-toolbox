import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildMarkdownReport } from '../src/lib/report.ts';
import type { Category, GraphEdge, GraphNode } from '../shared/types.ts';

const cat = (id: string, name: string): Category => ({
  id, projectId: 'p', name, color: '#60ccc5', icon: 'user', shape: 'circle', metadataKeys: [], cardKeys: [],
});
const node = (id: string, title: string, categoryId: string | null, extra: Partial<GraphNode> = {}): GraphNode => ({
  id, projectId: 'p', categoryId, title, content: '', positionX: 0, positionY: 0, metadata: {},
  reliability: null, createdAt: '', updatedAt: '', ...extra,
});
const edge = (id: string, s: string, t: string, extra: Partial<GraphEdge> = {}): GraphEdge => ({
  id, projectId: 'p', sourceNodeId: s, targetNodeId: t, sourceHandle: null, targetHandle: null,
  label: '', style: 'solid', directed: true, color: null, notes: '', createdAt: '', updatedAt: '', ...extra,
});

describe('markdown report', () => {
  it('groups nodes by category, with reliability, attributes, notes and links', () => {
    const md = buildMarkdownReport({
      project: { name: 'Opération Test', description: 'Périmètre fictif' },
      categories: [cat('c1', 'Personne'), cat('c2', 'Lieu')],
      nodes: [
        node('a', 'Alice', 'c1', { reliability: 'B2', metadata: { Pays: 'FR', Vide: ' ', 'Note|pipe': 'a|b' }, content: '## Profil\nVue à Lyon' }),
        node('b', 'Bob', null),
      ],
      edges: [edge('e1', 'a', 'b', { label: 'connaît', style: 'dashed' }), edge('e2', 'b', 'a', { directed: false })],
      date: new Date('2026-11-05T12:00:00Z'),
    });
    assert.match(md, /^# Opération Test\n\nPérimètre fictif\n/);
    assert.match(md, /2 nœuds, 2 liens/);
    assert.match(md, /## Personne \(1\)\n\n### Alice/);
    assert.ok(!md.includes('## Lieu'), 'empty categories are left out');
    assert.match(md, /## Non classé \(1\)\n\n### Bob/);
    assert.match(md, /\*\*Fiabilité :\*\* B2 \(Habituellement fiable · Probablement vraie\)/);
    assert.match(md, /\| Pays \| FR \|/);
    assert.ok(!md.includes('Vide'), 'empty attributes are left out');
    assert.match(md, /\| Note\\\|pipe \| a\\\|b \|/);
    assert.match(md, /> ## Profil\n> Vue à Lyon/);
    assert.match(md, /\| Alice \| connaît \| Bob \| Hypothèse \|/);
    assert.match(md, /\| Bob \| — \| Alice \| Fait \|/);
  });
});
