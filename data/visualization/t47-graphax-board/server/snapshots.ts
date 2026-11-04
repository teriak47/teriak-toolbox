import fs from 'node:fs';
import path from 'node:path';
import type { Surreal } from 'surrealdb';
import { extractId, resolveDataDir } from './db.ts';
import { buildExportBundle } from './bundles.ts';
import type { ProjectSnapshot, SnapshotKind } from '../shared/types.ts';

// Project snapshots (A7): a project's export bundle written as a JSON file under
// <data dir>/snapshots/<projectId>/. The files use the export format, so any of them can
// also be opened with "Importer" on the project list, even after the project was deleted.
// Automatic snapshots are taken when a project changed since its last snapshot and only
// the latest ones are kept; manual ones stay until they are deleted.

export const AUTO_SNAPSHOTS_KEPT = 10;
export const MANUAL_SNAPSHOTS_MAX = 50;

// <date>_<kind>.json, the date with ":" and "." replaced so it is a valid file name
const SNAPSHOT_FILE = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)_(auto|manual)\.json$/;
const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function snapshotsRoot(): string {
  return path.join(resolveDataDir(), 'snapshots');
}

function projectDir(projectId: string): string {
  if (!PROJECT_ID.test(projectId)) throw new Error('Identifiant de projet invalide.');
  return path.join(snapshotsRoot(), projectId);
}

export function isSnapshotName(name: string): boolean {
  return SNAPSHOT_FILE.test(name);
}

function parseName(name: string): { createdAt: string; kind: SnapshotKind } | null {
  const match = SNAPSHOT_FILE.exec(name);
  if (!match) return null;
  const [date, time] = match[1].split('T');
  const [h, m, sec, ms] = time.replace('Z', '').split('-');
  return { createdAt: `${date}T${h}:${m}:${sec}.${ms}Z`, kind: match[2] as SnapshotKind };
}

function fileName(createdAt: string, kind: SnapshotKind): string {
  return `${createdAt.replace(/[:.]/g, '-')}_${kind}.json`;
}

// Snapshots of a project, newest first (counts read from each file)
export function listSnapshots(projectId: string): ProjectSnapshot[] {
  const dir = projectDir(projectId);
  if (!fs.existsSync(dir)) return [];
  const out: ProjectSnapshot[] = [];
  for (const name of fs.readdirSync(dir)) {
    const meta = parseName(name);
    if (!meta) continue;
    let nodeCount = 0;
    let edgeCount = 0;
    try {
      const bundle = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8')) as {
        nodes?: unknown[];
        edges?: unknown[];
      };
      nodeCount = Array.isArray(bundle.nodes) ? bundle.nodes.length : 0;
      edgeCount = Array.isArray(bundle.edges) ? bundle.edges.length : 0;
    } catch {
      continue; // unreadable file: not listed
    }
    out.push({ name, ...meta, nodeCount, edgeCount });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function readSnapshot(projectId: string, name: string): Record<string, unknown> | null {
  if (!isSnapshotName(name)) return null;
  const file = path.join(projectDir(projectId), name);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
}

export function deleteSnapshot(projectId: string, name: string): boolean {
  if (!isSnapshotName(name)) return false;
  const file = path.join(projectDir(projectId), name);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file);
  return true;
}

// Writes a snapshot of the project; null when the project does not exist
export async function createSnapshot(
  db: Surreal,
  projectId: string,
  kind: SnapshotKind
): Promise<ProjectSnapshot | null> {
  const bundle = await buildExportBundle(db, projectId);
  if (!bundle) return null;
  const dir = projectDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  let createdAt = new Date().toISOString();
  // Two snapshots in the same millisecond would share a name
  while (fs.existsSync(path.join(dir, fileName(createdAt, kind)))) {
    createdAt = new Date(Date.parse(createdAt) + 1).toISOString();
  }
  const name = fileName(createdAt, kind);
  // Written to a temporary file first, so a crash never leaves a half-written snapshot
  const tmp = path.join(dir, `.${name}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(bundle, null, 2), 'utf-8');
  fs.renameSync(tmp, path.join(dir, name));
  pruneSnapshots(projectId);
  return { name, createdAt, kind, nodeCount: bundle.nodes.length, edgeCount: bundle.edges.length };
}

// Keeps the latest automatic snapshots and a bounded number of manual ones
export function pruneSnapshots(projectId: string): void {
  const all = listSnapshots(projectId);
  const dir = projectDir(projectId);
  const drop = [
    ...all.filter((s) => s.kind === 'auto').slice(AUTO_SNAPSHOTS_KEPT),
    ...all.filter((s) => s.kind === 'manual').slice(MANUAL_SNAPSHOTS_MAX),
  ];
  for (const s of drop) fs.rmSync(path.join(dir, s.name), { force: true });
}

// Takes an automatic snapshot of every project changed since its latest snapshot.
// Returns the ids of the projects snapshotted.
export async function runAutoSnapshots(db: Surreal): Promise<string[]> {
  const [rows] = await db
    .query<[Array<{ id: unknown; updatedAt: unknown }>]>('SELECT id, updatedAt FROM project;')
    .collect();
  const done: string[] = [];
  for (const row of rows ?? []) {
    const projectId = extractId(row.id);
    if (!PROJECT_ID.test(projectId)) continue;
    const latest = listSnapshots(projectId)[0];
    const updatedAt = String(row.updatedAt ?? '');
    if (latest && updatedAt && updatedAt <= latest.createdAt) continue;
    if (await createSnapshot(db, projectId, 'auto')) done.push(projectId);
  }
  return done;
}
