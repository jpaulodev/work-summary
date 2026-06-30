#!/usr/bin/env node
import { Command } from 'commander';
import { loadEnvFile } from './load-env.js';
import { runInit } from './commands/init.js';
import { runDoctor } from './commands/doctor.js';
import { runScan } from './commands/scan.js';
import { loadConfig, ConfigError, type Config } from './config.js';
import { loadMasterKey, hasDbConfig, loadConfigFromDb } from './config-db-loader.js';
import { runImportYaml } from './commands/import-yaml.js';
import { bootstrapMasterKey } from './config-db-loader.js';
import { createLogger } from './logger.js';
import { defaultConfigPath, defaultStateDir, defaultDbPath } from './paths.js';
import type { SqliteDatabase } from '@work-summary/storage';
import { createOctokit, GithubSource } from '@work-summary/github-source';
import { SmtpNotifier } from '@work-summary/notifiers';
import {
  openDatabase,
  runMigrations,
  createCommentsRepo,
  createRunsRepo,
  createWatermarksRepo,
} from '@work-summary/storage';
import { EXIT } from './exit-codes.js';

// Load a .env file from the working directory before any command reads config.
loadEnvFile();

const program = new Command();
program
  .name('work-summary')
  .description('Centralize pending PR/issue comments awaiting your response')
  .version('0.1.0');

program
  .command('init')
  .option('-c, --config <path>', 'config path', defaultConfigPath())
  .option('--force', 'overwrite existing config', false)
  .action((opts: { config: string; force: boolean }) => {
    try {
      const r = runInit({
        configPath: opts.config,
        stateDir: defaultStateDir(),
        force: opts.force,
      });
      process.stdout.write(
        `OK Wrote config to ${r.configPath}\nOK Created state dir at ${r.stateDir}\n`,
      );
      process.exit(EXIT.OK);
    } catch (err) {
      process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(EXIT.UNEXPECTED);
    }
  });

program
  .command('doctor')
  .option('-c, --config <path>', 'config path', defaultConfigPath())
  .action(async (opts: { config: string }) => {
    try {
      const cfg = loadConfig(opts.config, process.env);
      const r = await runDoctor({
        config: cfg,
        deps: {
          makeOctokit: (token) => createOctokit({ token }),
          makeSmtp: (smtpOpts) => new SmtpNotifier(smtpOpts),
          openDb: (p) => openDatabase(p),
          dbPath: defaultDbPath(),
        },
      });
      for (const c of r.checks)
        process.stdout.write(
          `${c.ok ? 'OK' : 'FAIL'} ${c.name}${c.message ? ': ' + c.message : ''}\n`,
        );
      process.exit(r.allOk ? EXIT.OK : EXIT.AUTH);
    } catch (err) {
      if (err instanceof ConfigError) {
        process.stderr.write(`config error: ${err.message}\n`);
        process.exit(EXIT.CONFIG);
      }
      process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(EXIT.UNEXPECTED);
    }
  });

program
  .command('scan', { isDefault: true })
  .option('-c, --config <path>', 'config path', defaultConfigPath())
  .option('--dry-run', 'do not send or mark notified', false)
  .option('--json', 'log JSON only (no pretty)', false)
  .option('--debug', 'verbose debug logging', false)
  .action(async (opts: { config: string; dryRun: boolean; json: boolean; debug: boolean }) => {
    try {
      const db = openDatabase(defaultDbPath());
      runMigrations(db);
      const cfg = await resolveConfig(db, opts.config);
      const logger = createLogger({
        level: opts.debug ? 'debug' : cfg.logging.level,
        file: cfg.logging.file,
        jsonOnly: opts.json,
      });
      const client = createOctokit({ token: cfg.sources.github.token });
      const source = new GithubSource(client);
      const notif = cfg.notifications.find((n) => n.enabled);
      if (!notif) {
        process.stderr.write('No enabled notifier in config\n');
        process.exit(EXIT.CONFIG);
      }
      const notifier = new SmtpNotifier({ ...notif.smtp, from: notif.from, to: notif.to });
      const r = await runScan({
        config: cfg,
        deps: {
          db,
          commentsRepo: createCommentsRepo(db, 1),
          runsRepo: createRunsRepo(db, 1, () => new Date()),
          watermarksRepo: createWatermarksRepo(db, 1),
          source,
          notifier,
          logger,
        },
        dryRun: opts.dryRun,
        now: () => new Date(),
      });
      process.exit(r.exitCode);
    } catch (err) {
      if (err instanceof ConfigError) {
        process.stderr.write(`config error: ${err.message}\n`);
        process.exit(EXIT.CONFIG);
      }
      process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(EXIT.UNEXPECTED);
    }
  });

program
  .command('import-yaml')
  .description('Import an existing YAML config into the DB (requires MASTER_PASSPHRASE)')
  .option('-c, --config <path>', 'config path', defaultConfigPath())
  .action(async (opts: { config: string }) => {
    try {
      const passphrase = process.env.MASTER_PASSPHRASE;
      if (!passphrase) {
        process.stderr.write('MASTER_PASSPHRASE is required for import-yaml\n');
        process.exit(EXIT.CONFIG);
      }
      const db = openDatabase(defaultDbPath());
      runMigrations(db);
      const key =
        (await loadMasterKey(db, passphrase)) ?? (await bootstrapMasterKey(db, passphrase));
      const res = runImportYaml({ db, key, configPath: opts.config, env: process.env });
      process.stdout.write(
        `OK Imported ${res.repos} repo(s) and ${res.notifiers} notifier(s)\n` +
          `OK Renamed ${opts.config} -> ${res.renamedTo}\n`,
      );
      process.exit(EXIT.OK);
    } catch (err) {
      if (err instanceof ConfigError) {
        process.stderr.write(`config error: ${err.message}\n`);
        process.exit(EXIT.CONFIG);
      }
      process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(EXIT.UNEXPECTED);
    }
  });

/**
 * Resolve the run config: prefer DB-backed config when MASTER_PASSPHRASE is set
 * and the DB holds a github source; otherwise fall back to the Phase 1 YAML file.
 */
async function resolveConfig(db: SqliteDatabase, configPath: string): Promise<Config> {
  const passphrase = process.env.MASTER_PASSPHRASE;
  if (passphrase && hasDbConfig(db)) {
    const key = await loadMasterKey(db, passphrase);
    if (key) {
      return loadConfigFromDb(db, key, process.env.GITHUB_LOGIN ?? '');
    }
  }
  return loadConfig(configPath, process.env);
}

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(EXIT.UNEXPECTED);
});
