import * as React from 'react';

/**
 * Props de l'en-tête de section signature.
 */
export interface RailSectionProps extends React.HTMLAttributes<HTMLElement> {
  /** Numéro de section (ex. "01"), affiché en mono accent. */
  numero?: React.ReactNode;
  /** Intitulé en capitales. */
  titre: React.ReactNode;
  /** Contenu de la section. */
  children: React.ReactNode;
  /** Largeur du rail gauche en px (défaut 132). */
  largeurRail?: number;
}

/**
 * En-tête de section signature — rail gauche : éclats + numéro + intitulé.
 */
export function RailSection(props: RailSectionProps): JSX.Element;
