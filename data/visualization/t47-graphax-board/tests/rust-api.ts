// Runs the HTTP cases of tests/api.test.ts against the Rust API of the desktop app
// (src-tauri), to check that it answers exactly as the Node server. Only the cases of the
// routes already ported are listed; the list grows with the migration. Cases that need a
// route not ported yet (such as links) are added with that route, since they would
// otherwise pass without testing anything; cases that read the Node database directly
// stay out (some of their HTTP checks still run here, with a Node-only final check).

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORTED_CASES = [
  // projects
  'creates, renames, lists and deletes a project',
  'rejects a project without a name',
  'rejects an invalid bundle',
  'creates a preset project with its categories',
  'creates every preset with valid, distinct-coloured categories in order',
  'creates the demo project in full',
  'imports categories, keeps node categories and skips dangling links',
  'limits the request size, with a larger limit for imports',
  'imports a bundle with invalid entries by skipping or defaulting them',
  'copies a project with new ids and leaves the original as it is',
  'names link colours on the project, replaces the whole map and keeps it through export',
  // categories
  'reorders categories and keeps the order',
  'stores category default keys and card keys',
  'validates category colour, icon and shape',
  'gives new and imported categories the same defaults',
  'refuses to merge categories of two projects',
  // nodes
  'refuses nodes and categories in a missing project',
  'only accepts a category of the same project for a node',
  'moves only the nodes of the project in a batch',
  'answers 400, not 500, to malformed JSON or a non-object body',
  'ignores fields of the wrong type instead of failing',
  'stores, validates, clears and exports the reliability code',
  'stores the bare target id on the moved nodes, even when given with its table prefix',
  'stores views on the project, cleans them, and keeps them on export and import with the new ids',
  // edges (and the node cases that also create links)
  'stores nodes and edges and returns them with the project graph',
  'rejects self-links',
  'removes the links of a deleted node',
  'swaps the endpoints and keeps the pending label',
  'returns 404 for an unknown edge and changes nothing',
  'round-trips a project into a new one',
  'refuses a link to a missing node or to a node of another project',
  'reports category, node and link counts per project',
  'stores, changes, resets and validates a link colour',
  'keeps the colour through a reversal and an export/import',
  'draws links without a colour in the default grey',
  'deletes several nodes with their links and leaves the rest',
  // presets, snapshots and restore
  'brings back a deleted node with its links, ids and category',
  'puts a deleted category back in its place and gives its nodes back to it',
  'skips links to nodes that are gone and refuses foreign or invalid records',
  'takes, lists, restores as a new project and deletes snapshots',
  'refuses unknown projects and snapshot names that are not snapshot files',
  'moves the nodes, adds the missing keys, deletes the source, and can be restored',
  'saves a project\'s categories as a preset and creates a project from it',
  // local-only guard and health
  'accepts same-origin and header-less requests',
  'accepts the Vite dev server origin',
  'refuses a foreign origin, including simple cross-site writes',
  'refuses an unexpected Host header (DNS rebinding)',
  'sends no CORS headers',
  'reports the version on the health endpoint',
];

const toolDir = path.resolve(import.meta.dirname, '..');
const tauriDir = path.join(toolDir, 'src-tauri');
const port = 3458;

const build = spawnSync('cargo', ['build', '--bin', 'graphax-api'], { cwd: tauriDir, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphax-rust-test-'));
const binary = path.join(tauriDir, 'target', 'debug', process.platform === 'win32' ? 'graphax-api.exe' : 'graphax-api');
const server = spawn(binary, [], {
  env: { ...process.env, GRAPHAX_DATA_DIR: dataDir, PORT: String(port) },
  stdio: 'inherit',
});

let exitCode = 1;
try {
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) break;
    } catch {
      // not listening yet
    }
    if (i >= 100) throw new Error("L'API Rust n'a pas démarré.");
    await new Promise((r) => setTimeout(r, 100));
  }

  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = `^(${PORTED_CASES.map(escape).join('|')})$`;
  const run = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', `--test-name-pattern=${pattern}`, 'tests/api.test.ts'],
    { cwd: toolDir, env: { ...process.env, GRAPHAX_API_URL: url }, encoding: 'utf-8' }
  );
  process.stdout.write(run.stdout);
  process.stderr.write(run.stderr);

  // A case renamed in api.test.ts would otherwise be skipped silently
  const passed = Number(/^# pass (\d+)/m.exec(run.stdout)?.[1] ?? 0);
  if (run.status === 0 && passed === PORTED_CASES.length) {
    console.log(`\nAPI Rust : ${passed}/${PORTED_CASES.length} cas portés passent.`);
    exitCode = 0;
  } else {
    console.error(`\nAPI Rust : ${passed}/${PORTED_CASES.length} cas portés passent.`);
  }
} finally {
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
process.exit(exitCode);
