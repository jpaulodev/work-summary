import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openDatabase, runMigrations, ScheduleRepository } from '@work-summary/storage';
import { ScheduleEngine } from './engine.js';

function makeRepo() {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return new ScheduleRepository(db);
}

describe('ScheduleEngine', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-06-01T00:00:00Z') }));
  afterEach(() => vi.useRealTimers());

  it('invokes runScan when a cron tick fires', async () => {
    const repo = makeRepo();
    repo.insert({
      id: 's1',
      name: 'every-min',
      enabled: true,
      cronExpression: '* * * * *',
      timezone: 'UTC',
      reposFilter: null,
    });
    const runScan = vi.fn().mockResolvedValue({ runId: 42 });
    const engine = new ScheduleEngine({ scheduleRepo: repo, runScan });
    engine.start();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(runScan).toHaveBeenCalledWith(expect.objectContaining({ triggeredBy: 'schedule:s1' }));
    engine.stop();
  });

  it('does not register disabled schedules', async () => {
    const repo = makeRepo();
    repo.insert({
      id: 's1',
      name: 'off',
      enabled: false,
      cronExpression: '* * * * *',
      timezone: 'UTC',
      reposFilter: null,
    });
    const runScan = vi.fn().mockResolvedValue({ runId: 1 });
    const engine = new ScheduleEngine({ scheduleRepo: repo, runScan });
    engine.start();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(runScan).not.toHaveBeenCalled();
    engine.stop();
  });

  it('records the run via markRun after a tick', async () => {
    const repo = makeRepo();
    repo.insert({
      id: 's1',
      name: 'every-min',
      enabled: true,
      cronExpression: '* * * * *',
      timezone: 'UTC',
      reposFilter: null,
    });
    const engine = new ScheduleEngine({
      scheduleRepo: repo,
      runScan: vi.fn().mockResolvedValue({ runId: 99 }),
    });
    engine.start();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(repo.get('s1')?.lastRunId).toBe(99);
    engine.stop();
  });

  it('upsert registers and remove deregisters', () => {
    const repo = makeRepo();
    repo.insert({
      id: 's1',
      name: 'x',
      enabled: true,
      cronExpression: '* * * * *',
      timezone: 'UTC',
      reposFilter: null,
    });
    const engine = new ScheduleEngine({
      scheduleRepo: repo,
      runScan: vi.fn().mockResolvedValue({ runId: 1 }),
    });
    engine.upsert('s1');
    expect(engine.has('s1')).toBe(true);
    engine.remove('s1');
    expect(engine.has('s1')).toBe(false);
    engine.stop();
  });
});
