// Ported from src/public/app.js (persistAuthSession/readAuthSession/clearAuthSession)
// and src/public/verify.html's equivalent copy — both used the same storage key and
// JSON shape, so this is a straight de-duplication, not a behavior change.

const AUTH_SESSION_KEY = 'noas_auth_session_v1';

export interface AuthSession {
  username: string;
  password: string;
  password_hash: string;
}

export function persistAuthSession({
  username,
  password,
  passwordHash,
}: {
  username?: string;
  password?: string;
  passwordHash?: string;
}): void {
  try {
    window.sessionStorage.setItem(
      AUTH_SESSION_KEY,
      JSON.stringify({
        username: String(username || '').trim().toLowerCase(),
        password: String(password || ''),
        password_hash: String(passwordHash || '').trim().toLowerCase(),
      }),
    );
  } catch {
    // Non-blocking fallback.
  }
}

export function readAuthSession(): AuthSession | null {
  try {
    const raw = window.sessionStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      username: String(parsed.username || '').trim().toLowerCase(),
      password: String(parsed.password || ''),
      password_hash: String(parsed.password_hash || '').trim().toLowerCase(),
    };
  } catch {
    return null;
  }
}

export function clearAuthSession(): void {
  try {
    window.sessionStorage.removeItem(AUTH_SESSION_KEY);
  } catch {
    // Non-blocking fallback.
  }
}
