import * as React from 'react';

/**
 * Props du bouton d'action Teriak47.
 */
export interface BoutonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Contenu du bouton (texte). */
  children: React.ReactNode;
  /** Style : contour neutre, accent en contour, accent rempli, ou texte seul. */
  variante?: 'normal' | 'primaire' | 'rempli' | 'fantome';
  /** Taille. */
  taille?: 'sm' | 'md';
  /** Coin supérieur droit coupé à 21° (géométrie de l'éclair). */
  coupe?: boolean;
  /** Glyphe d'icône optionnel (ex. '▸'), rendu en mono à l'accent. */
  icone?: React.ReactNode;
  disabled?: boolean;
}

/**
 * Bouton d'action Teriak47 — angles francs, aucun halo, aucun déplacement au survol.
 */
export function Bouton(props: BoutonProps): JSX.Element;
