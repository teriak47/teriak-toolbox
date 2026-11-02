import * as React from 'react';

export interface OptionMenuRadio {
  valeur: string;
  texte: string;
}

export interface MenuRadioProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'onChange'> {
  /** Selected value. */
  valeur?: string;
  onChange?: (valeur: string) => void;
  /** Options as strings or { valeur, texte } objects. */
  options?: (string | OptionMenuRadio)[];
}

/** Segmented single-choice control. */
export function MenuRadio(props: MenuRadioProps): JSX.Element;
