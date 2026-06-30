import { describe, it, expect, afterEach, vi } from 'vitest';
import { cookieSecure } from './cookies.js';

afterEach(() => vi.unstubAllEnvs());

describe('cookieSecure', () => {
  it('is false over http (so the session cookie is not dropped on a LAN/IP host)', () => {
    vi.stubEnv('PUBLIC_BASE_URL', 'http://192.168.1.50:3001');
    expect(cookieSecure()).toBe(false);
  });

  it('is true when served over https', () => {
    vi.stubEnv('PUBLIC_BASE_URL', 'https://work-summary.example.com');
    expect(cookieSecure()).toBe(true);
  });

  it('defaults to false when PUBLIC_BASE_URL is unset', () => {
    vi.stubEnv('PUBLIC_BASE_URL', '');
    expect(cookieSecure()).toBe(false);
  });

  it('honors an explicit COOKIE_SECURE override', () => {
    vi.stubEnv('PUBLIC_BASE_URL', 'http://localhost:3001');
    vi.stubEnv('COOKIE_SECURE', 'true');
    expect(cookieSecure()).toBe(true);
    vi.stubEnv('PUBLIC_BASE_URL', 'https://example.com');
    vi.stubEnv('COOKIE_SECURE', 'false');
    expect(cookieSecure()).toBe(false);
  });
});
