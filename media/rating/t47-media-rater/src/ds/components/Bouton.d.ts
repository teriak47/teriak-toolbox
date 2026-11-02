import * as React from 'react';

/** Action button props. */
export interface BoutonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Button content. */
  children: React.ReactNode;
  /** Neutral outline, accent outline, filled accent or text-only style. */
  variante?: 'normal' | 'primaire' | 'rempli' | 'fantome';
  /** Button size. */
  taille?: 'sm' | 'md';
  /** Top-right corner cut at 21 degrees. */
  coupe?: boolean;
  /** Optional icon glyph. */
  icone?: React.ReactNode;
  disabled?: boolean;
}

/** SECTION 21 action button. */
export function Bouton(props: BoutonProps): JSX.Element;
