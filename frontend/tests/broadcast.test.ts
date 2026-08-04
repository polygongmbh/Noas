import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTrustedCredentialOrigin, notifyOpenerAndClose, parseOrigin } from '../src/lib/broadcast';

describe('parseOrigin', () => {
  it('resolves an absolute URL to its origin', () => {
    expect(parseOrigin('https://norc.nodal.tools/auth/sign-in')).toBe('https://norc.nodal.tools');
  });

  it('resolves a relative path against window.location.origin', () => {
    expect(parseOrigin('/auth/sign-in')).toBe(window.location.origin);
  });

  it('returns null for an unparsable value', () => {
    // A bare string with a space is not resolvable by the URL constructor even
    // with a base, since "not a url" contains characters the WHATWG URL parser
    // treats as invalid in this position.
    expect(parseOrigin('http://')).toBeNull();
  });
});

describe('notifyOpenerAndClose', () => {
  const originalOpener = window.opener;
  const originalClose = window.close;

  afterEach(() => {
    Object.defineProperty(window, 'opener', { value: originalOpener, configurable: true });
    window.close = originalClose;
  });

  it('returns false and does not throw when there is no opener', () => {
    Object.defineProperty(window, 'opener', { value: null, configurable: true });
    expect(notifyOpenerAndClose('https://norc.nodal.tools/auth/sign-in')).toBe(false);
  });

  it('posts a message to the opener at the destination origin and closes the window', () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, 'opener', { value: { postMessage }, configurable: true });
    const close = vi.fn();
    window.close = close;

    const result = notifyOpenerAndClose('https://norc.nodal.tools/auth/sign-in');

    expect(result).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(
      { source: 'noas', type: 'auth-complete', destination: 'https://norc.nodal.tools/auth/sign-in' },
      'https://norc.nodal.tools',
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does not post to an untrusted/unparsable destination', () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, 'opener', { value: { postMessage }, configurable: true });

    const result = notifyOpenerAndClose('http://');

    expect(result).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('returns false if postMessage throws (e.g. cross-origin opener access denied)', () => {
    const postMessage = vi.fn(() => {
      throw new Error('blocked');
    });
    Object.defineProperty(window, 'opener', { value: { postMessage }, configurable: true });

    expect(notifyOpenerAndClose('https://norc.nodal.tools/auth/sign-in')).toBe(false);
  });

  it('includes credentials in the message when the caller supplies them', () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, 'opener', { value: { postMessage }, configurable: true });
    window.close = vi.fn();
    const credentials = { username: 'alice', publicKeyHex: 'pub', secretKeyHex: 'sec' };

    notifyOpenerAndClose('https://norc.nodal.tools/auth/sign-in', credentials);

    expect(postMessage).toHaveBeenCalledWith(
      { source: 'noas', type: 'auth-complete', destination: 'https://norc.nodal.tools/auth/sign-in', credentials },
      'https://norc.nodal.tools',
    );
  });

  it('omits credentials from the message when the caller does not supply them', () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, 'opener', { value: { postMessage }, configurable: true });
    window.close = vi.fn();

    notifyOpenerAndClose('https://norc.nodal.tools/auth/sign-in');

    const [message] = postMessage.mock.calls[0];
    expect(message).not.toHaveProperty('credentials');
  });
});

describe('isTrustedCredentialOrigin', () => {
  const trustedOrigins = ['https://norc.nodal.tools', 'https://norc.linkenfels.de'];

  it('trusts a destination whose origin is on the allowlist', () => {
    expect(isTrustedCredentialOrigin('https://norc.nodal.tools/auth/sign-in', trustedOrigins)).toBe(true);
  });

  it('does not trust a destination whose origin is off the allowlist, even if attacker-supplied', () => {
    expect(isTrustedCredentialOrigin('https://evil.example/harvest', trustedOrigins)).toBe(false);
  });

  it('does not trust anything when the allowlist is empty (safe default)', () => {
    expect(isTrustedCredentialOrigin('https://norc.nodal.tools/auth/sign-in', [])).toBe(false);
  });

  it('does not trust an unparsable destination', () => {
    expect(isTrustedCredentialOrigin('http://', trustedOrigins)).toBe(false);
  });
});
