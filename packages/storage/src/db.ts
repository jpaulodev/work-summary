import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';

export type SqliteDatabase = DB;

export function openDatabase(path: string): SqliteDatabase {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
