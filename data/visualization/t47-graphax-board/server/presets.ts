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

// Shapes follow the same meaning in every preset, so a node's nature reads at a glance:
// circle = person, hexagon = technical, octagon = threat or risk, diamond = uncertain,
// cut corner = evidence or document, square = everything else.
// Colours are distinct within a preset.
const cat = (
  name: string,
  icon: CategoryIconName,
  shape: CategoryShape,
  color: string,
  metadataKeys: string[],
  cardKeys: string[]
): PresetCategoryDef => ({ name, icon, shape, color, metadataKeys, cardKeys });

export const PRESET_CATEGORIES: Record<ProjectPreset, PresetCategoryDef[]> = {
  osint: [
    cat('Personne', 'user', 'circle', '#89d7f9', ['Nom complet', 'Alias', 'Date de naissance', 'Nationalité', 'Rôle'], ['Rôle']),
    cat('Organisation', 'building', 'sharp', '#6693aa', ['Secteur', 'Pays', 'Site web'], ['Secteur']),
    cat('Compte en ligne', 'at-sign', 'hexagon', '#60ccc5', ['Plateforme', 'Identifiant', 'URL', 'Créé le'], ['Plateforme', 'Identifiant']),
    cat('Contact (tél., e-mail)', 'phone', 'hexagon', '#47c0ef', ['Type', 'Valeur', 'Opérateur'], ['Valeur']),
    cat('Lieu', 'map-pin', 'sharp', '#7bc897', ['Adresse', 'Ville', 'Pays', 'Coordonnées'], ['Ville']),
    cat('Événement', 'clock', 'sharp', '#c4bfb4', ['Date', 'Lieu'], ['Date']),
    cat('Document / Preuve', 'file-text', 'cut', '#deb775', ['Source', 'Date', 'URL'], ['Source']),
    cat('Hypothèse', 'lightbulb', 'diamond', '#efaf69', ['Statut', 'Priorité'], ['Statut']),
  ],
  cyber: [
    cat('Acteur malveillant', 'skull', 'octagon', '#f28881', ['Alias', 'Origine', 'Motivation', 'Statut'], ['Statut']),
    cat('Malware / Outil', 'bug', 'octagon', '#e89dc0', ['Famille', 'SHA-256', 'Langage'], ['Famille']),
    cat('Vulnérabilité / Technique', 'shield-alert', 'octagon', '#c1a9ee', ['CVE', 'MITRE ATT&CK', 'Gravité'], ['CVE']),
    cat('IP / Serveur', 'server', 'hexagon', '#47c0ef', ['IP', 'ASN', 'Pays', 'Port', 'Première vue'], ['IP']),
    cat('Domaine / URL', 'globe', 'hexagon', '#0093c5', ['Domaine', 'Registrar', 'Création', 'Résout vers'], ['Domaine']),
    cat('Organisation / Victime', 'building', 'sharp', '#6693aa', ['Secteur', 'Pays', 'Impact'], ['Impact']),
    cat('Preuve / Rapport', 'file-text', 'cut', '#deb775', ['Source', 'Horodatage'], ['Source']),
    cat('Hypothèse', 'lightbulb', 'diamond', '#efaf69', ['Statut', 'Priorité', 'Confiance'], ['Statut']),
  ],
  lore: [
    cat('Personnage', 'user', 'circle', '#89d7f9', ['Rôle', 'Faction', 'Statut'], ['Rôle']),
    cat('Faction / Groupe', 'users', 'sharp', '#6693aa', ['Chef', 'Territoire'], []),
    cat('Lieu / Région', 'map-pin', 'sharp', '#7bc897', ['Région', 'Type'], ['Région']),
    cat('Événement', 'clock', 'sharp', '#c4bfb4', ['Date', 'Lieu'], ['Date']),
    cat('Artefact / Relique', 'key', 'cut', '#deb775', ['Détenteur', 'Pouvoir'], ['Détenteur']),
    cat('Créature / Menace', 'skull', 'octagon', '#f28881', ['Type', 'Territoire'], ['Type']),
    cat('Théorie / Mystère', 'lightbulb', 'diamond', '#efaf69', ['Statut'], ['Statut']),
  ],
  research: [
    cat('Concept clé', 'book-open', 'sharp', '#47c0ef', ['Domaine'], []),
    cat('Source / Document', 'file-text', 'cut', '#deb775', ['Auteur', 'Date', 'URL'], ['Auteur']),
    cat('Auteur / Entité', 'user', 'circle', '#89d7f9', ['Affiliation'], ['Affiliation']),
    cat('Hypothèse', 'lightbulb', 'diamond', '#efaf69', ['Statut', 'Confiance'], ['Statut']),
    cat('Contradiction / Risque', 'shield-alert', 'octagon', '#f28881', ['Gravité'], ['Gravité']),
  ],
  empty: [],
};
