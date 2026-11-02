import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { getDb } from './db.ts';
import { projectsRouter } from './routes/projects.ts';
import { categoriesRouter } from './routes/categories.ts';
import { nodesRouter } from './routes/nodes.ts';
import { edgesRouter } from './routes/edges.ts';

export const app = new Hono();

app.use('/api/*', cors());

app.onError((err, c) => {
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
  return c.json({ ok: true, engine: 'surrealdb-embedded-surrealkv' });
});

app.route('/api/projects', projectsRouter);
app.route('/api', categoriesRouter);
app.route('/api', nodesRouter);
app.route('/api', edgesRouter);

const distDir = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(distDir)) {
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('*', (c) => {
    const indexHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');
    return c.html(indexHtml);
  });
}
