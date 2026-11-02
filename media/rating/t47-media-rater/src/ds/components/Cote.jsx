import React from 'react';

/**
 * Cote — l'identifiant de classement mono qui marque chaque artefact
 * (T47/INC‑2026‑014). C'est la signature documentaire du système.
 */
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
