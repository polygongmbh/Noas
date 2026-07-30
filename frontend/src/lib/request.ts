// Ported from src/public/app.js's request()/adminRequest(). adminRequest()
// originally reached into a page-global `state` object for the signed-in
// username/passwordHash; here they're passed in explicitly since each Svelte
// page owns its own reactive session state instead of sharing one global.

export async function request<T = unknown>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data as { error?: string })?.error || 'Request failed';
    throw new Error(message);
  }
  return data as T;
}

export async function adminRequest<T = unknown>(
  path: string,
  payload: Record<string, unknown>,
  credentials: { username?: string | null; passwordHash?: string | null },
): Promise<T> {
  if (!credentials.username || !credentials.passwordHash) {
    throw new Error('Sign in before using admin tools.');
  }
  return request<T>(path, {
    username: credentials.username,
    password_hash: credentials.passwordHash,
    ...payload,
  });
}
