import React from 'react';

/**
 * Bouton — action Teriak47. Angles francs (aucune courbe), un coin peut être
 * coupé à 21°. L'état actif/primaire porte l'accent ; le survol fonce le filet
 * ou éclaircit le fond, sans halo ni déplacement.
 */
export function Bouton({
  children,
  variante = 'normal',   // 'normal' | 'primaire' | 'rempli' | 'fantome'
  taille = 'md',         // 'sm' | 'md'
  coupe = false,         // coin supérieur droit coupé à 21°
  icone = null,          // ex. '▸'
  disabled = false,
  onClick,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);

  const pads = taille === 'sm' ? '7px 14px' : '11px 22px';
  const fs = taille === 'sm' ? 'var(--txt-xs)' : 'var(--txt-sm)';

  const palette = {
    normal:   { bg: 'transparent', bd: 'var(--filet-fort)', fg: 'var(--texte-fort)',
                bgH: 'var(--surface-haute)', bdH: 'var(--accent)', fgH: 'var(--accent)' },
    primaire: { bg: 'transparent', bd: 'var(--accent)', fg: 'var(--accent)',
                bgH: 'color-mix(in oklch, var(--accent) 12%, transparent)', bdH: 'var(--accent-fort)', fgH: 'var(--accent-fort)' },
    rempli:   { bg: 'var(--accent)', bd: 'var(--accent)', fg: 'var(--texte-sur-accent)',
                bgH: 'var(--accent-fort)', bdH: 'var(--accent-fort)', fgH: 'var(--texte-sur-accent)' },
    fantome:  { bg: 'transparent', bd: 'transparent', fg: 'var(--texte)',
                bgH: 'transparent', bdH: 'transparent', fgH: 'var(--accent)' },
  }[variante];

  const bd = hover && !disabled ? palette.bdH : palette.bd;
  const bg = hover && !disabled ? palette.bgH : palette.bg;
  const fg = hover && !disabled ? palette.fgH : palette.fg;

  // Chamfer : coin supérieur droit coupé à 21°. On clippe à la même découpe
  // l'enveloppe (couleur du filet) et le fond inséré d'un filet, pour que le
  // bord se prolonge sans rupture le long de la coupe.
  const decoupe = 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)';

  const base = {
    position: 'relative',
    display: 'inline-flex', alignItems: 'center', gap: '9px',
    font: `var(--poids-demi) ${fs}/1 var(--font-sans)`,
    letterSpacing: '0.06em',
    padding: variante === 'fantome' ? '6px 2px' : pads,
    border: coupe ? 'none' : `var(--filet-fin) solid ${bd}`,
    background: coupe ? bd : bg,
    color: fg,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    transition: 'background var(--duree-courte) var(--ease), color var(--duree-courte) var(--ease), border-color var(--duree-courte) var(--ease)',
    transform: press && !disabled ? 'translateY(1px)' : 'none',
    clipPath: coupe ? decoupe : 'none',
    userSelect: 'none', textDecoration: 'none', whiteSpace: 'nowrap',
    ...style,
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPress(false); }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      style={base}
      {...rest}
    >
      {coupe ? (
        <span aria-hidden="true" style={{
          position: 'absolute', inset: 'var(--filet-fin)',
          background: bg, clipPath: decoupe, pointerEvents: 'none',
          transition: 'background var(--duree-courte) var(--ease)',
        }} />
      ) : null}
      {icone ? <span style={{ position: 'relative', color: variante === 'rempli' ? 'inherit' : 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{icone}</span> : null}
      <span style={{ position: 'relative' }}>{children}</span>
    </button>
  );
}
