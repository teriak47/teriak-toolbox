// Pure geometry helpers for the graph canvas (no React), so they can be unit tested.

import type { CategoryShape } from '../../shared/types.ts';

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.16;
export const MAX_ZOOM = 3.2;
const VIEWPORT_LIMIT = 50000;

export function clampFinite(val: number, fallback: number, min?: number, max?: number): number {
  if (!Number.isFinite(val)) return fallback;
  let out = val;
  if (min !== undefined && out < min) out = min;
  if (max !== undefined && out > max) out = max;
  return out;
}

// Keeps a viewport finite and within bounds; invalid values fall back to `fallback`
export function sanitizeViewport(
  vp: Viewport,
  fallback: Viewport = { x: 400, y: 300, zoom: 1 }
): Viewport {
  return {
    x: clampFinite(vp.x, fallback.x, -VIEWPORT_LIMIT, VIEWPORT_LIMIT),
    y: clampFinite(vp.y, fallback.y, -VIEWPORT_LIMIT, VIEWPORT_LIMIT),
    zoom: clampFinite(vp.zoom, fallback.zoom, MIN_ZOOM, MAX_ZOOM),
  };
}

// SECTION 21 geometry: no curves. Nodes are square boxes; "cut" boxes lose two opposite
// corners along the 21 degree slope (width / height = tan 21 degrees).
const NODE_HALF_RATIO = 0.92;
const CUT_SLOPE = Math.tan((21 * Math.PI) / 180);

export function nodeHalf(r: number): number {
  return r * NODE_HALF_RATIO;
}

// Distance from a box centre to its border along the unit direction (ux, uy)
export function boxBoundary(half: number, ux: number, uy: number): number {
  const m = Math.max(Math.abs(ux), Math.abs(uy));
  return m > 0 ? half / m : half;
}

// SVG polygon points of a node box centred on 0,0
export function boxPoints(half: number, cut: boolean): string {
  if (!cut) {
    return `${-half},${-half} ${half},${-half} ${half},${half} ${-half},${half}`;
  }
  const w = half * 0.38;
  const h = Math.min(w / CUT_SLOPE, half * 1.6);
  const pts: Array<[number, number]> = [
    [-half, -half],
    [half - w, -half],
    [half, -half + h],
    [half, half],
    [-half + w, half],
    [-half, half - h],
  ];
  return pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

type Point = [number, number];

// Size of each shape relative to the square's half side, chosen so every shape carries
// about the same visual weight as the square
const DIAMOND_RATIO = 1.3;
const HEXAGON_RATIO = 1.15;
const OCTAGON_RATIO = 1.08;
const CIRCLE_RATIO = 1.1;

function regularPolygon(sides: number, radius: number, startDeg: number): Point[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = ((startDeg + (360 / sides) * i) * Math.PI) / 180;
    return [radius * Math.cos(a), radius * Math.sin(a)] as Point;
  });
}

function parsePoints(points: string): Point[] {
  return points.split(' ').map((pt) => pt.split(',').map(Number) as Point);
}

// Corners of a node shape centred on 0,0, or null for the circle.
// Legacy "rounded" and "pill" shapes are drawn as squares.
export function shapeVertices(shape: CategoryShape | undefined, half: number): Point[] | null {
  switch (shape) {
    case 'circle':
      return null;
    case 'cut':
      return parsePoints(boxPoints(half, true));
    case 'diamond': {
      const r = half * DIAMOND_RATIO;
      return [
        [0, -r],
        [r, 0],
        [0, r],
        [-r, 0],
      ];
    }
    case 'hexagon':
      // Pointed left and right, flat top and bottom
      return regularPolygon(6, half * HEXAGON_RATIO, 0);
    case 'octagon':
      // Flat sides facing the axes
      return regularPolygon(8, half * OCTAGON_RATIO, 22.5);
    default:
      return parsePoints(boxPoints(half, false));
  }
}

export function circleRadius(half: number): number {
  return half * CIRCLE_RATIO;
}

// SVG polygon points of a node shape (not used for the circle)
export function shapePoints(shape: CategoryShape | undefined, half: number): string {
  const vertices = shapeVertices(shape, half) ?? regularPolygon(32, circleRadius(half), 0);
  return vertices.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

// Distance from the centre of a node shape to its border along the unit direction (ux, uy),
// so links start and end exactly on the outline
export function shapeBoundary(
  shape: CategoryShape | undefined,
  half: number,
  ux: number,
  uy: number
): number {
  const vertices = shapeVertices(shape, half);
  if (!vertices) return circleRadius(half);
  let best = Infinity;
  for (let i = 0; i < vertices.length; i++) {
    const [px, py] = vertices[i];
    const [qx, qy] = vertices[(i + 1) % vertices.length];
    const ex = qx - px;
    const ey = qy - py;
    // Solve t * (ux, uy) = p + s * e for t > 0 and s in [0, 1]
    const denom = ux * ey - uy * ex;
    if (Math.abs(denom) < 1e-9) continue;
    const t = (px * ey - py * ex) / denom;
    const s = (px * uy - py * ux) / denom;
    if (t > 0 && s >= -1e-9 && s <= 1 + 1e-9 && t < best) best = t;
  }
  return Number.isFinite(best) ? best : half;
}

// Half size of the square that encloses a node shape (for halos and selection frames)
export function shapeExtent(shape: CategoryShape | undefined, half: number): number {
  const vertices = shapeVertices(shape, half);
  if (!vertices) return circleRadius(half);
  return Math.max(...vertices.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
}
