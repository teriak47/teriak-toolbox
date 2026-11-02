import * as React from 'react';

export type RegistreAlerte = 'info' | 'attente' | 'neutre';

export interface AlerteProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Registre : info (accent), attente (--avert), neutre. */
  registre?: RegistreAlerte;
  /** Libellé mono en capitales (défaut selon le registre). */
  titre?: React.ReactNode;
  /** Si fourni, affiche une croix de fermeture. */
  onFermer?: () => void;
  children?: React.ReactNode;
}

/** Alerte — bandeau contextuel monochrome, filet d'accent à gauche, fente d'œil. */
export function Alerte(props: AlerteProps): JSX.Element;
