import React, { useState } from 'react';
import { MediaType, RatingCriterion, Scores } from '../types';
import { Carte } from '../ds/components/Carte.jsx';
import { Jauge } from '../ds/components/Jauge.jsx';
import { Bouton } from '../ds/components/Bouton.jsx';
import { Alerte } from '../ds/components/Alerte.jsx';
import { Champ } from '../ds/components/Champ.jsx';
import { downloadMarkdown, formatForObsidian, sanitizeFilename } from '../services/obsidianExport';

const ScoreCard: React.FC<{ cote: string; score: number; maxScore: number }> = ({ cote, score, maxScore }) => (
  <Carte cote={cote}>
    <div
      style={{
        font: 'var(--poids-demi) var(--txt-2xl)/1 var(--font-mono)',
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--texte-fort)',
        marginBottom: '14px',
      }}
    >
      {score}
      <span style={{ font: 'var(--type-cote)', color: 'var(--texte-faible)', marginLeft: '6px' }}>/ {maxScore}</span>
    </div>
    <Jauge valeur={score} max={maxScore} seuil={101} afficheValeur={false} />
  </Carte>
);

interface ScoreDisplayProps {
  scores: Scores;
  mediaTitle: string;
  mediaType: MediaType;
  criteria: RatingCriterion[];
}

const ScoreDisplay: React.FC<ScoreDisplayProps> = ({ scores, mediaTitle, mediaType, criteria }) => {
  const [isCopied, setIsCopied] = useState(false);
  const [exportDone, setExportDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverImage, setCoverImage] = useState('');

  const handleShare = async () => {
    const title = mediaTitle.trim() || `ce ${mediaType.slice(0, -1).toLowerCase()}`;
    const textToCopy = `J'ai noté "${title}" : ${scores.avg10Point}/10 (note originale : ${scores.avg7Point}/7)`;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Impossible de copier le texte :', err);
      setError('Impossible de copier le texte dans le presse-papiers.');
    }
  };

  const handleObsidianExport = async () => {
    if (!mediaTitle.trim()) {
      setError('Un titre est requis avant de générer la note Obsidian.');
      return;
    }
    setError(null);
    const markdownContent = formatForObsidian(scores, criteria, mediaTitle, mediaType, coverImage);
    downloadMarkdown(sanitizeFilename(mediaTitle), markdownContent);
    await navigator.clipboard.writeText(markdownContent).catch(() => {
      // Le téléchargement a réussi ; la copie presse-papiers est un bonus.
    });
    setExportDone(true);
    setTimeout(() => setExportDone(false), 2500);
  };

  return (
    <div style={{ marginTop: '32px', paddingTop: '24px', borderTop: 'var(--filet-fin) solid var(--filet)' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        <ScoreCard cote="NOTE /7" score={scores.avg7Point} maxScore={7} />
        <ScoreCard cote="NOTE /10" score={scores.avg10Point} maxScore={10} />
        <ScoreCard cote="NOTE /5" score={scores.avg5Point} maxScore={5} />
      </div>

      {error && (
        <Alerte registre="attente" titre="À VÉRIFIER" onFermer={() => setError(null)} style={{ marginBottom: '16px' }}>
          {error}
        </Alerte>
      )}

      <Champ
        label="IMAGE DE COUVERTURE (FACULTATIF)"
        valeur={coverImage}
        onChange={(event) => setCoverImage(event.target.value)}
        placeholder="Chemin ou URL de l’image pour la note Markdown"
        style={{ marginBottom: '16px' }}
      />
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <Bouton variante="normal" onClick={handleShare}>
          {isCopied ? 'COPIÉ' : 'Copier le résumé'}
        </Bouton>
        <Bouton variante="primaire" icone="▸" onClick={handleObsidianExport}>
          {exportDone ? 'NOTE EXPORTÉE' : 'Export Obsidian (.md)'}
        </Bouton>
      </div>
    </div>
  );
};

export default ScoreDisplay;
