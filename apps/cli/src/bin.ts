#!/usr/bin/env node
import { Command } from 'commander';
import { runInit } from './commands/init.js';
import { runDoctor } from './commands/doctor.js';
import { runScan } from './commands/scan.js';
import { loadConfig, ConfigError } from './config.js';
import { createLogger } from './logger.js';
import { defaultConfigPath, defaultStateDir, defaultDbPath } from './paths.js';
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
      const cfg = loadConfig(opts.config, process.env);
      const logger = createLogger({
        level: opts.debug ? 'debug' : cfg.logging.level,
        file: cfg.logging.file,
        jsonOnly: opts.json,
      });
      const db = openDatabase(defaultDbPath());
      runMigrations(db);
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
          commentsRepo: createCommentsRepo(db),
          runsRepo: createRunsRepo(db, () => new Date()),
          watermarksRepo: createWatermarksRepo(db),
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

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(EXIT.UNEXPECTED);
});
