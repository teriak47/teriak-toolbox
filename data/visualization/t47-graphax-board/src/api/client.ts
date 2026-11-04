import type {
  Category,
  CategoryIconName,
  CategoryShape,
  EdgeStyle,
  GraphEdge,
  GraphNode,
  NodeMetadata,
  Project,
  ProjectExportBundle,
  ProjectGraphPayload,
  ProjectPreset,
  ProjectSnapshot,
} from '@shared/types';

// What the category editor sends: style, default keys and card keys
export type CategoryInput = {
  name: string;
  color: string;
  icon: CategoryIconName;
  shape: CategoryShape;
  metadataKeys: string[];
  cardKeys: string[];
};

// What undo sends to bring deleted records back
export type RestoreSnapshot = {
  categories?: Array<Category & { index: number }>;
  nodes?: GraphNode[];
  edges?: GraphEdge[];
  assignments?: Array<{ categoryId: string; nodeIds: string[] }>;
};

async function request<T>(path: string, init?: RequestInit, retries = 3): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 450));
      return request<T>(path, init, retries - 1);
    }
    throw err;
  }

  // Retry briefly if Vite proxy hits API server during the ~300ms SurrealDB boot window
  if ((res.status === 502 || res.status === 503 || res.status === 504) && retries > 0) {
    await new Promise((r) => setTimeout(r, 450));
    return request<T>(path, init, retries - 1);
  }

  if (!res.ok) {
    let message = `Erreur HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // ignore json parse error
    }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

export const api = {
  // Projects
  listProjects: () => request<{ projects: Project[] }>('/api/projects'),

  createProject: (input: { name: string; description: string; preset: ProjectPreset }) =>
    request<{ project: Project }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  createDemoProject: () =>
    request<{ projectId: string }>('/api/projects/demo', {
      method: 'POST',
    }),

  getProjectGraph: (projectId: string) =>
    request<ProjectGraphPayload>(`/api/projects/${projectId}`),

  updateProject: (projectId: string, input: { name?: string; description?: string }) =>
    request<{ project: Project }>(`/api/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteProject: (projectId: string) =>
    request<{ deleted: boolean }>(`/api/projects/${projectId}`, {
      method: 'DELETE',
    }),

  exportProject: (projectId: string) =>
    request<ProjectExportBundle>(`/api/projects/${projectId}/export`),

  importProject: (bundle: unknown) =>
    request<{ project: Project }>('/api/projects/import', {
      method: 'POST',
      body: JSON.stringify(bundle),
    }),

  // Snapshots (A7)
  listSnapshots: (projectId: string) =>
    request<{ snapshots: ProjectSnapshot[] }>(`/api/projects/${projectId}/snapshots`),

  createSnapshot: (projectId: string) =>
    request<{ snapshot: ProjectSnapshot }>(`/api/projects/${projectId}/snapshots`, { method: 'POST' }),

  restoreSnapshot: (projectId: string, name: string) =>
    request<{ project: Project }>(
      `/api/projects/${projectId}/snapshots/${encodeURIComponent(name)}/restore`,
      { method: 'POST' }
    ),

  deleteSnapshot: (projectId: string, name: string) =>
    request<{ deleted: boolean }>(
      `/api/projects/${projectId}/snapshots/${encodeURIComponent(name)}`,
      { method: 'DELETE' }
    ),

  // Categories
  createCategory: (
    projectId: string,
    input: CategoryInput
  ) =>
    request<{ category: Category }>(`/api/projects/${projectId}/categories`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateCategory: (
    categoryId: string,
    input: Partial<CategoryInput>
  ) =>
    request<{ category: Category }>(`/api/categories/${categoryId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  reorderCategories: (projectId: string, ids: string[]) =>
    request<{ categories: Category[] }>(`/api/projects/${projectId}/categories/order`, {
      method: 'PUT',
      body: JSON.stringify({ ids }),
    }),

  deleteCategory: (categoryId: string) =>
    request<{ deleted: boolean }>(`/api/categories/${categoryId}`, {
      method: 'DELETE',
    }),

  // Nodes
  createNode: (
    projectId: string,
    input: {
      title?: string;
      categoryId?: string | null;
      content?: string;
      positionX: number;
      positionY: number;
      metadata?: NodeMetadata;
    }
  ) =>
    request<{ node: GraphNode }>(`/api/projects/${projectId}/nodes`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateNode: (
    nodeId: string,
    input: Partial<{
      title: string;
      categoryId: string | null;
      content: string;
      positionX: number;
      positionY: number;
      metadata: NodeMetadata;
      reliability: string | null;
    }>
  ) =>
    request<{ node: GraphNode }>(`/api/nodes/${nodeId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  updateNodePosition: (nodeId: string, positionX: number, positionY: number) =>
    request<{ node: GraphNode }>(`/api/nodes/${nodeId}/position`, {
      method: 'PATCH',
      body: JSON.stringify({ positionX, positionY }),
    }),

  updateBatchPositions: (
    projectId: string,
    positions: Array<{ id: string; positionX: number; positionY: number }>
  ) =>
    request<{ updated: number }>(`/api/projects/${projectId}/positions`, {
      method: 'PATCH',
      body: JSON.stringify({ positions }),
    }),

  // Several nodes and their links, in one transaction (multiple selection)
  deleteNodes: (projectId: string, ids: string[]) =>
    request<{ deleted: number }>(`/api/projects/${projectId}/nodes/delete`, {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),

  deleteNode: (nodeId: string) =>
    request<{ deleted: boolean }>(`/api/nodes/${nodeId}`, {
      method: 'DELETE',
    }),

  // Edges
  createEdge: (
    projectId: string,
    input: {
      sourceNodeId: string;
      targetNodeId: string;
      sourceHandle?: string | null;
      targetHandle?: string | null;
      label?: string;
      style?: EdgeStyle;
      directed?: boolean;
      color?: string | null;
      notes?: string;
    }
  ) =>
    request<{ edge: GraphEdge }>(`/api/projects/${projectId}/edges`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateEdge: (
    edgeId: string,
    input: Partial<{
      label: string;
      style: EdgeStyle;
      directed: boolean;
      color: string | null;
      notes: string;
      reverse: boolean;
    }>
  ) =>
    request<{ edge: GraphEdge; replacedId?: string }>(`/api/edges/${edgeId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  // Undo: brings back deleted records with their ids (categories at their former index,
  // nodes with their links, and nodes given back the category they lost)
  restore: (projectId: string, snapshot: RestoreSnapshot) =>
    request<{ categories: Category[]; nodes: GraphNode[]; edges: GraphEdge[] }>(
      `/api/projects/${projectId}/restore`,
      { method: 'POST', body: JSON.stringify(snapshot) }
    ),

  deleteEdge: (edgeId: string) =>
    request<{ deleted: boolean }>(`/api/edges/${edgeId}`, {
      method: 'DELETE',
    }),
};
