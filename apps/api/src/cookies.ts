/**
 * Whether session / OAuth-state cookies should carry the `Secure` attribute.
 *
 * A `Secure` cookie is dropped by browsers over plain HTTP — except on
 * `localhost` / `127.0.0.1`, which are treated as secure contexts. So forcing
 * `Secure` (the old `NODE_ENV === 'production'` rule) silently breaks login for
 * a self-hosted deployment accessed over http on a LAN IP or hostname: the
 * cookie is never stored, every request is unauthenticated.
 *
 * Derive it from how the app is actually served: `Secure` only when the public
 * URL is HTTPS. An explicit `COOKIE_SECURE=true|false` overrides (e.g. behind a
 * TLS-terminating proxy where the public URL is https but the app speaks http).
 */
export function cookieSecure(): boolean {
  const override = process.env.COOKIE_SECURE;
  if (override === 'true') return true;
  if (override === 'false') return false;
  return (process.env.PUBLIC_BASE_URL ?? '').startsWith('https://');
}
