import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadNoasVersion, normalizeVersionLabel } from '../src/lib/version';

describe('normalizeVersionLabel', () => {
  it('formats a semver-like version to major.minor', () => {
    expect(normalizeVersionLabel('1.6.0')).toBe('v1.6');
  });

  it('handles an already-prefixed version', () => {
    expect(normalizeVersionLabel('v2.3.1')).toBe('v2.3');
  });

  it('falls back to a placeholder when empty', () => {
    expect(normalizeVersionLabel('')).toBe('v—');
  });
});

describe('loadNoasVersion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses version, verification mode, and nip05 domain from the metadata endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          noas: {
            version: '1.6.0',
            email_verification_mode: 'required_nip05_domains',
            nip05_domain: 'Nodal.Tools',
          },
        }),
      })),
    );

    const result = await loadNoasVersion();

    expect(result).toEqual({
      versionLabel: 'v1.6',
      emailVerificationMode: 'required_nip05_domains',
      nip05Domain: 'nodal.tools',
      trustedAppOrigins: [],
    });
  });

  it('parses trusted app origins from the metadata endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          noas: {
            version: '1.7.0',
            trusted_app_origins: ['https://norc.nodal.tools', 'not-a-string' as unknown, 42],
          },
        }),
      })),
    );

    const result = await loadNoasVersion();

    expect(result?.trustedAppOrigins).toEqual(['https://norc.nodal.tools', 'not-a-string']);
  });

  it('returns null on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect(await loadNoasVersion()).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    expect(await loadNoasVersion()).toBeNull();
  });
});
