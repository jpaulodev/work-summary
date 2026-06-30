import { describe, it, expect } from 'vitest';
import { openDatabase, runMigrations } from './index.js';

describe('migration 0004', () => {
  it('creates jira_site and jira_project and adds issue_key', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((t) => t.name);
    expect(tables).toContain('jira_site');
    expect(tables).toContain('jira_project');
    const cols = db.prepare('PRAGMA table_info(notified_comments)').all() as { name: string }[];
    expect(cols.find((c) => c.name === 'issue_key')).toBeTruthy();
  });
});
