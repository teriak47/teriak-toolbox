import type { GraphEdge, GraphNode } from '../../shared/types.ts';
// Relative imports so the module also runs under node --test
import { boxBoundary, clampFinite, nodeHalf } from './canvasGeometry.ts';

export interface EdgeGeometry {
  edge: GraphEdge;
  /** SVG path: a straight segment, or two segments bent at one point for parallel links */
  pathD: string;
  /** Label position (middle of the link, or its bend) */
  mx: number;
  my: number;
  /** SVG polygon points of the arrowhead at the target end */
  arrowPoints: string;
  /** Smaller arrow along the link, so the direction reads without following it to the end;
   *  empty when there is no room for it before the label */
  midArrowPoints: string;
}

// Arrowhead at the target end, and the smaller arrow drawn along the link
export const ARROW_LENGTH = 12;
export const ARROW_HALF_WIDTH = 5.5;
const MID_ARROW_LENGTH = 9;
const MID_ARROW_HALF_WIDTH = 4.5;
// Space kept between the mid arrow and the label box or the link start
const MID_ARROW_GAP = 4;

// Half size of the box drawn at the middle of a link: the label, or for an unlabelled link
// the "+ label" placeholder shown on hover and selection (the canvas draws both from this)
export function edgeLabelHalfSize(label: string): { halfWidth: number; halfHeight: number } {
  if (!label) return { halfWidth: 34, halfHeight: 9 };
  return { halfWidth: label.length * 3.7 + 10, halfHeight: 10.5 };
}
// Triangle pointing along (ux, uy) with its tip at (tipX, tipY)
function arrowTriangle(
  tipX: number,
  tipY: number,
  ux: number,
  uy: number,
  length: number,
  halfWidth: number
): string {
  const bx = tipX - ux * length;
  const by = tipY - uy * length;
  const px = -uy;
  const py = ux;
  return [
    [tipX, tipY],
    [bx + px * halfWidth, by + py * halfWidth],
    [bx - px * halfWidth, by - py * halfWidth],
  ]
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
}

