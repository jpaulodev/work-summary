import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqliteDatabase } from './db.js';

function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, '..', 'migrations'), join(here, '..', '..', 'migrations')];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(`Migrations directory not found near ${here}`);
}

interface Migration {
  version: number;
  name: string;
  sql: string;
}

function loadMigrations(): Migration[] {
  const dir = migrationsDir();
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => {
      const match = /^(\d+)_(.+)\.sql$/.exec(f);
      if (!match) throw new Error(`Bad migration filename: ${f}`);
      return {
        version: parseInt(match[1]!, 10),
        name: match[2]!,
        sql: readFileSync(join(dir, f), 'utf8'),
      };
    });
}

function ensureVersionTable(db: SqliteDatabase): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
}

function appliedVersions(db: SqliteDatabase): Set<number> {
  const rows = db.prepare('SELECT version FROM schema_version').all() as { version: number }[];
  return new Set(rows.map((r) => r.version));
}

export function runMigrations(db: SqliteDatabase): { applied: number[] } {
  ensureVersionTable(db);
  const already = appliedVersions(db);
  const all = loadMigrations();
  const applied: number[] = [];
  for (const m of all) {
    if (already.has(m.version)) continue;
    const tx = db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)').run(
        m.version,
        new Date().toISOString(),
      );
    });
    tx();
    applied.push(m.version);
  }
  return { applied };
}
