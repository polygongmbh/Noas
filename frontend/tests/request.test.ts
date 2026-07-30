import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminRequest, request } from '../src/lib/request';

describe('request', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs JSON and returns the parsed response on success', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, value: 42 }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await request('/api/v1/auth/signin', { username: 'alice' });

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice' }),
    });
    expect(result).toEqual({ success: true, value: 42 });
  });

  it('throws the server error message on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Invalid password' }) })),
    );

    await expect(request('/api/v1/auth/signin', {})).rejects.toThrow('Invalid password');
  });

  it('falls back to a generic message when the error body is unparsable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => { throw new Error('bad json'); } })),
    );

    await expect(request('/api/v1/auth/signin', {})).rejects.toThrow('Request failed');
  });
});

describe('adminRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects without a signed-in session', async () => {
    await expect(
      adminRequest('/api/v1/admin/verify', {}, { username: null, passwordHash: null }),
    ).rejects.toThrow('Sign in before using admin tools.');
  });

  it('includes the signed-in credentials in the request body', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    vi.stubGlobal('fetch', fetchMock);

    await adminRequest(
      '/api/v1/admin/verify',
      { target_username: 'bob' },
      { username: 'alice', passwordHash: 'hash123' },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/admin/verify',
      expect.objectContaining({
        body: JSON.stringify({
          username: 'alice',
          password_hash: 'hash123',
          target_username: 'bob',
        }),
      }),
    );
  });
});
