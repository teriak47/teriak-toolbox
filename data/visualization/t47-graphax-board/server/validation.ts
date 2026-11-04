import type { Context, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { bodyLimit } from 'hono/body-limit';
import {
  CATEGORY_ICON_NAMES,
  CATEGORY_SHAPES,
  type CategoryIconName,
  type CategoryShape,
} from '../shared/types.ts';

// Request size limits: ordinary edits stay small, a project import can be large
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

const IMPORT_PATH = '/api/projects/import';

const tooLarge = (c: Context) =>
  c.json({ error: 'Requête trop volumineuse.' }, 413);

const defaultLimit = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge });
const importLimit = bodyLimit({ maxSize: MAX_IMPORT_BYTES, onError: tooLarge });

export const requestSizeLimit: MiddlewareHandler = (c, next) =>
  // An import and an undo restoring a large deletion can carry a whole graph
  c.req.path === IMPORT_PATH || /^\/api\/projects\/[^/]+\/restore$/.test(c.req.path)
    ? importLimit(c, next)
    : defaultLimit(c, next);

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Reads a JSON object body; malformed JSON or any other JSON value is a 400, not a 500
export async function readBody<T extends object = Record<string, unknown>>(
  c: Context
): Promise<Partial<T>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await c.req.text());
  } catch {
    throw new HTTPException(400, { message: 'Corps de requête JSON invalide.' });
  }
  if (!isPlainObject(parsed)) {
    throw new HTTPException(400, { message: 'Un objet JSON est attendu.' });
  }
  return parsed as Partial<T>;
}

// Returns the value when it is a string, so a number or object sent by mistake is ignored
export function optString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

// Accepts #rgb or #rrggbb and returns the #rrggbb form; anything else is null
export function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const hex = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(hex)) return hex;
  if (/^#[0-9a-f]{3}$/.test(hex)) {
    return `#${[...hex.slice(1)].map((ch) => ch + ch).join('')}`;
  }
  return null;
}

export function isCategoryIcon(value: unknown): value is CategoryIconName {
  return typeof value === 'string' && (CATEGORY_ICON_NAMES as readonly string[]).includes(value);
}

export function isCategoryShape(value: unknown): value is CategoryShape {
  return typeof value === 'string' && (CATEGORY_SHAPES as readonly string[]).includes(value);
}

// A link handle is a short string id or null
export function normalizeHandle(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}
