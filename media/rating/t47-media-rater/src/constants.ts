import { MediaType, RatingCriterion } from './types';

export const INITIAL_CRITERIA: Record<MediaType, RatingCriterion[]> = {
  [MediaType.SERIES]: [
    { id: 'histoire', label: 'Histoire', description: "Qualité de l'intrigue, cohérence du scénario et engagement narratif sur la durée.", score: 0, weight: 1 },
    { id: 'personnages', label: 'Personnages', description: "Profondeur, évolution et complexité des protagonistes et antagonistes.", score: 0, weight: 1 },
    { id: 'acting', label: 'Jeu d\'acteur', description: "Crédibilité et impact émotionnel des performances des acteurs.", score: 0, weight: 1 },
    { id: 'realisation', label: 'Réalisation', description: "Mise en scène, direction artistique et choix visuels.", score: 0, weight: 1 },
    { id: 'bandeSon', label: 'Bande Son', description: "Musique, sound design et adéquation avec l'ambiance.", score: 0, weight: 1 },
    { id: 'originalite', label: 'Originalité', description: "Nouveauté du concept ou fraîcheur de l'exécution.", score: 0, weight: 1 },
    { id: 'continuite', label: 'Continuité', description: "Cohérence entre les épisodes/saisons et gestion du rythme global.", score: 0, weight: 1 },
  ],
  [MediaType.MOVIES]: [
    { id: 'scenario', label: 'Scénario', description: "Structure, dialogues et force de l'histoire racontée.", score: 0, weight: 1 },
    { id: 'acting', label: 'Jeu d\'acteur', description: "Performances individuelles et alchimie entre les acteurs.", score: 0, weight: 1 },
    { id: 'realisation', label: 'Réalisation & Montage', description: "Vision du réalisateur, rythme du montage et direction artistique.", score: 0, weight: 1 },
    { id: 'cinematographie', label: 'Cinématographie', description: "Qualité de la photographie, de l'éclairage et de la composition des plans.", score: 0, weight: 1 },
    { id: 'bandeSon', label: 'Bande Son', description: "Impact de la musique originale et du mixage sonore.", score: 0, weight: 1 },
  ],
  [MediaType.ANIME]: [
    { id: 'histoire', label: 'Histoire & Intrigue', description: "Construction de l'intrigue et cohérence de l'univers narratif.", score: 0, weight: 1 },
    { id: 'personnages', label: 'Personnages', description: "Psychologie, design (chara-design) et évolution des personnages.", score: 0, weight: 1 },
    { id: 'animation', label: 'Animation & Style Artistique', description: "Fluidité, qualité des dessins, effets visuels et style artistique.", score: 0, weight: 1 },
    { id: 'bandeSon', label: 'Bande Son (OST) & Sound Design', description: "OST (Original Soundtrack), doublage (Seiyuu) et bruitages.", score: 0, weight: 1 },
    { id: 'openingEnding', label: 'Openings & Endings', description: "Qualité visuelle et musicale des génériques.", score: 0, weight: 1 },
    { id: 'originalite', label: 'Originalité & Impact', description: "Créativité du concept ou de l'approche artistique.", score: 0, weight: 1 },
    { id: 'continuite', label: 'Continuité', description: "Gestion du rythme et cohérence sur l'ensemble des épisodes.", score: 0, weight: 1 },
  ],
  [MediaType.BOOKS]: [
    { id: 'intrigue', label: 'Intrigue', description: "Intérêt de l'histoire, suspense et résolution des arcs narratifs.", score: 0, weight: 1 },
    { id: 'style', label: 'Style d\'écriture', description: "Qualité de la prose, vocabulaire et fluidité de la lecture.", score: 0, weight: 1 },
    { id: 'developpement', label: 'Développement des personnages', description: "Profondeur psychologique et arcs d'évolution des personnages.", score: 0, weight: 1 },
    { id: 'monde', label: 'Construction du monde', description: "Richesse, cohérence et immersion de l'univers (Worldbuilding).", score: 0, weight: 1 },
    { id: 'rythme', label: 'Rythme', description: "Équilibre entre action, description et dialogues.", score: 0, weight: 1 },
    { id: 'theme', label: 'Thèmes & Messages', description: "Profondeur des messages et réflexion proposée.", score: 0, weight: 1 },
  ],
  [MediaType.MUSIC]: [
    { id: 'melodie', label: 'Mélodie & Harmonie', description: "Accroche, harmonie et mémorabilité des lignes mélodiques.", score: 0, weight: 1 },
    { id: 'paroles', label: 'Paroles', description: "Qualité d'écriture, rimes, sens et poésie.", score: 0, weight: 1 },
    { id: 'production', label: 'Production & Mixage', description: "Qualité de l'enregistrement, du mixage et du mastering.", score: 0, weight: 1 },
    { id: 'instrumentation', label: 'Instrumentation', description: "Choix des instruments, virtuosité et arrangements.", score: 0, weight: 1 },
    { id: 'emotion', label: 'Émotion transmise', description: "Capacité à transmettre des sentiments ou une ambiance.", score: 0, weight: 1 },
    { id: 'originalite', label: 'Originalité', description: "Innovation sonore ou singularité du style.", score: 0, weight: 1 },
  ],
};

export const MEDIA_TABS: { id: MediaType; label: string }[] = [
  { id: MediaType.SERIES, label: 'Séries' },
  { id: MediaType.MOVIES, label: 'Films' },
  { id: MediaType.ANIME, label: 'Animés' },
  { id: MediaType.BOOKS, label: 'Livres' },
  { id: MediaType.MUSIC, label: 'Musique' },
];

export const RATING_DESCRIPTIONS: { [key: number]: string } = {
  1: '1 — Néfaste : une expérience qui change la vie, en mal.',
  2: '2 — Atroce : à fuir activement, repoussant.',
  3: '3 — Mauvais : à éviter si possible.',
  4: '4 — Passable : fait l\'affaire en cas de besoin.',
  5: '5 — Bon : agréable, mais ne vaut pas le détour.',
  6: '6 — Excellent : vaut la peine d\'être refait/revu/réécouté.',
  7: '7 — Parfait : un incontournable qui change la vie, à rechercher activement.',
};
