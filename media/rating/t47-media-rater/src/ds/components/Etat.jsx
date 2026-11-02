import React from 'react';

const MAP = {
  actif:   { mot: 'EN COURS', couleur: 'var(--etat-actif)',   variante: '' },
  retenu:  { mot: 'RETENUE',  couleur: 'var(--etat-actif)',   variante: '' },
  attente: { mot: 'À VÉRIFIER', couleur: 'var(--avert)', variante: 'attente' },
  clos:    { mot: 'CLASSÉ',   couleur: 'var(--etat-clos)',     variante: 'dim' },
  ecarte:  { mot: 'ÉCARTÉE',  couleur: 'var(--etat-clos)',     variante: 'dim' },
};

/**
 * État — indicateur d'état. Le vivant porte l'accent FROID (« en cours / retenu ») ;
 * « à vérifier » porte l'unique ton chaud calme (--avert), jamais le rouge ni le vert ;
 * le clos s'efface dans les neutres. La pastille est une FENTE D'ŒIL (jamais un cercle).
 */
export function Etat({ valeur = 'actif', enfant, style, ...rest }) {
  const e = MAP[valeur] || MAP.actif;
  const barre = valeur === 'actif' || valeur === 'retenu'
    ? 'var(--accent)'
    : valeur === 'attente' ? 'var(--avert)' : 'var(--etat-clos)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', ...style }} {...rest}>
      <span style={{ display: 'inline-block', width: '16px', height: '5px', background: barre, transform: 'skewX(-21deg)' }} />
      <span style={{
        font: 'var(--poids-demi) var(--txt-2xs)/1 var(--font-sans)',
        letterSpacing: 'var(--ls-libelle)', color: e.couleur,
        textDecoration: valeur === 'ecarte' ? 'line-through' : 'none',
      }}>
        {enfant || e.mot}
      </span>
    </span>
  );
}
