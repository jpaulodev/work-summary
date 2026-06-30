import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase, runMigrations } from './index.js';
import { JiraSiteRepository, JiraProjectRepository } from './jira-repo.js';
import type { SqliteDatabase } from './db.js';

let db: SqliteDatabase;
beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
});

describe('JiraSiteRepository', () => {
  it('inserts, lists and gets a site', () => {
    const repo = new JiraSiteRepository(db);
    repo.insert({
      id: 's1',
      baseUrl: 'https://acme.atlassian.net',
      cloudId: 'cloud-1',
      developerFieldId: null,
      enabled: true,
    });
    expect(repo.list()).toHaveLength(1);
    expect(repo.get('s1')?.baseUrl).toBe('https://acme.atlassian.net');
    expect(repo.get('s1')?.enabled).toBe(true);
  });

  it('updates and deletes', () => {
    const repo = new JiraSiteRepository(db);
    repo.insert({
      id: 's1',
      baseUrl: 'https://a.net',
      cloudId: 'cloud-1',
      developerFieldId: null,
      enabled: true,
    });
    const updated = repo.update('s1', { enabled: false, developerFieldId: 'customfield_1' });
    expect(updated.enabled).toBe(false);
    expect(updated.developerFieldId).toBe('customfield_1');
    repo.delete('s1');
    expect(repo.get('s1')).toBeNull();
  });
});

describe('JiraProjectRepository', () => {
  beforeEach(() => {
    new JiraSiteRepository(db).insert({
      id: 'site1',
      baseUrl: 'https://a.net',
      cloudId: 'cloud-1',
      developerFieldId: null,
      enabled: true,
    });
  });

  it('replaceForSite is transactional and replaces prior set', () => {
    const repo = new JiraProjectRepository(db);
    repo.replaceForSite('site1', [{ projectKey: 'WS', projectName: 'Work Summary' }]);
    repo.replaceForSite('site1', [
      { projectKey: 'WS', projectName: 'Work Summary' },
      { projectKey: 'OTHER', projectName: 'Other' },
    ]);
    expect(
      repo
        .listBySite('site1')
        .map((p) => p.projectKey)
        .sort(),
    ).toEqual(['OTHER', 'WS']);
  });

  it('cascades delete when the site is removed', () => {
    const projectRepo = new JiraProjectRepository(db);
    projectRepo.replaceForSite('site1', [{ projectKey: 'WS', projectName: 'Work' }]);
    new JiraSiteRepository(db).delete('site1');
    expect(projectRepo.listBySite('site1')).toHaveLength(0);
  });
});
