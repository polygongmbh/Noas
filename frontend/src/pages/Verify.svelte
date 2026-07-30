<script lang="ts">
  import { Card, Badge, Field, Button } from '@nodal/ui';
  import Shell from '../components/Shell.svelte';
  import { sha256Hex } from '../lib/crypto';
  import { persistAuthSession } from '../lib/session';
  import { loadNoasVersion } from '../lib/version';
  import { broadcastVerified, notifyOpenerAndClose, parseOrigin } from '../lib/broadcast';
  import { npubFromHexPublicKey } from '../lib/nostr';

  type StatusType = 'info' | 'success' | 'error';

  const params = new URLSearchParams(window.location.search);
  const token = (params.get('token') || '').trim();
  const redirectRaw = (params.get('redirect') || params.get('origin') || '').trim();

  let versionLabel = $state('');
  let trustedNip05Domain = $state('');

  function tryDecodeURIComponent(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function decodeRedirectValue(value: string): string {
    let decoded = String(value || '').trim();
    for (let i = 0; i < 2; i += 1) {
      const next = tryDecodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    return decoded;
  }

  function normalizeRedirect(value: string): string {
    const decoded = decodeRedirectValue(value);
    if (!decoded) return '';
    if (decoded.startsWith('https://') || decoded.startsWith('http://')) return decoded;
    if (decoded.startsWith('//')) return `${window.location.protocol}${decoded}`;
    if (decoded.startsWith('/')) return decoded;
    if (/^[a-z0-9.-]+\.[a-z]{2,}([/:?#]|$)/i.test(decoded)) return `https://${decoded}`;
    return '';
  }

  const redirect = normalizeRedirect(redirectRaw);
  const tenantLandingUrl = new URL('/', window.location.origin).toString();

  function isTrustedRedirect(value: string): boolean {
    if (!value) return false;
    try {
      const parsed = new URL(value, window.location.origin);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
      const host = parsed.hostname.toLowerCase();
      const currentHost = window.location.hostname.toLowerCase();
      if (host === currentHost) return true;
      if (!trustedNip05Domain) return false;
      return host === trustedNip05Domain || host.endsWith(`.${trustedNip05Domain}`);
    } catch {
      return false;
    }
  }

  function isAlreadyUsedError(message: string): boolean {
    const normalized = String(message || '').trim().toLowerCase();
    return normalized.includes('already active') || normalized.includes('already used');
  }

  // View state
  let phase = $state<'loading' | 'preview' | 'error'>('loading');
  let verifyMessage = $state('Checking verification link...');
  let verified = $state(false);
  let verifiedUsername = $state('');
  let verifiedNip05 = $state('');
  let verifiedEmail = $state('');
  let verifyNip05Text = $state('');
  let verifyPublicKeyHexText = $state('');
  let verifyPublicKeyNpubText = $state('');
  let verifyExpiryText = $state('');
  let password = $state('');
  let verifyStatus = $state<{ message: string; type: StatusType }>({ message: '', type: 'info' });
  let showBackToApp = $state(false);
  let backToAppLabel = $state('Back to app');
  let showBackToNoas = $state(false);

  function setStatus(message: string, type: StatusType = 'info') {
    verifyStatus = { message, type };
  }

  function renderError(message: string) {
    phase = 'error';
    verifyMessage = message;
    verifyStatus = { message: '', type: 'info' };
    password = '';
    verifyNip05Text = '';
    verifyPublicKeyHexText = '';
    verifyPublicKeyNpubText = '';
    verifyExpiryText = '';
    verified = false;
  }

  function showAlreadyUsedActions() {
    if (redirect) {
      showBackToApp = true;
      backToAppLabel = 'Back to app';
    } else {
      showBackToApp = false;
    }
    showBackToNoas = true;
  }

  function renderPreview(data: {
    username?: string;
    nip05?: string;
    registration_email?: string;
    public_key?: string;
    expires_at?: string;
  }) {
    phase = 'preview';
    verifyMessage = 'Enter your password to activate your account.';
    verifiedUsername = String(data.username || '').trim().toLowerCase();
    verifiedNip05 = String(data.nip05 || '').trim();
    verifiedEmail = String(data.registration_email || '').trim();
    verifyNip05Text = verifiedNip05 ? `NIP-05: ${verifiedNip05}` : '';
    const hexPubkey = String(data.public_key || '').trim().toLowerCase();
    const npubPubkey = hexPubkey ? npubFromHexPublicKey(hexPubkey) : '';
    verifyPublicKeyHexText = hexPubkey ? `Public key (hex): ${hexPubkey}` : '';
    verifyPublicKeyNpubText = npubPubkey ? `Public key (npub): ${npubPubkey}` : '';
    if (data.expires_at) {
      const minutesLeft = Math.max(1, Math.ceil((new Date(data.expires_at).getTime() - Date.now()) / (1000 * 60)));
      verifyExpiryText = `Expires in about ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.`;
    }
    verified = false;
  }

  async function loadPreview() {
    if (!token) {
      renderError('Invalid link.');
      return;
    }
    try {
      const response = await fetch(`/api/v1/auth/verify?token=${encodeURIComponent(token)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Invalid link.');
      }
      renderPreview(data);
    } catch (error) {
      const message = (error as Error).message || 'Invalid link.';
      if (isAlreadyUsedError(message)) showAlreadyUsedActions();
      renderError(message);
    }
  }

  async function signinAfterVerification(pw: string, passwordHash: string): Promise<boolean> {
    if (!verifiedUsername || !passwordHash) return false;
    try {
      const response = await fetch('/api/v1/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: verifiedUsername, password_hash: passwordHash }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) return false;
      persistAuthSession({ username: verifiedUsername, password: pw, passwordHash });
      return true;
    } catch {
      return false;
    }
  }

  async function handleVerifySubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!password) {
      setStatus('Password is required.', 'error');
      return;
    }
    setStatus('Verifying...', 'info');
    try {
      const passwordHash = await sha256Hex(password);
      const response = await fetch('/api/v1/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password_hash: passwordHash }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Verification failed.');
      }
      setStatus('Account verified. Signing you in...', 'success');
      verifyMessage = 'Your NIP-05 identity is live.';
      verified = true;
      const signedIn = await signinAfterVerification(password, passwordHash);

      if (redirect && !isTrustedRedirect(redirect)) {
        showBackToApp = true;
        backToAppLabel = 'Continue to destination';
        setStatus('Account verified. This destination is not vetted. If you trust it, click continue.', 'success');
        return;
      }

      const homeUrl = new URL('/', window.location.origin);
      homeUrl.searchParams.set('verified', '1');
      if (verifiedEmail) {
        homeUrl.searchParams.set('email', verifiedEmail);
      } else if (verifiedNip05) {
        homeUrl.searchParams.set('nip05', verifiedNip05);
      }
      const destination = redirect || (signedIn ? '/portal' : homeUrl.toString());
      broadcastVerified(destination);
      setTimeout(() => {
        if (!notifyOpenerAndClose(destination)) {
          window.location.assign(destination);
        }
      }, 700);
    } catch (error) {
      const message = (error as Error).message || 'Verification failed.';
      if (isAlreadyUsedError(message)) showAlreadyUsedActions();
      setStatus(message, 'error');
    }
  }

  function handleBackToApp() {
    if (!notifyOpenerAndClose(redirect)) {
      window.location.assign(redirect);
    }
  }

  function handleBackToNoas() {
    window.location.assign(tenantLandingUrl);
  }

  async function loadMetadata() {
    const metadata = await loadNoasVersion();
    if (!metadata) return;
    versionLabel = metadata.versionLabel;
    if (metadata.nip05Domain) trustedNip05Domain = metadata.nip05Domain;
  }

  if (redirect) showBackToApp = true;
  loadMetadata();
  loadPreview();
</script>

<svelte:head>
  <title>Verify Identity | Noas</title>
</svelte:head>

<Shell {versionLabel}>
  <div class="auth-wrap">
    <Card glow borderGlow>
      <div class="card-header">
        <div style="display:flex;align-items:center;gap:0.5rem">
          <h1 class="card-title">Verify account</h1>
          <Badge variant={verified ? 'success' : 'outline'}>{verified ? 'active' : 'pending'}</Badge>
        </div>
        <p class="card-description">{verifyMessage}</p>
      </div>

      <div class="card-content stack-3">
        {#if verifyNip05Text}<p class="font-mono-key muted" style="margin:0">{verifyNip05Text}</p>{/if}
        {#if verifyPublicKeyHexText}<p class="font-mono-key muted" style="margin:0">{verifyPublicKeyHexText}</p>{/if}
        {#if verifyPublicKeyNpubText}<p class="font-mono-key muted" style="margin:0">{verifyPublicKeyNpubText}</p>{/if}
        {#if verifyExpiryText}<p class="muted" style="margin:0">{verifyExpiryText}</p>{/if}

        {#if phase === 'preview'}
          <form class="form" onsubmit={handleVerifySubmit}>
            <Field id="verifyPassword" label="Password" type="password" bind:value={password} required placeholder="••••••••" autocomplete="current-password" />
            <Button type="submit" class="w-full">Verify & activate</Button>
            <div class="status" data-type={verifyStatus.type}>{verifyStatus.message}</div>
          </form>
        {/if}

        {#if showBackToApp}
          <Button class="w-full" onclick={handleBackToApp}>{backToAppLabel}</Button>
        {/if}
        {#if showBackToNoas}
          <Button variant="secondary" class="w-full" onclick={handleBackToNoas}>Back to noas</Button>
        {/if}
      </div>
    </Card>
  </div>
</Shell>
