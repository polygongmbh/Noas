document.addEventListener('DOMContentLoaded', function () {
  const state = {
    username: null,
    password: null,
    publicKey: null,
    signupUsername: null,
    emailVerificationMode: 'required_nip05_domains',
    emailVerificationEnabled: true,
    resendCooldownMinutes: 1,
    lastResendAttemptAt: 0,
    nip05Domain: window.location.hostname || '',
  };

  const signinForm = document.getElementById('signinForm');
  const credentialsForm = document.getElementById('credentialsForm');
  const relayForm = document.getElementById('relayForm');
  const deleteForm = document.getElementById('deleteForm');
  const signinStatus = document.getElementById('signinStatus');
  const credentialsStatus = document.getElementById('credentialsStatus');
  const relayStatus = document.getElementById('relayStatus');
  const deleteStatus = document.getElementById('deleteStatus');
  const pictureStatus = document.getElementById('pictureStatus');
  const accountPanel = document.getElementById('accountPanel');
  const updatePanel = document.getElementById('updatePanel');
  const deletePanel = document.getElementById('deletePanel');
  const profileSummary = document.getElementById('profileSummary');
  const profilePicturePreview = document.getElementById('profilePicturePreview');
  const profilePictureStatus = document.getElementById('profilePictureStatus');
  const publicKeyEl = document.getElementById('publicKey');
  const encryptedKeyEl = document.getElementById('encryptedKey');
  const privateKeyEl = document.getElementById('privateKey');
  const relayListEl = document.getElementById('relayList');
  const copyEncrypted = document.getElementById('copyEncrypted');
  const decryptPrivateKeyButton = document.getElementById('decryptPrivateKey');
  const pictureForm = document.getElementById('pictureForm');
  const profilePictureInput = document.getElementById('profilePictureInput');
  const deleteConfirmUsernameInput = deleteForm?.querySelector('input[name="confirm_username"]');

  const signupStartForm = document.getElementById('signupStartForm');
  const signupUsername = document.getElementById('signupUsername');
  const signupEmailLabel = document.getElementById('signupEmailLabel');
  const signupEmail = document.getElementById('signupEmail');
  const signupEmailHint = document.getElementById('signupEmailHint');
  const signupPassword = document.getElementById('signupPassword');
  const signupPasswordConfirm = document.getElementById('signupPasswordConfirm');
  const signupPublicKey = document.getElementById('signupPublicKey');
  const signupPrivateKeyEncrypted = document.getElementById('signupPrivateKeyEncrypted');
  const signupProfilePictureInput = document.getElementById('signupProfilePictureInput');
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
    const verificationMode = String(state.emailVerificationMode || 'off').trim().toLowerCase();
    const lockEmail = verificationMode === 'required_nip05_domains';
    const requireEmail = verificationMode === 'required' || lockEmail;
    const lockHint = 'Because EMAIL_VERIFICATION_MODE=required_nip05_domains, email must be username@NIP05_DOMAIN.';
    const requiredHint = 'Email verification is required. Enter the email that should receive verification links.';
    signupEmail.readOnly = lockEmail;
    signupEmail.required = requireEmail;
    signupEmail.dataset.locked = lockEmail ? 'true' : 'false';

    if (lockEmail) {
      signupEmail.value = getDerivedSignupEmail(signupUsername?.value);
      signupEmail.title = lockHint;
      signupEmailHint.textContent = lockHint;
      signupEmailLabel.classList.add('email-lock-hint');
      return;
    }

    signupEmail.removeAttribute('title');
    signupEmailHint.textContent = requireEmail
      ? requiredHint
      : 'Optional when EMAIL_VERIFICATION_MODE=off. Used for account and verification emails.';
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

  function resendCooldownRemainingMs() {
    const cooldownMs = Math.max(1, Number(state.resendCooldownMinutes) || 1) * 60 * 1000;
    return Math.max(0, Number(state.lastResendAttemptAt || 0) + cooldownMs - Date.now());
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
      const modeFromMetadata = String(metadata.email_verification_mode || '').trim().toLowerCase();
      if (modeFromMetadata === 'off' || modeFromMetadata === 'required' || modeFromMetadata === 'required_nip05_domains') {
        state.emailVerificationMode = modeFromMetadata;
      } else if (typeof metadata.email_verification_enabled === 'boolean') {
        state.emailVerificationMode = metadata.email_verification_enabled ? 'required_nip05_domains' : 'off';
      }
      state.emailVerificationEnabled = state.emailVerificationMode !== 'off';
      if (Number.isFinite(Number(metadata.resend_cooldown_minutes))) {
        state.resendCooldownMinutes = Math.max(1, Number(metadata.resend_cooldown_minutes) || 1);
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
      if (state.emailVerificationMode === 'required_nip05_domains') {
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

  function setProfilePicture(publicKey) {
    const normalized = String(publicKey || '').trim();
    if (!profileSummary || !profilePicturePreview || !profilePictureStatus) return;
    if (!normalized) {
      profileSummary.hidden = true;
      profilePicturePreview.hidden = true;
      profilePicturePreview.removeAttribute('src');
      profilePictureStatus.textContent = 'No profile picture available';
      return;
    }

    const pictureUrl = `/api/v1/picture/${normalized}`;
    profileSummary.hidden = false;
    profilePicturePreview.hidden = false;
    profilePicturePreview.src = pictureUrl;
    profilePictureStatus.textContent = pictureUrl;
  }

  function clearProfilePicture() {
    if (!profileSummary || !profilePicturePreview || !profilePictureStatus) return;
    profileSummary.hidden = true;
    profilePicturePreview.hidden = true;
    profilePicturePreview.removeAttribute('src');
    profilePictureStatus.textContent = 'No profile picture uploaded';
  }

  async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const base64Payload = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64Payload);
      };
      reader.onerror = () => reject(new Error('Unable to read selected file.'));
      reader.readAsDataURL(file);
    });
  }

  function validateSignupStartForm() {
    const username = signupUsername?.value.trim().toLowerCase() || '';
    const email = signupEmail?.value.trim().toLowerCase() || '';
    const password = signupPassword?.value || '';
    const passwordConfirm = signupPasswordConfirm?.value || '';
    const publicKey = signupPublicKey?.value.trim() || '';
    const privateKeyEncrypted = signupPrivateKeyEncrypted?.value.trim() || '';
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
    const verificationMode = String(state.emailVerificationMode || 'off').trim().toLowerCase();
    const requireEmail = verificationMode === 'required' || verificationMode === 'required_nip05_domains';
    if (requireEmail && !email) {
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
    if (email && !signupEmail?.checkValidity()) {
      setStatus(signupStatus, 'Please enter a valid email address', 'error');
      signupEmail?.focus();
      return false;
    }
    if (verificationMode === 'required_nip05_domains') {
      const expectedEmail = getDerivedSignupEmail(username);
      if (email !== expectedEmail) {
        signupEmail.value = expectedEmail;
        setStatus(signupStatus, 'Email must follow username@NIP05_DOMAIN when verification mode is required_nip05_domains', 'error');
        signupEmail?.focus();
        return false;
      }
    }
    if (publicKey && !(/^[a-f0-9]{64}$/i.test(publicKey) || publicKey.startsWith('npub1'))) {
      setStatus(signupStatus, 'Public key must be a valid npub1... or 64-char hex value', 'error');
      signupPublicKey?.focus();
      return false;
    }
    if (privateKeyEncrypted && !privateKeyEncrypted.startsWith('ncryptsec')) {
      setStatus(signupStatus, 'Encrypted private key must start with ncryptsec', 'error');
      signupPrivateKeyEncrypted?.focus();
      return false;
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
      const signupProfilePicture = signupProfilePictureInput?.files?.[0] || null;
      setStatus(signupStatus, 'Sending verification email...', 'info');

      try {
        const requestBody = {
          username,
          email: email || undefined,
          public_key: publicKey || undefined,
          private_key_encrypted: privateKeyEncrypted || undefined,
        };
        if (signupProfilePicture) {
          requestBody.profile_picture_data = await fileToBase64(signupProfilePicture);
          requestBody.profile_picture_content_type = signupProfilePicture.type || 'application/octet-stream';
        }
        if (publicKey || privateKeyEncrypted) {
          requestBody.password_hash = await sha256Hex(password);
        } else {
          requestBody.password = password;
        }
        const data = await request('/api/v1/auth/register', requestBody);

        state.signupUsername = username;
        if (resendUsername && !resendUsername.value) {
          resendUsername.value = username;
        }
        const verificationHint = data.verify_url
          ? ` Verification link: ${data.verify_url}`
          : '';
        const keyHint = data.key_source === 'generated'
          ? ` A Nostr keypair was generated automatically (pubkey: ${window.NoasNostr?.npubFromHexPublicKey(data.public_key) || data.public_key || 'unknown'}).`
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
      const remainingMs = resendCooldownRemainingMs();
      if (remainingMs > 0) {
        const secondsLeft = Math.max(1, Math.ceil(remainingMs / 1000));
        setStatus(resendStatus, `Wait ${secondsLeft}s before requesting another resend.`, 'error');
        return;
      }
      setStatus(resendStatus, 'Resending verification email...', 'info');
      try {
        const data = await request('/api/v1/auth/resend', { username });
        state.lastResendAttemptAt = Date.now();
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
      const passwordHash = await sha256Hex(password);
      const data = await request('/api/v1/auth/signin', { username, password_hash: passwordHash });
      state.username = username;
      state.password = password;
      state.publicKey = String(data.public_key || '').trim().toLowerCase() || null;

      const normalizedPublicKey = data.public_key || '';
      setProfilePicture(normalizedPublicKey);
      publicKeyEl.textContent = window.NoasNostr?.npubFromHexPublicKey(data.public_key) || data.public_key || '—';
      encryptedKeyEl.textContent = data.private_key_encrypted || '—';
      privateKeyEl.textContent = '—';
      relayListEl.textContent = (data.relays || []).join(', ') || '—';
      accountPanel.hidden = false;
      updatePanel.hidden = false;
      deletePanel.hidden = false;
      setStatus(signinStatus, 'Signed in successfully.', 'success');
      const relayTextarea = relayForm?.querySelector('textarea[name="relays"]');
      if (relayTextarea) {
        relayTextarea.value = (data.relays || []).join('\n');
      }
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

  decryptPrivateKeyButton.addEventListener('click', async () => {
    const encryptedPrivateKey = encryptedKeyEl.textContent;
    if (!encryptedPrivateKey || encryptedPrivateKey === '—') {
      setStatus(signinStatus, 'No encrypted key is available to decrypt.', 'error');
      return;
    }
    if (!state.password) {
      setStatus(signinStatus, 'Sign in again before decrypting your key.', 'error');
      return;
    }

    setStatus(signinStatus, 'Decrypting private key locally...', 'info');
    try {
      const decrypted = await window.NoasNostr.decryptPrivateKey(encryptedPrivateKey, state.password);
      privateKeyEl.textContent = decrypted.nsec || decrypted.hex || '—';
      setStatus(signinStatus, 'Private key decrypted locally in your browser.', 'success');
    } catch (error) {
      privateKeyEl.textContent = '—';
      setStatus(signinStatus, `Unable to decrypt private key: ${error.message}`, 'error');
    }
  });

  if (profilePicturePreview) {
    profilePicturePreview.addEventListener('error', () => {
      profilePicturePreview.hidden = true;
      profilePicturePreview.removeAttribute('src');
      if (profileSummary) profileSummary.hidden = false;
      if (profilePictureStatus) profilePictureStatus.textContent = 'No profile picture uploaded';
    });

    profilePicturePreview.addEventListener('load', () => {
      profilePicturePreview.hidden = false;
    });
  }

  credentialsForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.username || !state.password) {
      setStatus(credentialsStatus, 'Sign in before updating your account.', 'error');
      return;
    }

    const formData = new FormData(credentialsForm);
    const newPassword = String(formData.get('new_password') || '');
    const privateKeyInput = String(formData.get('private_key_input') || '').trim();

    if (!newPassword && !privateKeyInput) {
      setStatus(credentialsStatus, 'Enter both a new password and private key.', 'error');
      return;
    }
    if (!newPassword || !privateKeyInput) {
      setStatus(credentialsStatus, 'Password and private key must be updated together.', 'error');
      return;
    }

    setStatus(credentialsStatus, 'Updating password and key...', 'info');
    try {
      let encryptedPrivateKey = '';
      let resolvedPublicKey = '';

      if (privateKeyInput.startsWith('ncryptsec')) {
        const decrypted = await window.NoasNostr.decryptPrivateKey(privateKeyInput, newPassword);
        encryptedPrivateKey = privateKeyInput;
        resolvedPublicKey = String(decrypted.publicKey || '').trim().toLowerCase();
      } else {
        const encrypted = await window.NoasNostr.encryptPrivateKey(privateKeyInput, newPassword);
        encryptedPrivateKey = encrypted.privateKeyEncrypted;
        resolvedPublicKey = String(encrypted.publicKey || '').trim().toLowerCase();
      }

      if (!resolvedPublicKey) {
        throw new Error('Unable to derive a public key from the provided private key.');
      }

      await request('/api/v1/auth/update', {
        username: state.username,
        password: state.password,
        updates: {
          new_password: newPassword,
          public_key: resolvedPublicKey,
          private_key_encrypted: encryptedPrivateKey,
        },
      });
      state.password = newPassword;
      state.publicKey = resolvedPublicKey;
      encryptedKeyEl.textContent = encryptedPrivateKey;
      publicKeyEl.textContent = window.NoasNostr?.npubFromHexPublicKey(resolvedPublicKey) || resolvedPublicKey || '—';
      privateKeyEl.textContent = '—';
      setProfilePicture(resolvedPublicKey);
      setStatus(credentialsStatus, 'Password, public key, and encrypted key updated after local verification.', 'success');
      credentialsForm.reset();
    } catch (error) {
      setStatus(credentialsStatus, error.message, 'error');
    }
  });

  relayForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.username || !state.password) {
      setStatus(relayStatus, 'Sign in before updating relays.', 'error');
      return;
    }

    const formData = new FormData(relayForm);
    const relays = parseRelays(formData.get('relays'));
    if (!relays.length) {
      setStatus(relayStatus, 'Enter at least one relay URL.', 'error');
      return;
    }

    setStatus(relayStatus, 'Updating relays...', 'info');
    try {
      await request('/api/v1/auth/update', {
        username: state.username,
        password: state.password,
        updates: { relays },
      });
      relayListEl.textContent = relays.join(', ');
      setStatus(relayStatus, 'Relays updated.', 'success');
    } catch (error) {
      setStatus(relayStatus, error.message, 'error');
    }
  });

  pictureForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.username || !state.password) {
      setStatus(pictureStatus, 'Sign in before uploading a profile picture.', 'error');
      return;
    }

    const file = profilePictureInput?.files?.[0];
    if (!file) {
      setStatus(pictureStatus, 'Choose an image file to upload.', 'error');
      return;
    }

    setStatus(pictureStatus, 'Uploading profile picture...', 'info');

    try {
      const payloadBase64 = await fileToBase64(file);
      const data = await request('/api/v1/auth/update', {
        username: state.username,
        password: state.password,
        updates: {
          profile_picture_data: payloadBase64,
          profile_picture_content_type: file.type || 'application/octet-stream',
        },
      });

      const resolvedPictureUrl = data.picture_url || `/api/v1/picture/${state.publicKey || state.username}`;
      const pictureUrl = `${resolvedPictureUrl}?t=${Date.now()}`;
      if (profileSummary) profileSummary.hidden = false;
      if (profilePicturePreview) {
        profilePicturePreview.src = pictureUrl;
        profilePicturePreview.hidden = false;
      }
      if (profilePictureStatus) {
        profilePictureStatus.textContent = resolvedPictureUrl || 'Profile picture uploaded';
      }
      setStatus(pictureStatus, 'Profile picture uploaded.', 'success');
      pictureForm.reset();
    } catch (error) {
      setStatus(pictureStatus, error.message, 'error');
    }
  });

  deleteConfirmUsernameInput?.addEventListener('paste', (event) => {
    event.preventDefault();
    setStatus(deleteStatus, 'Paste is disabled. Type your username manually.', 'error');
  });

  deleteConfirmUsernameInput?.addEventListener('drop', (event) => {
    event.preventDefault();
  });

  deleteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.username || !state.password) {
      setStatus(deleteStatus, 'Sign in before deleting your account.', 'error');
      return;
    }

    const formData = new FormData(deleteForm);
    const savedKey = formData.get('saved_key');
    const confirmUsername = String(formData.get('confirm_username') || '').trim().toLowerCase();

    if (!savedKey) {
      setStatus(deleteStatus, 'Please confirm you saved your private key.', 'error');
      return;
    }
    if (confirmUsername !== String(state.username || '').trim().toLowerCase()) {
      setStatus(deleteStatus, 'Type your exact username to confirm account deletion.', 'error');
      return;
    }

    setStatus(deleteStatus, 'Deleting account...');
    try {
      await request('/api/v1/auth/delete', {
        username: state.username,
        password: state.password,
      });
      setStatus(deleteStatus, 'Account deleted.', 'success');
      accountPanel.hidden = true;
      updatePanel.hidden = true;
      deletePanel.hidden = true;
      signinForm.reset();
      credentialsForm?.reset();
      relayForm?.reset();
      deleteForm.reset();
      state.username = null;
      state.password = null;
      state.publicKey = null;
      clearProfilePicture();
      privateKeyEl.textContent = '—';
    } catch (error) {
      setStatus(deleteStatus, error.message, 'error');
    }
  });

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('verified') === '1') {
    const nip05 = (urlParams.get('nip05') || '').trim();
    const email = (urlParams.get('email') || '').trim();
    const message = email
      ? `Account verified for ${email}. You can now sign in.`
      : nip05
      ? `Account verified for ${nip05}. You can now sign in.`
      : 'Account verified. You can now sign in.';
    setStatus(verificationFlash, message, 'success');
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('verified');
    cleanUrl.searchParams.delete('email');
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
