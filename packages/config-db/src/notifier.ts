import { encryptSecret, decryptSecret } from '@work-summary/auth';
import type { SqliteDatabase } from '@work-summary/storage';

export type NotifierType = 'smtp' | 'slack' | 'teams';

export interface NotifierRecord {
  id: string;
  type: NotifierType;
  name: string;
  enabled: boolean;
  // SMTP-only fields (empty strings for webhook notifiers).
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
  webhookUrl: string;
}

export interface NotifierListItem extends NotifierRecord {
  hasSecret: boolean;
}

export interface NotifierInput {
  type?: NotifierType | undefined;
  name?: string | undefined;
  enabled?: boolean | undefined;
  host?: string | undefined;
  port?: number | undefined;
  secure?: boolean | undefined;
  from?: string | undefined;
  to?: string | undefined;
  subjectTemplate?: string | undefined;
  user?: string | undefined;
  pass?: string | undefined;
  webhookUrl?: string | undefined;
}

export interface NotifierConfigRepo {
  list(): NotifierListItem[];
  get(id: string): NotifierWithSecret | null;
  put(id: string, input: NotifierInput): void;
  delete(id: string): void;
}

interface ConfigJson {
  name?: string;
  host: string;
  port: number;
  secure: boolean;
  from: string;
  to: string;
  subjectTemplate: string;
}

interface Secret {
  user?: string;
  pass?: string;
  webhookUrl?: string;
}

function isNotifierType(t: string): t is NotifierType {
  return t === 'smtp' || t === 'slack' || t === 'teams';
}

export function createNotifierConfigRepo(
  db: SqliteDatabase,
  key: Buffer,
  userId: number,
): NotifierConfigRepo {
  const all = db.prepare(
    'SELECT id, type, enabled, config_json, secret_ciphertext FROM notifier_config WHERE user_id = ?',
  );
  const getOne = db.prepare(
    'SELECT id, type, enabled, config_json, secret_ciphertext, secret_nonce FROM notifier_config WHERE id = ? AND user_id = ?',
  );
  const upsert = db.prepare(
    `INSERT INTO notifier_config (id, user_id, type, enabled, config_json, secret_ciphertext, secret_nonce)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET type = excluded.type, enabled = excluded.enabled,
       config_json = excluded.config_json, secret_ciphertext = excluded.secret_ciphertext, secret_nonce = excluded.secret_nonce`,
  );
  const del = db.prepare('DELETE FROM notifier_config WHERE id = ? AND user_id = ?');

  const record = (id: string, type: string, enabled: number, c: ConfigJson): NotifierRecord => ({
    id,
    type: isNotifierType(type) ? type : 'smtp',
    name: c.name ?? id,
    enabled: Boolean(enabled),
    host: c.host,
    port: c.port,
    secure: c.secure,
    from: c.from,
    to: c.to,
    subjectTemplate: c.subjectTemplate,
  });

  const repo: NotifierConfigRepo = {
    list() {
      const rows = all.all(userId) as Array<{
        id: string;
        type: string;
        enabled: number;
        config_json: string;
        secret_ciphertext: string;
      }>;
      return rows.map((r) => ({
        ...record(r.id, r.type, r.enabled, JSON.parse(r.config_json) as ConfigJson),
        hasSecret: r.secret_ciphertext.length > 0,
      }));
    },
    get(id) {
      const r = getOne.get(id, userId) as
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
        ...record(r.id, r.type, r.enabled, c),
        user: s.user ?? '',
        pass: s.pass ?? '',
        webhookUrl: s.webhookUrl ?? '',
      };
    },
    put(id, input) {
      const existing = repo.get(id);
      const type = input.type ?? existing?.type ?? 'smtp';
      const cfg: ConfigJson = {
        name: input.name ?? existing?.name ?? id,
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
        webhookUrl: input.webhookUrl ?? existing?.webhookUrl ?? '',
      };
      const enc = encryptSecret(JSON.stringify(secret), key);
      const enabled = (input.enabled ?? existing?.enabled ?? true) ? 1 : 0;
      upsert.run(id, userId, type, enabled, JSON.stringify(cfg), enc.ciphertext, enc.nonce);
    },
    delete(id) {
      del.run(id, userId);
    },
  };
  return repo;
}
