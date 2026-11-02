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

export async function getDb(): Promise<Surreal> {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const dataDir = path.resolve(process.cwd(), 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    const dbPath = path.join(dataDir, 'graphax.db').replace(/\\/g, '/');
    const db = new Surreal({
      engines: createNodeEngines(),
    });

    await db.connect(`surrealkv://${dbPath}`);
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

    console.log(`[Graphax DB] SurrealDB Embedded v${engineVersion()} connecté -> surrealkv://${dbPath}`);
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
