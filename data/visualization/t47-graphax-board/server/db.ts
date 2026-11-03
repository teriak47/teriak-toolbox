import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Surreal, RecordId } from 'surrealdb';
import { createNodeEngines, engineVersion } from '@surrealdb/node';

let dbInstance: Surreal | null = null;
let initPromise: Promise<Surreal> | null = null;

export function generateId(): string {
  return crypto.randomBytes(8).toString('hex');
}

export function extractId(value: unknown): string {
  if (!value) return '';
  if (value instanceof RecordId) {
    return String(value.id);
  }
  if (typeof value === 'object' && value !== null && 'id' in value) {
    const inner = (value as { id: unknown }).id;
    return extractId(inner);
  }
  const str = String(value);
  const colonIdx = str.indexOf(':');
  const raw = colonIdx >= 0 ? str.slice(colonIdx + 1) : str;
  return raw.replace(/^[⟨`]|[`⟩]$/g, '');
}

export function toRecordId(table: string, id: string): RecordId {
  return new RecordId(table, extractId(id));
}

// Anchored on the tool directory, not on the working directory, so the same database is
// used whichever folder the server is started from. GRAPHAX_DATA_DIR overrides it.
export function resolveDataDir(): string {
  const override = process.env.GRAPHAX_DATA_DIR?.trim();
  if (override) return path.resolve(override);
  return path.resolve(import.meta.dirname, '..', 'data');
}

// SurrealKV reads `surrealkv://C:/dir` as a path relative to the working directory
// (creating `./C/dir`), so Windows drive paths use the `surrealkv:C:/dir` form.
export function surrealKvUrl(dbFile: string): string {
  const normalized = dbFile.replace(/\\/g, '/');
  return /^[A-Za-z]:\//.test(normalized) ? `surrealkv:${normalized}` : `surrealkv://${normalized}`;
}

// Earlier versions opened `surrealkv://D:/…/data/graphax.db`, which on Windows created the
// database under `<working directory>/D/…/data/graphax.db`. If the database is missing at
// the expected place but found there, copy it over; the original is never modified or removed.
export function recoverLegacyDatabase(dbFile: string): void {
  if (fs.existsSync(dbFile)) return;

  const toolDir = path.resolve(import.meta.dirname, '..');
  for (const startDir of new Set([process.cwd(), toolDir])) {
    const oldFile = path.join(startDir, 'data', 'graphax.db').replace(/\\/g, '/');
    const drive = /^([A-Za-z]):\/(.*)$/.exec(oldFile);
    if (!drive) return;
    const candidate = path.join(startDir, drive[1], drive[2]);
    if (path.resolve(candidate) === path.resolve(dbFile) || !fs.existsSync(candidate)) continue;

    fs.cpSync(candidate, dbFile, { recursive: true });
    console.warn(
      `[Graphax DB] Ancienne base trouvée dans ${candidate} ; copiée vers ${dbFile}. ` +
        "L'original n'a pas été modifié."
    );
    return;
  }
}

export async function getDb(): Promise<Surreal> {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const dataDir = resolveDataDir();
    fs.mkdirSync(dataDir, { recursive: true });

    const dbFile = path.join(dataDir, 'graphax.db');
    recoverLegacyDatabase(dbFile);

    const db = new Surreal({
      engines: createNodeEngines(),
    });

    await db.connect(surrealKvUrl(dbFile));
    await db.use({
      namespace: 'graphax',
      database: 'main',
    });

    await db
      .query(`
        DEFINE TABLE IF NOT EXISTS project SCHEMALESS;
        DEFINE TABLE IF NOT EXISTS category SCHEMALESS;
        DEFINE TABLE IF NOT EXISTS entity SCHEMALESS;
        DEFINE TABLE IF NOT EXISTS relation TYPE RELATION IN entity OUT entity SCHEMALESS;

        DEFINE INDEX IF NOT EXISTS idx_category_project ON TABLE category FIELDS projectId;
        DEFINE INDEX IF NOT EXISTS idx_entity_project ON TABLE entity FIELDS projectId;
        DEFINE INDEX IF NOT EXISTS idx_relation_project ON TABLE relation FIELDS projectId;
      `)
      .collect();

    console.log(`[Graphax DB] SurrealDB Embedded v${engineVersion()} connecté -> ${dbFile}`);
    dbInstance = db;
    return db;
  })();

  return initPromise;
}

export async function closeDb(): Promise<void> {
  if (dbInstance) {
    const current = dbInstance;
    dbInstance = null;
    initPromise = null;
    await current.close();
    console.log('[Graphax DB] Connexion SurrealDB fermée proprement.');
  }
}
