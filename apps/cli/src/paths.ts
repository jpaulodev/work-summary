import { homedir } from 'node:os';
import { join } from 'node:path';

function xdg(envVar: string, fallback: string): string {
  const v = process.env[envVar];
  if (v && v.length > 0) return v;
  return join(homedir(), fallback);
}

export function defaultConfigPath(): string {
  return join(xdg('XDG_CONFIG_HOME', '.config'), 'work-summary', 'config.yaml');
}

export function defaultStateDir(): string {
  return join(xdg('XDG_STATE_HOME', '.local/state'), 'work-summary');
}

export function defaultDbPath(): string {
  return join(defaultStateDir(), 'state.db');
}
