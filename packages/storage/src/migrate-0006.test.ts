import { describe, it, expect } from 'vitest';
import { openDatabase, runMigrations } from './index.js';

describe('migration 0006', () => {
  it('creates comment_reply and adds can_write + comment_url', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((t) => t.name);
    expect(tables).toContain('comment_reply');

    const sc = db.prepare('PRAGMA table_info(source_config)').all() as { name: string }[];
    expect(sc.find((c) => c.name === 'can_write')).toBeTruthy();
    const js = db.prepare('PRAGMA table_info(jira_site)').all() as { name: string }[];
    expect(js.find((c) => c.name === 'can_write')).toBeTruthy();
    const nc = db.prepare('PRAGMA table_info(notified_comments)').all() as { name: string }[];
    expect(nc.find((c) => c.name === 'comment_url')).toBeTruthy();
  });
});
