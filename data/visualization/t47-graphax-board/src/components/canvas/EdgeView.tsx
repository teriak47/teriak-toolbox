import { memo } from 'react';
import { edgeLabelHalfSize, type EdgeGeometry } from '@/lib/edgeGeometry';

interface EdgeViewProps {
  geometry: EdgeGeometry;
  /** Node selected on the canvas: its links take the direction colours */
  selectedNodeId: string | null;
  selected: boolean;
  hovered: boolean;
  /** A link of the hovered node */
  spotlighted: boolean;
  dimmed: boolean;
  /** Its label is being edited in the HTML overlay, so the SVG label is hidden */
  editing: boolean;
  onHover: (edgeId: string, hovered: boolean) => void;
  onSelect: (edgeId: string) => void;
  onEditLabel: (edgeId: string, label: string) => void;
}

// One link of the canvas: hit area, line, direction arrows and midpoint label (O6)
export const EdgeView = memo(function EdgeView({
  geometry,
  selectedNodeId,
  selected: isSelected,
  hovered: isHovered,
  spotlighted: isIncidentSpotlight,
  dimmed: isDimmed,
  editing,
  onHover,
  onSelect,
  onEditLabel,
}: EdgeViewProps) {
  const { edge, pathD, mx, my, arrowPoints, midArrowPoints } = geometry;
  const isDashed = edge.style === 'dashed';
  const labelText = String(edge.label ?? '');

  // Links of the selected node: outgoing and incoming in two colours of the same
  // family, so the direction of every relation reads at a glance
  const relation = !selectedNodeId
    ? null
    : edge.sourceNodeId === selectedNodeId
      ? edge.directed
        ? 'outgoing'
        : 'linked'
      : edge.targetNodeId === selectedNodeId
        ? edge.directed
          ? 'incoming'
          : 'linked'
        : null;
  // Moving dashes show the direction of the link being looked at
  const showFlow = edge.directed && (isSelected || isHovered || relation !== null);

  // A custom colour stays visible when the link is selected or hovered; the
  // direction colours of a selected node take over, then fall back to it
  const customColor = edge.color ?? null;
  const strokeColor =
    relation === 'incoming'
      ? 'var(--lien-entrant)'
      : relation !== null
        ? 'var(--lien-sortant)'
        : customColor
          ? customColor
          : isSelected
            ? 'var(--accent-fort)'
            : isIncidentSpotlight || isHovered
              ? 'var(--accent)'
              : 'var(--filet-fort)';

  const strokeWidth =
    isSelected || isHovered ? 2.4 : relation !== null ? 2.2 : isIncidentSpotlight ? 2.0 : 1.45;

  return (
    <g
      className="transition-opacity duration-150 cursor-pointer"
      style={{ opacity: isDimmed ? 0.16 : 1 }}
      onMouseEnter={() => onHover(edge.id, true)}
      onMouseLeave={() => onHover(edge.id, false)}
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(edge.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onSelect(edge.id);
        onEditLabel(edge.id, labelText);
      }}
    >
      {/* Wide transparent hit area so thin lines are easy to click */}
      <path d={pathD} fill="none" stroke="transparent" strokeWidth={18} />

      <path
        d={pathD}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={isDashed ? '6 5' : undefined}
        strokeLinecap="butt"
      />

      {/* Moving dashes along the direction of the link */}
      {showFlow && (
        <path
          d={pathD}
          fill="none"
          stroke="var(--surface-puits)"
          strokeWidth={Math.max(1, strokeWidth - 1)}
          className="graphax-edge-flow pointer-events-none"
        />
      )}

      {/* Direction: arrow along the link and arrowhead at the target */}
      {edge.directed && (
        <>
          {midArrowPoints && (
            <polygon points={midArrowPoints} fill={strokeColor} className="pointer-events-none" />
          )}
          <polygon points={arrowPoints} fill={strokeColor} />
        </>
      )}

      {/* Midpoint label */}
      {!editing && (labelText || isSelected || isHovered) && (
        <g transform={`translate(${mx.toFixed(1)}, ${my.toFixed(1)})`}>
          {labelText ? (
            <>
              <rect
                x={-edgeLabelHalfSize(labelText).halfWidth}
                y={-edgeLabelHalfSize(labelText).halfHeight}
                width={edgeLabelHalfSize(labelText).halfWidth * 2}
                height={edgeLabelHalfSize(labelText).halfHeight * 2}
                fill="var(--surface-puits)"
                stroke={isSelected ? 'var(--accent-fort)' : (customColor ?? 'var(--filet)')}
                strokeWidth={1}
                strokeDasharray={isDashed ? '3 2' : undefined}
              />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fill="var(--texte-fort)"
                fontSize={12}
                fontWeight={500}
                className="pointer-events-none"
              >
                {labelText}
              </text>
            </>
          ) : (
            <g>
              <rect
                x={-edgeLabelHalfSize('').halfWidth}
                y={-edgeLabelHalfSize('').halfHeight}
                width={edgeLabelHalfSize('').halfWidth * 2}
                height={edgeLabelHalfSize('').halfHeight * 2}
                fill="var(--surface-carte)"
                stroke="var(--filet-fort)"
                strokeWidth={1}
              />
              <text textAnchor="middle" dominantBaseline="central" fill="var(--texte)" fontSize={12}>
                + label
              </text>
            </g>
          )}
        </g>
      )}
    </g>
  );
});
