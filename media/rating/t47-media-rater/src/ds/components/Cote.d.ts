import * as React from 'react';

export interface CoteProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Archive identifier text. */
  children: React.ReactNode;
  /** Use a muted neutral variant. */
  dim?: boolean;
}

/** Monospace archive identifier. */
export function Cote(props: CoteProps): JSX.Element;
