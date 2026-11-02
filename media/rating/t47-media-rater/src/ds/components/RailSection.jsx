import React from 'react';

/**
 * RailSection — l'en-tête de section signature : un rail qui porte les éclats
 * de fourrure, le numéro mono et l'intitulé en capitales. C'est ici, et nulle
 * part ailleurs, que les éclats marquent une tête de section.
 */
export function RailSection({ numero, titre, children, largeurRail = 132, style, ...rest }) {
  return (
    <section style={{ display: 'grid', gridTemplateColumns: `${largeurRail}px 1fr`, gap: '32px', ...style }} {...rest}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '11px', alignItems: 'flex-start' }}>
        <span style={{ display: 'inline-flex', gap: '5px', alignItems: 'flex-start' }}>
          <i style={{ display: 'block', width: '3px', height: '17px', background: 'var(--filet-fort)', transform: 'rotate(21deg)' }} />
          <i style={{ display: 'block', width: '3px', height: '11px', marginTop: '3px', background: 'var(--filet-fort)', transform: 'rotate(21deg)' }} />
          <i style={{ display: 'block', width: '3px', height: '6px', marginTop: '6px', background: 'var(--filet-fort)', transform: 'rotate(21deg)' }} />
        </span>
        {numero != null ? (
          <span style={{ font: 'var(--type-cote)', fontSize: 'var(--txt-xs)', color: 'var(--accent)', letterSpacing: 'var(--ls-meta)' }}>{numero}</span>
        ) : null}
        <span style={{ font: 'var(--poids-demi) var(--txt-sm)/1.3 var(--font-sans)', letterSpacing: 'var(--ls-libelle)', color: 'var(--texte-fort)' }}>{titre}</span>
      </div>
      <div>{children}</div>
    </section>
  );
}
