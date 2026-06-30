import { describe, it, expect } from 'vitest';
import { openDatabase } from './db.js';
import { runMigrations } from './migrate.js';

describe('runMigrations', () => {
  it('applies 0001 on a fresh in-memory DB', () => {
    const db = openDatabase(':memory:');
    const result = runMigrations(db);
    expect(result.applied).toEqual([1, 2, 3, 4, 6, 7, 8]);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('notified_comments');
    expect(names).toContain('runs');
    expect(names).toContain('source_watermarks');
    expect(names).toContain('schema_version');
  });

  it('is idempotent on second run', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const second = runMigrations(db);
    expect(second.applied).toEqual([]);
  });

  it('records applied version in schema_version', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const rows = db.prepare('SELECT version FROM schema_version').all() as { version: number }[];
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3, 4, 6, 7, 8]);
  });
});
