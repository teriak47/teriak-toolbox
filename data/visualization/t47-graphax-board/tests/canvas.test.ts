import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GraphEdge, GraphNode } from '../shared/types.ts';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  boxBoundary,
  boxPoints,
  clampFinite,
  circleRadius,
  sanitizeViewport,
  shapeBoundary,
  shapeExtent,
  shapeVertices,
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

describe('node shapes', () => {
  const shapes = ['sharp', 'cut', 'hexagon', 'diamond', 'octagon', 'circle', 'rounded', 'pill'] as const;

  // Distance from a point to the closest edge of a polygon
  function distanceToOutline(x: number, y: number, vertices: Array<[number, number]>): number {
    let best = Infinity;
    for (let i = 0; i < vertices.length; i++) {
      const [ax, ay] = vertices[i];
      const [bx, by] = vertices[(i + 1) % vertices.length];
      const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2));
      best = Math.min(best, Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))));
    }
    return best;
  }

  it('puts the link end exactly on the outline of every shape, in every direction', () => {
    for (const shape of shapes) {
      for (let deg = 0; deg < 360; deg += 7) {
        const ux = Math.cos((deg * Math.PI) / 180);
        const uy = Math.sin((deg * Math.PI) / 180);
        const d = shapeBoundary(shape, 20, ux, uy);
        const vertices = shapeVertices(shape, 20);
        const gap = vertices
          ? distanceToOutline(ux * d, uy * d, vertices)
          : Math.abs(d - circleRadius(20));
        assert.ok(gap < 1e-6, `${shape} at ${deg}°: ${gap}`);
      }
    }
  });

  it('draws legacy shapes as squares and gives each shape its own outline', () => {
    assert.deepEqual(shapeVertices('rounded', 10), shapeVertices('sharp', 10));
    assert.deepEqual(shapeVertices('pill', 10), shapeVertices('sharp', 10));
    assert.equal(shapeVertices('hexagon', 10)?.length, 6);
    assert.equal(shapeVertices('octagon', 10)?.length, 8);
    assert.equal(shapeVertices('diamond', 10)?.length, 4);
    assert.equal(shapeVertices('circle', 10), null);
  });

  it('encloses every shape in its extent', () => {
    for (const shape of shapes) {
      const extent = shapeExtent(shape, 20);
      for (const [x, y] of shapeVertices(shape, 20) ?? []) {
        assert.ok(Math.abs(x) <= extent + 1e-9 && Math.abs(y) <= extent + 1e-9, shape);
      }
    }
    assert.ok(shapeExtent('diamond', 20) > shapeExtent('sharp', 20), 'the diamond needs a wider halo');
  });

  it('clips links to the shape of each end', () => {
    const nodes = [node('a', 0, 0), node('b', 200, 200)];
    const shapeOf = (id: string) => (id === 'a' ? 'diamond' : 'circle') as const;
    const [geo] = computeEdgeGeometry(nodes, [edge('e', 'a', 'b', false)], pos, radius, shapeOf);
    const [, sx, sy, , tx, ty] = geo.pathD.split(' ').map(Number);
    // Diamond: |x| + |y| = 1.3 * half on the outline (plus the 3 px gap along the link)
    const half = 20 * 0.92;
    assert.ok(Math.abs(Math.hypot(sx, sy) - (shapeBoundary('diamond', half, Math.SQRT1_2, Math.SQRT1_2) + 3)) < 0.2);
    assert.ok(Math.abs(Math.hypot(200 - tx, 200 - ty) - (circleRadius(half) + 3)) < 0.2);
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
    // Unlabelled links show a "+ label" placeholder in the middle on hover: stay clear of it
    const placeholder = edgeLabelHalfSize('');
    for (const [x, y] of tips(plain.midArrowPoints)) {
      assert.ok(
        !(Math.abs(x - plain.mx) < placeholder.halfWidth && Math.abs(y - plain.my) < placeholder.halfHeight),
        `arrow point ${x},${y} is under the "+ label" placeholder`
      );
    }

    // The arrow must stay clear of the label box, for short and long labels and slopes
    let checked = 0;
    for (const [label, bx, by] of [['', 200, 0], ['relation', 200, 0], ['connaît', 200, 0], ['communique avec', 300, 0], ['lien', 160, 120], ['', 160, 120]] as const) {
      const [geo] = computeEdgeGeometry([node('a', 0, 0), node('b', bx, by)], [{ ...edge('e', 'a', 'b'), label }], pos, () => 30);
      if (!geo.midArrowPoints) continue;
      checked++;
      const { halfWidth, halfHeight } = edgeLabelHalfSize(label);
      for (const [x, y] of tips(geo.midArrowPoints)) {
        const inside = Math.abs(x - geo.mx) < halfWidth && Math.abs(y - geo.my) < halfHeight;
        assert.ok(!inside, `arrow point ${x},${y} is under the label "${label}"`);
      }
    }

    assert.ok(checked >= 5, `only ${checked} labelled links had a mid arrow`);

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
