import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  Bug,
  Building2,
  Clock,
  FileText,
  Globe,
  KeyRound,
  Lightbulb,
  MapPin,
  Server,
  ShieldAlert,
  Skull,
  Tag,
  Terminal,
  User,
  Users,
} from 'lucide-react';
import type { CategoryIconName, CategoryShape } from '@shared/types';

export const CATEGORY_ICON_MAP: Record<CategoryIconName, { icon: LucideIcon; label: string }> = {
  user: { icon: User, label: 'Individu / Personnage' },
  users: { icon: Users, label: 'Groupe / Faction' },
  'map-pin': { icon: MapPin, label: 'Lieu / Coordonnées' },
  globe: { icon: Globe, label: 'Domaine / Web' },
  'shield-alert': { icon: ShieldAlert, label: 'Alerte / Menace' },
  bug: { icon: Bug, label: 'Malware / Vulnérabilité' },
  server: { icon: Server, label: 'Serveur / IP' },
  terminal: { icon: Terminal, label: 'Système / Commande' },
  key: { icon: KeyRound, label: 'Clé / Artefact' },
  'file-text': { icon: FileText, label: 'Document / Preuve' },
  lightbulb: { icon: Lightbulb, label: 'Théorie / Hypothèse' },
  'book-open': { icon: BookOpen, label: 'Lore / Savoir' },
  building: { icon: Building2, label: 'Organisation' },
  skull: { icon: Skull, label: 'Danger / Victime' },
  clock: { icon: Clock, label: 'Événement / Date' },
  tag: { icon: Tag, label: 'Étiquette générique' },
};

// SECTION 21 palette: cold accent, labelled semantic tones and cool neutrals
export const CATEGORY_COLORS: string[] = [
  '#47c0ef', // blue
  '#89d7f9', // light blue
  '#0093c5', // dark blue
  '#7bc897', // success
  '#deb775', // ochre
  '#efaf69', // attention
  '#f28881', // error
  '#c4bfb4', // ivory
  '#908b84', // neutral
  '#6693aa', // cool series
];

// Link colours: one lightness and chroma (oklch 0.78 / 0.10, like the accent blue),
// eight hues, so every colour reads equally well on the dark canvas
export const LINK_COLORS: Array<{ value: string; label: string }> = [
  { value: '#6cc4ea', label: 'Bleu' },
  { value: '#60ccc5', label: 'Turquoise' },
  { value: '#82cb9b', label: 'Vert' },
  { value: '#d5b36a', label: 'Sable' },
  { value: '#e9a679', label: 'Orange' },
  { value: '#f19e97', label: 'Corail' },
  { value: '#e89dc0', label: 'Rose' },
  { value: '#c1a9ee', label: 'Lavande' },
];

// Shapes offered in the category editor. Legacy "rounded" and "pill" values stay valid in
// saved data and are drawn as squares.
export const CATEGORY_SHAPES: Array<{ value: CategoryShape; label: string; radiusClass: string }> = [
  { value: 'sharp', label: 'Carré', radiusClass: '' },
  { value: 'cut', label: 'Coin coupé', radiusClass: 's21-coupe-2' },
  { value: 'hexagon', label: 'Hexagone', radiusClass: '' },
  { value: 'diamond', label: 'Losange', radiusClass: '' },
  { value: 'octagon', label: 'Octogone', radiusClass: '' },
  { value: 'circle', label: 'Cercle', radiusClass: '' },
];

export function getCategoryIcon(name?: CategoryIconName | null): LucideIcon {
  if (!name || !(name in CATEGORY_ICON_MAP)) return Tag;
  return CATEGORY_ICON_MAP[name].icon;
}

export function getShapeRadiusClass(shape?: CategoryShape | null): string {
  return shape === 'cut' ? 's21-coupe-2' : '';
}
