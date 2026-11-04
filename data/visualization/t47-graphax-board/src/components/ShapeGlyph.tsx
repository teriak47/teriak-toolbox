import type { CategoryShape } from '@shared/types';
import { circleRadius, shapeExtent, shapePoints } from '@/lib/canvasGeometry';

interface ShapeGlyphProps {
  shape: CategoryShape | undefined;
  size?: number;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  className?: string;
}

// A node shape drawn at icon size, with the same geometry as the canvas
export function ShapeGlyph({
  shape,
  size = 20,
  stroke = 'currentColor',
  fill = 'none',
  strokeWidth = 1.5,
  className,
}: ShapeGlyphProps) {
  const half = 10;
  const box = shapeExtent(shape, half) + strokeWidth;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-box} ${-box} ${box * 2} ${box * 2}`}
      className={className}
      aria-hidden="true"
    >
      {shape === 'circle' ? (
        <circle r={circleRadius(half)} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      ) : (
        <polygon
          points={shapePoints(shape, half)}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="miter"
        />
      )}
    </svg>
  );
}
