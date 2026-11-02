import * as React from 'react';

export interface JaugeProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Libellé mono en capitales. */
  label?: React.ReactNode;
  /** Valeur courante. */
  valeur?: number;
  /** Valeur maximale. Défaut 100. */
  max?: number;
  /** Seuil (en %) au-delà duquel la jauge passe au ton --avert. Défaut 80. */
  seuil?: number;
  /** Unité affichée après la valeur. Défaut « % ». */
  unite?: string;
  /** Affiche la valeur numérique à droite du libellé. Défaut true. */
  afficheValeur?: boolean;
}

/** Jauge — barre de mesure monochrome, accent froid, --avert au-delà du seuil. */
export function Jauge(props: JaugeProps): JSX.Element;
