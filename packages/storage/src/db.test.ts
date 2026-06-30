import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './db.js';

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('openDatabase', () => {
  it('opens an in-memory database', () => {
    const db = openDatabase(':memory:');
    expect(db.prepare('SELECT 1 AS x').get()).toEqual({ x: 1 });
    db.close();
  });

  it('creates the parent directory when it does not exist yet', () => {
    const base = mkdtempSync(join(tmpdir(), 'ws-db-'));
    dirs.push(base);
    const path = join(base, 'nested', 'state', 'state.db'); // none of these dirs exist
    expect(existsSync(join(base, 'nested'))).toBe(false);
    const db = openDatabase(path);
    expect(existsSync(path)).toBe(true);
    db.close();
  });
});
