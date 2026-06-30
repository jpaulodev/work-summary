import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase, runMigrations } from './index.js';
import { ScheduleRepository } from './schedule-repo.js';
import type { SqliteDatabase } from './db.js';

let db: SqliteDatabase;
beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
});

describe('ScheduleRepository', () => {
  it('inserts and lists', () => {
    const repo = new ScheduleRepository(db);
    repo.insert({
      id: 's1',
      name: 'weekday-9am',
      enabled: true,
      cronExpression: '0 9 * * 1-5',
      timezone: 'UTC',
      reposFilter: null,
    });
    expect(repo.list()).toHaveLength(1);
    expect(repo.list()[0]?.cronExpression).toBe('0 9 * * 1-5');
    expect(repo.list()[0]?.enabled).toBe(true);
  });

  it('serializes reposFilter as JSON', () => {
    const repo = new ScheduleRepository(db);
    repo.insert({
      id: 's2',
      name: 'x',
      enabled: true,
      cronExpression: '* * * * *',
      timezone: 'UTC',
      reposFilter: ['owner/repo1'],
    });
    expect(repo.get('s2')?.reposFilter).toEqual(['owner/repo1']);
  });

  it('updates fields and toggles enabled', () => {
    const repo = new ScheduleRepository(db);
    repo.insert({
      id: 's3',
      name: 'x',
      enabled: true,
      cronExpression: '* * * * *',
      timezone: 'UTC',
      reposFilter: null,
    });
    const updated = repo.update('s3', { enabled: false, name: 'renamed' });
    expect(updated.enabled).toBe(false);
    expect(updated.name).toBe('renamed');
  });

  it('markRun records last run and next run', () => {
    const repo = new ScheduleRepository(db);
    repo.insert({
      id: 's4',
      name: 'x',
      enabled: true,
      cronExpression: '* * * * *',
      timezone: 'UTC',
      reposFilter: null,
    });
    repo.markRun('s4', 7, '2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z');
    const row = repo.get('s4');
    expect(row?.lastRunId).toBe(7);
    expect(row?.nextRunAt).toBe('2026-06-01T11:00:00Z');
  });

  it('deletes', () => {
    const repo = new ScheduleRepository(db);
    repo.insert({
      id: 's5',
      name: 'x',
      enabled: true,
      cronExpression: '* * * * *',
      timezone: 'UTC',
      reposFilter: null,
    });
    repo.delete('s5');
    expect(repo.get('s5')).toBeNull();
  });
});
