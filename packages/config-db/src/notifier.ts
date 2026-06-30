import { encryptSecret, decryptSecret } from '@work-summary/auth';
import type { SqliteDatabase } from '@work-summary/storage';

export interface NotifierRecord {
  id: string;
  type: 'smtp';
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  from: string;
  to: string;
  subjectTemplate: string;
}

export interface NotifierWithSecret extends NotifierRecord {
  user: string;
  pass: string;
}

export interface NotifierListItem extends NotifierRecord {
  hasSecret: boolean;
}

export interface NotifierInput {
  enabled?: boolean | undefined;
  host?: string | undefined;
  port?: number | undefined;
  secure?: boolean | undefined;
  from?: string | undefined;
  to?: string | undefined;
  subjectTemplate?: string | undefined;
  type?: 'smtp' | undefined;
  user?: string | undefined;
  pass?: string | undefined;
}

export interface NotifierConfigRepo {
  list(): NotifierListItem[];
  get(id: string): NotifierWithSecret | null;
  put(id: string, input: NotifierInput): void;
  delete(id: string): void;
}

interface ConfigJson {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  to: string;
  subjectTemplate: string;
}

interface Secret {
  user: string;
  pass: string;
}

export function createNotifierConfigRepo(db: SqliteDatabase, key: Buffer): NotifierConfigRepo {
  const all = db.prepare(
    'SELECT id, type, enabled, config_json, secret_ciphertext FROM notifier_config',
  );
  const getOne = db.prepare(
    'SELECT id, type, enabled, config_json, secret_ciphertext, secret_nonce FROM notifier_config WHERE id = ?',
  );
  const upsert = db.prepare(
    `INSERT INTO notifier_config (id, type, enabled, config_json, secret_ciphertext, secret_nonce)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET type = excluded.type, enabled = excluded.enabled,
       config_json = excluded.config_json, secret_ciphertext = excluded.secret_ciphertext, secret_nonce = excluded.secret_nonce`,
  );
  const del = db.prepare('DELETE FROM notifier_config WHERE id = ?');

  const repo: NotifierConfigRepo = {
    list() {
      const rows = all.all() as Array<{
        id: string;
        type: string;
        enabled: number;
        config_json: string;
        secret_ciphertext: string;
      }>;
      return rows.map((r) => {
        const c = JSON.parse(r.config_json) as ConfigJson;
        return {
          id: r.id,
          type: 'smtp',
          enabled: Boolean(r.enabled),
          ...c,
          hasSecret: r.secret_ciphertext.length > 0,
        };
      });
    },
    get(id) {
      const r = getOne.get(id) as
        | {
            id: string;
            type: string;
            enabled: number;
            config_json: string;
            secret_ciphertext: string;
            secret_nonce: string;
          }
        | undefined;
      if (!r) return null;
      const c = JSON.parse(r.config_json) as ConfigJson;
      const s = JSON.parse(decryptSecret(r.secret_ciphertext, r.secret_nonce, key)) as Secret;
      return {
        id: r.id,
        type: 'smtp',
        enabled: Boolean(r.enabled),
        ...c,
        user: s.user,
        pass: s.pass,
      };
    },
    put(id, input) {
      const existing = repo.get(id);
      const cfg: ConfigJson = {
        host: input.host ?? existing?.host ?? '',
        port: input.port ?? existing?.port ?? 587,
        secure: input.secure ?? existing?.secure ?? false,
        from: input.from ?? existing?.from ?? '',
        to: input.to ?? existing?.to ?? '',
        subjectTemplate:
          input.subjectTemplate ??
          existing?.subjectTemplate ??
          '[work-summary] {{count}} - {{date}}',
      };
      const secret: Secret = {
        user: input.user ?? existing?.user ?? '',
        pass: input.pass ?? existing?.pass ?? '',
      };
      const enc = encryptSecret(JSON.stringify(secret), key);
      const enabled = (input.enabled ?? existing?.enabled ?? true) ? 1 : 0;
      upsert.run(id, 'smtp', enabled, JSON.stringify(cfg), enc.ciphertext, enc.nonce);
    },
    delete(id) {
      del.run(id);
    },
  };
  return repo;
}
