import { createHmac, timingSafeEqual } from 'node:crypto';

function hmac(value: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function signSessionId(id: string, secret: Buffer): string {
  return `${id}.${hmac(id, secret)}`;
}

export function verifySessionId(token: string, secret: Buffer): string | null {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const id = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(id, secret);
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return id;
}
