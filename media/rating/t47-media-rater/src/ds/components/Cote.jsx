import React from 'react';

/** Monospace archive identifier. */
export function Cote({ children, dim = false, style, ...rest }) {
  return (
    <span
      style={{
        font: 'var(--type-cote)',
        letterSpacing: 'var(--ls-meta)',
        color: dim ? 'var(--texte-faible)' : 'var(--accent)',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
