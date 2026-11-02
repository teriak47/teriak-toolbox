import * as React from 'react';

export interface TamponProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Mention, ex. "EN COURS", "CLASSÉ". */
  children: React.ReactNode;
  /** Variante éteinte (neutre) pour les mentions closes. */
  clos?: boolean;
}

/** Tampon de statut — entaillé d'un seul trait net à 21°, jamais en rotation bancale. */
export function Tampon(props: TamponProps): JSX.Element;
