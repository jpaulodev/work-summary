import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, ConfigError } from './config.js';

function writeTmp(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ws-conf-'));
  const path = join(dir, 'config.yaml');
  writeFileSync(path, yaml);
  return path;
}

const validYaml = `
user:
  githubLogin: me
sources:
  github:
    token: \${GH}
    repos: [org/a]
    rules:
      authorOfPrUnanswered: true
      mentioned: true
      repliedBeforeThenFollowup: true
      assignee: true
      changesRequested: true
    filters:
      excludeBots: true
      botWhitelist: []
scan:
  lookbackDays: 7
  concurrency: 3
notifications:
  - id: primary
    type: smtp
    enabled: true
    smtp:
      host: smtp.test
      port: 587
      secure: false
      user: \${SU}
      pass: \${SP}
    from: a@b
    to: c@d
    subjectTemplate: "[ws] {{count}} - {{date}}"
logging:
  level: info
  file: ~/.local/state/work-summary/scan.log
`;

describe('loadConfig', () => {
  it('parses valid yaml and interpolates env vars', () => {
    const p = writeTmp(validYaml);
    const cfg = loadConfig(p, { GH: 'tok', SU: 'u', SP: 'p' });
    expect(cfg.user.githubLogin).toBe('me');
    expect(cfg.sources.github.token).toBe('tok');
    expect(cfg.notifications[0]?.smtp.user).toBe('u');
  });

  it('throws ConfigError on missing required field', () => {
    const p = writeTmp('user:\n  githubLogin: me\n');
    expect(() => loadConfig(p, {})).toThrow(ConfigError);
  });

  it('throws ConfigError when env var unresolved', () => {
    const p = writeTmp(validYaml);
    expect(() => loadConfig(p, {})).toThrow(/GH/);
  });

  it('throws ConfigError on invalid YAML', () => {
    const p = writeTmp('this: is: not: yaml: ::');
    expect(() => loadConfig(p, {})).toThrow(ConfigError);
  });
});
