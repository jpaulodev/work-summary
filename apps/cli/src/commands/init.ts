import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const CONFIG_TEMPLATE = `# work-summary configuration
user:
  githubLogin: your-github-login

sources:
  github:
    token: \${GITHUB_TOKEN}
    repos:
      - org/repo-foo
      - org/repo-bar
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
  - id: primary-email
    type: smtp
    enabled: true
    smtp:
      host: smtp.gmail.com
      port: 587
      secure: false
      user: \${SMTP_USER}
      pass: \${SMTP_PASS}
    from: "Work Summary <me@example.com>"
    to: me@example.com
    subjectTemplate: "[work-summary] {{count}} new comments - {{date}}"

logging:
  level: info
  file: ~/.local/state/work-summary/scan.log
`;

export interface InitOptions {
  configPath: string;
  stateDir: string;
  force?: boolean;
}

export function runInit(opts: InitOptions): {
  written: boolean;
  configPath: string;
  stateDir: string;
} {
  if (existsSync(opts.configPath) && !opts.force) {
    throw new Error(`Config already exists at ${opts.configPath} (use --force to overwrite)`);
  }
  mkdirSync(dirname(opts.configPath), { recursive: true });
  mkdirSync(opts.stateDir, { recursive: true });
  writeFileSync(opts.configPath, CONFIG_TEMPLATE);
  return { written: true, configPath: opts.configPath, stateDir: opts.stateDir };
}
