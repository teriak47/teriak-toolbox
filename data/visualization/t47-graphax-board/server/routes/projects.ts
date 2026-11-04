import { Hono } from 'hono';
import { getDb, generateId, toRecordId } from '../db.ts';
import { mapCategory, mapEdge, mapNode, mapProject, sanitizeMetadata } from '../mappers.ts';
import { PRESET_CATEGORIES } from '../presets.ts';
import { insertProjectGraph } from '../bulk.ts';
import type {
  ProjectExportBundle,
  ProjectGraphPayload,
  ProjectPreset,
} from '../../shared/types.ts';

export const projectsRouter = new Hono();

// List all projects with counts
projectsRouter.get('/', async (c) => {
  const db = await getDb();
  const [rawProjects, rawCategories, rawNodes, rawEdges] = await db
    .query<
      [
        Record<string, unknown>[],
        Array<{ projectId: string }>,
        Array<{ projectId: string }>,
        Array<{ projectId: string }>,
      ]
    >(`
      SELECT * FROM project ORDER BY updatedAt DESC;
      SELECT projectId FROM category;
      SELECT projectId FROM entity;
      SELECT projectId FROM relation;
    `)
    .collect();

  const catCounts = new Map<string, number>();
  for (const item of rawCategories ?? []) {
    catCounts.set(item.projectId, (catCounts.get(item.projectId) ?? 0) + 1);
  }
  const nodeCounts = new Map<string, number>();
  for (const item of rawNodes ?? []) {
    nodeCounts.set(item.projectId, (nodeCounts.get(item.projectId) ?? 0) + 1);
  }
  const edgeCounts = new Map<string, number>();
  for (const item of rawEdges ?? []) {
    edgeCounts.set(item.projectId, (edgeCounts.get(item.projectId) ?? 0) + 1);
  }

  const projects = (rawProjects ?? []).map((raw) => {
    const p = mapProject(raw);
    return {
      ...p,
      categoryCount: catCounts.get(p.id) ?? 0,
      nodeCount: nodeCounts.get(p.id) ?? 0,
      edgeCount: edgeCounts.get(p.id) ?? 0,
    };
  });

  return c.json({ projects });
});

// Create a new project with optional category preset
projectsRouter.post('/', async (c) => {
  const body = await c.req.json<{
    name?: string;
    description?: string;
    preset?: ProjectPreset;
  }>();

  const name = (body.name ?? '').trim();
  if (!name) {
    return c.json({ error: 'Le nom du projet est requis.' }, 400);
  }

  const db = await getDb();
  const id = generateId();
  const now = new Date().toISOString();
  const preset: ProjectPreset = body.preset && body.preset in PRESET_CATEGORIES ? body.preset : 'osint';

  const projectRecord = {
    id,
    name,
    description: (body.description ?? '').trim(),
    createdAt: now,
    updatedAt: now,
  };
  const presetDefs = PRESET_CATEGORIES[preset];

  await insertProjectGraph(db, {
    project: projectRecord,
    categories: presetDefs.map((def) => ({ ...def, id: generateId() })),
    nodes: [],
    edges: [],
  });

  const project = {
    ...projectRecord,
    categoryCount: presetDefs.length,
    nodeCount: 0,
    edgeCount: 0,
  };

  return c.json({ project }, 201);
});

