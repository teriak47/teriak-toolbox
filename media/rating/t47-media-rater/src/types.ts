export enum MediaType {
  SERIES = 'Séries',
  MOVIES = 'Films',
  BOOKS = 'Livres',
  MUSIC = 'Musique',
  ANIME = 'Animés',
}

export interface RatingCriterion {
  id: string;
  label: string;
  description?: string;
  score: number; // 0 pour non noté, 1-7 pour noté
  weight: number; // ex. 0.5, 1, 1.5, 2
}

export interface Scores {
  avg7Point: number;
  avg10Point: number;
  avg5Point: number;
}
