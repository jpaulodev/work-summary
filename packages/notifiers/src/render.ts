import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Eta } from 'eta';
import type { NotificationPayload } from './types.js';
import type { PendingComment } from '@work-summary/core';

const BODY_LIMIT = 280;

function templatePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, 'templates', 'digest.eta'),
    join(here, '..', 'src', 'templates', 'digest.eta'),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error('digest.eta not found');
}

interface ContainerGroup {
  number: number;
  title: string;
  url: string;
  comments: Array<{
    author: string;
    createdAt: string;
    bodyPreview: string;
    url: string;
    matchedRules: string[];
  }>;
}

interface RepoGroup {
  repo: string;
  containers: ContainerGroup[];
}

function truncate(s: string): string {
  if (s.length <= BODY_LIMIT) return s;
  return s.slice(0, BODY_LIMIT) + '...';
}

function group(comments: PendingComment[]): RepoGroup[] {
  // Key containers by type AND number: GitHub PRs and issues share one numbering
  // space, so issue #42 and PR #42 in the same repo must not be merged.
  const byRepo = new Map<string, Map<string, ContainerGroup>>();
  const sorted = [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const c of sorted) {
    let repo = byRepo.get(c.repo);
    if (!repo) {
      repo = new Map();
      byRepo.set(c.repo, repo);
    }
    const containerKey = `${c.containerType}:${c.containerNumber}`;
    let container = repo.get(containerKey);
    if (!container) {
      container = {
        number: c.containerNumber,
        title: c.containerTitle,
        url: c.containerUrl,
        comments: [],
      };
      repo.set(containerKey, container);
    }
    container.comments.push({
      author: c.author.login,
      createdAt: c.createdAt,
      bodyPreview: truncate(c.body),
      url: c.commentUrl,
      matchedRules: c.matchedRules,
    });
  }
  return [...byRepo.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([repo, containers]) => ({
      repo,
      containers: [...containers.values()].sort((a, b) => a.number - b.number),
    }));
}

function renderText(payload: NotificationPayload, groups: RepoGroup[]): string {
  if (groups.length === 0) return `${payload.subject}\n\nNo new comments since last run.\n`;
  const lines: string[] = [payload.subject, `Generated at ${payload.generatedAt}`, ''];
  for (const g of groups) {
    lines.push(`== ${g.repo} ==`);
    for (const c of g.containers) {
      lines.push(`  #${c.number} ${c.title}  (${c.url})`);
      for (const cm of c.comments) {
        lines.push(`    @${cm.author} [${cm.matchedRules.join(',')}] ${cm.createdAt}`);
        lines.push(`      ${cm.bodyPreview}`);
        lines.push(`      ${cm.url}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

const eta = new Eta({ autoEscape: true });

export function renderDigest(payload: NotificationPayload): { html: string; text: string } {
  const groups = group(payload.comments);
  const tpl = readFileSync(templatePath(), 'utf8');
  const html = eta.renderString(tpl, {
    subject: payload.subject,
    generatedAt: payload.generatedAt,
    groups,
  });
  const text = renderText(payload, groups);
  return { html, text };
}
