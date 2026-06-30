import { describe, it, expect } from 'vitest';
import { openDatabase, runMigrations } from './index.js';

describe('migration 0002', () => {
  it('applies both 0001 and 0002 to a fresh DB', () => {
    const db = openDatabase(':memory:');
    const r = runMigrations(db);
    expect(r.applied).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((t) => t.name);
    for (const t of [
      'app_user',
      'app_session',
      'source_config',
      'notifier_config',
      'comment_status',
      'master_secret',
    ]) {
      expect(tables).toContain(t);
    }
  });

  it('is idempotent', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    expect(runMigrations(db).applied).toEqual([]);
  });
});
