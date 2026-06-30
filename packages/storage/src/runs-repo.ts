import type { SqliteDatabase } from './db.js';

export interface RunStats {
  commentsFound: number;
  commentsNotified: number;
  errorMessage?: string;
  sourceStats?: Record<string, { fetched: number; matched: number }>;
}

export interface RunsRepo {
  startRun(triggeredBy?: string): number;
  finishRun(id: number, status: 'success' | 'partial' | 'failed', stats: RunStats): void;
}

export function createRunsRepo(db: SqliteDatabase, now: () => Date): RunsRepo {
  const insert = db.prepare(
    `INSERT INTO runs (started_at, status, triggered_by) VALUES (?, 'running', ?)`,
  );
  const update = db.prepare(
    `UPDATE runs
     SET finished_at = ?, status = ?, comments_found = ?, comments_notified = ?, error_message = ?, source_stats = ?
     WHERE id = ?`,
  );
  return {
    startRun(triggeredBy = 'manual') {
      const info = insert.run(now().toISOString(), triggeredBy);
      return Number(info.lastInsertRowid);
    },
    finishRun(id, status, stats) {
      update.run(
        now().toISOString(),
        status,
        stats.commentsFound,
        stats.commentsNotified,
        stats.errorMessage ?? null,
        stats.sourceStats ? JSON.stringify(stats.sourceStats) : null,
        id,
      );
    },
  };
}
