import React from 'react';

/** Measurement bar with an optional warning threshold. */
export function Jauge({ label, valeur = 0, max = 100, seuil = 80, unite = '%', afficheValeur = true, style, ...rest }) {
  const pct = Math.max(0, Math.min(100, (valeur / max) * 100));
  const alerte = pct >= seuil;
  const teinte = alerte ? 'var(--avert)' : 'var(--accent)';
  return (
    <div style={{ ...style }} {...rest}>
      {(label || afficheValeur) ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
          {label ? <span style={{ font: 'var(--poids-demi) var(--txt-2xs)/1 var(--font-sans)', letterSpacing: 'var(--ls-libelle)', color: 'var(--texte-faible)' }}>{label}</span> : <span />}
          {afficheValeur ? <span style={{ font: 'var(--poids-demi) var(--txt-md)/1 var(--font-sans)', color: alerte ? 'var(--avert)' : 'var(--texte-fort)' }}>{Math.round(pct)}{unite}</span> : null}
        </div>
      ) : null}
      <div style={{ height: '5px', background: 'var(--surface-haute)' }}>
        <div style={{ height: '5px', width: `${pct}%`, background: teinte, transition: 'width var(--duree) var(--ease)' }} />
      </div>
    </div>
  );
}
