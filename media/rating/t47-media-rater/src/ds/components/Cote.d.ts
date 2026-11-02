import * as React from 'react';

export interface CoteProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Le texte de la cote, ex. "T47/INC‑2026‑014". */
  children: React.ReactNode;
  /** Variante effacée (neutre) plutôt qu'accent. */
  dim?: boolean;
}

/** Cote de classement mono — la signature documentaire de chaque artefact. */
export function Cote(props: CoteProps): JSX.Element;
