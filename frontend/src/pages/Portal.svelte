<script lang="ts">
  import { Button } from '@nodal/ui';
  import Shell from '../components/Shell.svelte';
  import { request, adminRequest } from '../lib/request';
  import { persistAuthSession, readAuthSession, clearAuthSession } from '../lib/session';
  import { loadNoasVersion } from '../lib/version';
  import { decryptPrivateKey, encryptPrivateKey, npubFromHexPublicKey } from '../lib/nostr';

  type StatusType = 'info' | 'success' | 'error';
  type Status = { message: string; type: StatusType };

  interface AdminUser {
    username: string;
    registration_email?: string;
    public_key?: string;
    picture_url?: string;
    role?: string;
    status?: string;
  }

  function setStatus(message: string, type: StatusType = 'info'): Status {
    return { message, type };
  }

  // Signed-in session state
  let username = $state<string | null>(null);
  let password = $state<string | null>(null);
  let passwordHash = $state<string | null>(null);
  let publicKey = $state<string | null>(null);
  let role = $state<string | null>(null);
  let signedIn = $derived(Boolean(username && passwordHash));

  let nip05Domain = $state(window.location.hostname || '');
  const portalIdentity = $derived(
    !username ? 'Loading account…' : nip05Domain ? `${username}@${nip05Domain}` : username,
  );

  let signinStatus = $state<Status>(setStatus(''));
  let profilePictureUrl = $state<string | null>(null);
  let profilePictureError = $state(false);
  let publicKeyDisplay = $state('—');
  let encryptedKeyDisplay = $state('—');
  let privateKeyDisplay = $state('—');
  let relays = $state<string[]>([]);

  let adminUsers = $state<AdminUser[]>([]);
  let adminStatus = $state<Status>(setStatus(''));
  let adminQuery = $state('');
  // Falls back to the username initial if a picture_url 404s (stale/missing upload) —
  // defense in depth alongside the backend only sending picture_url when a picture exists.
  let brokenAdminAvatars = $state(new Set<string>());
  function markAdminAvatarBroken(username: string) {
    brokenAdminAvatars = new Set(brokenAdminAvatars).add(username);
  }
  const showAdminPanel = $derived(role === 'admin' || role === 'moderator');
  const filteredAdminUsers = $derived.by(() => {
    const q = adminQuery.trim().toLowerCase();
    if (!q) return adminUsers;
    return adminUsers.filter(
      (u) => u.username.toLowerCase().includes(q) || (u.registration_email || '').toLowerCase().includes(q),
    );
  });
  const pendingAdminCount = $derived(adminUsers.filter((u) => u.status === 'unverified_email').length);

  // Fingerprint / rotate-key drawer
  let showPrivateDrawer = $state(false);
  let newPassword = $state('');
  let newPrivateKeyInput = $state('');
  let credentialsStatus = $state<Status>(setStatus(''));

  // Relays
  let relayMode = $state<'view' | 'edit'>('view');
  let relaysText = $state('');
  let relayStatus = $state<Status>(setStatus(''));

  // Profile picture
  let profilePictureInput: HTMLInputElement | undefined = $state();
  let pictureStatus = $state<Status>(setStatus(''));

  // Delete account dialog
  let showDeleteDialog = $state(false);
  let deleteSavedKeyChecked = $state(false);
  let deleteConfirmUsername = $state('');
  const deleteGuardOk = $derived(
    deleteSavedKeyChecked && deleteConfirmUsername.trim().toLowerCase() === String(username || '').trim().toLowerCase() && Boolean(deleteConfirmUsername),
  );
  let deleteStatus = $state<Status>(setStatus(''));

  function roleRank(r: string | null | undefined): number {
    const normalized = String(r || '').trim().toLowerCase();
    if (normalized === 'admin') return 3;
    if (normalized === 'moderator') return 2;
    return 1;
  }

  function canManageUser(actorRole: string | null, targetRole: string | undefined, targetUsername: string | undefined): boolean {
    if (!actorRole) return false;
    if (username && targetUsername && username === targetUsername) return false;
    return roleRank(actorRole) > roleRank(targetRole);
  }

  function formatUserIdentifier(user: AdminUser): string {
    const pubkey = String(user.public_key || '').trim();
    if (!pubkey) return '—';
    return npubFromHexPublicKey(pubkey) || pubkey;
  }

  function setProfilePicture(pubkey: string | null | undefined) {
    const normalized = String(pubkey || '').trim();
    profilePictureError = false;
    profilePictureUrl = normalized ? `/api/v1/picture/${normalized}` : null;
  }

  function clearProfilePicture() {
    profilePictureUrl = null;
  }

  async function loadAdminUsers() {
    if (!(role === 'admin' || role === 'moderator')) return;
    adminStatus = setStatus('Loading users...', 'info');
    try {
      const data = await adminRequest<{ users?: AdminUser[] }>(
        '/api/v1/admin/users/list',
        {},
        { username, passwordHash },
      );
      adminUsers = data.users || [];
      adminStatus = setStatus(`Loaded ${adminUsers.length} users.`, 'success');
    } catch (error) {
      adminStatus = setStatus((error as Error).message, 'error');
    }
  }

  async function handleRoleChange(user: AdminUser, newRole: string) {
    if (role !== 'admin') return;
    adminStatus = setStatus(`Updating role for ${user.username}...`, 'info');
    try {
      const response = await adminRequest<{ user?: { role?: string } }>(
        '/api/v1/admin/users/role',
        { target_username: user.username, new_role: newRole },
        { username, passwordHash },
      );
      if (username && user.username && username === user.username) {
        role = String(response?.user?.role || newRole).trim().toLowerCase();
      }
      adminStatus = setStatus(`Updated role for ${user.username}.`, 'success');
      await loadAdminUsers();
    } catch (error) {
      adminStatus = setStatus((error as Error).message, 'error');
    }
  }

  async function handleVerifyUser(user: AdminUser) {
    if (!canManageUser(role, user.role, user.username) || user.status !== 'unverified_email') return;
    adminStatus = setStatus(`Verifying ${user.username}...`, 'info');
    try {
      await adminRequest('/api/v1/admin/users/verify', { target_username: user.username }, { username, passwordHash });
      adminStatus = setStatus(`Verified ${user.username}.`, 'success');
      await loadAdminUsers();
    } catch (error) {
      adminStatus = setStatus((error as Error).message, 'error');
    }
  }

  async function handleDeleteUser(user: AdminUser) {
    if (!canManageUser(role, user.role, user.username)) return;
    const confirmationInput = window.prompt(`Type ${user.username} to confirm deletion. This cannot be undone.`);
    if (confirmationInput === null) return;
    const confirmedUsername = String(confirmationInput || '').trim().toLowerCase();
    const expectedUsername = String(user.username || '').trim().toLowerCase();
    if (confirmedUsername !== expectedUsername) {
      adminStatus = setStatus(`Confirmation failed for ${user.username}. Deletion cancelled.`, 'error');
      return;
    }
    adminStatus = setStatus(`Deleting ${user.username}...`, 'info');
    try {
      await adminRequest(
        '/api/v1/admin/users/delete',
        { target_username: user.username, confirm_username: confirmedUsername },
        { username, passwordHash },
      );
      adminStatus = setStatus(`Deleted ${user.username}.`, 'success');
      await loadAdminUsers();
    } catch (error) {
      adminStatus = setStatus((error as Error).message, 'error');
    }
  }

  async function applySignedInState(un: string, pw: string, pwHash: string, data: {
    public_key?: string;
    role?: string;
    private_key_encrypted?: string;
    relays?: string[];
  }) {
    username = un;
    password = pw;
    passwordHash = pwHash;
    publicKey = String(data.public_key || '').trim().toLowerCase() || null;
    role = String(data.role || 'user').trim().toLowerCase();

    setProfilePicture(data.public_key);
    publicKeyDisplay = data.public_key ? npubFromHexPublicKey(data.public_key) || data.public_key : '—';
    encryptedKeyDisplay = data.private_key_encrypted || '—';
    privateKeyDisplay = '—';
    relays = data.relays || [];
    relaysText = relays.join('\n');

    persistAuthSession({ username: un, password: pw, passwordHash: pwHash });
    if (role === 'admin' || role === 'moderator') {
      await loadAdminUsers();
    }
  }

  async function bootstrapPortalSession() {
    const session = readAuthSession();
    if (!session?.username || !session?.password_hash) {
      const homeUrl = new URL('/', window.location.origin);
      homeUrl.searchParams.set('signin_required', '1');
      window.location.assign(homeUrl.toString());
      return;
    }
    try {
      const data = await request<{ public_key?: string; role?: string; private_key_encrypted?: string; relays?: string[] }>(
        '/api/v1/auth/signin',
        { username: session.username, password_hash: session.password_hash },
      );
      await applySignedInState(session.username, session.password || '', session.password_hash, data);
    } catch {
      clearAuthSession();
      const homeUrl = new URL('/', window.location.origin);
      homeUrl.searchParams.set('signin_required', '1');
      window.location.assign(homeUrl.toString());
    }
  }

  async function loadMetadata() {
    const metadata = await loadNoasVersion();
    if (!metadata) return;
    if (metadata.nip05Domain) nip05Domain = metadata.nip05Domain;
  }

  loadMetadata();
  bootstrapPortalSession();

  function handleSignOut() {
    clearAuthSession();
  }

  async function handleCopy(value: string, label: string) {
    if (!value || value === '—') return;
    try {
      await navigator.clipboard.writeText(value);
      signinStatus = setStatus(`${label} copied to clipboard.`, 'success');
    } catch {
      signinStatus = setStatus(`Unable to copy ${label.toLowerCase()}. Copy it manually.`, 'error');
    }
  }

  function togglePrivateDrawer() {
    showPrivateDrawer = !showPrivateDrawer;
    if (!showPrivateDrawer) privateKeyDisplay = '—';
  }

  async function handleDecryptPrivateKey() {
    if (!encryptedKeyDisplay || encryptedKeyDisplay === '—') {
      signinStatus = setStatus('No encrypted key is available to decrypt.', 'error');
      return;
    }
    if (!password) {
      signinStatus = setStatus('Sign in again before decrypting your key.', 'error');
      return;
    }
    signinStatus = setStatus('Decrypting private key locally...', 'info');
    try {
      const decrypted = await decryptPrivateKey(encryptedKeyDisplay, password);
      privateKeyDisplay = decrypted.nsec || decrypted.hex || '—';
      signinStatus = setStatus('Private key decrypted locally in your browser.', 'success');
    } catch (error) {
      privateKeyDisplay = '—';
      signinStatus = setStatus(`Unable to decrypt private key: ${(error as Error).message}`, 'error');
    }
  }

  function hidePrivateKey() {
    privateKeyDisplay = '—';
  }

  async function handleCredentialsSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!username || !password) {
      credentialsStatus = setStatus('Sign in before updating your account.', 'error');
      return;
    }
    if (!newPassword && !newPrivateKeyInput) {
      credentialsStatus = setStatus('Enter both a new password and private key.', 'error');
      return;
    }
    if (!newPassword || !newPrivateKeyInput) {
      credentialsStatus = setStatus('Password and private key must be updated together.', 'error');
      return;
    }
    credentialsStatus = setStatus('Updating password and key...', 'info');
    try {
      let encryptedPrivateKey = '';
      let resolvedPublicKey = '';
      if (newPrivateKeyInput.startsWith('ncryptsec')) {
        const decrypted = await decryptPrivateKey(newPrivateKeyInput, newPassword);
        encryptedPrivateKey = newPrivateKeyInput;
        resolvedPublicKey = String(decrypted.publicKey || '').trim().toLowerCase();
      } else {
        const encrypted = await encryptPrivateKey(newPrivateKeyInput, newPassword);
        encryptedPrivateKey = encrypted.privateKeyEncrypted;
        resolvedPublicKey = String(encrypted.publicKey || '').trim().toLowerCase();
      }
      if (!resolvedPublicKey) {
        throw new Error('Unable to derive a public key from the provided private key.');
      }
      await request('/api/v1/auth/update', {
        username,
        password,
        updates: { new_password: newPassword, public_key: resolvedPublicKey, private_key_encrypted: encryptedPrivateKey },
      });
      password = newPassword;
      publicKey = resolvedPublicKey;
      encryptedKeyDisplay = encryptedPrivateKey;
      publicKeyDisplay = npubFromHexPublicKey(resolvedPublicKey) || resolvedPublicKey || '—';
      privateKeyDisplay = '—';
      setProfilePicture(resolvedPublicKey);
      credentialsStatus = setStatus('Password, public key, and encrypted key updated after local verification.', 'success');
      newPassword = '';
      newPrivateKeyInput = '';
    } catch (error) {
      credentialsStatus = setStatus((error as Error).message, 'error');
    }
  }

  function parseRelays(text: string): string[] {
    if (!text) return [];
    return text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  }

  function toggleRelayMode() {
    relayMode = relayMode === 'view' ? 'edit' : 'view';
  }

  async function handleRelaySubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!username || !password) {
      relayStatus = setStatus('Sign in before updating relays.', 'error');
      return;
    }
    const parsedRelays = parseRelays(relaysText);
    if (!parsedRelays.length) {
      relayStatus = setStatus('Enter at least one relay URL.', 'error');
      return;
    }
    relayStatus = setStatus('Updating relays...', 'info');
    try {
      await request('/api/v1/auth/update', { username, password, updates: { relays: parsedRelays } });
      relays = parsedRelays;
      relayStatus = setStatus('Relays updated.', 'success');
      relayMode = 'view';
    } catch (error) {
      relayStatus = setStatus((error as Error).message, 'error');
    }
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

  async function uploadSelectedProfilePicture() {
    if (!username || !password) {
      pictureStatus = setStatus('Sign in before uploading a profile picture.', 'error');
      return;
    }
    const file = profilePictureInput?.files?.[0];
    if (!file) return;
    pictureStatus = setStatus('Uploading profile picture...', 'info');
    try {
      const payloadBase64 = await fileToBase64(file);
      const data = await request<{ picture_url?: string }>('/api/v1/auth/update', {
        username,
        password,
        updates: { profile_picture_data: payloadBase64, profile_picture_content_type: file.type || 'application/octet-stream' },
      });
      const resolvedPictureUrl = data.picture_url || `/api/v1/picture/${publicKey || username}`;
      profilePictureUrl = `${resolvedPictureUrl}?t=${Date.now()}`;
      profilePictureError = false;
      pictureStatus = setStatus('Profile picture uploaded.', 'success');
    } catch (error) {
      pictureStatus = setStatus((error as Error).message, 'error');
    }
  }

  function openDeleteDialog() {
    showDeleteDialog = true;
  }

  function closeDeleteDialog() {
    showDeleteDialog = false;
    deleteSavedKeyChecked = false;
    deleteConfirmUsername = '';
    deleteStatus = setStatus('');
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (showDeleteDialog && event.key === 'Escape') closeDeleteDialog();
  }

  function handleDeletePaste(event: ClipboardEvent) {
    event.preventDefault();
    deleteStatus = setStatus('Paste is disabled. Type your username manually.', 'error');
  }

  function handleDeleteDrop(event: DragEvent) {
    event.preventDefault();
  }

  async function handleDeleteSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!username || !password) {
      deleteStatus = setStatus('Sign in before deleting your account.', 'error');
      return;
    }
    if (!deleteSavedKeyChecked) {
      deleteStatus = setStatus('Please confirm you saved your private key.', 'error');
      return;
    }
    if (deleteConfirmUsername.trim().toLowerCase() !== String(username || '').trim().toLowerCase()) {
      deleteStatus = setStatus('Type your exact username to confirm account deletion.', 'error');
      return;
    }
    deleteStatus = setStatus('Deleting account...');
    try {
      await request('/api/v1/auth/delete', { username, password });
      deleteStatus = setStatus('Account deleted.', 'success');
      username = null;
      password = null;
      publicKey = null;
      passwordHash = null;
      role = null;
      clearAuthSession();
      clearProfilePicture();
      privateKeyDisplay = '—';
      deleteSavedKeyChecked = false;
      deleteConfirmUsername = '';
      window.setTimeout(() => {
        window.location.assign('/');
      }, 250);
    } catch (error) {
      deleteStatus = setStatus((error as Error).message, 'error');
    }
  }

  // Ported from app.js's bottom-of-file urlParams handling.
  (function checkUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('signin_required') === '1') {
      signinStatus = setStatus('Please sign in to open your account portal.', 'info');
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

  // Simple orbit-point layout for the relay glyph — mirrors the design's
  // RelayOrbit icon, alternating between the inner and outer ring radius.
  function relayOrbitPoints(count: number): { x: number; y: number }[] {
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2;
      const radius = i % 2 === 0 ? 22 : 40;
      points.push({ x: 60 + Math.cos(angle) * radius, y: 60 + Math.sin(angle) * radius });
    }
    return points;
  }
