import type { CategoryIconName, CategoryShape, ProjectPreset } from '../shared/types.ts';

export interface PresetCategoryDef {
  name: string;
  color: string;
  icon: CategoryIconName;
  shape: CategoryShape;
}

export const PRESET_CATEGORIES: Record<ProjectPreset, PresetCategoryDef[]> = {
  osint: [
    { name: 'Acteur / Suspect', color: '#f28881', icon: 'user', shape: 'sharp' },
    { name: 'Infrastructure / IP', color: '#47c0ef', icon: 'server', shape: 'sharp' },
    { name: 'Domaine / URL', color: '#0093c5', icon: 'globe', shape: 'sharp' },
    { name: 'Malware / Exploit', color: '#f28881', icon: 'bug', shape: 'cut' },
    { name: 'Organisation', color: '#89d7f9', icon: 'building', shape: 'sharp' },
    { name: 'Preuve / Artefact', color: '#7bc897', icon: 'file-text', shape: 'sharp' },
    { name: 'Hypothèse', color: '#efaf69', icon: 'lightbulb', shape: 'cut' },
  ],
  lore: [
    { name: 'Personnage', color: '#47c0ef', icon: 'user', shape: 'sharp' },
    { name: 'Faction / Groupe', color: '#89d7f9', icon: 'users', shape: 'sharp' },
    { name: 'Lieu / Région', color: '#7bc897', icon: 'map-pin', shape: 'sharp' },
    { name: 'Événement', color: '#c4bfb4', icon: 'clock', shape: 'sharp' },
    { name: 'Artefact / Relique', color: '#deb775', icon: 'key', shape: 'cut' },
    { name: 'Théorie / Mystère', color: '#908b84', icon: 'lightbulb', shape: 'cut' },
  ],
  research: [
    { name: 'Concept Clé', color: '#47c0ef', icon: 'book-open', shape: 'sharp' },
    { name: 'Source / Document', color: '#7bc897', icon: 'file-text', shape: 'sharp' },
    { name: 'Auteur / Entité', color: '#89d7f9', icon: 'user', shape: 'sharp' },
    { name: 'Hypothèse', color: '#efaf69', icon: 'lightbulb', shape: 'cut' },
    { name: 'Contradiction / Risque', color: '#f28881', icon: 'shield-alert', shape: 'cut' },
  ],
  empty: [],
};
