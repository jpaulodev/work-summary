import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from './init.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ws-init-'));
});

describe('runInit', () => {
  it('creates config file and state dir on fresh system', () => {
    const cfg = join(tmp, 'config.yaml');
    const state = join(tmp, 'state');
    const res = runInit({ configPath: cfg, stateDir: state });
    expect(res.written).toBe(true);
    expect(existsSync(cfg)).toBe(true);
    expect(existsSync(state)).toBe(true);
    expect(readFileSync(cfg, 'utf8')).toContain('githubLogin');
  });

  it('throws when config exists and force=false', () => {
    const cfg = join(tmp, 'config.yaml');
    const state = join(tmp, 'state');
    runInit({ configPath: cfg, stateDir: state });
    expect(() => runInit({ configPath: cfg, stateDir: state })).toThrow(/already exists/);
  });

  it('overwrites when force=true', () => {
    const cfg = join(tmp, 'config.yaml');
    const state = join(tmp, 'state');
    runInit({ configPath: cfg, stateDir: state });
    const res = runInit({ configPath: cfg, stateDir: state, force: true });
    expect(res.written).toBe(true);
  });
});