// Computes how each link is drawn: its ends are clipped to the node boxes, parallel links
// between the same two nodes are spread apart, and directed links get an arrowhead.
export function computeEdgeGeometry(
  nodes: GraphNode[],
  edges: GraphEdge[],
  getNodePos: (node: GraphNode) => { x: number; y: number },
  getNodeRadius: (nodeId: string) => number
): EdgeGeometry[] {
  const nodeById = new Map<string, GraphNode>();
  for (const n of nodes) {
    if (n?.id) nodeById.set(n.id, n);
  }

  // Group edges by unordered node pair for clean parallel curve separation
  const pairGroups = new Map<string, string[]>();
  for (const e of edges) {
    if (!e?.id) continue;
    const key =
      e.sourceNodeId < e.targetNodeId
        ? `${e.sourceNodeId}::${e.targetNodeId}`
        : `${e.targetNodeId}::${e.sourceNodeId}`;
    const list = pairGroups.get(key) ?? [];
    list.push(e.id);
    pairGroups.set(key, list);
  }

  return edges
    .map((edge) => {
      if (!edge?.id) return null;
      const srcNode = nodeById.get(edge.sourceNodeId);
      const tgtNode = nodeById.get(edge.targetNodeId);
      if (!srcNode || !tgtNode) return null;

      const p1 = getNodePos(srcNode);
      const p2 = getNodePos(tgtNode);
      const r1 = getNodeRadius(srcNode.id);
      const r2 = getNodeRadius(tgtNode.id);

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.hypot(dx, dy);
      if (!Number.isFinite(dist) || dist < 1) return null;

      const pairKey =
        edge.sourceNodeId < edge.targetNodeId
          ? `${edge.sourceNodeId}::${edge.targetNodeId}`
          : `${edge.targetNodeId}::${edge.sourceNodeId}`;
      const siblings = pairGroups.get(pairKey) ?? [edge.id];
      const idx = siblings.indexOf(edge.id);
      const curveStep = siblings.length > 1 ? (idx - (siblings.length - 1) / 2) * 48 : 0;

      // Canonical normal so A->B and B->A curve to opposite sides!
      const canonA = edge.sourceNodeId < edge.targetNodeId ? p1 : p2;
      const canonB = edge.sourceNodeId < edge.targetNodeId ? p2 : p1;
      const cdx = canonB.x - canonA.x;
      const cdy = canonB.y - canonA.y;
      const cdist = Math.hypot(cdx, cdy) || 1;
      const nx = -cdy / cdist;
      const ny = cdx / cdist;

      const cx = (p1.x + p2.x) / 2 + nx * curveStep;
      const cy = (p1.y + p2.y) / 2 + ny * curveStep;

      // Start tangent p1 -> control
      const sdx = cx - p1.x;
      const sdy = cy - p1.y;
      const sLen = Math.hypot(sdx, sdy) || 1;
      const b1 = boxBoundary(nodeHalf(r1), sdx / sLen, sdy / sLen);
      const sx = p1.x + (sdx / sLen) * (b1 + 3);
      const sy = p1.y + (sdy / sLen) * (b1 + 3);

      // End tangent control -> p2
      const edx = p2.x - cx;
      const edy = p2.y - cy;
      const eLen = Math.hypot(edx, edy) || 1;
      const eux = edx / eLen;
      const euy = edy / eLen;
      const b2 = boxBoundary(nodeHalf(r2), eux, euy);
      const endPad = edge.directed ? b2 + 4 : b2 + 3;
      const tx = p2.x - eux * endPad;
      const ty = p2.y - euy * endPad;

      if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(tx) || !Number.isFinite(ty)) {
        return null;
      }

      const pathD =
        Math.abs(curveStep) < 0.5
          ? `M ${sx.toFixed(1)} ${sy.toFixed(1)} L ${tx.toFixed(1)} ${ty.toFixed(1)}`
          : `M ${sx.toFixed(1)} ${sy.toFixed(1)} L ${cx.toFixed(1)} ${cy.toFixed(1)} L ${tx.toFixed(1)} ${ty.toFixed(1)}`;

      // Parallel links bend at a single point; the label sits on that bend
      const mx = Math.abs(curveStep) < 0.5 ? (sx + tx) / 2 : cx;
      const my = Math.abs(curveStep) < 0.5 ? (sy + ty) / 2 : cy;

          // Arrowhead at (tx, ty), its tip slightly past the line end
      const arrowPoints = arrowTriangle(
        tx + eux * 2,
        ty + euy * 2,
        eux,
        euy,
        ARROW_LENGTH,
        ARROW_HALF_WIDTH
      );

      // Mid arrow on the first segment (the whole link when straight), placed in the free
      // part before the label so the label's opaque box never hides it. Skipped when that
      // part is too short: the arrowhead at the target still shows the direction.
      const bent = Math.abs(curveStep) >= 0.5;
      const segEndX = bent ? cx : tx;
      const segEndY = bent ? cy : ty;
      const segLen = Math.hypot(segEndX - sx, segEndY - sy) || 1;
      const mux = (segEndX - sx) / segLen;
      const muy = (segEndY - sy) / segLen;
      // Distance from the segment start to the label centre (the bend, or the middle)
      const labelCentre = bent ? segLen : segLen / 2;
      const { halfWidth, halfHeight } = edgeLabelHalfSize(edge.label ?? '');
      // The middle always holds a box (label or placeholder), so the arrow never moves
      // between rest and hover
      const labelExit = Math.min(
        Math.abs(mux) > 1e-6 ? halfWidth / Math.abs(mux) : Infinity,
        Math.abs(muy) > 1e-6 ? halfHeight / Math.abs(muy) : Infinity
      );
      const freeEnd = labelCentre - labelExit - MID_ARROW_GAP;
      const midDist = freeEnd / 2;
      const fits = freeEnd >= MID_ARROW_LENGTH + MID_ARROW_GAP * 2;
      const midArrowPoints = fits
        ? arrowTriangle(
            sx + mux * (midDist + MID_ARROW_LENGTH / 2),
            sy + muy * (midDist + MID_ARROW_LENGTH / 2),
            mux,
            muy,
            MID_ARROW_LENGTH,
            MID_ARROW_HALF_WIDTH
          )
        : '';

      return {
        edge,
        pathD,
        mx: clampFinite(mx, 0),
        my: clampFinite(my, 0),
        arrowPoints,
        midArrowPoints,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}
