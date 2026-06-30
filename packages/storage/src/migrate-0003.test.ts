import { describe, it, expect } from 'vitest';
import { openDatabase, runMigrations } from './index.js';

describe('migration 0003', () => {
  it('creates the schedules table with the expected columns', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const cols = (db.prepare('PRAGMA table_info(schedules)').all() as { name: string }[])
      .map((c) => c.name)
      .sort();
    expect(cols).toEqual([
      'created_at',
      'cron_expression',
      'enabled',
      'id',
      'last_run_at',
      'last_run_id',
      'name',
      'next_run_at',
      'repos_filter',
      'timezone',
      'updated_at',
      'user_id',
    ]);
  });

  it('adds triggered_by to runs (default manual)', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const cols = db.prepare('PRAGMA table_info(runs)').all() as { name: string }[];
    expect(cols.find((c) => c.name === 'triggered_by')).toBeTruthy();
  });

  it('applies versions 1, 2 and 3', () => {
    const db = openDatabase(':memory:');
    expect(runMigrations(db).applied).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  });
});
