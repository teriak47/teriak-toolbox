import { serve } from '@hono/node-server';
import { app } from './app.ts';
import { closeDb, getDb } from './db.ts';

const PORT = Number(process.env.PORT ?? 3456);

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

  const shutdown = async () => {
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
