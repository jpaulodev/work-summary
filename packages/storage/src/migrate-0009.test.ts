import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';
import { runMigrations } from './migrate.js';
import type { SqliteDatabase } from './db.js';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Apply every migration file up to (and including) the given version. */
function applyThrough(db: SqliteDatabase, files: string[]): void {
  for (const f of files) db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
}

const PRE_0009 = [
  '0001_init.sql',
  '0002_phase2.sql',
  '0003_schedules.sql',
  '0004_jira.sql',
  '0006_comment_reply.sql',
  '0007_oauth.sql',
  '0008_jira_oauth.sql',
];

describe('migration 0009 (multi-user) data preservation', () => {
  function seededDb(): SqliteDatabase {
    const db = openDatabase(':memory:'); // foreign_keys = ON
    applyThrough(db, PRE_0009);
    db.prepare(
      `INSERT INTO notified_comments
         (id, source, repo, container_type, container_number, comment_native_id, author_login, matched_rules, notified_at)
       VALUES ('c1', 'github', 'org/repo', 'issue', 1, 'c1', 'alice', '[]', '2026-06-01T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO comment_status (comment_id, status, note, updated_at)
       VALUES ('c1', 'resolved', 'keep me', '2026-06-01T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO comment_reply (comment_id, body, sent_at, source)
       VALUES ('c1', 'done', '2026-06-01T00:00:00Z', 'github')`,
    ).run();
    db.prepare(
      `INSERT INTO jira_site
         (id, base_url, email, encrypted_token, token_nonce, enabled, created_at, updated_at, cloud_id)
       VALUES ('cloud-1', 'https://acme.atlassian.net', '', '', '', 1, '', '', 'cloud-1')`,
    ).run();
    db.prepare(
      `INSERT INTO jira_project (site_id, project_key, project_name) VALUES ('cloud-1', 'WS', 'Work')`,
    ).run();
    db.prepare(
      `INSERT INTO notifier_config (id, type, enabled, config_json, secret_ciphertext, secret_nonce)
       VALUES ('n1', 'smtp', 1, '{}', 'ct', 'nc')`,
    ).run();
    db.prepare(
      `INSERT INTO app_user (id, username, password_hash, created_at) VALUES (1, 'admin', 'h', '')`,
    ).run();
    return db;
  }

  it('preserves comment_status (the FK-cascade trap) with user_id = 1', () => {
    const db = seededDb();
    db.exec(readFileSync(join(MIGRATIONS, '0009_multiuser.sql'), 'utf8'));
    const row = db
      .prepare('SELECT user_id, status, note FROM comment_status WHERE comment_id = ?')
      .get('c1') as { user_id: number; status: string; note: string } | undefined;
    expect(row).toEqual({ user_id: 1, status: 'resolved', note: 'keep me' });
  });

  it('preserves notified_comments, comment_reply, jira_project, notifier_config under user 1', () => {
    const db = seededDb();
    db.exec(readFileSync(join(MIGRATIONS, '0009_multiuser.sql'), 'utf8'));
    expect(db.prepare('SELECT user_id FROM notified_comments WHERE id = ?').get('c1')).toEqual({
      user_id: 1,
    });
    expect(db.prepare('SELECT user_id, comment_id FROM comment_reply').get()).toEqual({
      user_id: 1,
      comment_id: 'c1',
    });
    expect(db.prepare('SELECT user_id, site_id FROM jira_project').get()).toEqual({
      user_id: 1,
      site_id: 'cloud-1',
    });
    expect(db.prepare('SELECT user_id FROM notifier_config WHERE id = ?').get('n1')).toEqual({
      user_id: 1,
    });
  });

  it('keeps the bootstrap user as id=1 admin', () => {
    const db = seededDb();
    db.exec(readFileSync(join(MIGRATIONS, '0009_multiuser.sql'), 'utf8'));
    expect(db.prepare('SELECT id, role FROM app_user WHERE username = ?').get('admin')).toEqual({
      id: 1,
      role: 'admin',
    });
  });

  it('survives orphaned rows left by a foreign_keys-OFF delete (no crash)', () => {
    const db = seededDb();
    // Simulate the real failure: jira_site deleted via the sqlite3 CLI (FK OFF),
    // leaving an orphaned jira_project; and an orphaned comment_reply.
    db.pragma('foreign_keys = OFF');
    db.prepare("DELETE FROM jira_site WHERE id = 'cloud-1'").run();
    db.prepare(
      "INSERT INTO comment_reply (comment_id, body, sent_at, source) VALUES ('ghost', 'x', '', 'github')",
    ).run();
    db.pragma('foreign_keys = ON');

    // The migration must NOT throw on this dirty DB...
    expect(() =>
      db.exec(readFileSync(join(MIGRATIONS, '0009_multiuser.sql'), 'utf8')),
    ).not.toThrow();
    // ...orphans are dropped, valid rows survive.
    expect(db.prepare('SELECT COUNT(*) AS n FROM jira_project').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM comment_reply').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT comment_id FROM comment_reply').get()).toEqual({ comment_id: 'c1' });
  });

  it('applies via the real runMigrations path even with orphaned rows (FK off)', () => {
    // Faithfully reproduce a production upgrade: seed the pre-0009 schema, mark
    // 1..8 as already applied, dirty the DB with orphans (FK off, as the sqlite3
    // CLI does), then run the REAL migrator (0009 in a single transaction).
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    for (const f of PRE_0009) {
      db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
      db.prepare('INSERT INTO schema_version VALUES (?, ?)').run(parseInt(f.slice(0, 4), 10), 'x');
    }
    db.prepare(
      "INSERT INTO app_user (id, username, password_hash, created_at) VALUES (1,'me','h','')",
    ).run();
    db.pragma('foreign_keys = OFF');
    db.prepare(
      "INSERT INTO jira_project (site_id, project_key, project_name) VALUES ('ghost','G','G')",
    ).run();
    db.prepare(
      "INSERT INTO comment_reply (comment_id, body, sent_at, source) VALUES ('ghost','b','t','github')",
    ).run();
    db.pragma('foreign_keys = ON');

    expect(() => runMigrations(db)).not.toThrow();
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1); // restored
    expect(db.pragma('foreign_key_check')).toEqual([]); // orphans dropped, DB clean
    expect(
      (
        db.prepare('SELECT version FROM schema_version ORDER BY version').all() as {
          version: number;
        }[]
      ).map((r) => r.version),
    ).toContain(9);
  });

  it('lets two users share a jira cloud id (composite PK)', () => {
    const db = seededDb();
    db.exec(readFileSync(join(MIGRATIONS, '0009_multiuser.sql'), 'utf8'));
    // A second user connecting the SAME Atlassian org must not collide.
    expect(() =>
      db
        .prepare(
          `INSERT INTO jira_site (user_id, id, base_url, cloud_id, enabled, created_at, updated_at)
           VALUES (2, 'cloud-1', 'https://acme.atlassian.net', 'cloud-1', 1, '', '')`,
        )
        .run(),
    ).not.toThrow();
  });
});
