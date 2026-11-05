// Runtime lists, so the server can validate what the client sends.
// 'rounded' and 'pill' are legacy shapes kept for existing projects (drawn as squares).
export const CATEGORY_SHAPES = [
  'rounded',
  'sharp',
  'pill',
  'cut',
  'hexagon',
  'diamond',
  'octagon',
  'circle',
] as const;

export type CategoryShape = (typeof CATEGORY_SHAPES)[number];

export const CATEGORY_ICON_NAMES = [
  'user',
  'users',
  'map-pin',
  'globe',
  'shield-alert',
  'bug',
  'server',
  'terminal',
  'key',
  'file-text',
  'lightbulb',
  'book-open',
  'building',
  'skull',
  'clock',
  'tag',
  'at-sign',
  'phone',
] as const;

export type CategoryIconName = (typeof CATEGORY_ICON_NAMES)[number];

// Single source for the style of a new category and for missing or invalid stored values
export const DEFAULT_CATEGORY_COLOR = '#47c0ef';
export const DEFAULT_CATEGORY_ICON: CategoryIconName = 'tag';
export const DEFAULT_CATEGORY_SHAPE: CategoryShape = 'sharp';

// Default metadata keys of a category: added (empty) to its nodes, a few shown on the node card
export const MAX_CATEGORY_KEYS = 12;
export const MAX_CARD_KEYS = 2;
export const MAX_METADATA_KEY_LENGTH = 60;

// Clean list of keys: strings only, trimmed, shortened, without duplicates (case and accents
// ignored), at most `max`. Anything that is not an array gives an empty list.
export function normalizeKeyList(input: unknown, max: number): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const key = item.trim().slice(0, MAX_METADATA_KEY_LENGTH).trim();
    const folded = foldKey(key);
    if (!key || seen.has(folded)) continue;
    seen.add(folded);
    keys.push(key);
    if (keys.length >= max) break;
  }
  return keys;
}

// Default keys and card keys of a category; card keys are kept only when they are default keys
export function normalizeCategoryKeys(
  metadataKeys: unknown,
  cardKeys: unknown
): { metadataKeys: string[]; cardKeys: string[] } {
  const keys = normalizeKeyList(metadataKeys, MAX_CATEGORY_KEYS);
  const byFolded = new Map(keys.map((k) => [foldKey(k), k]));
  const card = normalizeKeyList(cardKeys, MAX_CATEGORY_KEYS)
    .map((k) => byFolded.get(foldKey(k)))
    .filter((k): k is string => k !== undefined)
    .slice(0, MAX_CARD_KEYS);
  return { metadataKeys: keys, cardKeys: card };
}

function foldKey(key: string): string {
  return key.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export type EdgeStyle = 'solid' | 'dashed';

export type ProjectPreset = 'osint' | 'cyber' | 'lore' | 'research' | 'empty';

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  /** Link types (V2): a name given to a link colour, e.g. { "#d5b36a": "Financier" } */
  linkTypes?: Record<string, string>;
  nodeCount?: number;
  edgeCount?: number;
  categoryCount?: number;
}

export interface Category {
  id: string;
  projectId: string;
  name: string;
  color: string;
  icon: CategoryIconName;
  shape: CategoryShape;
  /** Keys added, empty, to the category's nodes */
  metadataKeys: string[];
  /** Keys whose values are shown under the node title (among metadataKeys, at most 2) */
  cardKeys: string[];
}

export type NodeMetadata = Record<string, string>;

export interface GraphNode {
  id: string;
  projectId: string;
  categoryId: string | null;
  title: string;
  content: string;
  positionX: number;
  positionY: number;
  metadata: NodeMetadata;
  /** Admiralty code (A3): source reliability A–F then information credibility 1–6, e.g. "B2" */
  reliability: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GraphEdge {
  id: string;
  projectId: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label: string;
  style: EdgeStyle;
  directed: boolean;
  /** Custom link colour (#rrggbb); null or missing draws the default grey */
  color?: string | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectGraphPayload {
  project: Project;
  categories: Category[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ProjectExportBundle {
  format: 'graphax-project';
  version: 1;
  exportedAt: string;
  project: Omit<Project, 'nodeCount' | 'edgeCount' | 'categoryCount'>;
  categories: Category[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Most records (nodes plus links, or categories) one undo can bring back in a single
// restore; a group deletion larger than this is refused, so that it can always be undone
export const MAX_RESTORE_RECORDS = 5000;

// ---- Project snapshots (A7) ----

export type SnapshotKind = 'auto' | 'manual';

export interface ProjectSnapshot {
  /** File name, also the snapshot's id in the API */
  name: string;
  createdAt: string;
  kind: SnapshotKind;
  nodeCount: number;
  edgeCount: number;
  /** The project's revision captured in the snapshot (its updatedAt at that time) */
  projectUpdatedAt?: string;
}

// ---- Reliability (A3): the Admiralty (NATO) grading of a piece of information ----

export const RELIABILITY_SOURCES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'A', label: 'Totalement fiable' },
  { code: 'B', label: 'Habituellement fiable' },
  { code: 'C', label: 'Assez fiable' },
  { code: 'D', label: 'Pas toujours fiable' },
  { code: 'E', label: 'Peu fiable' },
  { code: 'F', label: 'Fiabilité inconnue' },
];

export const RELIABILITY_CREDIBILITY: ReadonlyArray<{ code: string; label: string }> = [
  { code: '1', label: 'Confirmée par d’autres sources' },
  { code: '2', label: 'Probablement vraie' },
  { code: '3', label: 'Possiblement vraie' },
  { code: '4', label: 'Douteuse' },
  { code: '5', label: 'Improbable' },
  { code: '6', label: 'Véracité inconnue' },
];

// "b2", " B2 " -> "B2"; anything that is not a letter A–F followed by a digit 1–6 -> null
export function normalizeReliability(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-F][1-6]$/.test(code) ? code : null;
}

// "B2" -> "Habituellement fiable · Probablement vraie"
export function describeReliability(code: string | null | undefined): string | null {
  const c = normalizeReliability(code);
  if (!c) return null;
  const source = RELIABILITY_SOURCES.find((s) => s.code === c[0])?.label;
  const info = RELIABILITY_CREDIBILITY.find((s) => s.code === c[1])?.label;
  return `${source} · ${info}`;
}

// ---- User presets (V5): a project's categories saved to start new projects with ----

export type PresetCategory = Pick<Category, 'name' | 'color' | 'icon' | 'shape' | 'metadataKeys' | 'cardKeys'>;

export interface UserPreset {
  id: string;
  name: string;
  categories: PresetCategory[];
  createdAt: string;
}

export const MAX_PRESET_NAME_LENGTH = 80;

// ---- Link types (V2): names given to link colours ----

export const MAX_LINK_TYPE_NAME_LENGTH = 40;
export const MAX_LINK_TYPES = 32;

// Keeps colour keys written #rrggbb (lower case) or "default", and non-empty names; anything
// else is dropped
export function normalizeLinkTypes(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, name] of Object.entries(value as Record<string, unknown>)) {
    const color = key.trim().toLowerCase();
    // "default" names the uncoloured (grey) links
    if ((color !== 'default' && !/^#[0-9a-f]{6}$/.test(color)) || typeof name !== 'string') continue;
    const label = name.trim().slice(0, MAX_LINK_TYPE_NAME_LENGTH);
    if (label) out[color] = label;
    if (Object.keys(out).length >= MAX_LINK_TYPES) break;
  }
  return out;
}
