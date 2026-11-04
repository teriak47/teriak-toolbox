import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

// The database and server settings are read from the environment, so set them first
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphax-test-'));
process.env.GRAPHAX_DATA_DIR = dataDir;
process.env.PORT = '3456';

const { app } = await import('../server/app.ts');
const { closeDb, getDb, recoverLegacyDatabase, surrealKvUrl } = await import('../server/db.ts');
const { insertProjectGraph } = await import('../server/bulk.ts');

const HOST = '127.0.0.1:3456';

async function call(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; json: any }> {
  const res = await app.request(url, {
    method,
    headers: { host: HOST, 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function createProject(name = 'Projet fictif'): Promise<string> {
  const { status, json } = await call('POST', '/api/projects', {
    name,
    description: 'Données fictives',
    preset: 'empty',
  });
  assert.equal(status, 201);
  return json.project.id;
}

async function createNode(projectId: string, title: string, x = 0): Promise<string> {
  const { status, json } = await call('POST', `/api/projects/${projectId}/nodes`, {
    title,
    positionX: x,
    positionY: 0,
  });
  assert.equal(status, 201);
  return json.node.id;
}

before(async () => {
  await call('GET', '/api/health');
});

after(async () => {
  await closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('project lifecycle', () => {
  it('creates, renames, lists and deletes a project', async () => {
    const id = await createProject('Alpha');

    const renamed = await call('PATCH', `/api/projects/${id}`, { name: 'Alpha 2' });
    assert.equal(renamed.json.project.name, 'Alpha 2');

    const list = await call('GET', '/api/projects');
    assert.ok(list.json.projects.some((p: { id: string }) => p.id === id));

    const removed = await call('DELETE', `/api/projects/${id}`);
    assert.equal(removed.status, 200);
    const after = await call('GET', '/api/projects');
    assert.ok(!after.json.projects.some((p: { id: string }) => p.id === id));
  });

  it('rejects a project without a name', async () => {
    const { status } = await call('POST', '/api/projects', { name: '  ' });
    assert.equal(status, 400);
  });
});

describe('graph editing and persistence', () => {
  it('stores nodes and edges and returns them with the project graph', async () => {
    const projectId = await createProject();
    const a = await createNode(projectId, 'A');
    const b = await createNode(projectId, 'B', 100);

    const edge = await call('POST', `/api/projects/${projectId}/edges`, {
      sourceNodeId: a,
      targetNodeId: b,
      label: 'relie',
      style: 'dashed',
    });
    assert.equal(edge.status, 201);
    assert.equal(edge.json.edge.style, 'dashed');

    await call('PATCH', `/api/nodes/${a}/position`, { positionX: 42, positionY: 7 });

    const graph = await call('GET', `/api/projects/${projectId}`);
    assert.equal(graph.json.nodes.length, 2);
    assert.equal(graph.json.edges.length, 1);
    const moved = graph.json.nodes.find((n: { id: string }) => n.id === a);
    assert.equal(moved.positionX, 42);
  });

  it('rejects self-links', async () => {
    const projectId = await createProject();
    const a = await createNode(projectId, 'A');
    const { status } = await call('POST', `/api/projects/${projectId}/edges`, {
      sourceNodeId: a,
      targetNodeId: a,
    });
    assert.equal(status, 400);
  });

  it('removes the links of a deleted node', async () => {
    const projectId = await createProject();
    const a = await createNode(projectId, 'A');
    const b = await createNode(projectId, 'B');
    await call('POST', `/api/projects/${projectId}/edges`, { sourceNodeId: a, targetNodeId: b });

    await call('DELETE', `/api/nodes/${a}`);
    const graph = await call('GET', `/api/projects/${projectId}`);
    assert.equal(graph.json.nodes.length, 1);
    assert.equal(graph.json.edges.length, 0);
  });
});

describe('edge reversal', () => {
  it('swaps the endpoints and keeps the pending label', async () => {
    const projectId = await createProject();
    const a = await createNode(projectId, 'A');
    const b = await createNode(projectId, 'B');
    const created = await call('POST', `/api/projects/${projectId}/edges`, {
      sourceNodeId: a,
      targetNodeId: b,
      label: 'ancien',
    });
    const oldId = created.json.edge.id;

    const reversed = await call('PATCH', `/api/edges/${oldId}`, {
      reverse: true,
      label: 'en attente',
    });
    assert.equal(reversed.status, 200);
    assert.equal(reversed.json.replacedId, oldId);
    assert.equal(reversed.json.edge.sourceNodeId, b);
    assert.equal(reversed.json.edge.targetNodeId, a);
    assert.equal(reversed.json.edge.label, 'en attente');

    const graph = await call('GET', `/api/projects/${projectId}`);
    assert.equal(graph.json.edges.length, 1);
    assert.equal(graph.json.edges[0].id, reversed.json.edge.id);
  });

  it('returns 404 for an unknown edge and changes nothing', async () => {
    const { status } = await call('PATCH', '/api/edges/doesnotexist', { reverse: true });
    assert.equal(status, 404);
  });
});

describe('JSON export and import', () => {
  it('round-trips a project into a new one', async () => {
    const projectId = await createProject('Source');
    const a = await createNode(projectId, 'A');
    const b = await createNode(projectId, 'B');
    await call('POST', `/api/projects/${projectId}/edges`, {
      sourceNodeId: a,
      targetNodeId: b,
      label: 'lien',
    });

    const exported = await call('GET', `/api/projects/${projectId}/export`);
    assert.equal(exported.json.format, 'graphax-project');

    const imported = await call('POST', '/api/projects/import', exported.json);
    assert.equal(imported.status, 201);
    const newId = imported.json.project.id;
    assert.notEqual(newId, projectId);

    const graph = await call('GET', `/api/projects/${newId}`);
    assert.equal(graph.json.nodes.length, 2);
    assert.equal(graph.json.edges.length, 1);
    assert.equal(graph.json.edges[0].label, 'lien');
  });

  it('rejects an invalid bundle', async () => {
    const { status } = await call('POST', '/api/projects/import', { hello: 'world' });
    assert.equal(status, 400);
  });
});

describe('atomic writes', () => {
  it('creates a preset project with its categories', async () => {
    const { status, json } = await call('POST', '/api/projects', {
      name: 'Preset',
      preset: 'osint',
    });
    assert.equal(status, 201);
    const graph = await call('GET', `/api/projects/${json.project.id}`);
    assert.equal(graph.json.categories.length, json.project.categoryCount);
    assert.ok(graph.json.categories.length > 0);
  });

  it('creates the demo project in full', async () => {
    const { status, json } = await call('POST', '/api/projects/demo');
    assert.equal(status, 201);
    const graph = await call('GET', `/api/projects/${json.projectId}`);
    assert.equal(graph.json.nodes.length, 7);
    assert.equal(graph.json.edges.length, 8);
    assert.ok(graph.json.nodes.every((n: { categoryId: string | null }) => n.categoryId));
  });

  it('imports categories, keeps node categories and skips dangling links', async () => {
    const bundle = {
      format: 'graphax-project',
      version: 1,
      project: { id: 'old', name: 'Import fictif', description: '' },
      categories: [{ id: 'c1', name: 'Personne', color: '#47c0ef', icon: 'user', shape: 'sharp' }],
      nodes: [
        { id: 'n1', categoryId: 'c1', title: 'A', content: '', positionX: 0, positionY: 0, metadata: { Clé: 'v' } },
        { id: 'n2', categoryId: null, title: 'B', content: '', positionX: 10, positionY: 0, metadata: {} },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2', label: 'connaît', style: 'dashed', directed: true },
        { id: 'e2', sourceNodeId: 'n1', targetNodeId: 'missing', label: 'orphelin' },
      ],
    };
    const imported = await call('POST', '/api/projects/import', bundle);
    assert.equal(imported.status, 201);
    assert.equal(imported.json.project.edgeCount, 1);

    const graph = await call('GET', `/api/projects/${imported.json.project.id}`);
    const [category] = graph.json.categories;
    const a = graph.json.nodes.find((n: { title: string }) => n.title === 'A');
    assert.equal(a.categoryId, category.id);
    assert.deepEqual(a.metadata, { Clé: 'v' });
    assert.equal(graph.json.edges.length, 1);
    assert.equal(graph.json.edges[0].style, 'dashed');
    assert.equal(graph.json.edges[0].sourceNodeId, a.id);
  });

  it('stores nothing when one record of a project fails', async () => {
    const now = new Date().toISOString();
    const node = {
      id: 'dupnode',
      categoryId: null,
      title: 'Doublon',
      content: '',
      positionX: 0,
      positionY: 0,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
    await assert.rejects(
      insertProjectGraph(await getDb(), {
        project: { id: 'halfproject', name: 'Partiel', description: '', createdAt: now, updatedAt: now },
        categories: [{ id: 'halfcat', name: 'Cat', color: '#47c0ef', icon: 'tag', shape: 'sharp' }],
        nodes: [node, node],
        edges: [],
      })
    );
    assert.equal((await call('GET', '/api/projects/halfproject')).status, 404);
    const { json } = await call('GET', '/api/projects');
    assert.ok(!json.projects.some((p: { id: string }) => p.id === 'halfproject'));
    const [leftovers] = await (await getDb())
      .query<[unknown[]]>("SELECT * FROM category WHERE projectId = 'halfproject';")
      .collect();
    assert.equal(leftovers.length, 0);
  });

  it('deletes a project with all its records', async () => {
    const projectId = await createProject('À supprimer');
    const a = await createNode(projectId, 'A');
    const b = await createNode(projectId, 'B');
    await call('POST', `/api/projects/${projectId}/edges`, { sourceNodeId: a, targetNodeId: b });
    assert.equal((await call('DELETE', `/api/projects/${projectId}`)).status, 200);

    const [entities, relations] = await (await getDb())
      .query<[unknown[], unknown[]]>(
        'SELECT * FROM entity WHERE projectId = $p; SELECT * FROM relation WHERE projectId = $p;',
        { p: projectId }
      )
      .collect();
    assert.equal(entities.length, 0);
    assert.equal(relations.length, 0);
  });
});

describe('local-only guard', () => {
  it('accepts same-origin and header-less requests', async () => {
    assert.equal((await call('GET', '/api/health')).status, 200);
    assert.equal(
      (await call('GET', '/api/health', undefined, { origin: `http://${HOST}` })).status,
      200
    );
  });

  it('accepts the Vite dev server origin', async () => {
    const res = await call('GET', '/api/health', undefined, { origin: 'http://localhost:5173' });
    assert.equal(res.status, 200);
  });

  it('refuses a foreign origin, including simple cross-site writes', async () => {
    const read = await call('GET', '/api/projects', undefined, { origin: 'https://evil.example' });
    assert.equal(read.status, 403);

    const before = (await call('GET', '/api/projects')).json.projects.length;
    const write = await call(
      'POST',
      '/api/projects',
      { name: 'pirate' },
      { origin: 'https://evil.example', 'content-type': 'text/plain' }
    );
    assert.equal(write.status, 403);
    const afterCount = (await call('GET', '/api/projects')).json.projects.length;
    assert.equal(afterCount, before);
  });

  it('refuses an unexpected Host header (DNS rebinding)', async () => {
    const res = await call('GET', '/api/projects', undefined, { host: 'evil.example:3456' });
    assert.equal(res.status, 403);
  });

  it('sends no CORS headers', async () => {
    const res = await app.request('/api/health', { headers: { host: HOST } });
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });
});

describe('database location', () => {
  it('stores the database inside the data directory', () => {
    assert.ok(fs.existsSync(path.join(dataDir, 'graphax.db')));
    const drive = /^([A-Za-z]):/.exec(process.cwd());
    if (drive) assert.ok(!fs.existsSync(path.join(process.cwd(), drive[1])));
  });

  it('keeps drive paths absolute for SurrealKV', () => {
    assert.equal(surrealKvUrl('C:\\data\\graphax.db'), 'surrealkv:C:/data/graphax.db');
    assert.equal(surrealKvUrl('/home/u/graphax.db'), 'surrealkv:///home/u/graphax.db');
  });

  it('copies a database left in the old nested location, without removing it', {
    skip: process.platform !== 'win32',
  }, () => {
    const startDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphax-legacy-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(startDir);
      const oldFile = path.join(startDir, 'data', 'graphax.db').replace(/\\/g, '/');
      const [, drive, rest] = /^([A-Za-z]):\/(.*)$/.exec(oldFile)!;
      const nested = path.join(startDir, drive, rest);
      fs.mkdirSync(nested, { recursive: true });
      fs.writeFileSync(path.join(nested, 'marker'), 'private');

      const target = path.join(startDir, 'new', 'graphax.db');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      recoverLegacyDatabase(target);

      assert.equal(fs.readFileSync(path.join(target, 'marker'), 'utf-8'), 'private');
      assert.ok(fs.existsSync(path.join(nested, 'marker')));
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(startDir, { recursive: true, force: true });
    }
  });
});

describe('versioning', () => {
  it('keeps package.json and tool.yaml on the same version', () => {
    const toolDir = path.resolve(import.meta.dirname, '..');
    const pkg = JSON.parse(fs.readFileSync(path.join(toolDir, 'package.json'), 'utf-8'));
    const yaml = fs.readFileSync(path.join(toolDir, 'tool.yaml'), 'utf-8');
    const yamlVersion = /^version:\s*(\S+)/m.exec(yaml)?.[1];
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
    assert.equal(yamlVersion, pkg.version);
  });

  it('reports the version on the health endpoint', async () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(import.meta.dirname, '..', 'package.json'), 'utf-8')
    );
    assert.equal((await call('GET', '/api/health')).json.version, pkg.version);
  });
});
