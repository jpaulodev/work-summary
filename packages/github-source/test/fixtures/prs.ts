export const prListFixture = [
  {
    number: 7,
    title: 'feat: add x',
    html_url: 'https://github.com/org/r/pull/7',
    user: { login: 'me', type: 'User' },
    assignees: [{ login: 'jane' }],
    head: { sha: 'abc' },
  },
];

export const prHeadCommitFixture = {
  sha: 'abc',
  commit: { author: { date: '2026-06-01T09:00:00Z' } },
};

export const reviewsFixture = [
  {
    id: 1,
    state: 'CHANGES_REQUESTED',
    user: { login: 'alice', type: 'User' },
    submitted_at: '2026-06-01T10:00:00Z',
  },
  {
    id: 2,
    state: 'COMMENTED',
    user: { login: 'bob', type: 'User' },
    submitted_at: '2026-06-01T11:00:00Z',
  },
];

export const issueCommentsFixture = [
  {
    id: 100,
    body: 'please review',
    html_url: 'https://gh/c/100',
    user: { login: 'alice', type: 'User' },
    created_at: '2026-06-01T10:30:00Z',
  },
];

export const prReviewCommentsFixture = [
  {
    id: 200,
    body: 'nit: rename',
    html_url: 'https://gh/c/200',
    user: { login: 'bob', type: 'User' },
    created_at: '2026-06-01T11:30:00Z',
  },
];
