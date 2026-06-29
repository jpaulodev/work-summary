import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

const RulesSchema = z.object({
  authorOfPrUnanswered: z.boolean(),
  mentioned: z.boolean(),
  repliedBeforeThenFollowup: z.boolean(),
  assignee: z.boolean(),
  changesRequested: z.boolean(),
});

const FiltersSchema = z.object({
  excludeBots: z.boolean(),
  botWhitelist: z.array(z.string()),
});

const SmtpSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive(),
  secure: z.boolean(),
  user: z.string(),
  pass: z.string(),
});

const NotificationSchema = z.object({
  id: z.string().min(1),
  type: z.literal('smtp'),
  enabled: z.boolean(),
  smtp: SmtpSchema,
  from: z.string().min(1),
  to: z.string().min(1),
  subjectTemplate: z.string().min(1),
});

const ConfigSchema = z.object({
  user: z.object({ githubLogin: z.string().min(1) }),
  sources: z.object({
    github: z.object({
      token: z.string().min(1),
      repos: z.array(z.string().regex(/^[^/]+\/[^/]+$/)).min(1),
      rules: RulesSchema,
      filters: FiltersSchema,
    }),
  }),
  scan: z.object({
    lookbackDays: z.number().int().positive(),
    concurrency: z.number().int().positive(),
  }),
  notifications: z.array(NotificationSchema).min(1),
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']),
    file: z.string().min(1),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

const ENV_RE = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

function interpolate(raw: string, env: NodeJS.ProcessEnv): string {
  const missing: string[] = [];
  const out = raw.replace(ENV_RE, (_, name: string) => {
    const v = env[name];
    if (v === undefined) {
      missing.push(name);
      return '';
    }
    return v;
  });
  if (missing.length > 0) {
    throw new ConfigError(`Unresolved environment variables: ${[...new Set(missing)].join(', ')}`);
  }
  return out;
}

export function loadConfig(path: string, env: NodeJS.ProcessEnv): Config {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new ConfigError(
      `Cannot read config at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const interpolated = interpolate(raw, env);
  let parsed: unknown;
  try {
    parsed = parseYaml(interpolated);
  } catch (err) {
    throw new ConfigError(
      `Invalid YAML in ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError(
      `Invalid config: ${result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return result.data;
}
