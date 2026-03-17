document.addEventListener('DOMContentLoaded', function () {
  const state = {
    username: null,
    password: null,
    signupUsername: null,
    signupPassword: null,
    signupEmail: null,
    signupRelays: [],
    signupVerified: false,
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
  const verifyEmailForm = document.getElementById('verifyEmailForm');
  const signupCompleteForm = document.getElementById('signupCompleteForm');
  const signupUsername = document.getElementById('signupUsername');
  const signupPassword = document.getElementById('signupPassword');
  const signupPasswordConfirm = document.getElementById('signupPasswordConfirm');
  const signupEmail = document.getElementById('signupEmail');
  const signupRelays = document.getElementById('signupRelays');
  const signupNsec = document.getElementById('signupNsec');
  const signupPin = document.getElementById('signupPin');
  const signupToken = document.getElementById('signupToken');
  const signupStatus = document.getElementById('signupStatus');
  const verifyStatus = document.getElementById('verifyStatus');
  const completeStatus = document.getElementById('completeStatus');
  const signupSuccess = document.getElementById('signupSuccess');
  const successUsername = document.getElementById('successUsername');
  const successPublicKey = document.getElementById('successPublicKey');

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

  function validateSignupStartForm() {
    const username = signupUsername?.value.trim().toLowerCase() || '';
    const password = signupPassword?.value || '';
    const email = signupEmail?.value.trim().toLowerCase() || '';
    const passwordConfirm = signupPasswordConfirm?.value || '';

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
    if (!passwordConfirm) {
      setStatus(signupStatus, 'Please confirm your password', 'error');
      signupPasswordConfirm?.focus();
      return false;
    }
    if (!email) {
      setStatus(signupStatus, 'Email is required', 'error');
      signupEmail?.focus();
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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus(signupStatus, 'Email format is invalid', 'error');
      signupEmail?.focus();
      return false;
    }
    if (password !== passwordConfirm) {
      setStatus(signupStatus, 'Passwords do not match', 'error');
      signupPasswordConfirm?.focus();
      return false;
    }

    const localPart = email.split('@')[0];
    if (localPart !== username) {
      setStatus(signupStatus, 'Username must match email local-part', 'error');
      signupUsername?.focus();
      return false;
    }

    return true;
  }

  if (signupStartForm) {
    signupStartForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      signupSuccess.hidden = true;
      if (!validateSignupStartForm()) return;

      const username = signupUsername.value.trim().toLowerCase();
      const password = signupPassword.value;
      const email = signupEmail.value.trim().toLowerCase();
      const relays = parseRelays(signupRelays?.value.trim() || '').filter((relay) => relay.startsWith('wss://'));

      setStatus(signupStatus, 'Sending verification email...', 'info');
      setStatus(verifyStatus, '', 'info');
      setStatus(completeStatus, '', 'info');

      try {
        const data = await request('/onboarding/start', {
          username,
          password,
          email,
          relays,
        });

        state.signupUsername = username;
        state.signupPassword = password;
        state.signupEmail = email;
        state.signupRelays = relays;
        state.signupVerified = false;

        verifyEmailForm.hidden = false;
        signupCompleteForm.hidden = true;
        setStatus(signupStatus, 'Verification sent. Enter the PIN or link token to continue.', 'success');

      } catch (error) {
        setStatus(signupStatus, `Registration start failed: ${error.message}`, 'error');
      }
    });
  }

  if (verifyEmailForm) {
    verifyEmailForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      const username = state.signupUsername || signupUsername?.value.trim().toLowerCase();
      const pin = signupPin?.value.trim();
      const token = signupToken?.value.trim();

      if (!username) {
        setStatus(verifyStatus, 'Start signup first.', 'error');
        return;
      }
      if (!pin && !token) {
        setStatus(verifyStatus, 'Enter either PIN or token.', 'error');
        return;
      }

      setStatus(verifyStatus, 'Verifying email...', 'info');
      try {
        await request('/verify-email', {
          username,
          pin: pin || undefined,
          token: token || undefined,
        });
        state.signupVerified = true;
        signupCompleteForm.hidden = false;
        setStatus(verifyStatus, 'Email verified. Continue to Step 3.', 'success');
      } catch (error) {
        setStatus(verifyStatus, `Verification failed: ${error.message}`, 'error');
      }
    });
  }

  if (signupCompleteForm) {
    signupCompleteForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      if (!state.signupVerified) {
        setStatus(completeStatus, 'Verify email before submitting private key.', 'error');
        return;
      }

      const username = state.signupUsername;
      const password = state.signupPassword;
      const nsecKey = signupNsec?.value.trim();

      if (!nsecKey) {
        setStatus(completeStatus, 'Private key is required', 'error');
        signupNsec?.focus();
        return;
      }

      setStatus(completeStatus, 'Completing account setup...', 'info');
      try {
        const data = await request('/onboarding/complete', {
          username,
          password,
          nsecKey,
        });

        successUsername.textContent = data.user.username;
        successPublicKey.textContent = data.user.publicKey;
        signupSuccess.hidden = false;
        setStatus(completeStatus, 'Account created successfully.', 'success');

        signupStartForm.reset();
        verifyEmailForm.reset();
        signupCompleteForm.reset();
        verifyEmailForm.hidden = true;
        signupCompleteForm.hidden = true;
        state.signupUsername = null;
        state.signupPassword = null;
        state.signupEmail = null;
        state.signupRelays = [];
        state.signupVerified = false;

        signupSuccess.scrollIntoView({ behavior: 'smooth' });
      } catch (error) {
        setStatus(completeStatus, `Completion failed: ${error.message}`, 'error');
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
      const data = await request('/signin', { username, password });
      state.username = username;
      state.password = password;

      publicKeyEl.textContent = data.publicKey || '—';
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
      await request('/update', {
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
      await request('/delete', {
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
  const tokenFromLink = urlParams.get('token');
  const userFromLink = urlParams.get('username');
  if (tokenFromLink && userFromLink) {
    verifyEmailForm.hidden = false;
    signupToken.value = tokenFromLink;
    signupUsername.value = userFromLink;
    state.signupUsername = userFromLink.trim().toLowerCase();
    setStatus(verifyStatus, 'Verification token loaded from link. Submit Step 2 to verify.', 'info');
  }
});
