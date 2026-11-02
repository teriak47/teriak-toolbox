import React, { useState } from 'react';
import { MediaType } from './types';
import { MEDIA_TABS } from './constants';
import RatingForm from './components/RatingForm';
import { Carte } from './ds/components/Carte.jsx';
import { Cote } from './ds/components/Cote.jsx';
import { Etat } from './ds/components/Etat.jsx';
import { MenuRadio } from './ds/components/MenuRadio.jsx';
import logoWhite from './ds/assets/logo-white.svg';

const TYPE_CODES: Record<MediaType, string> = {
  [MediaType.SERIES]: 'SER',
  [MediaType.MOVIES]: 'FLM',
  [MediaType.ANIME]: 'ANI',
  [MediaType.BOOKS]: 'LIV',
  [MediaType.MUSIC]: 'MUS',
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<MediaType>(MediaType.SERIES);

  return (
    <div style={{ maxWidth: 'var(--largeur-etroite)', margin: '0 auto', padding: '48px 20px 64px' }}>
      <header style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <img src={logoWhite} alt="Teriak47" style={{ width: '44px', height: '44px', flex: 'none' }} />
            <div>
              <h1 style={{ font: 'var(--type-titre)', letterSpacing: 'var(--ls-titre)' }}>7-Point Rater</h1>
              <p style={{ font: 'var(--type-corps-sm)', color: 'var(--texte)', margin: '6px 0 0' }}>
                Sept points, pondérés. Je note, je convertis, j'archive.
              </p>
            </div>
          </div>
          <Cote>T47/RATER</Cote>
        </div>
        <div style={{ height: 'var(--filet-fin)', background: 'var(--filet-fort)', marginTop: '24px' }} />
      </header>

      <main>
        <div style={{ marginBottom: '20px', overflowX: 'auto' }}>
          <MenuRadio
            valeur={activeTab}
            onChange={(v: MediaType) => setActiveTab(v)}
            options={MEDIA_TABS.map((t) => ({ valeur: t.id, texte: t.label.toUpperCase() }))}
          />
        </div>

        <Carte
          cote={`T47/RATER-${TYPE_CODES[activeTab]}`}
          mention={<Etat valeur="actif" enfant="NOTATION EN COURS" />}
          coupe
        >
          <RatingForm key={activeTab} mediaType={activeTab} />
        </Carte>
      </main>

      <footer style={{ marginTop: '48px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '16px' }}>
        <span style={{ font: 'var(--type-cote)', color: 'var(--texte-faible)' }}>Teriak47 — outil d'archive personnelle</span>
        <a
          href="https://github.com"
          target="_blank"
          rel="noopener noreferrer"
          style={{ font: 'var(--type-cote)', color: 'var(--texte-faible)', textDecoration: 'none' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--texte-faible)'; }}
        >
          ▸ code source
        </a>
      </footer>
    </div>
  );
};

export default App;
