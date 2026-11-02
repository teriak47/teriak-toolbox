import React from 'react';

const REG = {
  info:    { barre: 'var(--accent)',   texte: 'var(--accent)',    mot: 'NOTE' },
  attente: { barre: 'var(--avert)',    texte: 'var(--avert)',     mot: 'À VÉRIFIER' },
  neutre:  { barre: 'var(--filet-fort)', texte: 'var(--texte-faible)', mot: 'INFO' },
};

/**
 * Alerte — bandeau de message contextuel (en ligne). Filet d'accent à gauche,
 * fente d'œil + libellé mono, corps du message. Trois registres seulement :
 * info (accent froid), « à vérifier » (unique ton chaud --avert), neutre.
 * Jamais de rouge ni de vert — l'alerte reste monochrome.
 */
export function Alerte({ registre = 'info', titre, onFermer, children, style, ...rest }) {
  const r = REG[registre] || REG.info;
  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: '14px',
        background: 'var(--surface-carte)',
        borderLeft: `var(--filet-epais) solid ${r.barre}`,
        border: 'var(--filet-fin) solid var(--filet)',
        borderLeftWidth: 'var(--filet-epais)',
        padding: '14px 16px', ...style,
      }}
      {...rest}
    >
      <span aria-hidden="true" style={{ display: 'inline-block', width: '16px', height: '5px', background: r.barre, transform: 'skewX(-21deg)', marginTop: '5px', flex: 'none' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: 'var(--poids-demi) var(--txt-2xs)/1 var(--font-sans)', letterSpacing: 'var(--ls-libelle)', color: r.texte, marginBottom: '6px' }}>{titre || r.mot}</div>
        <div style={{ font: 'var(--poids-normal) var(--txt-sm)/1.55 var(--font-sans)', color: 'var(--texte)' }}>{children}</div>
      </div>
      {onFermer ? (
        <button type="button" onClick={onFermer} aria-label="Fermer" style={{
          border: 'none', background: 'transparent', color: 'var(--texte-faible)',
          font: 'var(--poids-demi) var(--txt-md)/1 var(--font-sans)', cursor: 'pointer', padding: '0 2px', flex: 'none',
        }}>×</button>
      ) : null}
    </div>
  );
}
