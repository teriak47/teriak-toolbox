import type { MouseEvent } from 'react';
import type { Category, GraphNode } from '@shared/types';
import { describeReliability } from '@shared/types';
import { getCategoryIcon } from '@/lib/icons';
import { cardEntries } from '@/lib/metadata';
import { cn } from '@/lib/utils';
import { nodeHalf } from '@/lib/canvasGeometry';
import { ShapeOutline, renderNodeShape } from './ShapeOutline';

interface NodeViewProps {
  node: GraphNode;
  pos: { x: number; y: number };
  /** Node radius (it grows with the number of links) */
  r: number;
  category: Category | null;
  toolMode: 'select' | 'link';
  selected: boolean;
  hovered: boolean;
  /** The pointer is on the link ring around the node */
  haloHovered: boolean;
  /** A link being drawn starts from this node */
  linkSource: boolean;
  searchHit: boolean;
  dimmed: boolean;
  onHover: (nodeId: string, hovered: boolean) => void;
  onHaloHover: (nodeId: string, hovered: boolean) => void;
  /** Plain selection (ring or title clicked) */
  onSelect: (nodeId: string) => void;
  onDoubleClick: (e: MouseEvent, node: GraphNode) => void;
  /** Mouse down on the link ring: starts drawing a link */
  onHaloMouseDown: (e: MouseEvent, node: GraphNode) => void;
  /** Mouse down on the node itself: drag, link or end of a two-click link */
  onBodyMouseDown: (e: MouseEvent, node: GraphNode) => void;
  /** Click on the node itself: selection, Ctrl+click toggles it in the multiple selection */
  onBodyClick: (e: MouseEvent, node: GraphNode) => void;
}

const outlinedText = (width: number, join?: 'miter') => ({
  paintOrder: 'stroke',
  stroke: 'var(--surface-puits)',
  strokeWidth: width,
  ...(join ? { strokeLinejoin: join } : {}),
});

