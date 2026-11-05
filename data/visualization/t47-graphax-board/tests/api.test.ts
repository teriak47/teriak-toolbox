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
const { closeDb, getDb, recoverLegacyDatabase, surrealKvUrl, toRecordId } = await import('../server/db.ts');
const { insertProjectGraph } = await import('../server/bulk.ts');
const { runAutoSnapshots, AUTO_SNAPSHOTS_KEPT } = await import('../server/snapshots.ts');

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
    const account = graph.json.categories.find((c: { name: string }) => c.name === 'Compte en ligne');
    assert.equal(account.icon, 'at-sign');
    assert.deepEqual(account.cardKeys, ['Plateforme', 'Identifiant']);
  });

  it('creates every preset with valid, distinct-coloured categories in order', async () => {
    const expected: Record<string, string> = {
      osint: 'Personne',
      cyber: 'Acteur malveillant',
      lore: 'Personnage',
      research: 'Concept clé',
    };
    for (const [preset, first] of Object.entries(expected)) {
      const { json } = await call('POST', '/api/projects', { name: `Modèle ${preset}`, preset });
      const graph = await call('GET', `/api/projects/${json.project.id}`);
      const cats: Array<{ name: string; color: string; metadataKeys: string[]; cardKeys: string[] }> =
        graph.json.categories;
      assert.ok(cats.length >= 5, preset);
      assert.equal(new Set(cats.map((c) => c.color)).size, cats.length, `${preset}: colours repeat`);
      assert.ok(cats.every((c) => c.cardKeys.every((k) => c.metadataKeys.includes(k))));
      assert.equal(cats[0].name, first, `${preset}: preset order is kept`);
    }
    const ip = (await call('GET', `/api/projects/${(await call('POST', '/api/projects', { name: 'C', preset: 'cyber' })).json.project.id}`)).json.categories.find(
      (c: { name: string }) => c.name === 'IP / Serveur'
    );
    assert.equal(ip.shape, 'hexagon');
    assert.deepEqual(ip.cardKeys, ['IP']);
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
      categories: [
        {
          id: 'c1',
          name: 'Personne',
          color: '#47c0ef',
          icon: 'user',
          shape: 'sharp',
          metadataKeys: ['Alias', 'Rôle'],
          cardKeys: ['Rôle', 'Inconnue'],
        },
      ],
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
    assert.deepEqual(category.metadataKeys, ['Alias', 'Rôle']);
    assert.deepEqual(category.cardKeys, ['Rôle']);
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

describe('reference checks', () => {
  async function createCategory(projectId: string): Promise<string> {
    const { status, json } = await call('POST', `/api/projects/${projectId}/categories`, {
      name: 'Catégorie fictive',
    });
    assert.equal(status, 201);
    return json.category.id;
  }

  it('refuses nodes and categories in a missing project', async () => {
    assert.equal((await call('POST', '/api/projects/missing/nodes', { title: 'X' })).status, 404);
    assert.equal(
      (await call('POST', '/api/projects/missing/categories', { name: 'X' })).status,
      404
    );
    const [orphans] = await (await getDb())
      .query<[unknown[]]>(
        "SELECT * FROM entity WHERE projectId = 'missing'; SELECT * FROM category WHERE projectId = 'missing';"
      )
      .collect();
    assert.equal(orphans.length, 0);
  });

  it('refuses a link to a missing node or to a node of another project', async () => {
    const p1 = await createProject('P1');
    const p2 = await createProject('P2');
    const a = await createNode(p1, 'A');
    const b = await createNode(p2, 'B');

    const ghost = await call('POST', `/api/projects/${p1}/edges`, {
      sourceNodeId: a,
      targetNodeId: 'ghost',
    });
    assert.equal(ghost.status, 400);
    const across = await call('POST', `/api/projects/${p1}/edges`, {
      sourceNodeId: a,
      targetNodeId: b,
    });
    assert.equal(across.status, 400);
    assert.equal(
      (await call('POST', '/api/projects/missing/edges', { sourceNodeId: a, targetNodeId: b }))
        .status,
      404
    );
    assert.equal((await call('GET', `/api/projects/${p1}`)).json.edges.length, 0);
  });

  it('only accepts a category of the same project for a node', async () => {
    const p1 = await createProject('P1');
    const p2 = await createProject('P2');
    const own = await createCategory(p1);
    const foreign = await createCategory(p2);

    const created = await call('POST', `/api/projects/${p1}/nodes`, { title: 'A', categoryId: own });
    assert.equal(created.status, 201);
    assert.equal(created.json.node.categoryId, own);

    assert.equal(
      (await call('POST', `/api/projects/${p1}/nodes`, { title: 'B', categoryId: foreign })).status,
      400
    );
    assert.equal(
      (await call('POST', `/api/projects/${p1}/nodes`, { title: 'C', categoryId: 'unknown' }))
        .status,
      400
    );

    const nodeId = created.json.node.id;
    assert.equal(
      (await call('PATCH', `/api/nodes/${nodeId}`, { categoryId: foreign })).status,
      400
    );
    const cleared = await call('PATCH', `/api/nodes/${nodeId}`, { categoryId: null });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.json.node.categoryId, null);
  });

  it('moves only the nodes of the project in a batch', async () => {
    const p1 = await createProject('P1');
    const p2 = await createProject('P2');
    const a = await createNode(p1, 'A');
    const b = await createNode(p2, 'B');

    const res = await call('PATCH', `/api/projects/${p1}/positions`, {
      positions: [
        { id: a, positionX: 11, positionY: 12 },
        { id: b, positionX: 99, positionY: 99 },
        { id: 'ghost', positionX: 1, positionY: 1 },
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.updated, 1);

    const g1 = await call('GET', `/api/projects/${p1}`);
    assert.equal(g1.json.nodes[0].positionX, 11);
    assert.equal(g1.json.nodes[0].positionY, 12);
    const g2 = await call('GET', `/api/projects/${p2}`);
    assert.equal(g2.json.nodes[0].positionX, 0);
    const [ghosts] = await (await getDb())
      .query<[unknown[]]>('SELECT * FROM entity:ghost;')
      .collect();
    assert.equal(ghosts.length, 0);
  });
});

describe('input validation', () => {
  async function raw(method: string, url: string, body: string) {
    const res = await app.request(url, {
      method,
      headers: { host: HOST, 'content-type': 'application/json' },
      body,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  }

  it('answers 400, not 500, to malformed JSON or a non-object body', async () => {
    const projectId = await createProject();
    for (const [method, url] of [
      ['POST', '/api/projects'],
      ['POST', `/api/projects/${projectId}/nodes`],
      ['POST', `/api/projects/${projectId}/categories`],
      ['POST', '/api/projects/import'],
    ]) {
      const broken = await raw(method, url, '{"name": ');
      assert.equal(broken.status, 400, `${method} ${url}`);
      assert.ok(broken.json.error);
      assert.equal((await raw(method, url, '[1, 2]')).status, 400, `${method} ${url} array`);
      assert.equal((await raw(method, url, 'null')).status, 400, `${method} ${url} null`);
    }
  });

  it('ignores fields of the wrong type instead of failing', async () => {
    const projectId = await createProject();
    const node = await call('POST', `/api/projects/${projectId}/nodes`, { title: 42, content: {} });
    assert.equal(node.status, 201);
    assert.equal(node.json.node.title, 'Nouvel indice');
    assert.equal(node.json.node.content, '');

    const project = await call('POST', '/api/projects', { name: 'Preset piégé', preset: 'toString' });
    assert.equal(project.status, 201);
  });

  it('appends new categories, and keeps older projects sorted by name', async () => {
    const { json } = await call('POST', '/api/projects', { name: 'Ordre', preset: 'research' });
    const pid = json.project.id;
    await call('POST', `/api/projects/${pid}/categories`, { name: 'Aaa nouvelle' });
    const names = (await call('GET', `/api/projects/${pid}`)).json.categories.map((c: { name: string }) => c.name);
    assert.equal(names[0], 'Concept clé');
    assert.equal(names.at(-1), 'Aaa nouvelle');

    // A project from before positions existed: its categories have none
    const legacy = await createProject('Ancien projet');
    await (await getDb()).query(
      "INSERT INTO category [{ projectId: $p, name: 'Zèbre', color: '#47c0ef', icon: 'tag', shape: 'sharp' }, { projectId: $p, name: 'Bœuf', color: '#47c0ef', icon: 'tag', shape: 'sharp' }];",
      { p: legacy }
    ).collect();
    await call('POST', `/api/projects/${legacy}/categories`, { name: 'Cheval' });
    const legacyNames = (await call('GET', `/api/projects/${legacy}`)).json.categories.map(
      (c: { name: string }) => c.name
    );
    assert.deepEqual(legacyNames, ['Bœuf', 'Cheval', 'Zèbre']);
  });

  it('reorders categories and keeps the order', async () => {
    const { json } = await call('POST', '/api/projects', { name: 'Réordre', preset: 'research' });
    const pid = json.project.id;
    const before = (await call('GET', `/api/projects/${pid}`)).json.categories.map((c: { id: string }) => c.id);
    const [a, b, c] = before;
    // Only the moved ones are listed: the others keep their order after them
    const res = await call('PUT', `/api/projects/${pid}/categories/order`, { ids: [c, a] });
    assert.equal(res.status, 200);
    const expected = [c, a, ...before.filter((id: string) => id !== c && id !== a)];
    assert.deepEqual(res.json.categories.map((x: { id: string }) => x.id), expected);
    const after = (await call('GET', `/api/projects/${pid}`)).json.categories.map((x: { id: string }) => x.id);
    assert.deepEqual(after, expected);
    // A new category still goes last
    await call('POST', `/api/projects/${pid}/categories`, { name: 'Dernière' });
    const names = (await call('GET', `/api/projects/${pid}`)).json.categories.map((x: { name: string }) => x.name);
    assert.equal(names.at(-1), 'Dernière');
    assert.ok(b);

    const other = await createProject('Autre');
    const foreign = (await call('POST', `/api/projects/${other}/categories`, { name: 'Étrangère' })).json.category.id;
    assert.equal((await call('PUT', `/api/projects/${pid}/categories/order`, { ids: [foreign] })).status, 400);
    assert.equal((await call('PUT', `/api/projects/${pid}/categories/order`, { ids: 'x' })).status, 400);
    assert.equal((await call('PUT', '/api/projects/missing/categories/order', { ids: [] })).status, 404);
  });

  it('stores category default keys and card keys', async () => {
    const projectId = await createProject();
    const url = `/api/projects/${projectId}/categories`;
    const created = await call('POST', url, {
      name: 'Serveur',
      metadataKeys: [' IP ', 'ip', 'ASN', 42, 'Pays'],
      cardKeys: ['ip', 'Port'],
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.json.category.metadataKeys, ['IP', 'ASN', 'Pays']);
    assert.deepEqual(created.json.category.cardKeys, ['IP']);

    const id = created.json.category.id;
    const patched = await call('PATCH', `/api/categories/${id}`, { cardKeys: ['Pays', 'ASN', 'IP'] });
    assert.deepEqual(patched.json.category.cardKeys, ['Pays', 'ASN']);
    // Removing a default key drops it from the card too
    const trimmed = await call('PATCH', `/api/categories/${id}`, { metadataKeys: ['ASN'] });
    assert.deepEqual(trimmed.json.category.cardKeys, ['ASN']);

    assert.equal((await call('POST', url, { name: 'X', metadataKeys: 'IP' })).status, 400);
    assert.equal((await call('PATCH', `/api/categories/${id}`, { cardKeys: { a: 1 } })).status, 400);

    const plain = await call('POST', url, { name: 'Sans clés' });
    assert.deepEqual(plain.json.category.metadataKeys, []);
    assert.deepEqual(plain.json.category.cardKeys, []);
  });

  it('validates category colour, icon and shape', async () => {
    const projectId = await createProject();
    const url = `/api/projects/${projectId}/categories`;
    assert.equal((await call('POST', url, { name: 'A', color: 'red' })).status, 400);
    assert.equal((await call('POST', url, { name: 'A', color: '#12345' })).status, 400);
    assert.equal((await call('POST', url, { name: 'A', icon: 'rocket' })).status, 400);
    assert.equal((await call('POST', url, { name: 'A', shape: 'star' })).status, 400);
    for (const shape of ['hexagon', 'diamond', 'octagon', 'circle']) {
      const ok = await call('POST', url, { name: shape, shape });
      assert.equal(ok.status, 201, shape);
      assert.equal(ok.json.category.shape, shape);
    }

    const short = await call('POST', url, { name: 'A', color: '#ABC', icon: 'bug', shape: 'cut' });
    assert.equal(short.status, 201);
    assert.equal(short.json.category.color, '#aabbcc');

    const id = short.json.category.id;
    assert.equal((await call('PATCH', `/api/categories/${id}`, { color: 'blue' })).status, 400);
    assert.equal((await call('PATCH', `/api/categories/${id}`, { icon: 'rocket' })).status, 400);
    const ok = await call('PATCH', `/api/categories/${id}`, { color: '#47C0EF', shape: 'sharp' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.category.color, '#47c0ef');
  });

  it('limits the request size, with a larger limit for imports', async () => {
    const projectId = await createProject();
    const big = 'x'.repeat(3 * 1024 * 1024);
    const tooBig = await call('POST', `/api/projects/${projectId}/nodes`, { title: 'A', content: big });
    assert.equal(tooBig.status, 413);

    const imported = await call('POST', '/api/projects/import', {
      project: { name: 'Gros import' },
      categories: [],
      nodes: [{ id: 'n1', title: 'A', content: big }],
      edges: [],
    });
    assert.equal(imported.status, 201);
  });

  it('imports a bundle with invalid entries by skipping or defaulting them', async () => {
    const imported = await call('POST', '/api/projects/import', {
      project: { name: 7 },
      categories: [null, { id: 'c1', name: 'Cat', color: 'not-a-colour', icon: 'rocket', shape: 'star' }],
      nodes: [null, 5, 'texte', { id: 'n1', title: { a: 1 }, categoryId: 'c1', metadata: [] }],
      edges: [null, { id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n1', label: 3 }],
    });
    assert.equal(imported.status, 201);
    assert.equal(imported.json.project.name, 'Projet importé');

    const graph = await call('GET', `/api/projects/${imported.json.project.id}`);
    assert.equal(graph.json.nodes.length, 1);
    assert.equal(graph.json.nodes[0].title, 'Indice');
    const [category] = graph.json.categories;
    assert.equal(category.color, '#47c0ef');
    assert.equal(category.icon, 'tag');
    assert.equal(graph.json.nodes[0].categoryId, category.id);
    assert.equal(graph.json.edges[0].label, '');

    assert.equal(
      (await call('POST', '/api/projects/import', { project: 'x', nodes: [], edges: [] })).status,
      400
    );
  });
});

describe('category defaults', () => {
  it('reads old or invalid category records with the shared defaults', async () => {
    const projectId = await createProject();
    await (await getDb())
      .query(
        `CREATE category:legacy_a CONTENT { projectId: $p, name: 'Ancienne', color: 'red', icon: 'rocket' };
        CREATE category:legacy_b CONTENT { projectId: $p, name: 'Courte', color: '#ABC', shape: 'rounded' };`,
        { p: projectId }
      )
      .collect();

    const graph = await call('GET', `/api/projects/${projectId}`);
    const byName = Object.fromEntries(
      graph.json.categories.map((c: { name: string }) => [c.name, c])
    );
    assert.equal(byName.Ancienne.color, '#47c0ef');
    assert.equal(byName.Ancienne.icon, 'tag');
    assert.equal(byName.Ancienne.shape, 'sharp');
    assert.equal(byName.Courte.color, '#aabbcc');
    assert.equal(byName.Courte.shape, 'rounded');
  });

  it('gives new and imported categories the same defaults', async () => {
    const projectId = await createProject();
    const created = await call('POST', `/api/projects/${projectId}/categories`, { name: 'Neuve' });
    const imported = await call('POST', '/api/projects/import', {
      project: { name: 'Import' },
      categories: [{ id: 'c1', name: 'Importée' }],
      nodes: [],
      edges: [],
    });
    const [importedCategory] = (await call('GET', `/api/projects/${imported.json.project.id}`)).json
      .categories;

    for (const category of [created.json.category, importedCategory]) {
      assert.equal(category.color, '#47c0ef');
      assert.equal(category.icon, 'tag');
      assert.equal(category.shape, 'sharp');
    }
  });
});

describe('project list', () => {
  it('reports category, node and link counts per project', async () => {
    const preset = await call('POST', '/api/projects', { name: 'Compté', preset: 'research' });
    const counted = preset.json.project.id;
    const a = await createNode(counted, 'A');
    const b = await createNode(counted, 'B');
    const c = await createNode(counted, 'C');
    await call('POST', `/api/projects/${counted}/edges`, { sourceNodeId: a, targetNodeId: b });
    await call('POST', `/api/projects/${counted}/edges`, { sourceNodeId: b, targetNodeId: c });
    const empty = await createProject('Vide');

    const { json } = await call('GET', '/api/projects');
    const byId = Object.fromEntries(json.projects.map((p: { id: string }) => [p.id, p]));
    assert.equal(byId[counted].categoryCount, preset.json.project.categoryCount);
    assert.equal(byId[counted].nodeCount, 3);
    assert.equal(byId[counted].edgeCount, 2);
    assert.equal(byId[empty].categoryCount, 0);
    assert.equal(byId[empty].nodeCount, 0);
    assert.equal(byId[empty].edgeCount, 0);
  });
});

describe('link colours', () => {
  it('stores, changes, resets and validates a link colour', async () => {
    const projectId = await createProject();
    const a = await createNode(projectId, 'A');
    const b = await createNode(projectId, 'B');

    const created = await call('POST', `/api/projects/${projectId}/edges`, {
      sourceNodeId: a,
      targetNodeId: b,
      color: '#C1A9EE',
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.edge.color, '#c1a9ee');
    const id = created.json.edge.id;

    assert.equal((await call('PATCH', `/api/edges/${id}`, { color: 'violet' })).status, 400);
    assert.equal(
      (await call('POST', `/api/projects/${projectId}/edges`, { sourceNodeId: b, targetNodeId: a, color: 12 }))
        .status,
      400
    );

    const changed = await call('PATCH', `/api/edges/${id}`, { color: '#6cc4ea' });
    assert.equal(changed.json.edge.color, '#6cc4ea');
    const untouched = await call('PATCH', `/api/edges/${id}`, { label: 'sans couleur envoyée' });
    assert.equal(untouched.json.edge.color, '#6cc4ea');

    const reset = await call('PATCH', `/api/edges/${id}`, { color: null });
    assert.equal(reset.json.edge.color, null);
  });

  it('keeps the colour through a reversal and an export/import', async () => {
    const projectId = await createProject();
    const a = await createNode(projectId, 'A');
    const b = await createNode(projectId, 'B');
    const { json } = await call('POST', `/api/projects/${projectId}/edges`, {
      sourceNodeId: a,
      targetNodeId: b,
      color: '#82cb9b',
    });

    const reversed = await call('PATCH', `/api/edges/${json.edge.id}`, { reverse: true });
    assert.equal(reversed.json.edge.color, '#82cb9b');
    assert.equal(reversed.json.edge.sourceNodeId, b);

    const exported = await call('GET', `/api/projects/${projectId}/export`);
    assert.equal(exported.json.edges[0].color, '#82cb9b');
    const imported = await call('POST', '/api/projects/import', exported.json);
    const graph = await call('GET', `/api/projects/${imported.json.project.id}`);
    assert.equal(graph.json.edges[0].color, '#82cb9b');
  });

  it('draws links without a colour in the default grey', async () => {
    const projectId = await createProject();
    const a = await createNode(projectId, 'A');
    const b = await createNode(projectId, 'B');
    const { json } = await call('POST', `/api/projects/${projectId}/edges`, { sourceNodeId: a, targetNodeId: b });
    assert.equal(json.edge.color, null);
  });
});

describe('node reliability (Admiralty code)', () => {
  it('stores, validates, clears and exports the reliability code', async () => {
    const projectId = await createProject('Fiabilité');
    const created = await call('POST', `/api/projects/${projectId}/nodes`, { title: 'Source', reliability: 'b2' });
    assert.equal(created.status, 201);
    assert.equal(created.json.node.reliability, 'B2');
    const id = created.json.node.id;
    for (const bad of ['Z9', 'A7', 'AB', 12]) {
      assert.equal((await call('PATCH', `/api/nodes/${id}`, { reliability: bad })).status, 400, String(bad));
    }
    assert.equal((await call('PATCH', `/api/nodes/${id}`, { reliability: 'C3' })).json.node.reliability, 'C3');
    const exported = (await call('GET', `/api/projects/${projectId}/export`)).json;
    assert.equal(exported.nodes[0].reliability, 'C3');
    const imported = (await call('POST', '/api/projects/import', exported)).json.project;
    assert.equal((await call('GET', `/api/projects/${imported.id}`)).json.nodes[0].reliability, 'C3');
    assert.equal((await call('PATCH', `/api/nodes/${id}`, { reliability: null })).json.node.reliability, null);
    // A node without the field reads as null; the demo uses the field instead of an attribute
    assert.equal((await call('POST', `/api/projects/${projectId}/nodes`, { title: 'X' })).json.node.reliability, null);
    const demo = (await call('POST', '/api/projects/demo')).json.projectId;
    const nodes = (await call('GET', `/api/projects/${demo}`)).json.nodes;
    assert.ok(nodes.some((n: { reliability: string | null }) => n.reliability === 'B2'));
    assert.ok(nodes.every((n: { metadata: Record<string, string> }) => !('Fiabilité' in n.metadata)));
  });
});

describe('batch node deletion', () => {
  it('deletes several nodes with their links and leaves the rest', async () => {
    const projectId = await createProject('Suppression groupée');
    const other = await createProject('Autre');
    const a = await createNode(projectId, 'A');
    const b = await createNode(projectId, 'B', 100);
    const c = await createNode(projectId, 'C', 200);
    const foreign = await createNode(other, 'Étranger');
    await call('POST', `/api/projects/${projectId}/edges`, { sourceNodeId: a, targetNodeId: b });
    await call('POST', `/api/projects/${projectId}/edges`, { sourceNodeId: b, targetNodeId: c });
    const res = await call('POST', `/api/projects/${projectId}/nodes/delete`, { ids: [a, b, foreign, 'missing'] });
    assert.equal(res.status, 200);
    assert.equal(res.json.deleted, 2);
    const g = (await call('GET', `/api/projects/${projectId}`)).json;
    assert.deepEqual(g.nodes.map((n: { id: string }) => n.id), [c]);
    assert.equal(g.edges.length, 0);
    assert.equal((await call('GET', `/api/projects/${other}`)).json.nodes[0].id, foreign);
    assert.equal((await call('POST', `/api/projects/${projectId}/nodes/delete`, { ids: [] })).status, 400);
    assert.equal((await call('POST', `/api/projects/${projectId}/nodes/delete`, {})).status, 400);
    assert.equal((await call('POST', '/api/projects/nope/nodes/delete', { ids: [c] })).status, 404);
  });

  it('refuses a deletion too large to be undone in one restore', async () => {
    const { MAX_RESTORE_RECORDS } = await import('../shared/types.ts');
    const projectId = await createProject('Suppression trop grande');
    const db = await getDb();
    const ids = Array.from({ length: MAX_RESTORE_RECORDS }, (_, i) => `big${i}`);
    await db
      .query('INSERT INTO entity $rows;', {
        rows: ids.map((id) => ({ id, projectId, title: 'n', content: '', positionX: 0, positionY: 0, metadata: {} })),
      })
      .collect();
    const hub = await createNode(projectId, 'Hub');
    await call('POST', `/api/projects/${projectId}/edges`, { sourceNodeId: hub, targetNodeId: ids[0] });
    const res = await call('POST', `/api/projects/${projectId}/nodes/delete`, { ids: [...ids.slice(0, MAX_RESTORE_RECORDS - 1), hub] });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /Trop d’éléments/);
    const ok = await call('POST', `/api/projects/${projectId}/nodes/delete`, { ids: ids.slice(1, 10) });
    assert.equal(ok.json.deleted, 9);
  });
});

describe('restore (undo of deletions)', () => {
  async function graph(projectId: string) {
    return (await call('GET', `/api/projects/${projectId}`)).json;
  }

  it('brings back a deleted node with its links, ids and category', async () => {
    const projectId = await createProject('Restauration');
    const cat = (await call('POST', `/api/projects/${projectId}/categories`, {
      name: 'Personne', color: '#60ccc5', icon: 'user', shape: 'circle',
    })).json.category;
    const a = await createNode(projectId, 'A');
    const b = await createNode(projectId, 'B', 200);
    await call('PATCH', `/api/nodes/${a}`, { categoryId: cat.id, metadata: { IP: '192.0.2.1' } });
    await call('POST', `/api/projects/${projectId}/edges`, { sourceNodeId: a, targetNodeId: b, label: 'connaît' });
    const before = await graph(projectId);
    const node = before.nodes.find((n: { id: string }) => n.id === a);
    const edge = before.edges[0];

    await call('DELETE', `/api/nodes/${a}`);
    assert.equal((await graph(projectId)).edges.length, 0);

    const body = { nodes: [node], edges: [edge] };
    const first = await call('POST', `/api/projects/${projectId}/restore`, body);
    assert.equal(first.status, 200);
    assert.equal(first.json.nodes[0].id, a);
    assert.equal(first.json.edges[0].id, edge.id);
    // A retried request gives the same result, without duplicates
    assert.equal((await call('POST', `/api/projects/${projectId}/restore`, body)).status, 200);

    const after = await graph(projectId);
    assert.equal(after.nodes.length, 2);
    assert.equal(after.edges.length, 1);
    const back = after.nodes.find((n: { id: string }) => n.id === a);
    assert.equal(back.categoryId, cat.id);
    assert.deepEqual(back.metadata, { IP: '192.0.2.1' });
    assert.equal(after.edges[0].label, 'connaît');
    assert.equal(after.edges[0].sourceNodeId, a);
  });

  it('puts a deleted category back in its place and gives its nodes back to it', async () => {
    const projectId = await createProject('Restauration catégories');
    const cats = [];
    for (const name of ['Un', 'Deux', 'Trois']) {
      cats.push((await call('POST', `/api/projects/${projectId}/categories`, {
        name, color: '#60ccc5', icon: 'user', shape: 'circle',
      })).json.category);
    }
    const n1 = await createNode(projectId, 'N1');
    const n2 = await createNode(projectId, 'N2', 100);
    await call('PATCH', `/api/nodes/${n1}`, { categoryId: cats[1].id });
    await call('PATCH', `/api/nodes/${n2}`, { categoryId: cats[1].id });
    await call('DELETE', `/api/categories/${cats[1].id}`);
    // Meanwhile N2 gets another category: the restore must not take it back
    await call('PATCH', `/api/nodes/${n2}`, { categoryId: cats[2].id });

    const res = await call('POST', `/api/projects/${projectId}/restore`, {
      categories: [{ ...cats[1], index: 1 }],
      assignments: [{ categoryId: cats[1].id, nodeIds: [n1, n2] }],
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.categories.map((c: { name: string }) => c.name), ['Un', 'Deux', 'Trois']);
    const g = await graph(projectId);
    assert.deepEqual(g.categories.map((c: { name: string }) => c.name), ['Un', 'Deux', 'Trois']);
    assert.equal(g.nodes.find((n: { id: string }) => n.id === n1).categoryId, cats[1].id);
    assert.equal(g.nodes.find((n: { id: string }) => n.id === n2).categoryId, cats[2].id);
  });

  it('skips links to nodes that are gone and refuses foreign or invalid records', async () => {
    const projectId = await createProject('Restauration refus');
    const other = await createProject('Autre projet');
    const a = await createNode(projectId, 'A');
    const foreign = await createNode(other, 'Étranger');
    const res = await call('POST', `/api/projects/${projectId}/restore`, {
      edges: [{ id: 'abc123', sourceNodeId: a, targetNodeId: 'missing0' }],
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.edges.length, 0);

    const g = await graph(other);
    const stolen = await call('POST', `/api/projects/${projectId}/restore`, { nodes: [g.nodes[0]] });
    assert.equal(stolen.status, 400);
    assert.equal((await graph(other)).nodes[0].id, foreign);
    assert.equal((await call('POST', `/api/projects/${projectId}/restore`, { nodes: [{ id: 'a b' }] })).status, 400);
    assert.equal((await call('POST', `/api/projects/${projectId}/restore`, {})).status, 400);
    assert.equal((await call('POST', '/api/projects/nope/restore', { nodes: [{ id: 'x1' }] })).status, 404);
  });
});

describe('project snapshots', () => {
  it('takes, lists, restores as a new project and deletes snapshots', async () => {
    const projectId = await createProject('Instantanés');
    await createNode(projectId, 'Avant');
    const taken = await call('POST', `/api/projects/${projectId}/snapshots`);
    assert.equal(taken.status, 201);
    assert.equal(taken.json.snapshot.kind, 'manual');
    assert.equal(taken.json.snapshot.nodeCount, 1);
    await createNode(projectId, 'Après', 100);

    const list = (await call('GET', `/api/projects/${projectId}/snapshots`)).json.snapshots;
    assert.equal(list.length, 1);
    const name = list[0].name;

    const restored = await call('POST', `/api/projects/${projectId}/snapshots/${name}/restore`);
    assert.equal(restored.status, 201);
    assert.match(restored.json.project.name, /^Instantanés \(instantané du /);
    const copy = (await call('GET', `/api/projects/${restored.json.project.id}`)).json;
    assert.deepEqual(copy.nodes.map((n: { title: string }) => n.title), ['Avant']);
    // The project itself is left as it is
    assert.equal((await call('GET', `/api/projects/${projectId}`)).json.nodes.length, 2);

    assert.equal((await call('DELETE', `/api/projects/${projectId}/snapshots/${name}`)).status, 200);
    assert.equal((await call('GET', `/api/projects/${projectId}/snapshots`)).json.snapshots.length, 0);
  });

  it('refuses unknown projects and snapshot names that are not snapshot files', async () => {
    const projectId = await createProject('Instantanés refus');
    assert.equal((await call('GET', '/api/projects/nope/snapshots')).status, 404);
    assert.equal((await call('POST', '/api/projects/nope/snapshots')).status, 404);
    for (const name of ['..%2F..%2Fgraphax.db', 'x.json', '2026-01-01T00-00-00-000Z_auto.json']) {
      assert.equal((await call('POST', `/api/projects/${projectId}/snapshots/${name}/restore`)).status, 404, name);
      assert.equal((await call('DELETE', `/api/projects/${projectId}/snapshots/${name}`)).status, 404, name);
    }
  });

  it('snapshots changed projects automatically and keeps only the latest ones', async () => {
    const projectId = await createProject('Instantanés auto');
    const db = await getDb();
    assert.ok((await runAutoSnapshots(db)).includes(projectId));
    // Unchanged since: no new snapshot
    assert.ok(!(await runAutoSnapshots(db)).includes(projectId));
    // A change whose date is older than the snapshot file (it landed while the snapshot was
    // being written) still differs from the revision captured in it: snapshotted again
    await db.query('UPDATE $pid SET updatedAt = "2000-01-01T00:00:00.000Z";', { pid: toRecordId('project', projectId) }).collect();
    assert.ok((await runAutoSnapshots(db)).includes(projectId));
    assert.ok(!(await runAutoSnapshots(db)).includes(projectId));
    for (let i = 0; i < AUTO_SNAPSHOTS_KEPT + 2; i++) {
      await createNode(projectId, `N${i}`, i * 10);
      await runAutoSnapshots(db);
    }
    const list = (await call('GET', `/api/projects/${projectId}/snapshots`)).json.snapshots;
    assert.equal(list.length, AUTO_SNAPSHOTS_KEPT);
    assert.equal(list[0].nodeCount, AUTO_SNAPSHOTS_KEPT + 2, 'newest first');
  });
});

describe('category merge', () => {
  it('moves the nodes, adds the missing keys, deletes the source, and can be restored', async () => {
    const projectId = await createProject('Fusion');
    const mk = async (name: string, metadataKeys: string[]) =>
      (await call('POST', `/api/projects/${projectId}/categories`, {
        name, color: '#60ccc5', icon: 'user', shape: 'circle', metadataKeys, cardKeys: [],
      })).json.category;
    const a = await mk('Personne', ['Nom', 'Pays']);
    const b = await mk('Individu', ['Pays', 'Alias']);
    const other = await mk('Lieu', []);
    const n1 = await createNode(projectId, 'N1');
    const n2 = await createNode(projectId, 'N2', 100);
    await call('PATCH', `/api/nodes/${n1}`, { categoryId: b.id });
    await call('PATCH', `/api/nodes/${n2}`, { categoryId: a.id });

    assert.equal((await call('POST', `/api/categories/${b.id}/merge`, { targetId: b.id })).status, 400);
    assert.equal((await call('POST', `/api/categories/${b.id}/merge`, { targetId: 'nope' })).status, 404);
    const res = await call('POST', `/api/categories/${b.id}/merge`, { targetId: a.id });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.category.metadataKeys, ['Nom', 'Pays', 'Alias']);
    assert.deepEqual(res.json.movedNodeIds, [n1]);
    let g = (await call('GET', `/api/projects/${projectId}`)).json;
    assert.deepEqual(g.categories.map((c: { name: string }) => c.name), ['Personne', 'Lieu']);
    assert.ok(g.nodes.every((n: { categoryId: string }) => n.categoryId === a.id));

    // Undo: the source comes back in its place and gets back the nodes still in the target
    await call('PATCH', `/api/nodes/${n2}`, { categoryId: other.id });
    const back = await call('POST', `/api/projects/${projectId}/restore`, {
      categories: [{ ...b, index: 1 }],
      assignments: [{ categoryId: b.id, fromCategoryId: a.id, nodeIds: [n1, n2] }],
    });
    assert.equal(back.status, 200);
    g = (await call('GET', `/api/projects/${projectId}`)).json;
    assert.deepEqual(g.categories.map((c: { name: string }) => c.name), ['Personne', 'Individu', 'Lieu']);
    assert.equal(g.nodes.find((n: { id: string }) => n.id === n1).categoryId, b.id);
    assert.equal(g.nodes.find((n: { id: string }) => n.id === n2).categoryId, other.id);
  });

  it('stores the bare target id on the moved nodes, even when given with its table prefix', async () => {
    const projectId = await createProject('Fusion préfixe');
    const mk = async (name: string) =>
      (await call('POST', `/api/projects/${projectId}/categories`, { name, color: '#60ccc5', icon: 'user', shape: 'circle' })).json.category;
    const a = await mk('A');
    const b = await mk('B');
    const n = await createNode(projectId, 'N');
    await call('PATCH', `/api/nodes/${n}`, { categoryId: b.id });
    assert.equal((await call('POST', `/api/categories/${b.id}/merge`, { targetId: `category:${a.id}` })).status, 200);
    const g = (await call('GET', `/api/projects/${projectId}`)).json;
    assert.equal(g.nodes[0].categoryId, a.id);
  });

  it('refuses to merge categories of two projects', async () => {
    const p1 = await createProject('P1');
    const p2 = await createProject('P2');
    const c1 = (await call('POST', `/api/projects/${p1}/categories`, { name: 'X', color: '#60ccc5', icon: 'user', shape: 'circle' })).json.category;
    const c2 = (await call('POST', `/api/projects/${p2}/categories`, { name: 'Y', color: '#60ccc5', icon: 'user', shape: 'circle' })).json.category;
    assert.equal((await call('POST', `/api/categories/${c1.id}/merge`, { targetId: c2.id })).status, 400);
  });
});

describe('user presets', () => {
  it('saves a project\'s categories as a preset and creates a project from it', async () => {
    const source = await createProject('Modèle');
    for (const [name, keys] of [['Témoin', ['Nom', 'Rôle']], ['Indice', []]] as const) {
      await call('POST', `/api/projects/${source}/categories`, {
        name, color: '#e89dc0', icon: 'user', shape: 'circle', metadataKeys: keys, cardKeys: keys.slice(0, 1),
      });
    }
    assert.equal((await call('POST', `/api/projects/${source}/presets`, { name: '  ' })).status, 400);
    const saved = await call('POST', `/api/projects/${source}/presets`, { name: 'Mon enquête' });
    assert.equal(saved.status, 201);
    assert.deepEqual(saved.json.preset.categories.map((c: { name: string }) => c.name), ['Témoin', 'Indice']);

    const list = (await call('GET', '/api/presets')).json.presets;
    assert.ok(list.some((p: { id: string }) => p.id === saved.json.preset.id));

    const created = await call('POST', '/api/projects', { name: 'Nouveau', userPresetId: saved.json.preset.id });
    assert.equal(created.status, 201);
    const cats = (await call('GET', `/api/projects/${created.json.project.id}`)).json.categories;
    assert.deepEqual(cats.map((c: { name: string }) => c.name), ['Témoin', 'Indice']);
    assert.deepEqual(cats[0].metadataKeys, ['Nom', 'Rôle']);
    assert.deepEqual(cats[0].cardKeys, ['Nom']);

    assert.equal((await call('POST', '/api/projects', { name: 'X', userPresetId: 'nope' })).status, 404);
    assert.equal((await call('POST', '/api/projects/nope/presets', { name: 'X' })).status, 404);
    assert.equal((await call('DELETE', `/api/presets/${saved.json.preset.id}`)).status, 200);
    assert.equal((await call('DELETE', `/api/presets/${saved.json.preset.id}`)).status, 404);
  });
});

describe('project duplication', () => {
  it('copies a project with new ids and leaves the original as it is', async () => {
    const demo = (await call('POST', '/api/projects/demo')).json.projectId;
    const original = (await call('GET', `/api/projects/${demo}`)).json;
    const res = await call('POST', `/api/projects/${demo}/duplicate`);
    assert.equal(res.status, 201);
    assert.equal(res.json.project.name, `${original.project.name} (copie)`);
    const copy = (await call('GET', `/api/projects/${res.json.project.id}`)).json;
    assert.equal(copy.nodes.length, original.nodes.length);
    assert.equal(copy.edges.length, original.edges.length);
    assert.deepEqual(copy.categories.map((c: { name: string }) => c.name), original.categories.map((c: { name: string }) => c.name));
    const originalIds = new Set(original.nodes.map((n: { id: string }) => n.id));
    assert.ok(copy.nodes.every((n: { id: string }) => !originalIds.has(n.id)));
    assert.equal((await call('POST', '/api/projects/nope/duplicate')).status, 404);
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
