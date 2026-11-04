import { serve } from '@hono/node-server';
import { app } from './app.ts';
import { closeDb, getDb } from './db.ts';
import { runAutoSnapshots } from './snapshots.ts';

const PORT = Number(process.env.PORT ?? 3456);
// Automatic snapshots of changed projects (A7); GRAPHAX_AUTO_SNAPSHOT_MINUTES=0 turns them off
const AUTO_SNAPSHOT_MINUTES = Number(process.env.GRAPHAX_AUTO_SNAPSHOT_MINUTES ?? 30);

function scheduleAutoSnapshots(): NodeJS.Timeout | null {
  if (!Number.isFinite(AUTO_SNAPSHOT_MINUTES) || AUTO_SNAPSHOT_MINUTES <= 0) return null;
  const run = async () => {
    try {
      const done = await runAutoSnapshots(await getDb());
      if (done.length > 0) console.log(`[Graphax] Instantanés automatiques : ${done.length} projet(s).`);
    } catch (err) {
      console.error('[Graphax] Instantanés automatiques impossibles :', err);
    }
  };
  // A first pass shortly after start, then at the chosen interval
  setTimeout(() => void run(), 60_000).unref();
  const timer = setInterval(() => void run(), AUTO_SNAPSHOT_MINUTES * 60_000);
  timer.unref();
  return timer;
}

async function bootstrap() {
  await getDb();

  const server = serve(
    {
      fetch: app.fetch,
      port: PORT,
      hostname: '127.0.0.1',
    },
    (info) => {
      console.log(`[Graphax API] Serveur local prêt sur http://127.0.0.1:${info.port}`);
    }
  );

  const snapshotTimer = scheduleAutoSnapshots();

  const shutdown = async () => {
    if (snapshotTimer) clearInterval(snapshotTimer);
    server.close();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('[Graphax Bootstrap Fatal]', err);
  process.exit(1);
});
