import React from 'react';
import { Cote } from './Cote.jsx';

/** Archive surface with an optional cut corner and header. */
export function Carte({
  children,
  cote,                 // string: show a header with the identifier
  mention,              // ReactNode shown at the right of the header, e.g. <Etat/>
  coupe = false,        // cut top-right corner
  haute = false,        // raised surface
  accent = false,       // left accent border for highlighted items
  style,
  ...rest
}) {
  const surface = haute ? 'var(--surface-haute)' : 'var(--surface-carte)';
  const decoupe = 'polygon(0 0, calc(100% - 12px) 0, 100% 31px, 100% 100%, 0 100%)';

  const interieur = (
    <React.Fragment>
      {cote || mention ? (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 16px', borderBottom: 'var(--filet-fin) solid var(--filet)',
        }}>
          {cote ? <Cote>{cote}</Cote> : <span />}
          {mention}
        </div>
      ) : null}
      <div style={{ padding: '16px' }}>{children}</div>
    </React.Fragment>
  );

  // Chamfer: wrap the surface in a matching border layer
  // so the border continues along the cut.
  if (coupe) {
    return (
      <div
        style={{
          background: 'var(--filet)',
          borderLeft: accent ? 'var(--filet-epais) solid var(--accent)' : undefined,
          padding: 'var(--filet-fin)',
          clipPath: decoupe,
          ...style,
        }}
        {...rest}
      >
        <div style={{ background: surface, clipPath: decoupe }}>
          {interieur}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: surface,
        border: 'var(--filet-fin) solid var(--filet)',
        borderLeft: accent ? 'var(--filet-epais) solid var(--accent)' : undefined,
        ...style,
      }}
      {...rest}
    >
      {interieur}
    </div>
  );
}
