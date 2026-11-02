import React, { useEffect, useRef, useState } from 'react';
import { RATING_DESCRIPTIONS } from '../constants';

interface RatingScaleProps {
  label: string;
  description?: string;
  score: number;
  weight: number;
  onChange: (score: number) => void;
  onWeightChange: (weight: number) => void;
}

const WEIGHTS = [1, 1.5, 2, 0.5];

const RatingScale: React.FC<RatingScaleProps> = ({ label, description, score, onChange, weight, onWeightChange }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!showTooltip) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(event.target as Node)) {
        setShowTooltip(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showTooltip]);

  const handleWeightClick = () => {
    const currentIndex = WEIGHTS.indexOf(weight);
    const nextIndex = (currentIndex + 1) % WEIGHTS.length;
    onWeightChange(WEIGHTS[nextIndex]);
  };

  return (
    <div className="critere">
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, position: 'relative' }}>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block', width: '12px', height: '4px', flex: 'none',
            background: score > 0 ? 'var(--accent)' : 'var(--filet-fort)',
            transform: 'skewX(-21deg)',
            transition: 'background var(--duree-courte) var(--ease)',
          }}
        />
        <span
          style={{
            font: 'var(--poids-moyen) var(--txt-sm)/1.3 var(--font-sans)',
            color: score > 0 ? 'var(--texte-fort)' : 'var(--texte)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
        {description && (
          <span ref={tooltipRef} style={{ position: 'relative', display: 'inline-flex', flex: 'none' }}>
            <button
              type="button"
              className="info-btn"
              data-ouvert={showTooltip}
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
              onClick={(e) => { e.stopPropagation(); setShowTooltip(!showTooltip); }}
              aria-label={`Description pour ${label}`}
            >
              ?
            </button>
            {showTooltip && <span className="info-bulle" role="tooltip">{description}</span>}
          </span>
        )}
        <button
          type="button"
          className="poids-btn"
          data-actif={weight !== 1}
          onClick={handleWeightClick}
          title="Ajuster le poids de ce critère"
          style={{ marginLeft: 'auto' }}
        >
          ×{weight}
        </button>
      </div>

      <div className="note-echelle" role="group" aria-label={`Note pour ${label}`}>
        {Array.from({ length: 7 }, (_, i) => i + 1).map((value) => {
          const niveau = score === value ? 'choisi' : score > 0 && value < score ? 'sous' : 'neutre';
          return (
            <button
              key={value}
              type="button"
              className="note-btn"
              data-niveau={niveau}
              onClick={() => onChange(value)}
              title={RATING_DESCRIPTIONS[value]}
              aria-pressed={score === value}
            >
              {value}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default RatingScale;
