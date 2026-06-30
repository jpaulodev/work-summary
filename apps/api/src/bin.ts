#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, runMigrations } from '@work-summary/storage';
import { loadEnvFile } from './load-env.js';
import { buildServer } from './server.js';
import { bootstrapMasterSecret, hasMasterSecret, loadMasterKey } from './master-key.js';

// Load a .env file from the working directory before reading any config.
loadEnvFile();

function dbPath(): string {
  const stateDir =
    process.env.XDG_STATE_HOME && process.env.XDG_STATE_HOME.length > 0
      ? process.env.XDG_STATE_HOME
      : join(homedir(), '.local/state');
  return join(stateDir, 'work-summary', 'state.db');
}

function deriveSessionSecret(masterKey: Buffer): Buffer {
  return createHash('sha256').update(masterKey).update('ws-session').digest();
}

async function main(): Promise<void> {
  const passphrase = process.env.MASTER_PASSPHRASE;
  if (!passphrase) {
    process.stderr.write('MASTER_PASSPHRASE env var is required to start the API\n');
    process.exit(2);
  }

  const db = openDatabase(dbPath());
  const { applied } = runMigrations(db);
  if (applied.length > 0) {
    process.stdout.write(`applied database migrations: ${applied.join(', ')}\n`);
  }

  const masterKey = hasMasterSecret(db)
    ? await loadMasterKey(db, passphrase)
    : await bootstrapMasterSecret(db, passphrase);

  const app = await buildServer({
    db,
    masterKey,
    sessionSecret: deriveSessionSecret(masterKey),
    now: () => new Date(),
  });

  const port = Number(process.env.PORT ?? 3001);
  // Default to localhost-only. Set HOST=0.0.0.0 to serve other machines on the
  // network (the app requires login, so LAN exposure is the intended use there).
  const host = process.env.HOST && process.env.HOST.length > 0 ? process.env.HOST : '127.0.0.1';
  await app.listen({ port, host });
  process.stdout.write(`work-summary API listening on http://${host}:${port}\n`);

  const hasUser = db.prepare('SELECT 1 FROM app_user WHERE id = 1').get();
  if (!hasUser) {
    process.stdout.write(
      'No user yet. Bootstrap one:\n' +
        `  curl -X POST http://127.0.0.1:${port}/api/auth/bootstrap ` +
        `-H 'content-type: application/json' ` +
        `-d '{"username":"you","password":"a-strong-password"}'\n`,
    );
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
