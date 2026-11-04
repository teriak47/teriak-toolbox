// Pure geometry helpers for the graph canvas (no React), so they can be unit tested.

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
