import * as React from 'react';

/** Archive surface props. */
export interface CarteProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  /** Identifier shown in the optional header. */
  cote?: string;
  /** Element shown at the right of the header. */
  mention?: React.ReactNode;
  /** Top-right corner cut at 21 degrees. */
  coupe?: boolean;
  /** Raised surface. */
  haute?: boolean;
  /** Left accent border for a highlighted item. */
  accent?: boolean;
}

/** Archive surface with border-based elevation. */
export function Carte(props: CarteProps): JSX.Element;
