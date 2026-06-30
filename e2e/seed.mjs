// Seed a state DB with a known user and a sample pending comment for E2E.
// Usage: WS_DB=/path/state.db MASTER_PASSPHRASE=pw E2E_USER=me E2E_PASS=pw1234567 node seed.mjs
import { openDatabase, runMigrations } from '@work-summary/storage';
import { hashPassword } from '@work-summary/auth';

const dbPath = process.env.WS_DB ?? './e2e-state.db';
const user = process.env.E2E_USER ?? 'me';
const pass = process.env.E2E_PASS ?? 'pw1234567';

const db = openDatabase(dbPath);
runMigrations(db);

const exists = db.prepare('SELECT 1 FROM app_user WHERE id = 1').get();
if (!exists) {
  const hash = await hashPassword(pass);
  db.prepare(
    'INSERT INTO app_user (id, username, password_hash, created_at) VALUES (1, ?, ?, ?)',
  ).run(user, hash, new Date().toISOString());
}

db.prepare(
  `INSERT OR IGNORE INTO notified_comments
     (id, source, repo, container_type, container_number, comment_native_id, author_login, matched_rules, notified_at)
   VALUES (?, 'github', 'org/demo', 'pr', 12, 'c-demo', 'octocat', ?, ?)`,
).run('seed-1', JSON.stringify(['mentioned', 'assignee']), new Date().toISOString());

process.stdout.write(`Seeded ${dbPath} with user "${user}" and 1 pending comment\n`);
