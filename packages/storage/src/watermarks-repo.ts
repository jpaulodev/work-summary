import type { SqliteDatabase } from './db.js';

export interface WatermarksRepo {
  get(source: string, repo: string): string | null;
  set(source: string, repo: string, isoTimestamp: string): void;
}

export function createWatermarksRepo(db: SqliteDatabase, userId: number): WatermarksRepo {
  const getStmt = db.prepare(
    'SELECT last_success_at FROM source_watermarks WHERE user_id = ? AND source = ? AND repo = ?',
  );
  const setStmt = db.prepare(
    `INSERT INTO source_watermarks (user_id, source, repo, last_success_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, source, repo) DO UPDATE SET last_success_at = excluded.last_success_at`,
  );
  return {
    get(source, repo) {
      const row = getStmt.get(userId, source, repo) as { last_success_at: string } | undefined;
      return row ? row.last_success_at : null;
    },
    set(source, repo, isoTimestamp) {
      setStmt.run(userId, source, repo, isoTimestamp);
    },
  };
}
