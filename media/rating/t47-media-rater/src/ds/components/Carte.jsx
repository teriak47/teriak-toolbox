import React from 'react';
import { Cote } from './Cote.jsx';

/**
 * Carte — surface d'archive. Pas d'ombre ni d'arrondi : l'élévation se lit
 * au filet. Un coin peut être coupé à 21°. En-tête optionnel portant une cote
 * et une mention à droite.
 */
export function Carte({
  children,
  cote,                 // string — affiche un en-tête avec la cote
  mention,              // ReactNode — coin droit de l'en-tête (ex. <Etat/>)
  coupe = false,        // coin supérieur droit coupé
  haute = false,        // surface surélevée
  accent = false,       // liseré d'accent à gauche (rare — pour signaler)
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

  // Chamfer : on enveloppe la surface d'un calque couleur-filet, lui aussi
  // découpé, pour que le bord se prolonge le long de la coupe (1 filet partout).
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
