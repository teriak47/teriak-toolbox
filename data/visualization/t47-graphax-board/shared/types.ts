// Runtime lists, so the server can validate what the client sends.
// 'rounded' and 'pill' are legacy shapes kept for existing projects (drawn as squares).
export const CATEGORY_SHAPES = ['rounded', 'sharp', 'pill', 'cut'] as const;

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
] as const;

export type CategoryIconName = (typeof CATEGORY_ICON_NAMES)[number];

// Single source for the style of a new category and for missing or invalid stored values
export const DEFAULT_CATEGORY_COLOR = '#47c0ef';
export const DEFAULT_CATEGORY_ICON: CategoryIconName = 'tag';
export const DEFAULT_CATEGORY_SHAPE: CategoryShape = 'sharp';

export type EdgeStyle = 'solid' | 'dashed';

export type ProjectPreset = 'osint' | 'lore' | 'research' | 'empty';

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
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
