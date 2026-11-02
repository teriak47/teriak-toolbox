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

export const CATEGORY_COLORS: string[] = [
  '#38bdf8', // Sky
  '#06b6d4', // Cyan
  '#10b981', // Emerald
  '#84cc16', // Lime
  '#eab308', // Yellow
  '#f59e0b', // Amber
  '#f97316', // Orange
  '#ef4444', // Red
  '#f43f5e', // Rose
  '#ec4899', // Pink
  '#a855f7', // Purple
  '#6366f1', // Indigo
];

export const CATEGORY_SHAPES: Array<{ value: CategoryShape; label: string; radiusClass: string }> = [
  { value: 'rounded', label: 'Cercle', radiusClass: 'rounded-full' },
  { value: 'sharp', label: 'Carré', radiusClass: 'rounded-md' },
  { value: 'pill', label: 'Orbe', radiusClass: 'rounded-full' },
  { value: 'cut', label: 'Hexagone', radiusClass: 'rounded-lg' },
];

export function getCategoryIcon(name?: CategoryIconName | null): LucideIcon {
  if (!name || !(name in CATEGORY_ICON_MAP)) return Tag;
  return CATEGORY_ICON_MAP[name].icon;
}

export function getShapeRadiusClass(shape?: CategoryShape | null): string {
  switch (shape) {
    case 'sharp':
      return 'rounded-sm';
    case 'pill':
      return 'rounded-2xl';
    case 'cut':
      return 'rounded-md';
    default:
      return 'rounded-xl';
  }
}
