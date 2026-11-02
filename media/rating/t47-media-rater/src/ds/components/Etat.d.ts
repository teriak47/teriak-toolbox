import * as React from 'react';

export interface EtatProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Document status. */
  valeur?: 'actif' | 'retenu' | 'attente' | 'clos' | 'ecarte';
  /** Custom label replacing the default. */
  enfant?: React.ReactNode;
}

/** Status indicator with an eye slit and label. */
export function Etat(props: EtatProps): JSX.Element;
