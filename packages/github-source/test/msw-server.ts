import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import {
  prListFixture,
  prHeadCommitFixture,
  reviewsFixture,
  issueCommentsFixture,
  prReviewCommentsFixture,
} from './fixtures/prs.js';

export function buildServer() {
  return setupServer(
    http.get('https://api.github.com/repos/:owner/:repo/pulls', () =>
      HttpResponse.json(prListFixture),
    ),
    http.get('https://api.github.com/repos/:owner/:repo/commits/:sha', () =>
      HttpResponse.json(prHeadCommitFixture),
    ),
    http.get('https://api.github.com/repos/:owner/:repo/pulls/:number/reviews', () =>
      HttpResponse.json(reviewsFixture),
    ),
    http.get('https://api.github.com/repos/:owner/:repo/issues/:number/comments', () =>
      HttpResponse.json(issueCommentsFixture),
    ),
    http.get('https://api.github.com/repos/:owner/:repo/pulls/:number/comments', () =>
      HttpResponse.json(prReviewCommentsFixture),
    ),
    http.get('https://api.github.com/search/issues', ({ request }) => {
      const url = new URL(request.url);
      const q = url.searchParams.get('q') ?? '';
      if (!q.includes('mentions:me')) return HttpResponse.json({ total_count: 0, items: [] });
      return HttpResponse.json({
        total_count: 2,
        items: [
          {
            number: 7,
            html_url: 'https://github.com/org/r/pull/7',
            repository_url: 'https://api.github.com/repos/org/r',
            pull_request: {},
          },
          {
            number: 42,
            html_url: 'https://github.com/org/r/issues/42',
            repository_url: 'https://api.github.com/repos/org/r',
          },
        ],
      });
    }),
  );
}