// Create a pre-populated demonstration project
projectsRouter.post('/demo', async (c) => {
  const db = await getDb();
  const projectId = generateId();
  const now = new Date().toISOString();

  const catDefs = PRESET_CATEGORIES.osint;
  const categories = catDefs.map((def) => ({ ...def, id: generateId() }));
  const catIds: Record<string, string> = Object.fromEntries(
    categories.map((cat) => [cat.name, cat.id])
  );

  const demoNodes = [
    {
      key: 'actor',
      categoryId: catIds['Acteur / Suspect'],
      title: 'Groupe "NightOwl" (APT-X)',
      positionX: -320,
      positionY: -120,
      metadata: {
        Fiabilité: 'Probable (B2)',
        Origine: 'Cluster Est-Européen',
        Statut: 'Actif',
      },
      content:
        '### Profil de menace\nGroupe observé depuis **fin 2025** ciblant des dépôts CI/CD.\n\n- Réutilisation de certificats auto-signés spécifiques\n- Fenêtres d\'activité : `06:00 - 15:00 UTC`\n- TTPs proches d\'anciennes campagnes *ShadowLoader*.',
    },
    {
      key: 'malware',
      categoryId: catIds['Malware / Exploit'],
      title: 'Implant "ChimeraLoader.dll"',
      positionX: -20,
      positionY: -95,
      metadata: {
        'SHA-256': '9f86d081884c7d659a2f...',
        Langage: 'Rust / C++',
        Fiabilité: 'Confirmé (A1)',
      },
      content:
        '### Analyse statique\nDLL injectée par *side-loading* lors de l\'étape de build.\n\n```text\nMutex: Global\\Chm_Sync_991\n Sleep jitter: 45s ± 30%\n```\nExfiltre les variables d\'environnement chiffrées en ChaCha20.',
    },
    {
      key: 'c2',
      categoryId: catIds['Infrastructure / IP'],
      title: 'Relais C2 192.0.2.42',
      positionX: 290,
      positionY: -160,
      metadata: {
        IP: '192.0.2.42',
        ASN: 'AS205100',
        Port: '8443 / TLS 1.3',
        Fiabilité: 'Confirmé (A1)',
      },
      content:
        '### Télémétrie Réseau\nNoeud relais contacté toutes les 45 secondes par `ChimeraLoader.dll`.\n\n- Certificat TLS émis le `2026-10-14`\n- Hébergeur VPS payé en Monero selon réponse réquisition.',
    },
    {
      key: 'domain',
      categoryId: catIds['Domaine / URL'],
      title: 'telemetry[.]example',
      positionX: 310,
      positionY: 85,
      metadata: {
        Domaine: 'telemetry.example',
        Registrar: 'NameCheap',
        Création: '2026-09-29',
      },
      content:
        'Domaine de *fallback* codé en dur dans la configuration chiffrée du loader.\nPointe vers `192.0.2.42` via enregistrement A.',
    },
    {
      key: 'org',
      categoryId: catIds['Organisation'],
      title: 'NovaTech CI/CD Pipeline',
      positionX: -40,
      positionY: 135,
      metadata: {
        Impact: 'Critique',
        Date: '2026-10-22',
        Périmètre: 'Runner Build #04',
      },
      content:
        '### Point d\'entrée initial\nCompromission d\'un token de publication secondaire ayant permis l\'injection de `ChimeraLoader.dll` dans la release `v4.2.1`.',
    },
    {
      key: 'evidence',
      categoryId: catIds['Preuve / Artefact'],
      title: 'Logs Forensics Runner #04',
      positionX: 95,
      positionY: 315,
      metadata: {
        Source: 'EDR + Auditd',
        Fiabilité: 'Confirmé (A1)',
        Horodatage: '2026-10-22 08:14 UTC',
      },
      content:
        'Capture mémoire et journaux système confirmant l\'exécution du binaire malveillant et la connexion sortante vers `192.0.2.42:8443`.',
    },
    {
      key: 'theory',
      categoryId: catIds['Hypothèse'],
      title: 'Phishing DevOps ou Fuite Token ?',
      positionX: -285,
      positionY: 175,
      metadata: {
        Statut: 'En vérification',
        Priorité: 'Haute',
      },
      content:
        '### Hypothèse de travail\nLe token CI/CD n\'avait pas expiré malgré la politique de rotation à 30 jours.\n\n1. **Piste A :** Spear-phishing d\'un ingénieur DevOps le 18/10.\n2. **Piste B :** Fuite involontaire dans un dépôt public forké.',
    },
  ];

  const nodeIds: Record<string, string> = Object.fromEntries(
    demoNodes.map((n) => [n.key, generateId()])
  );

  const demoEdges = [
    { from: 'actor', to: 'malware', label: 'développe probable', style: 'dashed', directed: true },
    { from: 'malware', to: 'c2', label: 'communique avec (TLS)', style: 'solid', directed: true },
    { from: 'domain', to: 'c2', label: 'résout vers (DNS A)', style: 'solid', directed: true },
    { from: 'malware', to: 'domain', label: 'domaine de secours', style: 'solid', directed: true },
    { from: 'org', to: 'malware', label: 'infecté par', style: 'solid', directed: true },
    { from: 'evidence', to: 'org', label: 'documente intrusion', style: 'solid', directed: true },
    { from: 'theory', to: 'org', label: 'explique accès initial ?', style: 'dashed', directed: true },
    { from: 'actor', to: 'theory', label: 'vecteur supposé', style: 'dashed', directed: false },
  ];

  await insertProjectGraph(db, {
    project: {
      id: projectId,
      name: 'Opération Chimère — Enquête Cyber & Intrusion',
      description:
        "Analyse croisée d'une compromission supply-chain : corrélation d'infrastructures C2, artefacts malveillants, acteurs menaçants et hypothèses d'attribution.",
      createdAt: now,
      updatedAt: now,
    },
    categories,
    nodes: demoNodes.map(({ key, metadata, ...n }) => ({
      ...n,
      metadata: sanitizeMetadata(metadata),
      id: nodeIds[key],
      createdAt: now,
      updatedAt: now,
    })),
    edges: demoEdges.map((e) => ({
      id: generateId(),
      sourceNodeId: nodeIds[e.from],
      targetNodeId: nodeIds[e.to],
      label: e.label,
      style: e.style,
      directed: e.directed,
      notes: '',
      sourceHandle: null,
      targetHandle: null,
      createdAt: now,
      updatedAt: now,
    })),
  });

  return c.json({ projectId }, 201);
});

