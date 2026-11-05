import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildTimeline, groupedLayout, neighbourhood, pathEdgeIds, shortestPath } from '../src/lib/graphViews.ts';
import type { GraphEdge, GraphNode } from '../shared/types.ts';

const node = (id: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id, projectId: 'p', categoryId: null, title: id, content: '', positionX: 0, positionY: 0, metadata: {},
  reliability: null, createdAt: '', updatedAt: '', ...extra,
});
const edge = (id: string, s: string, t: string): GraphEdge => ({
  id, projectId: 'p', sourceNodeId: s, targetNodeId: t, sourceHandle: null, targetHandle: null,
  label: '', style: 'solid', directed: true, color: null, notes: '', createdAt: '', updatedAt: '',
});

// a - b - c - d     e (alone)     a - x - d (longer: a-x, x-y, y-d)
const edges = [edge('ab', 'a', 'b'), edge('cb', 'c', 'b'), edge('cd', 'c', 'd'), edge('ax', 'a', 'x'), edge('xy', 'x', 'y'), edge('yd', 'y', 'd')];

describe('graph views', () => {
  it('finds the neighbourhood at N links, whatever the direction', () => {
    assert.deepEqual([...neighbourhood('a', edges, 1)].sort(), ['a', 'b', 'x']);
    assert.deepEqual([...neighbourhood('a', edges, 2)].sort(), ['a', 'b', 'c', 'x', 'y']);
    assert.deepEqual([...neighbourhood('e', edges, 3)], ['e']);
  });

  it('finds a shortest path and its links, or none', () => {
    const path = shortestPath('a', 'd', edges);
    assert.equal(path?.length, 4);
    assert.equal(path?.[0], 'a');
    assert.equal(path?.at(-1), 'd');
    assert.equal(shortestPath('a', 'e', edges), null);
    assert.deepEqual(shortestPath('a', 'a', edges), ['a']);
    assert.deepEqual([...pathEdgeIds(['a', 'b', 'c'], edges)].sort(), ['ab', 'cb']);
  });

  it('builds a timeline from dated attributes, oldest first', () => {
    const tl = buildTimeline([
      node('n1', { title: 'Intrusion', metadata: { Date: '2026-10-22 08:14 UTC', Note: 'x' } }),
      node('n2', { title: 'Rapport', metadata: { Publication: '03/11/2026' } }),
      node('n3', { title: 'Premier signe', metadata: { 'Première vue': '2026-09-30', Fin: '2026-12-01' } }),
      node('n4', { title: 'Sans date', metadata: { Statut: 'actif' } }),
    ]);
    assert.deepEqual(tl.map((e) => `${e.node.title}:${e.key}`), [
      'Premier signe:Première vue',
      'Intrusion:Date',
      'Rapport:Publication',
      'Premier signe:Fin',
    ]);
    assert.equal(tl[1].sortKey, '2026-10-22 08:14');
  });

  it('keeps the seconds of a timestamp in the timeline order', () => {
    const tl = buildTimeline([
      node('a', { title: 'A plus tard', metadata: { Vu: '2026-10-22 08:14:59 UTC' } }),
      node('z', { title: 'Z plus tôt', metadata: { Vu: '2026-10-22 08:14:01 UTC' } }),
    ]);
    assert.deepEqual(tl.map((e) => e.node.title), ['Z plus tôt', 'A plus tard']);
    assert.equal(tl[0].sortKey, '2026-10-22 08:14:01');
  });

  it('lays nodes out in one column per category, unclassified last', () => {
    const pos = groupedLayout(
      [node('b', { categoryId: 'c2' }), node('a', { categoryId: 'c2' }), node('z', { categoryId: 'c1' }), node('u')],
      ['c1', 'c2', 'c3']
    );
    const at = (id: string) => pos.find((p) => p.id === id);
    assert.deepEqual([at('z')?.positionX, at('a')?.positionX, at('b')?.positionX, at('u')?.positionX], [0, 280, 280, 560]);
    assert.deepEqual([at('a')?.positionY, at('b')?.positionY], [0, 150]);
  });
});
