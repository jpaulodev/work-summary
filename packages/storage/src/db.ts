import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type SqliteDatabase = DB;

export function openDatabase(path: string): SqliteDatabase {
  // Ensure the parent directory exists for file-backed databases; the API's
  // first run targets ~/.local/state/work-summary/state.db before anything
  // creates that directory. Skip special paths like ":memory:".
  if (!path.startsWith(':')) {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
