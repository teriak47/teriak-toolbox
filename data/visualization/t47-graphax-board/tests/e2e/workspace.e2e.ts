// End-to-end tests of the workspace in a real browser (A9). They start the built app with a
// throwaway database, open the demo project and drive it like a user. Run `pnpm build`
// first, then `pnpm test:e2e`. Playwright's Chromium must be installed
// (`pnpm exec playwright install chromium`).

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';

const toolDir = path.resolve(import.meta.dirname, '..', '..');
const PORT = 3471;
const BASE = `http://127.0.0.1:${PORT}`;

let server: ChildProcess;
let browser: Browser;
let page: Page;
let dataDir: string;
let projectId: string;
let pageErrors: string[] = [];

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('The Graphax server did not start.');
}

async function api(pathName: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${pathName}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  return res.json();
}

const graph = () => api(`/api/projects/${projectId}`);

// Screen point of a node, found from its title under it. The view fits the graph and the
// layout may still be settling just after loading, so wait until the title stays put.
async function nodeCenter(title: string): Promise<{ x: number; y: number }> {
  const label = page.locator('svg text', { hasText: title }).first();
  let last = '';
  for (let i = 0; i < 40; i++) {
    const box = await label.boundingBox();
    assert.ok(box, `node "${title}" on screen`);
    const key = `${Math.round(box.x)},${Math.round(box.y)}`;
    if (key === last) return { x: box.x + box.width / 2, y: box.y - 30 };
    last = key;
    await page.waitForTimeout(150);
  }
  assert.fail(`node "${title}" kept moving`);
}

const undoButton = () => page.getByRole('button', { name: 'Annuler', exact: true });

before(async () => {
  assert.ok(fs.existsSync(path.join(toolDir, 'dist', 'index.html')), 'run `pnpm build` before the e2e tests');
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphax-e2e-'));
  // The local API (built by `pnpm test:e2e`) serves the built interface from dist/
  const binary = path.join(toolDir, 'target', 'debug', process.platform === 'win32' ? 'graphax-api.exe' : 'graphax-api');
  server = spawn(binary, [], {
    cwd: toolDir,
    env: { ...process.env, PORT: String(PORT), GRAPHAX_DATA_DIR: dataDir, GRAPHAX_AUTO_SNAPSHOT_MINUTES: '0' },
    stdio: 'ignore',
  });
  await waitForServer();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(async () => {
  // Each test starts on a fresh copy of the demo project
  projectId = (await api('/api/projects/demo', { method: 'POST' })).projectId;
  page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`${BASE}/?project=${projectId}`);
  await page.locator('svg text', { hasText: 'Groupe "NightOwl"' }).first().waitFor();
});

describe('workspace (browser)', () => {
  it('shows the demo graph with its reliability badges', async () => {
    const g = await graph();
    assert.equal(await page.locator('svg g[aria-label^="Fiabilité"]').count(), 4);
    for (const n of g.nodes) {
      assert.ok(await page.locator('svg text', { hasText: n.title.slice(0, 12) }).count(), n.title);
    }
    assert.deepEqual(pageErrors, []);
  });

  it('creates a node, then undoes and redoes it', async () => {
    const before = (await graph()).nodes.length;
    await page.getByRole('button', { name: 'Nœud', exact: true }).click();
    await page.waitForTimeout(800);
    assert.equal((await graph()).nodes.length, before + 1);
    assert.match((await undoButton().getAttribute('title')) ?? '', /Création du nœud/);
    await page.mouse.click(700, 120);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(800);
    assert.equal((await graph()).nodes.length, before);
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(800);
    assert.equal((await graph()).nodes.length, before + 1);
    assert.deepEqual(pageErrors, []);
  });

  it('moves a multiple selection together and undoes the move in one step', async () => {
    const g0 = await graph();
    const a = g0.nodes.find((n: { title: string }) => n.title.startsWith('Groupe'));
    const b = g0.nodes.find((n: { title: string }) => n.title.startsWith('Phishing'));
    const ca = await nodeCenter('Groupe "NightOwl"');
    const cb = await nodeCenter('Phishing DevOps');
    await page.mouse.click(ca.x, ca.y);
    await page.keyboard.down('Control');
    await page.mouse.click(cb.x, cb.y);
    await page.keyboard.up('Control');
    await page.getByRole('complementary', { name: 'Sélection multiple' }).waitFor();

    await page.mouse.move(ca.x, ca.y);
    await page.mouse.down();
    await page.mouse.move(ca.x + 80, ca.y + 40, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(800);
    const g1 = await graph();
    const moved = (id: string) => {
      const before = g0.nodes.find((n: { id: string }) => n.id === id);
      const now = g1.nodes.find((n: { id: string }) => n.id === id);
      return [Math.round(now.positionX - before.positionX), Math.round(now.positionY - before.positionY)];
    };
    assert.deepEqual(moved(a.id), moved(b.id));
    assert.notDeepEqual(moved(a.id), [0, 0]);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(800);
    const g2 = await graph();
    assert.equal(g2.nodes.find((n: { id: string }) => n.id === a.id).positionX, a.positionX);
    assert.equal(g2.nodes.find((n: { id: string }) => n.id === b.id).positionY, b.positionY);
    assert.deepEqual(pageErrors, []);
  });

  it('asks before deleting a node, and brings it back with its links on undo', async () => {
    const g0 = await graph();
    const target = g0.nodes.find((n: { title: string }) => n.title.startsWith('Groupe'));
    const links = g0.edges.filter(
      (e: { sourceNodeId: string; targetNodeId: string }) =>
        e.sourceNodeId === target.id || e.targetNodeId === target.id
    ).length;
    const c = await nodeCenter('Groupe "NightOwl"');
    await page.mouse.click(c.x, c.y);
    await page.keyboard.press('Delete');
    const dialog = page.getByRole('alertdialog');
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /NightOwl/);
    await page.keyboard.press('Enter');
    await dialog.waitFor({ state: 'detached' });
    await page.waitForTimeout(800);
    assert.ok(!(await graph()).nodes.some((n: { id: string }) => n.id === target.id));

    await page.mouse.click(700, 120);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(1000);
    const g2 = await graph();
    assert.ok(g2.nodes.some((n: { id: string }) => n.id === target.id));
    assert.equal(g2.edges.length, g0.edges.length);
    assert.ok(links > 0);
    assert.deepEqual(pageErrors, []);
  });

  it('changes a node category from the right-click menu', async () => {
    const c = await nodeCenter('Phishing DevOps');
    await page.mouse.move(c.x, c.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
    await page.getByRole('menu').getByRole('menuitemradio', { name: /Domaine \/ URL/ }).click();
    await page.waitForTimeout(800);
    const g = await graph();
    const node = g.nodes.find((n: { title: string }) => n.title.startsWith('Phishing'));
    assert.equal(g.categories.find((cat: { id: string }) => cat.id === node.categoryId).name, 'Domaine / URL');
    assert.deepEqual(pageErrors, []);
  });
});
