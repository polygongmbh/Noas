document.addEventListener('DOMContentLoaded', function () {
  const state = {
    username: null,
    password: null,
    signupUsername: null,
    emailVerificationEnabled: false,
    nip05Domain: window.location.hostname || '',
  };

  const signinForm = document.getElementById('signinForm');
  const updateForm = document.getElementById('updateForm');
  const deleteForm = document.getElementById('deleteForm');
  const signinStatus = document.getElementById('signinStatus');
  const updateStatus = document.getElementById('updateStatus');
  const deleteStatus = document.getElementById('deleteStatus');
  const accountPanel = document.getElementById('accountPanel');
  const updatePanel = document.getElementById('updatePanel');
  const deletePanel = document.getElementById('deletePanel');
  const publicKeyEl = document.getElementById('publicKey');
  const encryptedKeyEl = document.getElementById('encryptedKey');
  const relayListEl = document.getElementById('relayList');
  const copyEncrypted = document.getElementById('copyEncrypted');

  const signupStartForm = document.getElementById('signupStartForm');
  const signupUsername = document.getElementById('signupUsername');
  const signupEmailLabel = document.getElementById('signupEmailLabel');
  const signupEmail = document.getElementById('signupEmail');
  const signupEmailHint = document.getElementById('signupEmailHint');
  const signupPassword = document.getElementById('signupPassword');
  const signupPasswordConfirm = document.getElementById('signupPasswordConfirm');
  const signupRedirect = document.getElementById('signupRedirect');
  const signupPublicKey = document.getElementById('signupPublicKey');
  const signupPrivateKeyEncrypted = document.getElementById('signupPrivateKeyEncrypted');
  const signupStatus = document.getElementById('signupStatus');
  const verificationFlash = document.getElementById('verificationFlash');
  const resendForm = document.getElementById('resendForm');
  const resendUsername = document.getElementById('resendUsername');
  const resendStatus = document.getElementById('resendStatus');
  const noasVersion = document.getElementById('noasVersion');
  const noasVersionFooter = document.getElementById('noasVersionFooter');

  function getDerivedSignupEmail(usernameRaw) {
    const username = String(usernameRaw || '').trim().toLowerCase();
    const domain = String(state.nip05Domain || '').trim().toLowerCase();
    if (!username || !domain) return '';
    return `${username}@${domain}`;
  }

  function syncSignupEmailLockState() {
    if (!signupEmail || !signupEmailLabel || !signupEmailHint) return;
    const lockEmail = Boolean(state.emailVerificationEnabled);
    const lockHint = 'Because email verification is enabled, email must be username@NIP05_DOMAIN.';
    signupEmail.readOnly = lockEmail;
    signupEmail.dataset.locked = lockEmail ? 'true' : 'false';

    if (lockEmail) {
      signupEmail.value = getDerivedSignupEmail(signupUsername?.value);
      signupEmail.title = lockHint;
      signupEmailHint.textContent = lockHint;
      signupEmailLabel.classList.add('email-lock-hint');
      return;
    }

    signupEmail.removeAttribute('title');
    signupEmailHint.textContent = 'Used for account and verification emails.';
    signupEmailLabel.classList.remove('email-lock-hint');
  }

  function normalizeVersionLabel(version) {
    const trimmed = String(version || '').trim().replace(/^v/i, '');
    if (!trimmed) return 'v—';
    const parts = trimmed.split('.');
    if (parts.length >= 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
      return `v${parts[0]}.${parts[1]}`;
    }
    return `v${trimmed}`;
  }

  async function loadNoasVersion() {
    try {
      const response = await fetch('/.well-known/nostr.json');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return;
      const metadata = data?.noas || {};
      const label = normalizeVersionLabel(data?.noas?.version);
      if (noasVersion) noasVersion.textContent = label;
      if (noasVersionFooter) noasVersionFooter.textContent = label;
      if (typeof metadata.email_verification_enabled === 'boolean') {
        state.emailVerificationEnabled = metadata.email_verification_enabled;
      }
      if (typeof metadata.nip05_domain === 'string' && metadata.nip05_domain.trim()) {
        state.nip05Domain = metadata.nip05_domain.trim().toLowerCase();
      }
      syncSignupEmailLockState();
    } catch {
      // Non-blocking: keep placeholder when metadata is unavailable.
      syncSignupEmailLockState();
    }
  }

  if (signupUsername) {
    signupUsername.addEventListener('input', () => {
      if (state.emailVerificationEnabled) {
        syncSignupEmailLockState();
      }
    });
  }

  syncSignupEmailLockState();
  loadNoasVersion();

  function setStatus(el, message, type = 'info') {
    if (!el) return;
    el.textContent = message;
    el.dataset.type = type;
  }

  function parseRelays(text) {
    if (!text) return [];
    return text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async function request(path, payload) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error || 'Request failed';
      throw new Error(message);
    }
    return data;
  }

  async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  function validateSignupStartForm() {
    const username = signupUsername?.value.trim().toLowerCase() || '';
    const email = signupEmail?.value.trim().toLowerCase() || '';
    const password = signupPassword?.value || '';
    const passwordConfirm = signupPasswordConfirm?.value || '';
    const publicKey = signupPublicKey?.value.trim() || '';
    const privateKeyEncrypted = signupPrivateKeyEncrypted?.value.trim() || '';
    const redirect = signupRedirect?.value.trim() || '';

    if (!username) {
      setStatus(signupStatus, 'Username is required', 'error');
      signupUsername?.focus();
      return false;
    }
    if (!password) {
      setStatus(signupStatus, 'Password is required', 'error');
      signupPassword?.focus();
      return false;
    }
    if (!email) {
      setStatus(signupStatus, 'Email is required', 'error');
      signupEmail?.focus();
      return false;
    }
    if (!passwordConfirm) {
      setStatus(signupStatus, 'Please confirm your password', 'error');
      signupPasswordConfirm?.focus();
      return false;
    }

    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      setStatus(signupStatus, 'Username must be 3-32 characters, lowercase letters, numbers, dash, underscore, and dot', 'error');
      signupUsername?.focus();
      return false;
    }
    if (password.length < 8) {
      setStatus(signupStatus, 'Password must be at least 8 characters long', 'error');
      signupPassword?.focus();
      return false;
    }
    if (!signupEmail?.checkValidity()) {
      setStatus(signupStatus, 'Please enter a valid email address', 'error');
      signupEmail?.focus();
      return false;
    }
    if (state.emailVerificationEnabled) {
      const expectedEmail = getDerivedSignupEmail(username);
      if (email !== expectedEmail) {
        signupEmail.value = expectedEmail;
        setStatus(signupStatus, 'Email must follow username@NIP05_DOMAIN when email verification is enabled', 'error');
        signupEmail?.focus();
        return false;
      }
    }
    if (publicKey && !(/^[a-f0-9]{64}$/i.test(publicKey) || publicKey.startsWith('npub1'))) {
      setStatus(signupStatus, 'Public key must be npub1... or 64-char hex', 'error');
      signupPublicKey?.focus();
      return false;
    }
    if (privateKeyEncrypted && !privateKeyEncrypted.startsWith('ncryptsec')) {
      setStatus(signupStatus, 'Encrypted private key must start with ncryptsec', 'error');
      signupPrivateKeyEncrypted?.focus();
      return false;
    }
    if (redirect) {
      try {
        new URL(redirect);
      } catch {
        setStatus(signupStatus, 'Redirect must be a valid URL', 'error');
        signupRedirect?.focus();
        return false;
      }
    }
    if (password !== passwordConfirm) {
      setStatus(signupStatus, 'Passwords do not match', 'error');
      signupPasswordConfirm?.focus();
      return false;
    }
    return true;
  }

  if (signupStartForm) {
    signupStartForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!validateSignupStartForm()) return;

      const username = signupUsername.value.trim().toLowerCase();
      const email = signupEmail?.value.trim().toLowerCase() || '';
      const password = signupPassword.value;
      const publicKey = signupPublicKey?.value.trim() || '';
      const privateKeyEncrypted = signupPrivateKeyEncrypted?.value.trim() || '';
      const redirect = signupRedirect?.value.trim() || '';

      setStatus(signupStatus, 'Sending verification email...', 'info');

      try {
        const passwordHash = await sha256Hex(password);
        const data = await request('/api/v1/auth/register', {
          username,
          email: email || undefined,
          password_hash: passwordHash,
          public_key: publicKey || undefined,
          private_key_encrypted: privateKeyEncrypted || undefined,
          redirect: redirect || undefined,
        });

        state.signupUsername = username;
        if (resendUsername && !resendUsername.value) {
          resendUsername.value = username;
        }
        const verificationHint = data.verify_url
          ? ` Verification link: ${data.verify_url}`
          : '';
        const keyHint = data.key_source === 'generated'
          ? ` A Nostr keypair was generated automatically (pubkey: ${data.public_npub || data.public_key || 'unknown'}).`
          : '';
        setStatus(signupStatus, `${data.message || 'Verification sent.'}${keyHint}${verificationHint}`, 'success');

      } catch (error) {
        setStatus(signupStatus, `Registration start failed: ${error.message}`, 'error');
      }
    });
  }

  if (resendForm) {
    resendForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const username = (resendUsername?.value || state.signupUsername || '').trim().toLowerCase();
      if (!username) {
        setStatus(resendStatus, 'Username is required.', 'error');
        return;
      }
      setStatus(resendStatus, 'Resending verification email...', 'info');
      try {
        const data = await request('/api/v1/auth/resend', { username });
        const message = data.verify_url
          ? `${data.message} Verification link: ${data.verify_url}`
          : (data.message || 'Verification email resent.');
        setStatus(resendStatus, message, 'success');
      } catch (error) {
        setStatus(resendStatus, error.message, 'error');
      }
    });
  }

  signinForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus(signinStatus, 'Signing in...');
    const formData = new FormData(signinForm);
    const username = formData.get('username');
    const password = formData.get('password');

    try {
      const data = await request('/api/v1/auth/signin', { username, password });
      state.username = username;
      state.password = password;

      publicKeyEl.textContent = data.publicKeyNpub || data.publicKey || '—';
      encryptedKeyEl.textContent = data.encryptedPrivateKey || '—';
      relayListEl.textContent = (data.relays || []).join(', ') || '—';
      accountPanel.hidden = false;
      updatePanel.hidden = false;
      deletePanel.hidden = false;
      setStatus(signinStatus, 'Signed in successfully.', 'success');
      updateForm.querySelector('textarea[name="relays"]').value = (data.relays || []).join('\n');
    } catch (error) {
      setStatus(signinStatus, error.message, 'error');
    }
  });

  copyEncrypted.addEventListener('click', async () => {
    const value = encryptedKeyEl.textContent;
    if (!value || value === '—') return;
    try {
      await navigator.clipboard.writeText(value);
      setStatus(signinStatus, 'Encrypted key copied to clipboard.', 'success');
    } catch (error) {
      setStatus(signinStatus, 'Unable to copy key. Copy it manually.', 'error');
    }
  });

  updateForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.username || !state.password) {
      setStatus(updateStatus, 'Sign in before updating your account.', 'error');
      return;
    }

    const formData = new FormData(updateForm);
    const updates = {};
    const newPassword = formData.get('newPassword');
    const encryptedPrivateKey = formData.get('encryptedPrivateKey');
    const relays = parseRelays(formData.get('relays'));

    if (newPassword) updates.newPassword = newPassword;
    if (encryptedPrivateKey) updates.encryptedPrivateKey = encryptedPrivateKey;
    if (relays.length) updates.relays = relays;

    if (Object.keys(updates).length === 0) {
      setStatus(updateStatus, 'Add at least one field to update.', 'error');
      return;
    }

    setStatus(updateStatus, 'Updating account...');
    try {
      await request('/api/v1/auth/update', {
        username: state.username,
        password: state.password,
        updates,
      });
      setStatus(updateStatus, 'Account updated successfully.', 'success');
    } catch (error) {
      setStatus(updateStatus, error.message, 'error');
    }
  });

  deleteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.username || !state.password) {
      setStatus(deleteStatus, 'Sign in before deleting your account.', 'error');
      return;
    }

    const formData = new FormData(deleteForm);
    const savedKey = formData.get('savedKey');
    const confirm = formData.get('confirm');

    if (!savedKey) {
      setStatus(deleteStatus, 'Please confirm you saved your private key.', 'error');
      return;
    }
    if (confirm !== 'DELETE') {
      setStatus(deleteStatus, 'Type DELETE to confirm account deletion.', 'error');
      return;
    }

    setStatus(deleteStatus, 'Deleting account...');
    try {
      await request('/api/v1/auth/delete', {
        username: state.username,
        password: state.password,
        savedKey: true,
      });
      setStatus(deleteStatus, 'Account deleted.', 'success');
      accountPanel.hidden = true;
      updatePanel.hidden = true;
      deletePanel.hidden = true;
      signinForm.reset();
      updateForm.reset();
      deleteForm.reset();
      state.username = null;
      state.password = null;
    } catch (error) {
      setStatus(deleteStatus, error.message, 'error');
    }
  });

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('verified') === '1') {
    const nip05 = (urlParams.get('nip05') || '').trim();
    const message = nip05
      ? `Account verified for ${nip05}. You can now sign in.`
      : 'Account verified. You can now sign in.';
    setStatus(verificationFlash, message, 'success');
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('verified');
    cleanUrl.searchParams.delete('nip05');
    window.history.replaceState({}, '', cleanUrl.toString());
  }
  const tokenFromLink = urlParams.get('token');
  if (tokenFromLink) {
    const redirectFromLink = urlParams.get('redirect');
    const params = new URLSearchParams({ token: tokenFromLink });
    if (redirectFromLink) params.set('redirect', redirectFromLink);
    window.location.href = `/verify?${params.toString()}`;
  }
});
