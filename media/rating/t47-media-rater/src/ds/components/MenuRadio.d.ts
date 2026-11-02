import * as React from 'react';

export interface OptionMenuRadio {
  valeur: string;
  texte: string;
}

export interface MenuRadioProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'onChange'> {
  /** Valeur sélectionnée. */
  valeur?: string;
  onChange?: (valeur: string) => void;
  /** Options : chaînes simples ou { valeur, texte }. */
  options?: (string | OptionMenuRadio)[];
}

/** Menu radio segmenté — segments accolés, actif à l'accent plein. */
export function MenuRadio(props: MenuRadioProps): JSX.Element;
