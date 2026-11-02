import type { Category, CategoryIconName, CategoryShape, ProjectPreset } from '../shared/types.ts';

export interface PresetCategoryDef {
  name: string;
  color: string;
  icon: CategoryIconName;
  shape: CategoryShape;
}

export const PRESET_CATEGORIES: Record<ProjectPreset, PresetCategoryDef[]> = {
  osint: [
    { name: 'Acteur / Suspect', color: '#f43f5e', icon: 'user', shape: 'rounded' },
    { name: 'Infrastructure / IP', color: '#38bdf8', icon: 'server', shape: 'sharp' },
    { name: 'Domaine / URL', color: '#06b6d4', icon: 'globe', shape: 'rounded' },
    { name: 'Malware / Exploit', color: '#ef4444', icon: 'bug', shape: 'cut' },
    { name: 'Organisation', color: '#a855f7', icon: 'building', shape: 'rounded' },
    { name: 'Preuve / Artefact', color: '#10b981', icon: 'file-text', shape: 'sharp' },
    { name: 'Hypothèse', color: '#f59e0b', icon: 'lightbulb', shape: 'pill' },
  ],
  lore: [
    { name: 'Personnage', color: '#38bdf8', icon: 'user', shape: 'rounded' },
    { name: 'Faction / Groupe', color: '#a855f7', icon: 'users', shape: 'rounded' },
    { name: 'Lieu / Région', color: '#10b981', icon: 'map-pin', shape: 'sharp' },
    { name: 'Événement', color: '#f97316', icon: 'clock', shape: 'rounded' },
    { name: 'Artefact / Relique', color: '#eab308', icon: 'key', shape: 'cut' },
    { name: 'Théorie / Mystère', color: '#ec4899', icon: 'lightbulb', shape: 'pill' },
  ],
  research: [
    { name: 'Concept Clé', color: '#38bdf8', icon: 'book-open', shape: 'rounded' },
    { name: 'Source / Document', color: '#10b981', icon: 'file-text', shape: 'sharp' },
    { name: 'Auteur / Entité', color: '#a855f7', icon: 'user', shape: 'rounded' },
    { name: 'Hypothèse', color: '#f59e0b', icon: 'lightbulb', shape: 'pill' },
    { name: 'Contradiction / Risque', color: '#f43f5e', icon: 'shield-alert', shape: 'cut' },
  ],
  empty: [],
};

export function normalizeCategoryRecord(raw: Record<string, unknown>, idExtractor: (v: unknown) => string): Category {
  return {
    id: idExtractor(raw.id),
    projectId: String(raw.projectId ?? ''),
    name: String(raw.name ?? 'Sans nom'),
    color: String(raw.color ?? '#38bdf8'),
    icon: (raw.icon as CategoryIconName) || 'tag',
    shape: (raw.shape as CategoryShape) || 'rounded',
  };
}
