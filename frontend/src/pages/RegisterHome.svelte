<script lang="ts">
  import { Card, Field, Button } from '@nodal/ui';
  import Shell from '../components/Shell.svelte';
  import { request } from '../lib/request';
  import { sha256Hex } from '../lib/crypto';
  import { persistAuthSession } from '../lib/session';
  import { loadNoasVersion, type EmailVerificationMode } from '../lib/version';
  import { notifyOpenerAndClose, isTrustedCredentialOrigin, type AuthCredentials } from '../lib/broadcast';
  import { encryptPrivateKey, decryptPrivateKey, npubFromHexPublicKey } from '../lib/nostr';
  import { onDestroy } from 'svelte';

  type Mode = 'signin' | 'register';
  type StatusType = 'info' | 'success' | 'error';

  function normalizeUsernameForInput(value: string): string {
    const raw = String(value || '').toLowerCase();
    const base = raw.split('@')[0] || '';
    return base.replace(/[^a-z0-9._-]/g, '').slice(0, 32);
  }

  const initialMode: Mode = window.location.pathname === '/register' ? 'register' : 'signin';
  let mode = $state<Mode>(initialMode);
  const isRegisterMode = $derived(mode === 'register');

  let versionLabel = $state('');
  let emailVerificationMode = $state<EmailVerificationMode>('required_nip05_domains');
  let emailVerificationEnabled = $derived(emailVerificationMode !== 'off');
  let nip05Domain = $state(window.location.hostname || '');
  let trustedAppOrigins = $state<string[]>([]);

  let username = $state('');
  let email = $state('');
  let password = $state('');
  let passwordConfirm = $state('');
  let privateKeyInput = $state('');
  let profilePictureInput: HTMLInputElement | undefined = $state();
  let showAdvanced = $state(false);

  let signinStatus = $state<{ message: string; type: StatusType }>({ message: '', type: 'info' });
  let signupStatus = $state<{ message: string; type: StatusType }>({ message: '', type: 'info' });
  let signupUsernameForResend = $state('');
  let showResend = $state(false);
  let resendUsername = $state('');
  let resendStatus = $state<{ message: string; type: StatusType }>({ message: '', type: 'info' });
  let lastResendAttemptAt = 0;
  const resendCooldownMinutes = 1;

  const lockEmail = $derived(emailVerificationMode === 'required_nip05_domains');
  const emailRequired = $derived(emailVerificationMode === 'required' || lockEmail);
  const derivedEmail = $derived(username && nip05Domain ? `${username}@${nip05Domain}` : '');
  const emailPlaceholder = $derived(nip05Domain ? `you@${nip05Domain}` : 'you@your-domain.tld');
  const emailHint = $derived(
    lockEmail
      ? 'Domain verification is enabled. You need an email address that matches your username to sign up.'
      : emailRequired
        ? 'Email verification is required. Enter the email that should receive verification links.'
        : 'Used for account and verification emails.',
  );

  $effect(() => {
    if (lockEmail) email = derivedEmail;
  });

  const title = $derived(isRegisterMode ? 'Register' : 'Sign in');
  const description = $derived(isRegisterMode ? 'Create your Nostr identity' : 'Access your Nostr account');
  const submitLabel = $derived(
    isRegisterMode ? (emailVerificationEnabled ? 'Register & Send Verification' : 'Register') : 'Sign in',
  );

  async function loadMetadata() {
    const metadata = await loadNoasVersion();
    if (!metadata) return;
    versionLabel = metadata.versionLabel;
    if (metadata.emailVerificationMode) emailVerificationMode = metadata.emailVerificationMode;
    if (metadata.nip05Domain) nip05Domain = metadata.nip05Domain;
    trustedAppOrigins = metadata.trustedAppOrigins;
  }
  loadMetadata();

  // Ported from app.js's bottom-of-file urlParams handling (shared across every
  // page): a stray `token` param redirects to /verify; `signin_required=1`
  // (set by Portal.svelte when bootstrapping without a session) shows a message
  // here since this page owns the `signinStatus` region too.
  (function checkUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('signin_required') === '1') {
      signinStatus = { message: 'Please sign in to open your account portal.', type: 'info' };
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('signin_required');
      window.history.replaceState({}, '', cleanUrl.toString());
    }
    const tokenFromLink = urlParams.get('token');
    if (tokenFromLink) {
      const redirectFromLink = urlParams.get('redirect');
      const verifyParams = new URLSearchParams({ token: tokenFromLink });
      if (redirectFromLink) verifyParams.set('redirect', redirectFromLink);
      window.location.href = `/verify?${verifyParams.toString()}`;
    }
  })();

  function onUsernameInput(event: Event) {
    const normalized = normalizeUsernameForInput((event.target as HTMLInputElement).value);
    if (username !== normalized) username = normalized;
  }

  function setMode(next: Mode) {
    mode = next;
    signinStatus = { message: '', type: 'info' };
    signupStatus = { message: '', type: 'info' };
    showResend = false;
    stopVerificationPoll();
  }

  function toggleAdvanced() {
    showAdvanced = !showAdvanced;
  }

  function validateRegisterForm(): string | null {
    if (!username) return 'Username is required';
    if (!password) return 'Password is required';
    if (emailRequired && !email) return 'Email is required';
    if (!passwordConfirm) return 'Please confirm your password';
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      return 'Username must be 3-32 characters, lowercase letters, numbers, dash, underscore, and dot';
    }
    if (password.length < 8) return 'Password must be at least 8 characters long';
    if (email) {
      const emailInputEl = document.getElementById('signupEmail') as HTMLInputElement | null;
      if (emailInputEl && !emailInputEl.checkValidity()) return 'Please enter a valid email address';
    }
    if (lockEmail && email !== derivedEmail) {
      email = derivedEmail;
      return 'Domain verification is enabled. Use an email that matches your username.';
    }
    if (privateKeyInput) {
      const looksValid = /^[a-f0-9]{64}$/i.test(privateKeyInput) || privateKeyInput.startsWith('nsec1');
      if (!looksValid) return 'Private key must be a 64-character hex key or nsec key';
    }
    if (password !== passwordConfirm) return 'Passwords do not match';
    return null;
  }

  async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        resolve(result.includes(',') ? result.split(',')[1] : result);
      };
      reader.onerror = () => reject(new Error('Unable to read selected file.'));
      reader.readAsDataURL(file);
    });
  }

  function redirectParam(): string | null {
    return new URLSearchParams(window.location.search).get('redirect');
  }

  // Decrypt the private key here (we still have the plaintext password) and
  // hand it to a trusted relying party via the pop-up hand-off, so it can
  // sign the user in without asking them to retype their password. Only ever
  // decrypts for a destination on the operator-configured allowlist.
  async function buildCredentialsIfTrusted(
    destination: string,
    un: string,
    pw: string,
    privateKeyEncrypted: string | null | undefined,
  ): Promise<AuthCredentials | undefined> {
    if (!privateKeyEncrypted) return undefined;
    if (!isTrustedCredentialOrigin(destination, trustedAppOrigins)) return undefined;
    try {
      const decrypted = await decryptPrivateKey(privateKeyEncrypted, pw);
      return { username: un, publicKeyHex: decrypted.publicKey, secretKeyHex: decrypted.hex };
    } catch {
      return undefined;
    }
  }

  // While showing "check your email," quietly retry sign-in with the
  // credentials the user just entered until it succeeds. A verification
  // link opened on another tab, browser, or device has no way to signal
  // this page directly (no window.opener, no shared BroadcastChannel across
  // devices), so polling the one thing we can always check — "has this
  // account been verified yet?" — is the only mechanism that works
  // regardless of where the email got opened.
  const VERIFICATION_POLL_INTERVAL_MS = 4000;
  const VERIFICATION_POLL_TIMEOUT_MS = 15 * 60 * 1000;
  let verificationPollHandle: ReturnType<typeof setInterval> | undefined;

  function stopVerificationPoll() {
    if (verificationPollHandle !== undefined) {
      clearInterval(verificationPollHandle);
      verificationPollHandle = undefined;
    }
  }

  function startVerificationPoll(un: string, pw: string) {
    stopVerificationPoll();
    const deadline = Date.now() + VERIFICATION_POLL_TIMEOUT_MS;
    verificationPollHandle = setInterval(async () => {
      if (Date.now() > deadline) {
        stopVerificationPoll();
        return;
      }
      try {
        const passwordHash = await sha256Hex(pw);
        const data = await request<{ private_key_encrypted?: string | null }>('/api/v1/auth/signin', {
          username: un,
          password_hash: passwordHash,
        });
        stopVerificationPoll();
        persistAuthSession({ username: un, password: pw, passwordHash });
        const redirect = redirectParam();
        const destination = redirect ? decodeURIComponent(redirect) : '/portal';
        const credentials = await buildCredentialsIfTrusted(destination, un, pw, data.private_key_encrypted);
        if (!notifyOpenerAndClose(destination, credentials)) {
          window.location.assign(destination);
        }
      } catch {
        // Not verified yet — keep waiting.
      }
    }, VERIFICATION_POLL_INTERVAL_MS);
  }

  onDestroy(stopVerificationPoll);

  async function autoSigninAndRedirect(un: string, pw: string): Promise<boolean> {
    try {
      const passwordHash = await sha256Hex(pw);
      const data = await request<{ private_key_encrypted?: string | null }>('/api/v1/auth/signin', {
        username: un,
        password_hash: passwordHash,
      });
      persistAuthSession({ username: un, password: pw, passwordHash });
      const redirect = redirectParam();
      const destination = redirect ? decodeURIComponent(redirect) : '/portal';
      const credentials = await buildCredentialsIfTrusted(destination, un, pw, data.private_key_encrypted);
      if (!notifyOpenerAndClose(destination, credentials)) {
        window.location.assign(destination);
      }
      return true;
    } catch (error) {
      signupStatus = {
        message: `Registration succeeded but auto sign-in failed. ${(error as Error).message}`,
        type: 'error',
      };
      return false;
    }
  }

  async function submitSignin() {
    signinStatus = { message: 'Signing in...', type: 'info' };
    signupStatus = { message: '', type: 'info' };
    try {
      const passwordHash = await sha256Hex(password);
      await request('/api/v1/auth/signin', { username, password_hash: passwordHash });
      persistAuthSession({ username, password, passwordHash });
      window.location.assign('/portal');
    } catch (error) {
      signinStatus = { message: (error as Error).message, type: 'error' };
    }
  }

  async function submitRegister() {
    const validationError = validateRegisterForm();
    if (validationError) {
      signupStatus = { message: validationError, type: 'error' };
      return;
    }
    signupStatus = { message: 'Sending verification email...', type: 'info' };
    signinStatus = { message: '', type: 'info' };

    try {
      const requestBody: Record<string, unknown> = {
        username,
        email: email || undefined,
      };
      const picture = profilePictureInput?.files?.[0];
      if (picture) {
        requestBody.profile_picture_data = await fileToBase64(picture);
        requestBody.profile_picture_content_type = picture.type || 'application/octet-stream';
      }
      if (privateKeyInput) {
        let encrypted;
        try {
          encrypted = await encryptPrivateKey(privateKeyInput, password);
        } catch {
          throw new Error('Private key must be a valid 64-character hex or nsec key');
        }
        requestBody.public_key = encrypted.publicKey;
        requestBody.private_key_encrypted = encrypted.privateKeyEncrypted;
        requestBody.password_hash = await sha256Hex(password);
      } else {
        requestBody.password = password;
      }
      const redirect = redirectParam();
      if (redirect) requestBody.redirect = redirect;

      const data = await request<{
        status?: string;
        message?: string;
        verify_url?: string;
        key_source?: string;
        public_key?: string;
      }>('/api/v1/auth/register', requestBody);

      signupUsernameForResend = username;
      if (!resendUsername) resendUsername = username;

      const isActiveNow = String(data.status || '').trim().toLowerCase() === 'active' || !emailVerificationEnabled;
      if (isActiveNow) {
        signupStatus = { message: 'Account is active. Signing you in...', type: 'info' };
        const signedIn = await autoSigninAndRedirect(username, password);
        if (signedIn) return;
      }

      const verificationHint = data.verify_url ? ` Verification link: ${data.verify_url}` : '';
      const keyHint =
        data.key_source === 'generated'
          ? ` A Nostr keypair was generated automatically (pubkey: ${npubFromHexPublicKey(data.public_key || '') || data.public_key || 'unknown'}).`
          : '';
      signupStatus = {
        message: `${data.message || 'Verification sent.'}${keyHint}${verificationHint}`,
        type: 'success',
      };
      if (emailVerificationEnabled) {
        showResend = true;
        startVerificationPoll(username, password);
      }
    } catch (error) {
      signupStatus = { message: `Registration start failed: ${(error as Error).message}`, type: 'error' };
    }
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (isRegisterMode) {
      submitRegister();
    } else {
      submitSignin();
    }
  }

  function resendCooldownRemainingMs(): number {
    const cooldownMs = Math.max(1, resendCooldownMinutes) * 60 * 1000;
    return Math.max(0, lastResendAttemptAt + cooldownMs - Date.now());
  }

  async function submitResend(event: SubmitEvent) {
    event.preventDefault();
    const un = normalizeUsernameForInput(resendUsername || signupUsernameForResend);
    if (resendUsername !== un) resendUsername = un;
    if (!un) {
      resendStatus = { message: 'Username is required.', type: 'error' };
      return;
    }
    const remainingMs = resendCooldownRemainingMs();
    if (remainingMs > 0) {
      const secondsLeft = Math.max(1, Math.ceil(remainingMs / 1000));
      resendStatus = { message: `Wait ${secondsLeft}s before requesting another resend.`, type: 'error' };
      return;
    }
    resendStatus = { message: 'Resending verification email...', type: 'info' };
    try {
      const data = await request<{ message?: string; verify_url?: string }>('/api/v1/auth/resend', {
        username: un,
      });
      lastResendAttemptAt = Date.now();
      const message = data.verify_url
        ? `${data.message} Verification link: ${data.verify_url}`
        : data.message || 'Verification email resent.';
      resendStatus = { message, type: 'success' };
    } catch (error) {
      resendStatus = { message: (error as Error).message, type: 'error' };
    }
  }
