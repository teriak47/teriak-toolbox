import * as React from 'react';

export interface EtatProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** L'état documentaire. Monochrome par principe — aucun vert/ambre/rouge. */
  valeur?: 'actif' | 'retenu' | 'attente' | 'clos' | 'ecarte';
  /** Libellé personnalisé (remplace le mot par défaut). */
  enfant?: React.ReactNode;
}

/** Indicateur d'état — fente d'œil + libellé ; accent froid pour le vivant, ocre calme (--avert) pour l'alerte « à vérifier », neutres pour le clos. */
export function Etat(props: EtatProps): JSX.Element;
