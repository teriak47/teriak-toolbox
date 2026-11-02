import React, { useCallback, useMemo, useState } from 'react';
import { MediaType, RatingCriterion, Scores } from '../types';
import { INITIAL_CRITERIA } from '../constants';
import RatingScale from './RatingScale';
import ScoreDisplay from './ScoreDisplay';
import { Champ } from '../ds/components/Champ.jsx';
import { Bouton } from '../ds/components/Bouton.jsx';
import { Alerte } from '../ds/components/Alerte.jsx';

interface RatingFormProps {
  mediaType: MediaType;
}

const PLACEHOLDER_MAP: Record<MediaType, string> = {
  [MediaType.SERIES]: 'Quelle série',
  [MediaType.MOVIES]: 'Quel film',
  [MediaType.BOOKS]: 'Quel livre',
  [MediaType.MUSIC]: 'Quel album/titre',
  [MediaType.ANIME]: 'Quel animé',
};

const RatingForm: React.FC<RatingFormProps> = ({ mediaType }) => {
  const [criteria, setCriteria] = useState<RatingCriterion[]>(INITIAL_CRITERIA[mediaType]);
  const [scores, setScores] = useState<Scores | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [mediaTitle, setMediaTitle] = useState('');

  const handleRatingChange = useCallback((id: string, score: number) => {
    setCriteria((prev) => prev.map((c) => (c.id === id ? { ...c, score } : c)));
    setScores(null);
    setShowSuccess(false);
  }, []);

  const handleWeightChange = useCallback((id: string, weight: number) => {
    setCriteria((prev) => prev.map((c) => (c.id === id ? { ...c, weight } : c)));
    setScores(null);
    setShowSuccess(false);
  }, []);

  const ratedCriteria = useMemo(() => criteria.filter((c) => c.score > 0), [criteria]);

  const calculateScores = () => {
    if (ratedCriteria.length === 0) {
      setError('Noter au moins un critère avant de calculer le score.');
      return;
    }
    setError(null);

    const weightedSum = ratedCriteria.reduce((acc, c) => acc + c.score * c.weight, 0);
    const totalWeight = ratedCriteria.reduce((acc, c) => acc + c.weight, 0);

    if (totalWeight === 0) {
      setError('Le poids total des critères notés ne peut pas être zéro.');
      return;
    }

    const avg7 = weightedSum / totalWeight;
    const avg10 = (avg7 - 1) * (9 / 6) + 1;
    const avg5 = (avg7 - 1) * (4 / 6) + 1;

    setScores({
      avg7Point: parseFloat(avg7.toFixed(1)),
      avg10Point: parseFloat(avg10.toFixed(1)),
      avg5Point: parseFloat(avg5.toFixed(1)),
    });

    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 2000);
  };

  const resetForm = () => {
    setCriteria(INITIAL_CRITERIA[mediaType]);
    setScores(null);
    setError(null);
    setShowSuccess(false);
    setMediaTitle('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <Champ
        label="PIÈCE À NOTER"
        cote={`${ratedCriteria.length} / ${criteria.length} CRITÈRES`}
        valeur={mediaTitle}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMediaTitle(e.target.value)}
        placeholder={`${PLACEHOLDER_MAP[mediaType]} est-ce que je note ?`}
      />

      <div>
        {criteria.map((criterion) => (
          <RatingScale
            key={criterion.id}
            label={criterion.label}
            description={criterion.description}
            score={criterion.score}
            weight={criterion.weight}
            onChange={(score) => handleRatingChange(criterion.id, score)}
            onWeightChange={(weight) => handleWeightChange(criterion.id, weight)}
          />
        ))}
      </div>

      {error && (
        <Alerte registre="attente" titre="À VÉRIFIER" onFermer={() => setError(null)}>
          {error}
        </Alerte>
      )}

      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap',
          paddingTop: '20px', borderTop: 'var(--filet-fin) solid var(--filet)',
        }}
      >
        <Bouton
          variante="rempli"
          icone="▸"
          coupe
          onClick={calculateScores}
          disabled={ratedCriteria.length === 0 || showSuccess}
        >
          {showSuccess ? 'CALCULÉ' : 'Calculer le score'}
        </Bouton>
        {scores && (
          <Bouton variante="fantome" onClick={resetForm}>
            Recommencer une nouvelle notation
          </Bouton>
        )}
      </div>

      {scores && <ScoreDisplay scores={scores} mediaTitle={mediaTitle} mediaType={mediaType} criteria={criteria} />}
    </div>
  );
};

export default RatingForm;
