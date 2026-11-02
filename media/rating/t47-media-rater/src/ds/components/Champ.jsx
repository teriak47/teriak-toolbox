import React from 'react';

/** Text field with a label and accent focus border. */
export function Champ({
  label,
  valeur,
  onChange,
  placeholder,
  cote,                 // small identifier aligned to the right of the label
  multiligne = false,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const champStyle = {
    width: '100%', boxSizing: 'border-box',
    background: 'var(--surface-puits)',
    border: 'var(--filet-fin) solid var(--filet)',
    borderBottom: `var(--filet-epais) solid ${focus ? 'var(--accent)' : 'var(--filet-fort)'}`,
    color: 'var(--texte-fort)',
    font: `var(--poids-normal) var(--txt-base)/1.5 var(--font-sans)`,
    padding: '10px 12px', outline: 'none',
    transition: 'border-color var(--duree) var(--ease)',
    resize: multiligne ? 'vertical' : 'none',
  };
  return (
    <label style={{ display: 'block', ...style }}>
      {label ? (
        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '7px' }}>
          <span style={{ font: 'var(--poids-demi) var(--txt-2xs)/1 var(--font-sans)', letterSpacing: 'var(--ls-libelle)', color: 'var(--texte-faible)' }}>{label}</span>
          {cote ? <span style={{ font: 'var(--type-cote)', fontSize: 'var(--txt-2xs)', color: 'var(--texte-faible)' }}>{cote}</span> : null}
        </span>
      ) : null}
      {multiligne ? (
        <textarea
          value={valeur} onChange={onChange} placeholder={placeholder} rows={4}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          style={champStyle} {...rest}
        />
      ) : (
        <input
          type="text" value={valeur} onChange={onChange} placeholder={placeholder}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          style={champStyle} {...rest}
        />
      )}
    </label>
  );
}
