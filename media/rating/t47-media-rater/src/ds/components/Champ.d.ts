import * as React from 'react';

/** Text field props. */
export interface ChampProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  /** Uppercase label. */
  label?: React.ReactNode;
  /** Controlled value. */
  valeur?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  placeholder?: string;
  /** Identifier aligned to the right of the label. */
  cote?: React.ReactNode;
  /** Multiline text area. */
  multiligne?: boolean;
}

/** Text field with an accent focus border. */
export function Champ(props: ChampProps): JSX.Element;
