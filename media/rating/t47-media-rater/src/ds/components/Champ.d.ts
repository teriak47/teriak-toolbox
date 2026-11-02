import * as React from 'react';

/**
 * Props du champ de saisie.
 */
export interface ChampProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  /** Libellé en capitales mono. */
  label?: React.ReactNode;
  /** Valeur contrôlée. */
  valeur?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  placeholder?: string;
  /** Petite cote alignée à droite du libellé. */
  cote?: React.ReactNode;
  /** Zone de texte multiligne. */
  multiligne?: boolean;
}

/**
 * Champ de saisie — filet net, focus à l'accent ; pas de boîte arrondie.
 */
export function Champ(props: ChampProps): JSX.Element;
