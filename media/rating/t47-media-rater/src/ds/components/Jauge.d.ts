import * as React from 'react';

export interface JaugeProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Uppercase label. */
  label?: React.ReactNode;
  /** Current value. */
  valeur?: number;
  /** Maximum value; defaults to 100. */
  max?: number;
  /** Percentage threshold for warning color; defaults to 80. */
  seuil?: number;
  /** Displayed unit; defaults to percent. */
  unite?: string;
  /** Show numeric value; defaults to true. */
  afficheValeur?: boolean;
}

/** Measurement bar with warning threshold. */
export function Jauge(props: JaugeProps): JSX.Element;
