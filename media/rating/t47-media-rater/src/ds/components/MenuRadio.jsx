import React from 'react';

/**
 * MenuRadio — contrôle segmenté (choix unique). Segments accolés dans un cadre
 * à filet ; le segment actif porte l'accent plein. Angles francs. Remplace le
 * groupe radio classique pour 2 à 5 options courtes.
 */
export function MenuRadio({ valeur, onChange, options = [], style, ...rest }) {
  const items = options.map((o) => (typeof o === 'string' ? { valeur: o, texte: o } : o));
  return (
    <span
      role="radiogroup"
      style={{ display: 'inline-flex', border: 'var(--filet-fin) solid var(--filet)', ...style }}
      {...rest}
    >
      {items.map((o, i) => {
        const actif = o.valeur === valeur;
        return (
          <button
            key={o.valeur}
            type="button"
            role="radio"
            aria-checked={actif}
            onClick={() => onChange && onChange(o.valeur)}
            style={{
              font: 'var(--poids-demi) var(--txt-xs)/1 var(--font-sans)',
              letterSpacing: '0.08em',
              padding: '10px 16px',
              border: 'none',
              borderLeft: i === 0 ? 'none' : 'var(--filet-fin) solid var(--filet)',
              background: actif ? 'var(--accent)' : 'transparent',
              color: actif ? 'var(--texte-sur-accent)' : 'var(--texte)',
              cursor: 'pointer', whiteSpace: 'nowrap',
              transition: 'background var(--duree) var(--ease), color var(--duree) var(--ease)',
            }}
          >
            {o.texte}
          </button>
        );
      })}
    </span>
  );
}
