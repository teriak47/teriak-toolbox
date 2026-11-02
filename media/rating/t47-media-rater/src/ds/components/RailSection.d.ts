import * as React from 'react';

/** Section heading props. */
export interface RailSectionProps extends React.HTMLAttributes<HTMLElement> {
  /** Monospace section number. */
  numero?: React.ReactNode;
  /** Uppercase title. */
  titre: React.ReactNode;
  /** Section content. */
  children: React.ReactNode;
  /** Left rail width in pixels; defaults to 132. */
  largeurRail?: number;
}

/** Section heading with shards, number and title. */
export function RailSection(props: RailSectionProps): JSX.Element;
