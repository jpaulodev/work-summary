import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from './logger.js';

describe('createLogger', () => {
  it('writes JSON lines to file', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ws-log-')), 'scan.log');
    const log = createLogger({ level: 'info', file, jsonOnly: true });
    log.info({ a: 1 }, 'hello');
    await new Promise((r) => setTimeout(r, 50));
    const content = readFileSync(file, 'utf8');
    expect(content).toContain('"msg":"hello"');
    expect(content).toContain('"a":1');
  });

  it('tags every line with runId when provided', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ws-log-')), 'scan.log');
    const log = createLogger({ level: 'info', file, runId: 42, jsonOnly: true });
    log.info('hi');
    await new Promise((r) => setTimeout(r, 50));
    const content = readFileSync(file, 'utf8');
    expect(content).toContain('"runId":42');
  });
});
