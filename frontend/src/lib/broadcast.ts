// Consolidates the pop-up/BroadcastChannel logic that previously existed as two
// independent copies: src/public/app.js (AUTH_BROADCAST_CHANNEL, parseOrigin,
// notifyOpenerAndClose, listenForVerificationBroadcast) and src/public/verify.html
// (its own parseOrigin/notifyOpenerAndClose/broadcastVerified). Behavior is kept
// byte-for-byte equivalent to both — this is a de-duplication, not a redesign.
//
// Why this exists: norc opens noas's register page in a pop-up instead of a full
// redirect. After registering, noas emails a verification link that opens in a
// brand new tab from the user's mail client — a tab with no `window.opener` back
// to the original pop-up. BroadcastChannel is same-origin messaging that works
// between any two tabs/windows regardless of an opener relationship, so it
// bridges that gap: the pop-up listens on the channel while showing "check your
// email"; the verification tab posts to the channel once it succeeds; the pop-up
// then relays that to norc via postMessage (since it *does* have window.opener)
// and closes itself.

export const AUTH_BROADCAST_CHANNEL = 'noas-auth-events';

export function parseOrigin(url: string): string | null {
  try {
    return new URL(url, window.location.origin).origin;
  } catch {
    return null;
  }
}

/**
 * If the current window was opened as a pop-up (has window.opener), notify it
 * that auth completed and close this window. Returns true if the notification
 * was sent, false if there's no opener (caller should fall back to a normal
 * navigation in that case).
 */
export function notifyOpenerAndClose(destination: string): boolean {
  const targetOrigin = parseOrigin(destination);
  if (!window.opener || !targetOrigin) return false;
  try {
    window.opener.postMessage({ source: 'noas', type: 'auth-complete', destination }, targetOrigin);
    window.close();
    return true;
  } catch {
    return false;
  }
}

/** Broadcast to any same-origin listener (e.g. a pop-up on a different tab) that verification succeeded. */
export function broadcastVerified(destination: string): void {
  try {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
    channel.postMessage({ type: 'verified', destination });
    channel.close();
  } catch {
    // Non-blocking: only helps a pop-up opened from a different tab.
  }
}

/**
 * Called by the register/sign-up page right after showing "check your email."
 * Listens for a same-origin broadcast that verification finished elsewhere, then
 * relays it back to the opener (norc) and closes this pop-up — or, if this
 * window has no opener, falls back to navigating itself to the destination.
 */
export function listenForVerificationBroadcast(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const redirectParam = new URLSearchParams(window.location.search).get('redirect');
  if (!redirectParam) return;
  const channel = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
  channel.onmessage = (event: MessageEvent) => {
    const { type, destination } = event.data || {};
    if (type !== 'verified' || !destination) return;
    channel.close();
    if (!notifyOpenerAndClose(destination)) {
      window.location.assign(destination);
    }
  };
}
