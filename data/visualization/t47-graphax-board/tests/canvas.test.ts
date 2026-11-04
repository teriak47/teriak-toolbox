import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GraphEdge, GraphNode } from '../shared/types.ts';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  boxBoundary,
  boxPoints,
  clampFinite,
  sanitizeViewport,
} from '../src/lib/canvasGeometry.ts';
import { computeEdgeGeometry, edgeLabelHalfSize } from '../src/lib/edgeGeometry.ts';

const now = '2026-11-04T00:00:00.000Z';

function node(id: string, x: number, y: number): GraphNode {
  return { id, projectId: 'p', categoryId: null, title: id, content: '', positionX: x, positionY: y, metadata: {}, createdAt: now, updatedAt: now };
}

function edge(id: string, source: string, target: string, directed = true): GraphEdge {
  return { id, projectId: 'p', sourceNodeId: source, targetNodeId: target, label: '', style: 'solid', directed, createdAt: now, updatedAt: now };
}

const pos = (n: GraphNode) => ({ x: n.positionX, y: n.positionY });
const radius = () => 20;

describe('canvas geometry', () => {
  it('clamps and replaces non-finite numbers', () => {
    assert.equal(clampFinite(Number.NaN, 7), 7);
    assert.equal(clampFinite(Infinity, 7), 7);
    assert.equal(clampFinite(5, 0, 0, 3), 3);
    assert.equal(clampFinite(-5, 0, 0, 3), 0);
  });

  it('keeps the viewport finite and within the zoom range', () => {
    const vp = sanitizeViewport({ x: Number.NaN, y: 1e9, zoom: 99 }, { x: 1, y: 2, zoom: 1 });
    assert.deepEqual(vp, { x: 1, y: 50000, zoom: MAX_ZOOM });
    assert.equal(sanitizeViewport({ x: 0, y: 0, zoom: 0.01 }).zoom, MIN_ZOOM);
  });

  it('measures the distance to a box border', () => {
    assert.equal(boxBoundary(10, 1, 0), 10);
    assert.ok(Math.abs(boxBoundary(10, Math.SQRT1_2, Math.SQRT1_2) - 10 * Math.SQRT2) < 1e-9);
  });

  it('draws square and cut boxes', () => {
    assert.equal(boxPoints(10, false).split(' ').length, 4);
    assert.equal(boxPoints(10, true).split(' ').length, 6);
  });
});

describe('edge geometry', () => {
  it('clips a link to both node boxes and adds an arrow when directed', () => {
    const [geo] = computeEdgeGeometry([node('a', 0, 0), node('b', 200, 0)], [edge('e', 'a', 'b')], pos, radius);
    const [, sx, , , tx] = geo.pathD.split(' ');
    assert.ok(Number(sx) > 18 && Number(sx) < 25, `start ${sx}`);
    assert.ok(Number(tx) < 182 && Number(tx) > 170, `end ${tx}`);
    assert.equal(geo.my, 0);
    assert.equal(geo.arrowPoints.split(' ').length, 3);
  });

  it('places the mid arrow along the link, pointing to the target, away from the label', () => {
    const tips = (points: string) => points.split(' ').map((pt) => pt.split(',').map(Number));
    const [plain] = computeEdgeGeometry([node('a', 0, 0), node('b', 200, 0)], [edge('e', 'a', 'b')], pos, radius);
    const [tip, base1, base2] = tips(plain.midArrowPoints);
    assert.ok(tip[0] > base1[0] && tip[0] > base2[0], 'points towards the target');
    assert.ok(Math.abs((base1[0] + tip[0]) / 2 - 100) < 10, 'near the middle without a label');

    // The arrow must stay clear of the label box, for short and long labels and slopes
    let checked = 0;
    for (const [label, bx, by] of [['relation', 200, 0], ['connaît', 200, 0], ['communique avec', 300, 0], ['lien', 160, 120]] as const) {
      const [geo] = computeEdgeGeometry([node('a', 0, 0), node('b', bx, by)], [{ ...edge('e', 'a', 'b'), label }], pos, () => 30);
      if (!geo.midArrowPoints) continue;
      checked++;
      const { halfWidth, halfHeight } = edgeLabelHalfSize(label);
      for (const [x, y] of tips(geo.midArrowPoints)) {
        const inside = Math.abs(x - geo.mx) < halfWidth && Math.abs(y - geo.my) < halfHeight;
        assert.ok(!inside, `arrow point ${x},${y} is under the label "${label}"`);
      }
    }

    assert.ok(checked >= 3, `only ${checked} labelled links had a mid arrow`);

    // No room before the label: the mid arrow is skipped rather than hidden
    const [cramped] = computeEdgeGeometry(
      [node('a', 0, 0), node('b', 150, 0)],
      [{ ...edge('e', 'a', 'b'), label: 'une relation au libellé très long' }],
      pos,
      radius
    );
    assert.equal(cramped.midArrowPoints, '');

    const [reversed] = computeEdgeGeometry([node('a', 0, 0), node('b', 200, 0)], [edge('e', 'b', 'a')], pos, radius);
    const [rtip, rbase] = tips(reversed.midArrowPoints);
    assert.ok(rtip[0] < rbase[0], 'follows the link direction');
  });

  it('bends parallel links to opposite sides', () => {
    const geos = computeEdgeGeometry(
      [node('a', 0, 0), node('b', 200, 0)],
      [edge('e1', 'a', 'b'), edge('e2', 'b', 'a')],
      pos,
      radius
    );
    assert.equal(geos.length, 2);
    assert.ok(geos.every((g) => g.pathD.split(' L ').length === 3), 'both links are bent');
    assert.ok(Math.sign(geos[0].my) === -Math.sign(geos[1].my) && geos[0].my !== 0);
  });

  it('skips links whose nodes are missing or overlap', () => {
    const geos = computeEdgeGeometry(
      [node('a', 0, 0), node('b', 0, 0)],
      [edge('e1', 'a', 'b'), edge('e2', 'a', 'ghost')],
      pos,
      radius
    );
    assert.equal(geos.length, 0);
  });
});
