import type { CategoryIconName, CategoryShape, ProjectPreset } from '../shared/types.ts';

export interface PresetCategoryDef {
  name: string;
  color: string;
  icon: CategoryIconName;
  shape: CategoryShape;
  /** Keys added, empty, to new nodes of the category */
  metadataKeys: string[];
  /** Keys shown under the node title (among metadataKeys) */
  cardKeys: string[];
}

export const PRESET_CATEGORIES: Record<ProjectPreset, PresetCategoryDef[]> = {
  osint: [
    { name: 'Acteur / Suspect', color: '#f28881', icon: 'user', shape: 'sharp',
      metadataKeys: ['Alias', 'Origine', 'Statut', 'Fiabilité'], cardKeys: ['Statut'] },
    { name: 'Infrastructure / IP', color: '#47c0ef', icon: 'server', shape: 'sharp',
      metadataKeys: ['IP', 'ASN', 'Pays', 'Port', 'Première vue'], cardKeys: ['IP'] },
    { name: 'Domaine / URL', color: '#0093c5', icon: 'globe', shape: 'sharp',
      metadataKeys: ['Domaine', 'Registrar', 'Création'], cardKeys: ['Domaine'] },
    { name: 'Malware / Exploit', color: '#f28881', icon: 'bug', shape: 'cut',
      metadataKeys: ['Famille', 'SHA-256', 'Langage', 'Fiabilité'], cardKeys: ['Famille'] },
    { name: 'Organisation', color: '#89d7f9', icon: 'building', shape: 'sharp',
      metadataKeys: ['Secteur', 'Pays', 'Impact'], cardKeys: ['Impact'] },
    { name: 'Preuve / Artefact', color: '#7bc897', icon: 'file-text', shape: 'sharp',
      metadataKeys: ['Source', 'Horodatage', 'Fiabilité'], cardKeys: ['Source'] },
    { name: 'Hypothèse', color: '#efaf69', icon: 'lightbulb', shape: 'cut',
      metadataKeys: ['Statut', 'Priorité'], cardKeys: ['Statut'] },
  ],
  lore: [
    { name: 'Personnage', color: '#47c0ef', icon: 'user', shape: 'sharp',
      metadataKeys: ['Rôle', 'Faction', 'Statut'], cardKeys: ['Rôle'] },
    { name: 'Faction / Groupe', color: '#89d7f9', icon: 'users', shape: 'sharp',
      metadataKeys: ['Chef', 'Territoire'], cardKeys: [] },
    { name: 'Lieu / Région', color: '#7bc897', icon: 'map-pin', shape: 'sharp',
      metadataKeys: ['Région', 'Type'], cardKeys: ['Région'] },
    { name: 'Événement', color: '#c4bfb4', icon: 'clock', shape: 'sharp',
      metadataKeys: ['Date', 'Lieu'], cardKeys: ['Date'] },
    { name: 'Artefact / Relique', color: '#deb775', icon: 'key', shape: 'cut',
      metadataKeys: ['Détenteur', 'Pouvoir'], cardKeys: ['Détenteur'] },
    { name: 'Théorie / Mystère', color: '#908b84', icon: 'lightbulb', shape: 'cut',
      metadataKeys: ['Statut'], cardKeys: ['Statut'] },
  ],
  research: [
    { name: 'Concept Clé', color: '#47c0ef', icon: 'book-open', shape: 'sharp',
      metadataKeys: ['Domaine'], cardKeys: [] },
    { name: 'Source / Document', color: '#7bc897', icon: 'file-text', shape: 'sharp',
      metadataKeys: ['Auteur', 'Date', 'URL'], cardKeys: ['Auteur'] },
    { name: 'Auteur / Entité', color: '#89d7f9', icon: 'user', shape: 'sharp',
      metadataKeys: ['Affiliation'], cardKeys: ['Affiliation'] },
    { name: 'Hypothèse', color: '#efaf69', icon: 'lightbulb', shape: 'cut',
      metadataKeys: ['Statut', 'Priorité'], cardKeys: ['Statut'] },
    { name: 'Contradiction / Risque', color: '#f28881', icon: 'shield-alert', shape: 'cut',
      metadataKeys: ['Gravité'], cardKeys: ['Gravité'] },
  ],
  empty: [],
};
