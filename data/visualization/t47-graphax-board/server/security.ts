import type { MiddlewareHandler } from 'hono';

const DEV_CLIENT_PORT = 5173;

export function getServerPort(): number {
  return Number(process.env.PORT ?? 3456);
}

// Hosts the local API answers to. Rejecting any other Host header stops DNS rebinding,
// where a hostile site resolves its own name to 127.0.0.1 to reach the local server.
function allowedHosts(): Set<string> {
  const port = getServerPort();
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
}

// Origins allowed to call the API from a browser: the app itself and the Vite dev server.
// Extra origins can be added with GRAPHAX_ALLOWED_ORIGINS (comma-separated).
function allowedOrigins(): Set<string> {
  const port = getServerPort();
  const extra = (process.env.GRAPHAX_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://127.0.0.1:${DEV_CLIENT_PORT}`,
    `http://localhost:${DEV_CLIENT_PORT}`,
    ...extra,
  ]);
}

// No CORS headers are ever sent, so other sites cannot read responses. This guard also
// refuses their requests outright, because "simple" cross-site POSTs would otherwise
// still reach the handlers and modify data.
export const localOnlyGuard: MiddlewareHandler = async (c, next) => {
  const host = c.req.header('host') ?? '';
  if (!allowedHosts().has(host.toLowerCase())) {
    return c.json({ error: 'Hôte non autorisé.' }, 403);
  }

  const origin = c.req.header('origin');
  if (origin !== undefined && !allowedOrigins().has(origin)) {
    return c.json({ error: 'Origine non autorisée.' }, 403);
  }

  if (origin === undefined && c.req.header('sec-fetch-site') === 'cross-site') {
    return c.json({ error: 'Requête inter-sites non autorisée.' }, 403);
  }

  await next();
};
