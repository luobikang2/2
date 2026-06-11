// Authentication for the admin panel.
// Password may be stored in (priority order): D1 database -> KV namespace -> env var.
// The session token is an HMAC-signed value stored in an HttpOnly cookie.

const COOKIE_NAME = 'bjh_session';
const DEFAULT_PASSWORD = 'admin';

/**
 * Resolve the effective admin password from D1, KV, then env.
 * @param {Record<string, any>} env
 */
export async function resolvePassword(env) {
  // D1: expects a table `settings(key TEXT PRIMARY KEY, value TEXT)`.
  if (env.DB && typeof env.DB.prepare === 'function') {
    try {
      const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
        .bind('password')
        .first();
      if (row && row.value) return String(row.value);
    } catch {
      // table may not exist yet; fall through to other sources
    }
  }
  // KV: key `password`.
  if (env.KV && typeof env.KV.get === 'function') {
    try {
      const v = await env.KV.get('password');
      if (v) return v;
    } catch {
      /* ignore */
    }
  }
  return env.PASSWORD || DEFAULT_PASSWORD;
}

/**
 * Persist a new password to D1 (preferred) or KV if available.
 * Returns the storage backend used, or null if only env is available.
 */
export async function savePassword(env, password) {
  if (env.DB && typeof env.DB.prepare === 'function') {
    try {
      await env.DB.prepare(
        'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)',
      ).run();
      await env.DB.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
        .bind('password', password)
        .run();
      return 'D1';
    } catch {
      /* fall through */
    }
  }
  if (env.KV && typeof env.KV.put === 'function') {
    try {
      await env.KV.put('password', password);
      return 'KV';
    } catch {
      /* fall through */
    }
  }
  return null;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function tokenSecret(env, password) {
  return `${env.UUID || ''}:${password}:bjh`;
}

/**
 * Create a signed session token valid for `ttl` ms (default 7 days).
 */
export async function createToken(env, password, ttl = 7 * 24 * 3600 * 1000) {
  const exp = Date.now() + ttl;
  const payload = `${exp}`;
  const sig = await hmac(tokenSecret(env, password), payload);
  return `${payload}.${sig}`;
}

export async function verifyToken(env, token) {
  if (!token || !token.includes('.')) return false;
  const password = await resolvePassword(env);
  const [payload, sig] = token.split('.');
  const exp = Number(payload);
  if (!exp || exp < Date.now()) return false;
  const expected = await hmac(tokenSecret(env, password), payload);
  return timingSafeEqual(sig, expected);
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function getCookie(request, name = COOKIE_NAME) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function sessionCookie(token, maxAgeSec = 7 * 24 * 3600) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`;
}

export function clearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function isAuthed(request, env) {
  const token = getCookie(request);
  return verifyToken(env, token);
}