// Export full project as JSON bundle
projectsRouter.get('/:id/export', async (c) => {
  const projectId = c.req.param('id');
  const db = await getDb();

  const [rawProject, rawCategories, rawNodes, rawEdges] = await db
    .query<
      [
        Record<string, unknown> | undefined,
        Record<string, unknown>[],
        Record<string, unknown>[],
        Record<string, unknown>[],
      ]
    >(
      `
      SELECT * FROM ONLY $pid;
      SELECT * FROM category WHERE projectId = $projectId;
      SELECT * FROM entity WHERE projectId = $projectId;
      SELECT * FROM relation WHERE projectId = $projectId;
    `,
      {
        pid: toRecordId('project', projectId),
        projectId,
      }
    )
    .collect();

  if (!rawProject) {
    return c.json({ error: 'Projet introuvable.' }, 404);
  }

  const bundle: ProjectExportBundle = {
    format: 'graphax-project',
    version: 1,
    exportedAt: new Date().toISOString(),
    project: mapProject(rawProject),
    categories: (rawCategories ?? []).map(mapCategory),
    nodes: (rawNodes ?? []).map(mapNode),
    edges: (rawEdges ?? []).map(mapEdge),
  };

  return c.json(bundle);
});

// Import full project from JSON bundle (with safe ID remapping to avoid collisions)
projectsRouter.post('/import', async (c) => {
  const bundle = await c.req.json<Partial<ProjectExportBundle>>();
  if (!bundle.project || !Array.isArray(bundle.nodes) || !Array.isArray(bundle.edges)) {
    return c.json({ error: 'Fichier JSON invalide : structure de projet Graphax attendue.' }, 400);
  }

  const db = await getDb();
  const newProjectId = generateId();
  const now = new Date().toISOString();

  // Every record gets a fresh id so an import never collides with existing data
  const project = {
    id: newProjectId,
    name: String(bundle.project.name || 'Projet importé').trim(),
    description: String(bundle.project.description || '').trim(),
    createdAt: String(bundle.project.createdAt || now),
    updatedAt: now,
  };

  const categoryIdMap = new Map<string, string>();
  const categories = (Array.isArray(bundle.categories) ? bundle.categories : []).map((cat) => {
    const id = generateId();
    categoryIdMap.set(cat.id, id);
    return {
      id,
      name: String(cat.name || 'Catégorie'),
      color: String(cat.color || '#47c0ef'),
      icon: String(cat.icon || 'tag'),
      shape: String(cat.shape || 'rounded'),
    };
  });

  const nodeIdMap = new Map<string, string>();
  const nodes = bundle.nodes.map((node) => {
    const id = generateId();
    nodeIdMap.set(node.id, id);
    return {
      id,
      categoryId: node.categoryId ? (categoryIdMap.get(node.categoryId) ?? null) : null,
      title: String(node.title || 'Indice'),
      content: String(node.content || ''),
      positionX: Number.isFinite(Number(node.positionX)) ? Number(node.positionX) : 0,
      positionY: Number.isFinite(Number(node.positionY)) ? Number(node.positionY) : 0,
      metadata: sanitizeMetadata(node.metadata),
      createdAt: String(node.createdAt || now),
      updatedAt: now,
    };
  });

  // Links whose ends are not in the bundle are skipped
  const edges = bundle.edges.flatMap((edge) => {
    const sourceNodeId = nodeIdMap.get(edge.sourceNodeId);
    const targetNodeId = nodeIdMap.get(edge.targetNodeId);
    if (!sourceNodeId || !targetNodeId) return [];
    return [
      {
        id: generateId(),
        sourceNodeId,
        targetNodeId,
        label: String(edge.label ?? ''),
        style: edge.style === 'dashed' ? 'dashed' : 'solid',
        directed: edge.directed !== false,
        notes: String(edge.notes ?? ''),
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
        createdAt: String(edge.createdAt || now),
        updatedAt: now,
      },
    ];
  });

  // One transaction: a failed import leaves no partial project behind
  await insertProjectGraph(db, { project, categories, nodes, edges });

  return c.json(
    {
      project: {
        ...project,
        categoryCount: categories.length,
        nodeCount: nodes.length,
        edgeCount: edges.length,
      },
    },
    201
  );
});

