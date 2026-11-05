import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { serveStatic } from '@hono/node-server/serve-static';
import { getDb } from './db.ts';
import { APP_VERSION } from './version.ts';
import { localOnlyGuard } from './security.ts';
import { requestSizeLimit } from './validation.ts';
import { projectsRouter } from './routes/projects.ts';
import { categoriesRouter } from './routes/categories.ts';
import { nodesRouter } from './routes/nodes.ts';
import { edgesRouter } from './routes/edges.ts';
import { restoreRouter } from './routes/restore.ts';
import { presetsRouter } from './routes/presets.ts';
import { snapshotsRouter } from './routes/snapshots.ts';

export const app = new Hono();

app.use('*', localOnlyGuard);
app.use('/api/*', requestSizeLimit);

app.onError((err, c) => {
  // Client errors raised on purpose (e.g. malformed JSON) keep their status and message
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error('[Graphax API Error]', err);
  return c.json(
    {
      error: err instanceof Error ? err.message : 'Erreur interne du serveur.',
    },
    500
  );
});

app.get('/api/health', async (c) => {
  await getDb();
  return c.json({ ok: true, version: APP_VERSION, engine: 'surrealdb-embedded-surrealkv' });
});

app.route('/api/projects', projectsRouter);
app.route('/api', categoriesRouter);
app.route('/api', nodesRouter);
app.route('/api', edgesRouter);
app.route('/api', restoreRouter);
app.route('/api', presetsRouter);
app.route('/api', snapshotsRouter);

const distDir = path.resolve(import.meta.dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use('/*', serveStatic({ root: path.relative(process.cwd(), distDir) || '.' }));
  app.get('*', (c) => {
    const indexHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');
    return c.html(indexHtml);
  });
}
