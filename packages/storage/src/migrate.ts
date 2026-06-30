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

  // Migrations do schema surgery (table rebuilds for composite keys, etc.).
  // SQLite's own guidance is to disable foreign keys during such changes:
  // otherwise an intermediate rebuild state — or a single pre-existing orphaned
  // row left behind by an earlier FK-off delete — aborts the whole migration and
  // it can never record its version, so the app crash-loops on every start.
  // foreign_keys cannot be toggled inside a transaction, so we flip it here
  // (outside any transaction) and restore the prior setting afterwards.
  const fkWasOn = db.pragma('foreign_keys', { simple: true }) === 1;
  if (fkWasOn) db.pragma('foreign_keys = OFF');
  try {
    for (const m of all) {
      if (already.has(m.version)) continue;
      try {
        const tx = db.transaction(() => {
          db.exec(m.sql);
          db.prepare(
            'INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)',
          ).run(m.version, new Date().toISOString());
        });
        tx();
      } catch (err) {
        // Surface which migration failed and any FK violations, so a failure is
        // diagnosable from the logs instead of a bare "constraint failed".
        const violations = db.pragma('foreign_key_check') as unknown[];
        const detail =
          Array.isArray(violations) && violations.length > 0
            ? ` foreign_key_check=${JSON.stringify(violations)}`
            : '';
        throw new Error(
          `migration ${m.version} (${m.name}) failed: ${
            err instanceof Error ? err.message : String(err)
          }.${detail}`,
        );
      }
      applied.push(m.version);
    }
  } finally {
    if (fkWasOn) db.pragma('foreign_keys = ON');
  }
  return { applied };
}
