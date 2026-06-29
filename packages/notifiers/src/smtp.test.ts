import { describe, it, expect } from 'vitest';
import { SmtpNotifier } from './smtp.js';

describe('SmtpNotifier', () => {
  it('exposes id "smtp"', () => {
    const n = new SmtpNotifier({
      host: 'localhost',
      port: 25,
      secure: false,
      user: 'u',
      pass: 'p',
      from: 'a@b',
      to: 'c@d',
    });
    expect(n.id).toBe('smtp');
  });
});
