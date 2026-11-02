import * as React from 'react';

export interface TamponProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Status text, for example EN COURS. */
  children: React.ReactNode;
  /** Muted neutral variant for closed statuses. */
  clos?: boolean;
}

/** Status stamp with a 21-degree cut. */
export function Tampon(props: TamponProps): JSX.Element;
