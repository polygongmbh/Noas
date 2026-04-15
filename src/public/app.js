document.addEventListener('DOMContentLoaded', function () {
  const AUTH_SESSION_KEY = 'noas_auth_session_v1';
  const state = {
    username: null,
    password: null,
    passwordHash: null,
    publicKey: null,
    role: null,
    signupUsername: null,
    emailVerificationMode: 'required_nip05_domains',
    emailVerificationEnabled: true,
    resendCooldownMinutes: 1,
    lastResendAttemptAt: 0,
    nip05Domain: window.location.hostname || '',
  };

  const signinForm = document.getElementById('signinForm');
  const homeUnifiedAuthForm = document.getElementById('homeUnifiedAuthForm');
  const portalIdentity = document.getElementById('portalIdentity');
  const portalStatusBadge = document.getElementById('portalStatusBadge');
  const portalTabs = document.getElementById('portalTabs');
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
  const adminPanel = document.getElementById('adminPanel');
  const adminUsersList = document.getElementById('adminUsersList');
  const adminStatus = document.getElementById('adminStatus');
  const refreshAdminUsers = document.getElementById('refreshAdminUsers');
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
  const deleteSavedKeyInput = deleteForm?.querySelector('input[name="saved_key"]');
  const deleteSubmitButton = document.getElementById('deleteSubmitButton');
  const deleteUsernamePrompt = document.getElementById('deleteUsernamePrompt');

  const signupStartForm = document.getElementById('signupStartForm');
  const signupUsername = document.getElementById('signupUsername');
  const signupDescription = document.getElementById('signupDescription');
  const signupEmailLabel = document.getElementById('signupEmailLabel');
  const signupEmail = document.getElementById('signupEmail');
  const signupEmailHint = document.getElementById('signupEmailHint');
  const signupPassword = document.getElementById('signupPassword');
  const signupPasswordConfirm = document.getElementById('signupPasswordConfirm');
  const signupPublicKey = document.getElementById('signupPublicKey');
  const signupPrivateKeyEncrypted = document.getElementById('signupPrivateKeyEncrypted');
  const signupProfilePictureInput = document.getElementById('signupProfilePictureInput');
  const signupSubmit = document.getElementById('signupSubmit');
  const signupStatus = document.getElementById('signupStatus');
  const verificationFlash = document.getElementById('verificationFlash');
  const verificationNextStep = document.getElementById('verificationNextStep');
  const resendForm = document.getElementById('resendForm');
  const resendUsername = document.getElementById('resendUsername');
  const resendStatus = document.getElementById('resendStatus');
  const noasVersion = document.getElementById('noasVersion');
  const noasVersionFooter = document.getElementById('noasVersionFooter');
  const signOutLink = document.getElementById('signOutLink');
  const homeAuthTitle = document.getElementById('homeAuthTitle');
  const homeAuthDescription = document.getElementById('homeAuthDescription');
  const homeAuthSubmit = document.getElementById('homeAuthSubmit');
  const homeAuthToggleSignIn = document.getElementById('homeAuthToggleSignIn');
  const homeAuthToggleRegister = document.getElementById('homeAuthToggleRegister');
  const homeConfirmPasswordField = document.getElementById('homeConfirmPasswordField');
  const homeRegisterWarning = document.getElementById('homeRegisterWarning');
  const homeShowRegister = document.getElementById('homeShowRegister');
  const homeShowSignIn = document.getElementById('homeShowSignIn');
  const registerAdvancedToggle = document.getElementById('registerAdvancedToggle');
  const registerAdvancedPanel = document.getElementById('registerAdvancedPanel');
  const isUnifiedHomeAuth = Boolean(homeUnifiedAuthForm);

  function updateDeleteGuardState() {
    if (!deleteSubmitButton || !deleteForm) return;
    const confirmUsername = String(deleteConfirmUsernameInput?.value || '').trim().toLowerCase();
    const expectedUsername = String(state.username || '').trim().toLowerCase();
    const savedKeyConfirmed = Boolean(deleteSavedKeyInput?.checked);
    deleteSubmitButton.disabled = !(savedKeyConfirmed && confirmUsername && confirmUsername === expectedUsername);
  }

  function persistAuthSession() {
    if (!state.username || !state.passwordHash) return;
    try {
      window.sessionStorage.setItem(
        AUTH_SESSION_KEY,
        JSON.stringify({
          username: state.username,
          password: state.password,
          password_hash: state.passwordHash,
        })
      );
    } catch {
      // Non-blocking fallback.
    }
  }

  function readAuthSession() {
    try {
      const raw = window.sessionStorage.getItem(AUTH_SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return {
        username: String(parsed.username || '').trim().toLowerCase(),
        password: String(parsed.password || ''),
        password_hash: String(parsed.password_hash || '').trim().toLowerCase(),
      };
    } catch {
      return null;
    }
  }

  function clearAuthSession() {
    try {
      window.sessionStorage.removeItem(AUTH_SESSION_KEY);
    } catch {
      // Non-blocking fallback.
    }
  }

  function isUnifiedHomeMode(mode) {
    if (!homeUnifiedAuthForm) return false;
    return String(homeUnifiedAuthForm.dataset.authMode || 'signin').trim().toLowerCase() === mode;
  }

  function setUnifiedHomeMode(mode) {
    if (!homeUnifiedAuthForm) return;
    const normalizedMode = mode === 'register' ? 'register' : 'signin';
    homeUnifiedAuthForm.dataset.authMode = normalizedMode;

    const isRegisterMode = normalizedMode === 'register';
    if (homeAuthTitle) homeAuthTitle.textContent = isRegisterMode ? 'Register' : 'Sign in';
    if (homeAuthDescription) {
      homeAuthDescription.textContent = isRegisterMode
        ? 'Create your Nostr identity'
        : 'Access your Nostr account';
    }
    if (homeAuthSubmit) {
      homeAuthSubmit.textContent = isRegisterMode
        ? (state.emailVerificationEnabled ? 'Register & Send Verification' : 'Register')
        : 'Sign in';
    }
    if (homeAuthToggleSignIn) homeAuthToggleSignIn.hidden = isRegisterMode;
    if (homeAuthToggleRegister) homeAuthToggleRegister.hidden = !isRegisterMode;
    if (signupEmailLabel) signupEmailLabel.hidden = !isRegisterMode;
    if (homeConfirmPasswordField) homeConfirmPasswordField.hidden = !isRegisterMode;
    if (registerAdvancedToggle) registerAdvancedToggle.hidden = !isRegisterMode;
    if (homeRegisterWarning) homeRegisterWarning.hidden = !isRegisterMode;
    if (signupStatus) signupStatus.hidden = !isRegisterMode;
    if (signinStatus) signinStatus.hidden = isRegisterMode;
    if (signupPassword) {
      signupPassword.setAttribute('autocomplete', isRegisterMode ? 'new-password' : 'current-password');
    }
    if (signupEmail) signupEmail.disabled = !isRegisterMode;
    if (signupPasswordConfirm) {
      signupPasswordConfirm.disabled = !isRegisterMode;
      signupPasswordConfirm.required = isRegisterMode;
    }
    if (signupPublicKey) signupPublicKey.disabled = !isRegisterMode;
    if (signupPrivateKeyEncrypted) signupPrivateKeyEncrypted.disabled = !isRegisterMode;
    if (signupProfilePictureInput) signupProfilePictureInput.disabled = !isRegisterMode;
    if (!isRegisterMode && registerAdvancedPanel) {
      registerAdvancedPanel.hidden = true;
    }
    if (!isRegisterMode && registerAdvancedToggle) {
      registerAdvancedToggle.textContent = '▸ Show advanced options';
    }
    setStatus(signupStatus, '', 'info');
    setStatus(signinStatus, '', 'info');
    syncSignupEmailLockState();
  }

  function getDerivedSignupEmail(usernameRaw) {
    const username = String(usernameRaw || '').trim().toLowerCase();
    const domain = String(state.nip05Domain || '').trim().toLowerCase();
    if (!username || !domain) return '';
    return `${username}@${domain}`;
  }

  function syncSignupEmailLockState() {
    if (!signupEmail || !signupEmailLabel || !signupEmailHint) return;
    if (isUnifiedHomeAuth && !isUnifiedHomeMode('register')) {
      signupEmail.readOnly = false;
      signupEmail.required = false;
      signupEmail.dataset.locked = 'false';
      signupEmail.removeAttribute('title');
      signupEmailHint.textContent = 'Used for account and verification emails.';
      signupEmailLabel.classList.remove('email-lock-hint');
      return;
    }
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

  function syncVerificationVisibility() {
    if (resendForm) {
      resendForm.hidden = !state.emailVerificationEnabled;
    }
    if (verificationNextStep) {
      verificationNextStep.hidden = !state.emailVerificationEnabled;
    }
    if (!state.emailVerificationEnabled && resendStatus) {
      resendStatus.textContent = '';
      resendStatus.dataset.type = 'info';
    }
    if (signupDescription) {
      signupDescription.textContent = state.emailVerificationEnabled
        ? 'Register with username + email + password. Verification is sent to your account email.'
        : 'Register with username + password. Email verification is disabled on this server.';
    }
    if (signupSubmit) {
      signupSubmit.textContent = state.emailVerificationEnabled
        ? 'Register & Send Verification'
        : 'Register';
    }
    if (homeUnifiedAuthForm && homeAuthSubmit && isUnifiedHomeMode('register')) {
      homeAuthSubmit.textContent = state.emailVerificationEnabled
        ? 'Register & Send Verification'
        : 'Register';
    }
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
      }
      state.emailVerificationEnabled = state.emailVerificationMode !== 'off';
      if (typeof metadata.nip05_domain === 'string' && metadata.nip05_domain.trim()) {
        state.nip05Domain = metadata.nip05_domain.trim().toLowerCase();
      }
      syncSignupEmailLockState();
      syncVerificationVisibility();
    } catch {
      // Non-blocking: keep placeholder when metadata is unavailable.
      syncSignupEmailLockState();
      syncVerificationVisibility();
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
  syncVerificationVisibility();
  loadNoasVersion();

  if (homeUnifiedAuthForm) {
    setUnifiedHomeMode('signin');
  }

  if (homeShowRegister && homeUnifiedAuthForm) {
    homeShowRegister.addEventListener('click', () => {
      setUnifiedHomeMode('register');
    });
  }

  if (homeShowSignIn && homeUnifiedAuthForm) {
    homeShowSignIn.addEventListener('click', () => {
      setUnifiedHomeMode('signin');
    });
  }

  if (registerAdvancedToggle && registerAdvancedPanel) {
    registerAdvancedToggle.addEventListener('click', () => {
      const opening = registerAdvancedPanel.hidden;
      registerAdvancedPanel.hidden = !opening;
      registerAdvancedToggle.textContent = opening ? '▾ Hide advanced options' : '▸ Show advanced options';
    });
  }

  if (portalTabs) {
    const tabTriggers = Array.from(portalTabs.querySelectorAll('[data-tab-target]'));
    const tabPanels = Array.from(portalTabs.querySelectorAll('[data-tab-panel]'));
    const activateTab = (target) => {
      tabTriggers.forEach((trigger) => {
        const active = trigger.dataset.tabTarget === target;
        trigger.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      tabPanels.forEach((panel) => {
        panel.hidden = panel.dataset.tabPanel !== target;
      });
    };
    tabTriggers.forEach((trigger) => {
      trigger.addEventListener('click', () => activateTab(trigger.dataset.tabTarget));
    });
    activateTab('overview');
  }

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

  async function adminRequest(path, payload) {
    if (!state.username || !state.passwordHash) {
      throw new Error('Sign in before using admin tools.');
    }
    return request(path, {
      username: state.username,
      password_hash: state.passwordHash,
      ...payload,
    });
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

  function roleRank(role) {
    const normalized = String(role || '').trim().toLowerCase();
    if (normalized === 'admin') return 3;
    if (normalized === 'moderator') return 2;
    return 1;
  }

  function canManageUser(actorRole, targetRole, targetUsername) {
    if (!actorRole) return false;
    if (state.username && targetUsername && state.username === targetUsername) return false;
    return roleRank(actorRole) > roleRank(targetRole);
  }

  function formatUserIdentifier(user) {
    if (!user) return '—';
    const pubkey = String(user.public_key || '').trim();
    if (!pubkey) return '—';
    const npub = window.NoasNostr?.npubFromHexPublicKey(pubkey);
    return npub || pubkey;
  }

  function renderAdminUsers(users = []) {
    if (!adminUsersList) return;
    adminUsersList.innerHTML = '';
    if (!users.length) {
      const empty = document.createElement('div');
      empty.className = 'admin-empty';
      empty.textContent = 'No users returned.';
      adminUsersList.appendChild(empty);
      return;
    }

    users.forEach((user) => {
      const card = document.createElement('div');
      card.className = 'admin-user';
      card.dataset.username = user.username;

      const main = document.createElement('div');
      main.className = 'admin-user-main';

      const avatar = document.createElement('img');
      avatar.className = 'admin-avatar';
      avatar.alt = `${user.username} avatar`;
      if (user.picture_url) {
        avatar.src = user.picture_url;
      } else {
        avatar.classList.add('placeholder');
      }
      avatar.addEventListener('error', () => {
        avatar.removeAttribute('src');
        avatar.classList.add('placeholder');
      });
      main.appendChild(avatar);

      const meta = document.createElement('div');
      meta.className = 'admin-meta';

      const name = document.createElement('div');
      name.className = 'admin-name';
      name.textContent = user.username;
      meta.appendChild(name);

      const email = document.createElement('div');
      email.className = 'admin-sub';
      email.textContent = user.registration_email || '—';
      meta.appendChild(email);

      const pubkey = document.createElement('div');
      pubkey.className = 'admin-sub';
      pubkey.textContent = formatUserIdentifier(user);
      meta.appendChild(pubkey);

      main.appendChild(meta);
      card.appendChild(main);

      const tags = document.createElement('div');
      tags.className = 'admin-tags';
      const roleTag = document.createElement('span');
      roleTag.className = 'tag';
      roleTag.textContent = user.role || 'user';
      const statusTag = document.createElement('span');
      statusTag.className = `tag status-${user.status || 'unknown'}`;
      statusTag.textContent = user.status || 'unknown';
      tags.appendChild(roleTag);
      tags.appendChild(statusTag);
      card.appendChild(tags);

      const controls = document.createElement('div');
      controls.className = 'admin-controls';

      const roleSelect = document.createElement('select');
      roleSelect.className = 'role-select';
      ['user', 'moderator', 'admin'].forEach((role) => {
        const option = document.createElement('option');
        option.value = role;
        option.textContent = role;
        if (role === user.role) option.selected = true;
        roleSelect.appendChild(option);
      });

      const canManage = canManageUser(state.role, user.role, user.username);
      roleSelect.disabled = state.role !== 'admin' || state.username === user.username;
      if (state.role !== 'admin') {
        roleSelect.hidden = true;
      }

      const verifyButton = document.createElement('button');
      verifyButton.type = 'button';
      verifyButton.className = 'btn subtle';
      verifyButton.textContent = 'Verify';
      verifyButton.disabled = !canManage || user.status !== 'unverified_email';
      if (user.status !== 'unverified_email') {
        verifyButton.hidden = true;
      }

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'btn danger';
      deleteButton.textContent = 'Delete';
      deleteButton.disabled = !canManage;
      if (state.role === 'moderator' && user.role === 'admin') {
        deleteButton.hidden = true;
      }

      roleSelect.addEventListener('change', async () => {
        if (state.role !== 'admin') return;
        const newRole = roleSelect.value;
        setStatus(adminStatus, `Updating role for ${user.username}...`, 'info');
        try {
          await adminRequest('/api/v1/admin/users/role', {
            target_username: user.username,
            new_role: newRole,
          });
          setStatus(adminStatus, `Updated role for ${user.username}.`, 'success');
          await loadAdminUsers();
        } catch (error) {
          roleSelect.value = user.role || 'user';
          setStatus(adminStatus, error.message, 'error');
        }
      });

      verifyButton.addEventListener('click', async () => {
        if (!canManage || user.status !== 'unverified_email') return;
        setStatus(adminStatus, `Verifying ${user.username}...`, 'info');
        try {
          await adminRequest('/api/v1/admin/users/verify', {
            target_username: user.username,
          });
          setStatus(adminStatus, `Verified ${user.username}.`, 'success');
          await loadAdminUsers();
        } catch (error) {
          setStatus(adminStatus, error.message, 'error');
        }
      });

      deleteButton.addEventListener('click', async () => {
        if (!canManage) return;
        const confirmed = window.confirm(`Delete ${user.username}? This cannot be undone.`);
        if (!confirmed) return;
        setStatus(adminStatus, `Deleting ${user.username}...`, 'info');
        try {
          await adminRequest('/api/v1/admin/users/delete', {
            target_username: user.username,
          });
          setStatus(adminStatus, `Deleted ${user.username}.`, 'success');
          await loadAdminUsers();
        } catch (error) {
          setStatus(adminStatus, error.message, 'error');
        }
      });

      controls.appendChild(roleSelect);
      controls.appendChild(verifyButton);
      controls.appendChild(deleteButton);
      card.appendChild(controls);

      adminUsersList.appendChild(card);
    });
  }

  async function loadAdminUsers() {
    if (!adminPanel || !adminUsersList) return;
    if (!state.role || (state.role !== 'admin' && state.role !== 'moderator')) return;
    setStatus(adminStatus, 'Loading users...', 'info');
    try {
      const data = await adminRequest('/api/v1/admin/users/list', {});
      renderAdminUsers(data.users || []);
      setStatus(adminStatus, `Loaded ${data.users?.length || 0} users.`, 'success');
    } catch (error) {
      setStatus(adminStatus, error.message, 'error');
    }
  }

  async function applySignedInState({ username, password, passwordHash, data }) {
    state.username = username;
    state.password = password;
    state.passwordHash = passwordHash;
    state.publicKey = String(data.public_key || '').trim().toLowerCase() || null;
    state.role = String(data.role || 'user').trim().toLowerCase();

    if (portalIdentity) {
      const nip05Domain = String(state.nip05Domain || window.location.hostname || '').trim();
      portalIdentity.textContent = state.username && nip05Domain
        ? `${state.username}@${nip05Domain}`
        : String(state.username || '');
    }
    if (portalStatusBadge) {
      portalStatusBadge.className = 'badge badge-success';
      portalStatusBadge.textContent = 'verified';
    }
    if (deleteUsernamePrompt && state.username) {
      deleteUsernamePrompt.textContent = state.username;
    }
    updateDeleteGuardState();

    const normalizedPublicKey = data.public_key || '';
    setProfilePicture(normalizedPublicKey);
    if (publicKeyEl) {
      publicKeyEl.textContent = window.NoasNostr?.npubFromHexPublicKey(data.public_key) || data.public_key || '—';
    }
    if (encryptedKeyEl) {
      encryptedKeyEl.textContent = data.private_key_encrypted || '—';
    }
    if (privateKeyEl) {
      privateKeyEl.textContent = '—';
    }
    if (relayListEl) {
      relayListEl.textContent = (data.relays || []).join(', ') || '—';
    }
    if (accountPanel) accountPanel.hidden = false;
    if (updatePanel) updatePanel.hidden = false;
    if (deletePanel) deletePanel.hidden = false;
    if (adminPanel) {
      adminPanel.hidden = !(state.role === 'admin' || state.role === 'moderator');
    }
    const relayTextarea = relayForm?.querySelector('textarea[name="relays"]');
    if (relayTextarea) {
      relayTextarea.value = (data.relays || []).join('\n');
    }
    persistAuthSession();
    if (state.role === 'admin' || state.role === 'moderator') {
      await loadAdminUsers();
    }
  }

  async function autoSigninAndRedirectToPortal({ username, password, statusElement, prefixMessage = '' }) {
    const normalizedUsername = String(username || '').trim().toLowerCase();
    const rawPassword = String(password || '');
    if (!normalizedUsername || !rawPassword) return false;
    try {
      const passwordHash = await sha256Hex(rawPassword);
      const data = await request('/api/v1/auth/signin', {
        username: normalizedUsername,
        password_hash: passwordHash,
      });
      await applySignedInState({
        username: normalizedUsername,
        password: rawPassword,
        passwordHash,
        data,
      });
      window.location.assign('/portal');
      return true;
    } catch (error) {
      if (statusElement) {
        const prefix = prefixMessage ? `${prefixMessage} ` : '';
        setStatus(statusElement, `${prefix}${error.message}`, 'error');
      }
      return false;
    }
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

  if (signupStartForm && !isUnifiedHomeAuth) {
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
        const isActiveNow = String(data.status || '').trim().toLowerCase() === 'active' || !state.emailVerificationEnabled;
        if (isActiveNow) {
          setStatus(signupStatus, 'Account is active. Signing you in...', 'info');
          const signedIn = await autoSigninAndRedirectToPortal({
            username,
            password,
            statusElement: signupStatus,
            prefixMessage: 'Registration succeeded but auto sign-in failed.',
          });
          if (signedIn) return;
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

  if (signinForm && !isUnifiedHomeAuth) {
    signinForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      setStatus(signinStatus, 'Signing in...');
      const formData = new FormData(signinForm);
      const username = String(formData.get('username') || '').trim().toLowerCase();
      const password = String(formData.get('password') || '');

      try {
        const passwordHash = await sha256Hex(password);
        const data = await request('/api/v1/auth/signin', { username, password_hash: passwordHash });
        await applySignedInState({ username, password, passwordHash, data });
        const isHomePage = window.location.pathname === '/' || window.location.pathname === '/index.html';
        if (isHomePage && !accountPanel) {
          window.location.assign('/portal');
          return;
        }
        setStatus(signinStatus, 'Signed in successfully.', 'success');
      } catch (error) {
        setStatus(signinStatus, error.message, 'error');
      }
    });
  }

  if (homeUnifiedAuthForm) {
    homeUnifiedAuthForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const registerMode = isUnifiedHomeMode('register');

      if (!registerMode) {
        setStatus(signinStatus, 'Signing in...', 'info');
        setStatus(signupStatus, '', 'info');
        const username = String(signupUsername?.value || '').trim().toLowerCase();
        const password = String(signupPassword?.value || '');

        try {
          const passwordHash = await sha256Hex(password);
          const data = await request('/api/v1/auth/signin', { username, password_hash: passwordHash });
          await applySignedInState({ username, password, passwordHash, data });
          window.location.assign('/portal');
        } catch (error) {
          setStatus(signinStatus, error.message, 'error');
        }
        return;
      }

      if (!validateSignupStartForm()) return;
      setStatus(signupStatus, 'Sending verification email...', 'info');
      setStatus(signinStatus, '', 'info');

      try {
        const username = signupUsername.value.trim().toLowerCase();
        const email = signupEmail?.value.trim().toLowerCase() || '';
        const password = signupPassword.value;
        const publicKey = signupPublicKey?.value.trim() || '';
        const privateKeyEncrypted = signupPrivateKeyEncrypted?.value.trim() || '';
        const signupProfilePicture = signupProfilePictureInput?.files?.[0] || null;

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
        const isActiveNow = String(data.status || '').trim().toLowerCase() === 'active' || !state.emailVerificationEnabled;
        if (isActiveNow) {
          setStatus(signupStatus, 'Account is active. Signing you in...', 'info');
          const signedIn = await autoSigninAndRedirectToPortal({
            username,
            password,
            statusElement: signupStatus,
            prefixMessage: 'Registration succeeded but auto sign-in failed.',
          });
          if (signedIn) return;
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

  async function bootstrapPortalSession() {
    if (!accountPanel) return;
    if (signinForm) return;
    const session = readAuthSession();
    if (!session?.username || !session?.password_hash) {
      const homeUrl = new URL('/', window.location.origin);
      homeUrl.searchParams.set('signin_required', '1');
      window.location.assign(homeUrl.toString());
      return;
    }
    try {
      const data = await request('/api/v1/auth/signin', {
        username: session.username,
        password_hash: session.password_hash,
      });
      await applySignedInState({
        username: session.username,
        password: session.password || '',
        passwordHash: session.password_hash,
        data,
      });
    } catch {
      clearAuthSession();
      const homeUrl = new URL('/', window.location.origin);
      homeUrl.searchParams.set('signin_required', '1');
      window.location.assign(homeUrl.toString());
    }
  }

  if (signOutLink) {
    signOutLink.addEventListener('click', () => {
      clearAuthSession();
    });
  }

  bootstrapPortalSession();

  if (copyEncrypted && encryptedKeyEl) {
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
  }

  if (refreshAdminUsers) {
    refreshAdminUsers.addEventListener('click', async () => {
      await loadAdminUsers();
    });
  }

  if (decryptPrivateKeyButton && encryptedKeyEl) {
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
        if (privateKeyEl) {
          privateKeyEl.textContent = decrypted.nsec || decrypted.hex || '—';
        }
        setStatus(signinStatus, 'Private key decrypted locally in your browser.', 'success');
      } catch (error) {
        if (privateKeyEl) {
          privateKeyEl.textContent = '—';
        }
        setStatus(signinStatus, `Unable to decrypt private key: ${error.message}`, 'error');
      }
    });
  }

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
      if (encryptedKeyEl) {
        encryptedKeyEl.textContent = encryptedPrivateKey;
      }
      if (publicKeyEl) {
        publicKeyEl.textContent = window.NoasNostr?.npubFromHexPublicKey(resolvedPublicKey) || resolvedPublicKey || '—';
      }
      if (privateKeyEl) {
        privateKeyEl.textContent = '—';
      }
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
      if (relayListEl) {
        relayListEl.textContent = relays.join(', ');
      }
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
  deleteConfirmUsernameInput?.addEventListener('input', updateDeleteGuardState);
  deleteSavedKeyInput?.addEventListener('change', updateDeleteGuardState);

  if (deleteForm) {
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
        if (accountPanel) accountPanel.hidden = true;
        if (updatePanel) updatePanel.hidden = true;
        if (deletePanel) deletePanel.hidden = true;
        signinForm?.reset();
        credentialsForm?.reset();
        relayForm?.reset();
        deleteForm.reset();
        state.username = null;
        state.password = null;
        state.publicKey = null;
        state.passwordHash = null;
        state.role = null;
        clearAuthSession();
        if (portalIdentity) {
          portalIdentity.textContent = 'Loading account…';
        }
        if (portalStatusBadge) {
          portalStatusBadge.className = 'badge badge-outline';
          portalStatusBadge.textContent = 'pending';
        }
        clearProfilePicture();
        if (privateKeyEl) {
          privateKeyEl.textContent = '—';
        }
        updateDeleteGuardState();
        window.setTimeout(() => {
          window.location.assign('/');
        }, 250);
      } catch (error) {
        setStatus(deleteStatus, error.message, 'error');
      }
    });
  }

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('signin_required') === '1') {
    setStatus(signinStatus, 'Please sign in to open your account portal.', 'info');
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('signin_required');
    window.history.replaceState({}, '', cleanUrl.toString());
  }
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
