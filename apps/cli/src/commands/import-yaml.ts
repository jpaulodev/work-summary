import { renameSync } from 'node:fs';
import { createSourceConfigRepo, createNotifierConfigRepo } from '@work-summary/config-db';
import type { SqliteDatabase } from '@work-summary/storage';
import { loadConfig } from '../config.js';

export interface ImportYamlResult {
  repos: number;
  notifiers: number;
  renamedTo: string;
}

/**
 * Read the Phase 1 YAML config and persist it into the DB-backed config tables,
 * then rename the file to <path>.imported so the DB becomes the source of truth.
 */
export function runImportYaml(opts: {
  db: SqliteDatabase;
  key: Buffer;
  configPath: string;
  env: NodeJS.ProcessEnv;
}): ImportYamlResult {
  const cfg = loadConfig(opts.configPath, opts.env);

  createSourceConfigRepo(opts.db, opts.key).putGithub({
    enabled: true,
    token: cfg.sources.github.token,
    repos: cfg.sources.github.repos,
    rules: cfg.sources.github.rules,
    filters: cfg.sources.github.filters,
  });

  const notifiers = createNotifierConfigRepo(opts.db, opts.key);
  for (const n of cfg.notifications) {
    notifiers.put(n.id, {
      enabled: n.enabled,
      host: n.smtp.host,
      port: n.smtp.port,
      secure: n.smtp.secure,
      from: n.from,
      to: n.to,
      subjectTemplate: n.subjectTemplate,
      user: n.smtp.user,
      pass: n.smtp.pass,
    });
  }

  const renamedTo = `${opts.configPath}.imported`;
  renameSync(opts.configPath, renamedTo);
  return { repos: cfg.sources.github.repos.length, notifiers: cfg.notifications.length, renamedTo };
}
