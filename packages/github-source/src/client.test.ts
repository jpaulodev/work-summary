import { describe, it, expect } from 'vitest';
import { createOctokit } from './client.js';

describe('createOctokit', () => {
  it('returns an object with .request and .rest', () => {
    const o = createOctokit({ token: 'fake' });
    expect(typeof o.request).toBe('function');
    expect(typeof o.rest.repos.get).toBe('function');
  });

  it('sets the user agent', () => {
    const o = createOctokit({ token: 'fake', userAgent: 'work-summary-test/0.1' });
    expect(
      (
        o as unknown as {
          request: { endpoint: { DEFAULTS: { headers: Record<string, string> } } };
        }
      ).request.endpoint.DEFAULTS.headers['user-agent'],
    ).toContain('work-summary-test/0.1');
  });
});