</script>

<svelte:head>
  <title>Noas | Nostr Account Service</title>
  <meta
    name="description"
    content="Noas is a minimal Nostr account service for secure key storage, relay updates, and account management."
  />
</svelte:head>

<Shell {versionLabel}>
  <div class="page-title-wrap">
    <h1 class="page-title">noas</h1>
    <p class="page-subtitle">
      Secure, API-first Nostr account service.<br />
      NIP-05 verification · encrypted key storage · relay management.
    </p>
  </div>

  <div class="auth-wrap">
    <Card glow borderGlow title={title} description={description}>
      <form class="form" onsubmit={submit}>
        <Field id="signupUsername" label="Username" bind:value={username} oninput={onUsernameInput} required placeholder="username" autocomplete="username" />

        {#if isRegisterMode}
          <div class="field">
            <span class="label">Email</span>
            <input
              type="email"
              id="signupEmail"
              bind:value={email}
              placeholder={emailPlaceholder}
              autocomplete="email"
              required={emailRequired}
              disabled={lockEmail}
              data-locked={lockEmail}
            />
            <small id="signupEmailHint">{emailHint}</small>
          </div>
        {/if}

        <Field
          id="signupPassword"
          label="Password"
          type="password"
          bind:value={password}
          required
          placeholder="••••••••"
          autocomplete={isRegisterMode ? 'new-password' : 'current-password'}
        />

        {#if isRegisterMode}
          <Field
            id="signupPasswordConfirm"
            label="Confirm password"
            type="password"
            bind:value={passwordConfirm}
            required
            placeholder="••••••••"
            autocomplete="new-password"
          />

          <label class="field">
            <span class="label small-label">Profile picture (optional)</span>
            <input type="file" id="signupProfilePictureInput" accept="image/*" bind:this={profilePictureInput} />
          </label>

          <button type="button" class="advanced-toggle" onclick={toggleAdvanced}>
            {showAdvanced ? '▾ Hide advanced options' : '▸ Show advanced options'}
          </button>
          {#if showAdvanced}
            <div class="advanced-panel">
              <label class="field">
                <span class="label small-label">Private key (optional)</span>
                <input type="text" id="signupPrivateKey" class="form-mono" bind:value={privateKeyInput} placeholder="64-character hex or nsec1..." />
              </label>
              <p class="hint">Leave blank to let noas generate a keypair. If provided, your key is encrypted locally before upload.</p>
            </div>
          {/if}

          <div class="warning-banner">
            ⚠ Your private key is encrypted with your password. If you lose your password, your key is irrecoverable.
          </div>
        {/if}

        <Button type="submit" class="w-full">{submitLabel}</Button>

        {#if isRegisterMode}
          <div class="status" role="status" data-type={signupStatus.type}>{signupStatus.message}</div>
        {:else}
          <div class="status" role="status" data-type={signinStatus.type}>{signinStatus.message}</div>
        {/if}

        {#if !isRegisterMode}
          <p class="auth-toggle">
            No account? <button class="advanced-toggle" type="button" onclick={() => setMode('register')}>Register</button>
          </p>
        {:else}
          <p class="auth-toggle">
            Already registered? <button class="advanced-toggle" type="button" onclick={() => setMode('signin')}>Sign in</button>
          </p>
        {/if}
      </form>

      {#if isRegisterMode && showResend}
        <form
          class="form"
          style="padding-top: 0.5rem; border-top: 1px solid oklch(0.25 0.01 260 / 0.45)"
          onsubmit={submitResend}
        >
          <label class="field">
            <span class="label">Username for resend</span>
            <input type="text" bind:value={resendUsername} placeholder="username" />
          </label>
          <Button type="submit" variant="secondary">Resend verification email</Button>
          <div class="status" role="status" data-type={resendStatus.type}>{resendStatus.message}</div>
        </form>
      {/if}
    </Card>
  </div>
</Shell>