</script>

<svelte:head>
  <title>Noas | Portal</title>
  <meta name="description" content="Sign in to Noas to retrieve encrypted keys and manage your account." />
</svelte:head>

<Shell wide>
  {#snippet footerStart()}
    {#if signedIn}
      <button type="button" class="footer-action danger" onclick={openDeleteDialog}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6" /><path d="M14 11v6" />
        </svg>
        Delete account
      </button>
    {/if}
  {/snippet}
  {#snippet footerEnd()}
    {#if signedIn}
      <a class="footer-action primary" href="/" onclick={handleSignOut}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        Sign out
      </a>
    {/if}
  {/snippet}
  <div class="portal-welcome">
    <button
      type="button"
      class="portal-avatar-btn"
      onclick={() => profilePictureInput?.click()}
      aria-label="Change profile picture"
    >
      <span class="portal-avatar-glow" aria-hidden="true"></span>
      <span class="portal-avatar-circle">
        {#if profilePictureUrl && !profilePictureError}
          <img src={profilePictureUrl} alt="" onerror={() => (profilePictureError = true)} />
        {:else}
          {(username || '?')[0]?.toUpperCase()}
        {/if}
      </span>
      <span class="portal-avatar-badge" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      </span>
    </button>
    <input
      type="file"
      accept="image/*"
      class="visually-hidden"
      bind:this={profilePictureInput}
      onchange={uploadSelectedProfilePicture}
    />
    {#if signedIn}
      <h1>Welcome back, <span class="identity-highlight">{username}</span></h1>
    {:else}
      <h1>{portalIdentity}</h1>
    {/if}
    <button type="button" class="portal-picture-toggle" onclick={() => profilePictureInput?.click()}>
      {profilePictureUrl ? 'Replace profile picture' : 'Add profile picture'}
    </button>
    <p class="font-mono-key muted portal-nip05">{portalIdentity}</p>
    <div class="status mt-6" data-type={signinStatus.type}>{signinStatus.message}</div>
    {#if pictureStatus.message}
      <div class="status" data-type={pictureStatus.type}>{pictureStatus.message}</div>
    {/if}
  </div>

  {#if signedIn}
    <div class="portal-sections">
      <section class="section-shell">
        <span class="section-dot" aria-hidden="true"></span>
        <div class="section-head">
          <div>
            <h2 class="section-title">Your fingerprint</h2>
            <p class="section-subtitle">Your public identity on Nostr.</p>
          </div>
        </div>
        <div class="section-box">
          <div class="fingerprint-row">
            <svg class="fingerprint-glyph" viewBox="0 0 80 80" fill="none" stroke-width="1.5" stroke="currentColor">
              <path d="M40 12c-13 0-22 10-22 22v10" stroke-linecap="round" />
              <path d="M40 20c-8 0-14 6-14 14v14" stroke-linecap="round" />
              <path d="M40 28c-4 0-7 3-7 7v22" stroke-linecap="round" />
              <path d="M40 36v20" stroke-linecap="round" />
              <path d="M47 34c0-4-3-7-7-7" stroke-linecap="round" opacity="0.7" />
              <path d="M54 34c0-8-6-14-14-14" stroke-linecap="round" opacity="0.5" />
              <path d="M62 34c0-13-10-22-22-22" stroke-linecap="round" opacity="0.3" />
              <path d="M33 60c1 3 4 5 7 5s6-2 7-5" stroke-linecap="round" opacity="0.7" />
            </svg>
            <div style="min-width:0;flex:1">
              <div class="trunc-key">
                <span class="trunc-key-label">pub</span>
                <span class="trunc-key-value font-mono-key">{publicKeyDisplay}</span>
                <button type="button" class="trunc-key-copy" onclick={() => handleCopy(publicKeyDisplay, 'Public key')}>copy</button>
              </div>
              <div class="trunc-key">
                <span class="trunc-key-label">enc</span>
                <span class="trunc-key-value font-mono-key">{encryptedKeyDisplay}</span>
                <button type="button" class="trunc-key-copy" onclick={() => handleCopy(encryptedKeyDisplay, 'Encrypted key')}>copy</button>
              </div>
              <button type="button" class="section-action mt-6" aria-expanded={showPrivateDrawer} onclick={togglePrivateDrawer}>
                {showPrivateDrawer ? 'Hide private key & rotation ↑' : 'Reveal, rotate or replace private key ↓'}
              </button>
            </div>
          </div>

          {#if showPrivateDrawer}
            <div class="private-drawer">
              <div class="private-drawer-warning">
                <span aria-hidden="true">⚠</span>
                <p style="margin:0">Your private key is the only proof of your identity. Never paste it into unknown apps.</p>
              </div>

              {#if privateKeyDisplay === '—'}
                <Button variant="secondary" onclick={handleDecryptPrivateKey}>Decrypt private key</Button>
              {:else}
                <div class="trunc-key">
                  <span class="trunc-key-label">nsec</span>
                  <span class="trunc-key-value font-mono-key">{privateKeyDisplay}</span>
                </div>
                <p class="muted" style="margin:0">Scroll to select. Never fully rendered at once.</p>
                <Button variant="ghost" onclick={hidePrivateKey}>Hide</Button>
              {/if}

              <div class="private-drawer-divider">
                <p class="small-label" style="text-transform:uppercase;letter-spacing:0.04em;margin-bottom:0.5rem">Rotate password &amp; re-encrypt</p>
                <form class="form" onsubmit={handleCredentialsSubmit}>
                  <label>
                    New private key
                    <input type="text" bind:value={newPrivateKeyInput} class="form-mono" placeholder="ncryptsec…, nsec1…, or hex" />
                  </label>
                  <div class="split-fields">
                    <label>
                      New password
                      <input type="password" bind:value={newPassword} autocomplete="new-password" placeholder="••••••••" />
                    </label>
                    <Button type="submit">Rotate</Button>
                  </div>
                  <p class="muted" style="margin:0">Paste the nsec you want to re-encrypt with the new password.</p>
                  <div class="status" data-type={credentialsStatus.type}>{credentialsStatus.message}</div>
                </form>
              </div>
            </div>
          {/if}
        </div>
      </section>

      <section class="section-shell">
        <span class="section-dot" aria-hidden="true"></span>
        <div class="section-head">
          <div>
            <h2 class="section-title">Your spaces</h2>
            <p class="section-subtitle">The relays that carry your notes.</p>
          </div>
          <button type="button" class="section-action" onclick={toggleRelayMode}>
            {relayMode === 'view' ? 'Edit' : 'Done'}
          </button>
        </div>
        <div
          class="section-box relay-box"
          class:relay-box--view={relayMode === 'view'}
          onclick={() => relayMode === 'view' && toggleRelayMode()}
          onkeydown={(e) => {
            if (relayMode === 'view' && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              toggleRelayMode();
            }
          }}
          role={relayMode === 'view' ? 'button' : undefined}
          tabindex={relayMode === 'view' ? 0 : undefined}
        >
          <div class="relay-row">
            <svg class="relay-orbit" viewBox="0 0 120 120" fill="none">
              <circle cx="60" cy="60" r="4" fill="currentColor" />
              <circle cx="60" cy="60" r="22" stroke="currentColor" stroke-opacity="0.25" />
              <circle cx="60" cy="60" r="40" stroke="currentColor" stroke-opacity="0.15" />
              {#each relayOrbitPoints(relays.length) as point}
                <circle cx={point.x} cy={point.y} r="3" fill="currentColor" />
              {/each}
            </svg>
            {#if relayMode === 'view'}
              <ul class="relay-list font-mono-key">
                {#each relays as relay (relay)}
                  <li>{relay}</li>
                {:else}
                  <li>No relays configured.</li>
                {/each}
              </ul>
            {:else}
              <form class="form" style="flex:1;min-width:0" onsubmit={handleRelaySubmit}>
                <textarea
                  aria-label="Relay URLs, one per line"
                  bind:value={relaysText}
                  rows="4"
                  class="font-mono-key"
                  placeholder="wss://relay.example.com"
                ></textarea>
                <p class="muted" style="margin:0">One relay URL per line.</p>
                <Button type="submit">Save relays</Button>
                <div class="status" data-type={relayStatus.type}>{relayStatus.message}</div>
              </form>
            {/if}
          </div>
        </div>
      </section>

      {#if showAdminPanel}
        <section class="section-shell">
          <span class="section-dot" aria-hidden="true"></span>
          <div class="section-head">
            <div>
              <h2 class="section-title">Administration</h2>
              <p class="section-subtitle">Review accounts, verify pending users, and manage roles.</p>
            </div>
            <button type="button" class="section-action" onclick={loadAdminUsers}>Refresh</button>
          </div>
          <div class="section-box">
            <div class="admin-console-head">
              <div class="admin-search">
                <svg class="admin-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  type="text"
                  aria-label="Search users"
                  bind:value={adminQuery}
                  placeholder="Search username or NIP-05"
                />
              </div>
              <span class="admin-count">
                {adminUsers.length} users{pendingAdminCount > 0 ? ` · ${pendingAdminCount} pending` : ''}
              </span>
            </div>
            <div class="status" data-type={adminStatus.type}>{adminStatus.message}</div>
            <div class="admin-list">
              {#if !filteredAdminUsers.length}
                <div class="admin-empty">{adminUsers.length ? 'No matching users.' : 'No users returned.'}</div>
              {:else}
                {#each filteredAdminUsers as user (user.username)}
                  {@const isSelf = Boolean(username && user.username === username)}
                  {@const actorRank = roleRank(role)}
                  {@const canManage = canManageUser(role, user.role, user.username)}
                  <div class="admin-user">
                    {#if user.picture_url && !brokenAdminAvatars.has(user.username)}
                      <img
                        class="admin-avatar"
                        alt="{user.username} avatar"
                        src={user.picture_url}
                        onerror={() => markAdminAvatarBroken(user.username)}
                      />
                    {:else}
                      <div class="admin-avatar">{user.username[0]?.toUpperCase()}</div>
                    {/if}
                    <div class="admin-meta">
                      <div class="admin-name-row">
                        <span class="admin-name">{user.username}</span>
                        {#if user.status === 'unverified_email'}
                          <span class="admin-pending-pill">pending</span>
                        {/if}
                      </div>
                      <div class="admin-sub">{user.registration_email || '—'}</div>
                      <div class="admin-sub">{formatUserIdentifier(user)}</div>

                      <div class="admin-controls">
                        {#if role === 'admin'}
                          <label class="sr-only" for="role-{user.username}">Role for {user.username}</label>
                          <select
                            id="role-{user.username}"
                            class="role-select"
                            value={user.role || 'user'}
                            onchange={(e) => handleRoleChange(user, (e.target as HTMLSelectElement).value)}
                          >
                            {#each ['user', 'moderator', 'admin'] as roleOption}
                              <option value={roleOption} disabled={isSelf && roleRank(roleOption) >= actorRank}>{roleOption}</option>
                            {/each}
                          </select>
                        {/if}
                        {#if user.status === 'unverified_email'}
                          <button class="btn subtle" type="button" disabled={!canManage} onclick={() => handleVerifyUser(user)}>Verify</button>
                        {/if}
                        {#if !(role === 'moderator' && user.role === 'admin')}
                          <button class="section-action" type="button" disabled={!canManage} onclick={() => handleDeleteUser(user)}>Remove</button>
                        {/if}
                      </div>
                    </div>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        </section>
      {/if}
    </div>
  {/if}
</Shell>

<svelte:window onkeydown={handleWindowKeydown} />

{#if showDeleteDialog}
  <div class="dialog-overlay" role="presentation" onclick={closeDeleteDialog}>
    <div
      class="dialog-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      <h2 id="delete-dialog-title">Delete this account?</h2>
      <p>
        This is irreversible. Your encrypted key and relay list are erased from noas — if you have not saved
        your private key, your identity is lost forever.
      </p>
      <form class="form mt-6" onsubmit={handleDeleteSubmit}>
        <label class="checkline">
          <input type="checkbox" bind:checked={deleteSavedKeyChecked} required />
          <span>I have saved my private key somewhere safe.</span>
        </label>
        <label>
          <span class="small-label">Type <code class="font-mono-key">{username}</code> to confirm</span>
          <input
            type="text"
            bind:value={deleteConfirmUsername}
            placeholder={username || 'username'}
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            required
            onpaste={handleDeletePaste}
            ondrop={handleDeleteDrop}
          />
        </label>
        <div class="status" data-type={deleteStatus.type}>{deleteStatus.message}</div>
        <div class="dialog-actions">
          <button type="button" class="btn ghost" onclick={closeDeleteDialog}>Cancel</button>
          <button type="submit" class="btn danger" disabled={!deleteGuardOk}>Delete permanently</button>
        </div>
      </form>
    </div>
  </div>
{/if}
