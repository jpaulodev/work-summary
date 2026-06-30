import type { SqliteDatabase } from './db.js';

export interface ScheduleRow {
  id: string;
  userId: number;
  name: string;
  enabled: boolean;
  cronExpression: string;
  timezone: string;
  reposFilter: string[] | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  lastRunId: number | null;
  nextRunAt: string | null;
}

export type ScheduleInsert = Pick<
  ScheduleRow,
  'id' | 'name' | 'enabled' | 'cronExpression' | 'timezone' | 'reposFilter'
>;

export interface SchedulePatch {
  name?: string | undefined;
  enabled?: boolean | undefined;
  cronExpression?: string | undefined;
  timezone?: string | undefined;
  reposFilter?: string[] | null | undefined;
  nextRunAt?: string | null | undefined;
}

interface RawRow {
  id: string;
  user_id: number;
  name: string;
  enabled: number;
  cron_expression: string;
  timezone: string;
  repos_filter: string | null;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  last_run_id: number | null;
  next_run_at: string | null;
}

/**
 * Schedule storage. Pass a userId to scope every operation to one user (the
 * route-facing case). Pass null for the scheduler engine, which must see and
 * fire schedules across all users (each row carries its owning userId).
 */
export class ScheduleRepository {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly userId: number | null = null,
  ) {}

  private parseRow(r: RawRow): ScheduleRow {
    return {
      id: r.id,
      userId: r.user_id,
      name: r.name,
      enabled: r.enabled === 1,
      cronExpression: r.cron_expression,
      timezone: r.timezone,
      reposFilter: r.repos_filter ? (JSON.parse(r.repos_filter) as string[]) : null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastRunAt: r.last_run_at,
      lastRunId: r.last_run_id,
      nextRunAt: r.next_run_at,
    };
  }

  list(): ScheduleRow[] {
    const rows =
      this.userId === null
        ? (this.db.prepare('SELECT * FROM schedules ORDER BY name').all() as RawRow[])
        : (this.db
            .prepare('SELECT * FROM schedules WHERE user_id = ? ORDER BY name')
            .all(this.userId) as RawRow[]);
    return rows.map((r) => this.parseRow(r));
  }

  get(id: string): ScheduleRow | null {
    const r =
      this.userId === null
        ? (this.db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as RawRow | undefined)
        : (this.db
            .prepare('SELECT * FROM schedules WHERE id = ? AND user_id = ?')
            .get(id, this.userId) as RawRow | undefined);
    return r ? this.parseRow(r) : null;
  }

  insert(row: ScheduleInsert): ScheduleRow {
    if (this.userId === null) throw new Error('insert requires a user-scoped repository');
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO schedules
          (id, user_id, name, enabled, cron_expression, timezone, repos_filter, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        this.userId,
        row.name,
        row.enabled ? 1 : 0,
        row.cronExpression,
        row.timezone,
        row.reposFilter ? JSON.stringify(row.reposFilter) : null,
        now,
        now,
      );
    return this.get(row.id) as ScheduleRow;
  }

  update(id: string, patch: SchedulePatch): ScheduleRow {
    const cur = this.get(id);
    if (!cur) throw new Error(`Schedule ${id} not found`);
    const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    this.db
      .prepare(
        `UPDATE schedules SET
          name = ?, enabled = ?, cron_expression = ?, timezone = ?, repos_filter = ?,
          next_run_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.name,
        next.enabled ? 1 : 0,
        next.cronExpression,
        next.timezone,
        next.reposFilter ? JSON.stringify(next.reposFilter) : null,
        next.nextRunAt,
        next.updatedAt,
        id,
      );
    return this.get(id) as ScheduleRow;
  }

  delete(id: string): void {
    if (this.userId === null) {
      this.db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
    } else {
      this.db.prepare('DELETE FROM schedules WHERE id = ? AND user_id = ?').run(id, this.userId);
    }
  }

  markRun(id: string, runId: number, ranAt: string, nextRunAt: string): void {
    this.db
      .prepare(
        `UPDATE schedules SET last_run_id = ?, last_run_at = ?, next_run_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(runId, ranAt, nextRunAt, new Date().toISOString(), id);
  }
}
