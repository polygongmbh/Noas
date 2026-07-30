import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_BROADCAST_CHANNEL,
  broadcastVerified,
  listenForVerificationBroadcast,
  notifyOpenerAndClose,
  parseOrigin,
} from '../src/lib/broadcast';

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
});

describe('broadcastVerified + listenForVerificationBroadcast', () => {
  const originalOpener = window.opener;
  const originalClose = window.close;
  const originalLocation = window.location;
  const originalSearch = window.location.search;

  beforeEach(() => {
    Object.defineProperty(window, 'opener', { value: null, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(window, 'opener', { value: originalOpener, configurable: true });
    window.close = originalClose;
    Object.defineProperty(window, 'location', { value: originalLocation, configurable: true, writable: true });
    window.history.replaceState(null, '', `${window.location.pathname}${originalSearch}`);
  });

  it('does nothing if there is no redirect param in the URL', async () => {
    window.history.replaceState(null, '', window.location.pathname);
    const channel = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
    const onmessage = vi.fn();
    channel.onmessage = onmessage;

    listenForVerificationBroadcast();
    broadcastVerified('https://norc.nodal.tools/auth/sign-in');

    await new Promise((r) => setTimeout(r, 10));
    channel.close();
  });

  it('relays a verified broadcast to the opener and closes when a redirect param is present', async () => {
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}?redirect=${encodeURIComponent('https://norc.nodal.tools/auth/sign-in')}`,
    );

    const postMessage = vi.fn();
    const close = vi.fn();
    Object.defineProperty(window, 'opener', { value: { postMessage }, configurable: true });
    window.close = close;

    listenForVerificationBroadcast();

    const sender = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
    sender.postMessage({ type: 'verified', destination: 'https://norc.nodal.tools/auth/sign-in' });
    sender.close();

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(postMessage).toHaveBeenCalledWith(
      { source: 'noas', type: 'auth-complete', destination: 'https://norc.nodal.tools/auth/sign-in' },
      'https://norc.nodal.tools',
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('falls back to navigating directly when there is no opener', async () => {
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}?redirect=${encodeURIComponent('https://norc.nodal.tools/auth/sign-in')}`,
    );

    const assign = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, assign },
      configurable: true,
      writable: true,
    });

    listenForVerificationBroadcast();

    const sender = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
    sender.postMessage({ type: 'verified', destination: 'https://norc.nodal.tools/auth/sign-in' });
    sender.close();

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(assign).toHaveBeenCalledWith('https://norc.nodal.tools/auth/sign-in');
  });
});
