import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import smtpTester from 'smtp-tester';
import { SmtpNotifier } from './smtp.js';
import type { PendingComment } from '@work-summary/core';

const PORT = 4025;
let mailServer: ReturnType<typeof smtpTester.init>;

beforeAll(() => {
  mailServer = smtpTester.init(PORT);
});

afterAll(() => {
  mailServer.stop(() => undefined);
});

function sampleComment(): PendingComment {
  return {
    id: 'x',
    source: 'github',
    repo: 'org/a',
    containerType: 'pr',
    containerNumber: 1,
    containerTitle: 'feat',
    containerUrl: 'https://gh/pr/1',
    commentId: 'c1',
    commentUrl: 'https://gh/c1',
    author: { login: 'alice', isBot: false },
    body: 'please review',
    createdAt: '2026-06-01T10:00:00Z',
    matchedRules: ['mentioned'],
  };
}

describe('SmtpNotifier (integration via smtp-tester)', () => {
  it('sends an email with subject, html and text bodies', async () => {
    const n = new SmtpNotifier({
      host: '127.0.0.1',
      port: PORT,
      secure: false,
      user: '',
      pass: '',
      from: 'sender@test',
      to: 'me@test',
    });

    const received = new Promise<{ subject: string; html: string; text: string }>((resolve) => {
      mailServer.bind((_addr, _id, email) => {
        const e = email as unknown as {
          headers: { subject: string };
          html: string;
          body: string;
        };
        resolve({ subject: e.headers.subject, html: e.html, text: e.body });
      });
    });

    await n.send({
      subject: '[work-summary] 1 new',
      comments: [sampleComment()],
      generatedAt: '2026-06-01T12:00:00Z',
    });

    const email = await received;
    expect(email.subject).toBe('[work-summary] 1 new');
    expect(email.html).toContain('org/a');
    expect(email.html).toContain('please review');
    expect(email.text).toContain('org/a');
  }, 15000);

  it('throws SmtpError when host unreachable', async () => {
    const n = new SmtpNotifier({
      host: '127.0.0.1',
      port: 1,
      secure: false,
      user: '',
      pass: '',
      from: 'a@b',
      to: 'c@d',
    });
    await expect(
      n.send({ subject: 's', comments: [], generatedAt: '2026-06-01T12:00:00Z' }),
    ).rejects.toMatchObject({ name: 'SmtpError' });
  }, 15000);
});
