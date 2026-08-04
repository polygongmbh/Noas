// The pop-up/opener half of the noas <-> norc hand-off: norc opens noas's
// register page in a pop-up instead of a full redirect, and once auth
// completes this notifies the opener (norc) and closes the pop-up.
//
// This used to also carry a BroadcastChannel-based relay so a verification
// link opened in a brand-new tab (no window.opener) could tell the pop-up it
// was done. That only works when the link is opened in the same browser on
// the same device — which isn't guaranteed for an email link — so the
// register page now polls sign-in instead (see RegisterHome.svelte) and the
// broadcast relay was removed.

export function parseOrigin(url: string): string | null {
  try {
    return new URL(url, window.location.origin).origin;
  } catch {
    return null;
  }
}

export type AuthCredentials = {
  username: string;
  publicKeyHex: string;
  secretKeyHex: string;
};

/**
 * Whether `destination`'s origin is on the operator-configured allowlist of
 * relying-party apps trusted to receive decrypted key material. This is a
 * separate, deliberately narrower list than CORS's allowedOrigins: CORS just
 * gates API calls, this gates whether a raw private key ever leaves this
 * page. The `redirect` param that produces `destination` is caller-supplied
 * (norc sets it, but so could anyone who links directly to /register with
 * their own redirect) — never attach credentials without this check.
 */
export function isTrustedCredentialOrigin(destination: string, trustedOrigins: string[]): boolean {
  const origin = parseOrigin(destination);
  if (!origin) return false;
  return trustedOrigins.includes(origin);
}

/**
 * If the current window was opened as a pop-up (has window.opener), notify it
 * that auth completed and close this window. Returns true if the notification
 * was sent, false if there's no opener (caller should fall back to a normal
 * navigation in that case).
 *
 * `credentials`, when provided, is relayed to the opener so it can sign the
 * user in immediately instead of asking them to type their password again.
 * Callers must only pass this after checking isTrustedCredentialOrigin —
 * postMessage's explicit targetOrigin means the browser will only deliver it
 * to a window actually at that origin, but destination itself can be
 * attacker-chosen, so the allowlist check is what actually keeps key
 * material scoped to apps we operate.
 */
export function notifyOpenerAndClose(destination: string, credentials?: AuthCredentials): boolean {
  const targetOrigin = parseOrigin(destination);
  if (!window.opener || !targetOrigin) return false;
  try {
    window.opener.postMessage(
      { source: 'noas', type: 'auth-complete', destination, ...(credentials ? { credentials } : {}) },
      targetOrigin,
    );
    window.close();
    return true;
  } catch {
    return false;
  }
}
