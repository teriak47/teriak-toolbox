import * as React from 'react';

export type RegistreAlerte = 'info' | 'attente' | 'neutre' | 'succes' | 'attention' | 'erreur';

export interface AlerteProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Semantic color: info, succes, attention, erreur, attente or neutre. */
  registre?: RegistreAlerte;
  /** Uppercase label with a default per register. */
  titre?: React.ReactNode;
  /** Shows a close control when provided. */
  onFermer?: () => void;
  children?: React.ReactNode;
}

/** Contextual alert with semantic color and label. */
export function Alerte(props: AlerteProps): JSX.Element;
