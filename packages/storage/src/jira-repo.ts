import type { SqliteDatabase } from './db.js';

export interface JiraSiteRow {
  id: string;
  baseUrl: string;
  email: string;
  encryptedToken: string;
  tokenNonce: string;
  developerFieldId: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type JiraSiteInsert = Omit<JiraSiteRow, 'createdAt' | 'updatedAt'>;

export interface JiraSitePatch {
  baseUrl?: string | undefined;
  email?: string | undefined;
  encryptedToken?: string | undefined;
  tokenNonce?: string | undefined;
  developerFieldId?: string | null | undefined;
  enabled?: boolean | undefined;
}

interface RawSite {
  id: string;
  base_url: string;
  email: string;
  encrypted_token: string;
  token_nonce: string;
  developer_field_id: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export class JiraSiteRepository {
  constructor(private readonly db: SqliteDatabase) {}

  private parse(r: RawSite): JiraSiteRow {
    return {
      id: r.id,
      baseUrl: r.base_url,
      email: r.email,
      encryptedToken: r.encrypted_token,
      tokenNonce: r.token_nonce,
      developerFieldId: r.developer_field_id,
      enabled: r.enabled === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  list(): JiraSiteRow[] {
    return (this.db.prepare('SELECT * FROM jira_site ORDER BY base_url').all() as RawSite[]).map(
      (r) => this.parse(r),
    );
  }

  get(id: string): JiraSiteRow | null {
    const r = this.db.prepare('SELECT * FROM jira_site WHERE id = ?').get(id) as
      RawSite | undefined;
    return r ? this.parse(r) : null;
  }

  insert(row: JiraSiteInsert): JiraSiteRow {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO jira_site
          (id, base_url, email, encrypted_token, token_nonce, developer_field_id, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.baseUrl,
        row.email,
        row.encryptedToken,
        row.tokenNonce,
        row.developerFieldId,
        row.enabled ? 1 : 0,
        now,
        now,
      );
    return this.get(row.id) as JiraSiteRow;
  }

  update(id: string, patch: JiraSitePatch): JiraSiteRow {
    const cur = this.get(id);
    if (!cur) throw new Error(`Jira site ${id} not found`);
    const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    this.db
      .prepare(
        `UPDATE jira_site SET
          base_url = ?, email = ?, encrypted_token = ?, token_nonce = ?,
          developer_field_id = ?, enabled = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.baseUrl,
        next.email,
        next.encryptedToken,
        next.tokenNonce,
        next.developerFieldId,
        next.enabled ? 1 : 0,
        next.updatedAt,
        id,
      );
    return this.get(id) as JiraSiteRow;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM jira_site WHERE id = ?').run(id);
  }
}

export interface JiraProjectRow {
  id: number;
  siteId: string;
  projectKey: string;
  projectName: string;
}

interface RawProject {
  id: number;
  site_id: string;
  project_key: string;
  project_name: string;
}

export class JiraProjectRepository {
  constructor(private readonly db: SqliteDatabase) {}

  listBySite(siteId: string): JiraProjectRow[] {
    return (
      this.db
        .prepare('SELECT * FROM jira_project WHERE site_id = ? ORDER BY project_key')
        .all(siteId) as RawProject[]
    ).map((r) => ({
      id: r.id,
      siteId: r.site_id,
      projectKey: r.project_key,
      projectName: r.project_name,
    }));
  }

  replaceForSite(
    siteId: string,
    projects: { projectKey: string; projectName: string }[],
  ): JiraProjectRow[] {
    const tx = this.db.transaction((sid: string, projs: typeof projects) => {
      this.db.prepare('DELETE FROM jira_project WHERE site_id = ?').run(sid);
      const stmt = this.db.prepare(
        'INSERT INTO jira_project (site_id, project_key, project_name) VALUES (?, ?, ?)',
      );
      for (const p of projs) stmt.run(sid, p.projectKey, p.projectName);
    });
    tx(siteId, projects);
    return this.listBySite(siteId);
  }
}
