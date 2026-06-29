import type { Config } from '../config.js';

export interface DoctorCheck {
  name: 'config' | 'github' | 'smtp' | 'storage';
  ok: boolean;
  message?: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  allOk: boolean;
}

export interface DoctorDeps {
  makeOctokit: (token: string) => {
    rest: { users: { getAuthenticated: () => Promise<{ data: { login: string } }> } };
  };
  makeSmtp: (opts: Config['notifications'][number]['smtp'] & { from: string; to: string }) => {
    verify: () => Promise<void>;
  };
  openDb: (path: string) => {
    pragma: (s: string) => unknown;
    exec: (s: string) => void;
    prepare: (s: string) => { all: () => unknown[]; get: () => unknown; run: () => void };
  };
  dbPath: string;
}

export async function runDoctor(args: { config: Config; deps: DoctorDeps }): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [{ name: 'config', ok: true }];

  try {
    const client = args.deps.makeOctokit(args.config.sources.github.token);
    const me = await client.rest.users.getAuthenticated();
    checks.push({ name: 'github', ok: true, message: `Authenticated as ${me.data.login}` });
  } catch (err) {
    checks.push({
      name: 'github',
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  for (const n of args.config.notifications) {
    if (!n.enabled) continue;
    try {
      const smtp = args.deps.makeSmtp({ ...n.smtp, from: n.from, to: n.to });
      await smtp.verify();
      checks.push({ name: 'smtp', ok: true, message: `${n.smtp.host}:${n.smtp.port}` });
    } catch (err) {
      checks.push({
        name: 'smtp',
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    break;
  }

  try {
    const db = args.deps.openDb(args.deps.dbPath);
    db.pragma('user_version');
    checks.push({ name: 'storage', ok: true, message: args.deps.dbPath });
  } catch (err) {
    checks.push({
      name: 'storage',
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return { checks, allOk: checks.every((c) => c.ok) };
}
