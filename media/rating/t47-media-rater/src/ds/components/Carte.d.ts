import * as React from 'react';

/**
 * Props de la surface d'archive.
 */
export interface CarteProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  /** Cote affichée dans l'en-tête (active l'en-tête). */
  cote?: string;
  /** Élément du coin droit de l'en-tête, ex. un <Etat/>. */
  mention?: React.ReactNode;
  /** Coin supérieur droit coupé à 21°. */
  coupe?: boolean;
  /** Surface surélevée (un cran plus clair). */
  haute?: boolean;
  /** Liseré d'accent à gauche — rare, pour signaler une pièce active. */
  accent?: boolean;
}

/**
 * Surface d'archive — élévation au filet, pas d'ombre ni d'arrondi.
 */
export function Carte(props: CarteProps): JSX.Element;
