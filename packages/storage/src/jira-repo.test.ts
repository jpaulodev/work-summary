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
    const repo = new JiraSiteRepository(db, 1);
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
    const repo = new JiraSiteRepository(db, 1);
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
    new JiraSiteRepository(db, 1).insert({
      id: 'site1',
      baseUrl: 'https://a.net',
      cloudId: 'cloud-1',
      developerFieldId: null,
      enabled: true,
    });
  });

  it('replaceForSite is transactional and replaces prior set', () => {
    const repo = new JiraProjectRepository(db, 1);
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
    const projectRepo = new JiraProjectRepository(db, 1);
    projectRepo.replaceForSite('site1', [{ projectKey: 'WS', projectName: 'Work' }]);
    new JiraSiteRepository(db, 1).delete('site1');
    expect(projectRepo.listBySite('site1')).toHaveLength(0);
  });

  it('isolates projects per user even when two users share a cloud id', () => {
    // user 1's site 'site1' already exists (beforeEach). Add user 2's site with
    // the SAME id (the Atlassian cloud id, shared across an org).
    new JiraSiteRepository(db, 2).insert({
      id: 'site1',
      baseUrl: 'https://a.net',
      cloudId: 'cloud-1',
      developerFieldId: null,
      enabled: true,
    });
    new JiraProjectRepository(db, 1).replaceForSite('site1', [
      { projectKey: 'SECRET', projectName: 'Admin only' },
    ]);
    new JiraProjectRepository(db, 2).replaceForSite('site1', [
      { projectKey: 'MINE', projectName: 'Member' },
    ]);
    expect(new JiraProjectRepository(db, 1).listBySite('site1').map((p) => p.projectKey)).toEqual([
      'SECRET',
    ]);
    expect(new JiraProjectRepository(db, 2).listBySite('site1').map((p) => p.projectKey)).toEqual([
      'MINE',
    ]);
  });
});
