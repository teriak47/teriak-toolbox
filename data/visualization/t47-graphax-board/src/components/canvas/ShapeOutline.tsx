import type { ReactNode, SVGProps } from 'react';
import type { CategoryShape } from '@shared/types';
import { circleRadius, nodeHalf, shapePoints } from '@/lib/canvasGeometry';

// Draws a node shape (or a ring around it) centred on 0,0
export function ShapeOutline({
  shape,
  half,
  children,
  ...props
}: {
  shape: CategoryShape | undefined;
  half: number;
  children?: ReactNode;
} & SVGProps<SVGPolygonElement> & SVGProps<SVGCircleElement>) {
  if (shape === 'circle') {
    return (
      <circle r={circleRadius(half)} {...(props as SVGProps<SVGCircleElement>)}>
        {children}
      </circle>
    );
  }
  return (
    <polygon
      points={shapePoints(shape, half)}
      strokeLinejoin="miter"
      {...(props as SVGProps<SVGPolygonElement>)}
    >
      {children}
    </polygon>
  );
}

// A node's filled shape for a node radius
export function renderNodeShape(
  shape: CategoryShape | undefined,
  r: number,
  fill: string,
  stroke: string,
  strokeWidth: number
) {
  return (
    <ShapeOutline
      shape={shape}
      half={nodeHalf(r)}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
    />
  );
}