// One node of the canvas: link ring, shape, icon, badges and the title below (O6). The
// interaction logic stays in GraphCanvas, which passes it as callbacks.
export function NodeView({
  node,
  pos,
  r,
  category: cat,
  toolMode,
  selected: isSelected,
  hovered: isHovered,
  haloHovered: isHaloHovered,
  linkSource: isLinkSource,
  searchHit: isSearchHit,
  dimmed: isDimmed,
  onHover,
  onHaloHover,
  onSelect,
  onDoubleClick,
  onHaloMouseDown,
  onBodyMouseDown,
  onBodyClick,
}: NodeViewProps) {
  const color = cat?.color ?? 'var(--texte)';
  const Icon = getCategoryIcon(cat?.icon);
  const nodeTitle = String(node.title ?? 'Indice');
  const nodeContent = String(node.content ?? '');
  const nodeMeta = node.metadata && typeof node.metadata === 'object' ? node.metadata : {};

  // Empty fields (a category's default keys not filled yet) are not details
  const metaEntries = Object.entries(nodeMeta).filter(([, v]) => String(v ?? '').trim());
  const hasDetails = nodeContent.trim().length > 0 || metaEntries.length > 0;
  // Values chosen in the category for the card, then the first other value on hover
  const card = cardEntries(cat, nodeMeta);
  const cardLine = card.map((e) => e.value).join(' · ');
  const shownKeys = new Set(card.map((e) => e.key));
  const firstMeta = metaEntries.find(([k]) => !shownKeys.has(k));

  return (
    <g
      transform={`translate(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)})`}
      className="transition-opacity duration-150"
      style={{ opacity: isDimmed ? 0.2 : 1 }}
      onMouseEnter={() => onHover(node.id, true)}
      onMouseLeave={() => onHover(node.id, false)}
      onDoubleClick={(e) => onDoubleClick(e, node)}
    >
      {/* Link ring all around the node: drag it to another node to link them */}
      {toolMode === 'select' && (
        <ShapeOutline
          shape={cat?.shape}
          half={nodeHalf(r) + 8}
          fill="none"
          stroke={isHaloHovered || isLinkSource ? 'var(--accent-fort)' : color}
          strokeWidth={11}
          strokeOpacity={isHaloHovered || isLinkSource ? 0.42 : isHovered ? 0.18 : 0}
          className="cursor-crosshair transition-opacity"
          onMouseEnter={() => onHaloHover(node.id, true)}
          onMouseLeave={() => onHaloHover(node.id, false)}
          onMouseDown={(e) => onHaloMouseDown(e, node)}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(node.id);
          }}
        >
          <title>Glisser ce cadre vers un autre nœud pour créer un lien</title>
        </ShapeOutline>
      )}

      {/* Dashed ring when hovered */}
      {(isHovered || isHaloHovered || isLinkSource) && (
        <ShapeOutline
          shape={cat?.shape}
          half={nodeHalf(r) + 9}
          fill="none"
          stroke={isHaloHovered || isLinkSource ? 'var(--accent-fort)' : color}
          strokeWidth={1.3}
          strokeDasharray="4 3"
          opacity={0.75}
          className="pointer-events-none"
        />
      )}

      {/* Selection or search ring */}
      {(isSelected || isSearchHit) && (
        <ShapeOutline
          shape={cat?.shape}
          half={nodeHalf(r) + 4.5}
          fill="none"
          stroke={isSelected ? 'var(--accent-fort)' : 'var(--attention)'}
          strokeWidth={2}
          className="pointer-events-none"
        />
      )}

      {/* The node itself: drag to move (Shift+drag, right drag or link mode to link) */}
      <g
        className={cn(toolMode === 'link' ? 'cursor-crosshair' : 'cursor-pointer')}
        onMouseDown={(e) => onBodyMouseDown(e, node)}
        onClick={(e) => onBodyClick(e, node)}
      >
        {renderNodeShape(cat?.shape, r, 'var(--surface-carte)', color, isSelected ? 2.6 : 2)}
        {/* Category tint */}
        {renderNodeShape(cat?.shape, r - 1, `color-mix(in oklab, ${color} 17%, transparent)`, 'none', 0)}

        <g
          transform={`translate(${-9}, ${-9})`}
          style={{ color: isSelected ? 'var(--texte-fort)' : color }}
          className="pointer-events-none"
        >
          <Icon width={18} height={18} strokeWidth={2} />
        </g>

        {/* Notes or attributes */}
        {hasDetails && (
          <rect
            x={nodeHalf(r) - 4}
            y={-nodeHalf(r) - 4}
            width={8}
            height={8}
            fill={color}
            stroke="var(--surface-puits)"
            strokeWidth={1.5}
            className="pointer-events-none"
          />
        )}

        {/* Reliability badge (Admiralty code, A3) on the top-left corner */}
        {node.reliability && (
          <g
            transform={`translate(${-nodeHalf(r) - 6}, ${-nodeHalf(r) - 7})`}
            aria-label={`Fiabilité ${node.reliability}`}
          >
            <title>{`Fiabilité ${node.reliability} : ${describeReliability(node.reliability) ?? ''}`}</title>
            <rect x={-11} y={-7} width={22} height={14} fill="var(--surface-puits)" stroke={color} strokeWidth={1.2} />
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={9}
              fontFamily="var(--font-mono, ui-monospace, monospace)"
              fill="var(--texte-fort)"
            >
              {node.reliability}
            </text>
          </g>
        )}
      </g>

      {/* Title below the node: a click selects the node instead of reaching the background */}
      <g
        transform={`translate(0, ${r + 15})`}
        className="cursor-pointer"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(node.id);
        }}
      >
        <text
          textAnchor="middle"
          fill={isSelected || isHovered ? 'var(--texte-fort)' : 'var(--txt-1)'}
          fontSize={12}
          fontWeight={isSelected || isHovered ? 600 : 500}
          style={outlinedText(4.5, 'miter')}
        >
          {nodeTitle.length > 34 ? `${nodeTitle.slice(0, 32)}…` : nodeTitle}
        </text>

        {/* Card values chosen in the category, always shown */}
        {cardLine && (
          <text y={15} textAnchor="middle" fill={color} fontSize={12} fontFamily="var(--font-mono)" style={outlinedText(4)}>
            <title>{card.map((e) => `${e.key} : ${e.value}`).join('\n')}</title>
            {cardLine.length > 34 ? `${cardLine.slice(0, 32)}…` : cardLine}
          </text>
        )}

        {/* First other attribute, on hover or selection */}
        {firstMeta && (isHovered || isSelected) && (
          <text
            y={cardLine ? 30 : 15}
            textAnchor="middle"
            fill="var(--texte)"
            fontSize={12}
            fontFamily="var(--font-mono)"
            style={outlinedText(4)}
          >
            {String(firstMeta[0])}: {String(firstMeta[1] ?? '').slice(0, 26)}
          </text>
        )}
      </g>
    </g>
  );
}