// Get full project graph payload
projectsRouter.get('/:id', async (c) => {
  const projectId = c.req.param('id');
  const db = await getDb();

  const [rawProject, rawCategories, rawNodes, rawEdges] = await db
    .query<
      [
        Record<string, unknown> | undefined,
        Record<string, unknown>[],
        Record<string, unknown>[],
        Record<string, unknown>[],
      ]
    >(
      `
      SELECT * FROM ONLY $pid;
      SELECT * FROM category WHERE projectId = $projectId ORDER BY name ASC;
      SELECT * FROM entity WHERE projectId = $projectId;
      SELECT * FROM relation WHERE projectId = $projectId;
    `,
      {
        pid: toRecordId('project', projectId),
        projectId,
      }
    )
    .collect();

  if (!rawProject) {
    return c.json({ error: 'Projet introuvable.' }, 404);
  }

  const payload: ProjectGraphPayload = {
    project: mapProject(rawProject),
    categories: (rawCategories ?? []).map(mapCategory),
    nodes: (rawNodes ?? []).map(mapNode),
    edges: (rawEdges ?? []).map(mapEdge),
  };

  return c.json(payload);
});

// Update project metadata
projectsRouter.patch('/:id', async (c) => {
  const projectId = c.req.param('id');
  const body = await c.req.json<{ name?: string; description?: string }>();
  const db = await getDb();

  const patch: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (typeof body.name === 'string' && body.name.trim()) {
    patch.name = body.name.trim();
  }
  if (typeof body.description === 'string') {
    patch.description = body.description.trim();
  }

  const [updated] = await db
    .query<[Record<string, unknown> | undefined]>('UPDATE ONLY $pid MERGE $patch;', {
      pid: toRecordId('project', projectId),
      patch,
    })
    .collect();

  if (!updated) {
    return c.json({ error: 'Projet introuvable.' }, 404);
  }

  return c.json({ project: mapProject(updated) });
});

// Delete project and all associated records
projectsRouter.delete('/:id', async (c) => {
  const projectId = c.req.param('id');
  const db = await getDb();

  await db
    .query(
      `
      BEGIN TRANSACTION;
      DELETE relation WHERE projectId = $projectId;
      DELETE entity WHERE projectId = $projectId;
      DELETE category WHERE projectId = $projectId;
      DELETE $pid;
      COMMIT TRANSACTION;
    `,
      {
        projectId,
        pid: toRecordId('project', projectId),
      }
    )
    .collect();

  return c.json({ deleted: true });
});
