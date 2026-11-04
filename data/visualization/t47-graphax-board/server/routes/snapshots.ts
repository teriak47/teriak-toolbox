import { Hono } from 'hono';
import { getDb } from '../db.ts';
import { projectExists } from '../guards.ts';
import { importProjectBundle } from '../bundles.ts';
import { createSnapshot, deleteSnapshot, isSnapshotName, listSnapshots, readSnapshot } from '../snapshots.ts';
import { mapProject } from '../mappers.ts';
import { toRecordId } from '../db.ts';

export const snapshotsRouter = new Hono();

const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/;

// List a project's snapshots, newest first
snapshotsRouter.get('/projects/:projectId/snapshots', async (c) => {
  const projectId = c.req.param('projectId');
  if (!PROJECT_ID.test(projectId) || !(await projectExists(await getDb(), projectId))) {
    return c.json({ error: 'Projet introuvable.' }, 404);
  }
  return c.json({ snapshots: listSnapshots(projectId) });
});

// Take a snapshot now
snapshotsRouter.post('/projects/:projectId/snapshots', async (c) => {
  const projectId = c.req.param('projectId');
  if (!PROJECT_ID.test(projectId)) return c.json({ error: 'Projet introuvable.' }, 404);
  const snapshot = await createSnapshot(await getDb(), projectId, 'manual');
  if (!snapshot) return c.json({ error: 'Projet introuvable.' }, 404);
  return c.json({ snapshot }, 201);
});

// Restore a snapshot as a new project; the current project is left as it is
snapshotsRouter.post('/projects/:projectId/snapshots/:name/restore', async (c) => {
  const projectId = c.req.param('projectId');
  const name = c.req.param('name');
  if (!PROJECT_ID.test(projectId) || !isSnapshotName(name)) {
    return c.json({ error: 'Instantané introuvable.' }, 404);
  }
  const bundle = readSnapshot(projectId, name);
  if (!bundle) return c.json({ error: 'Instantané introuvable.' }, 404);

  const db = await getDb();
  const [current] = await db
    .query<[Record<string, unknown> | undefined]>('SELECT * FROM ONLY $pid;', {
      pid: toRecordId('project', projectId),
    })
    .collect();
  const sourceName =
    (current ? mapProject(current).name : '') ||
    String((bundle.project as { name?: unknown } | undefined)?.name ?? '') ||
    'Projet';
  const date = new Date(listSnapshots(projectId).find((s) => s.name === name)?.createdAt ?? Date.now());
  const label = date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  const project = await importProjectBundle(db, bundle, `${sourceName} (instantané du ${label})`);
  if (!project) return c.json({ error: 'Instantané illisible.' }, 400);
  return c.json({ project }, 201);
});

snapshotsRouter.delete('/projects/:projectId/snapshots/:name', async (c) => {
  const projectId = c.req.param('projectId');
  const name = c.req.param('name');
  if (!PROJECT_ID.test(projectId) || !deleteSnapshot(projectId, name)) {
    return c.json({ error: 'Instantané introuvable.' }, 404);
  }
  return c.json({ deleted: true });
});
