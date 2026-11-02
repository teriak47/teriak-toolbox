import React from 'react';

/** Status stamp with a 21-degree cut. */
export function Tampon({ children, clos = false, style, ...rest }) {
  const couleur = clos ? 'var(--etat-clos)' : 'var(--accent)';
  return (
    <span
      style={{
        position: 'relative', display: 'inline-block',
        font: `var(--poids-demi) var(--txt-sm)/1 var(--font-sans)`,
        letterSpacing: 'var(--ls-libelle)', color: couleur,
        padding: '5px 2px', whiteSpace: 'nowrap', ...style,
      }}
      {...rest}
    >
      {children}
      <i style={{
        position: 'absolute', left: '-9px', right: '-3px', top: '54%',
        height: '2px', background: couleur, transform: 'rotate(-10.5deg)',
      }} />
    </span>
  );
}
