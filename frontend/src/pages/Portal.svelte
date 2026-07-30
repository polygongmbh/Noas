<script lang="ts">
  import { Card, Badge, Button, Tabs, Tab } from '@nodal/ui';
  import Shell from '../components/Shell.svelte';
  import { request, adminRequest } from '../lib/request';
  import { persistAuthSession, readAuthSession, clearAuthSession } from '../lib/session';
  import { loadNoasVersion } from '../lib/version';
  import { decryptPrivateKey, encryptPrivateKey, npubFromHexPublicKey } from '../lib/nostr';

  type StatusType = 'info' | 'success' | 'error';
  type Status = { message: string; type: StatusType };
  type Tag = 'overview' | 'update' | 'delete';

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

  let versionLabel = $state('');
  let activeTab = $state<Tag>('overview');

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
  let profilePictureStatusText = $state('No profile picture uploaded');
  let publicKeyDisplay = $state('—');
  let encryptedKeyDisplay = $state('—');
  let privateKeyDisplay = $state('—');
  let relayListDisplay = $state('—');
  let relays = $state<string[]>([]);

  let adminUsers = $state<AdminUser[]>([]);
  let adminStatus = $state<Status>(setStatus(''));
  const showAdminPanel = $derived(role === 'admin' || role === 'moderator');

  // Update forms
  let newPassword = $state('');
  let newPrivateKeyInput = $state('');
  let credentialsStatus = $state<Status>(setStatus(''));

  let relaysText = $state('');
  let relayStatus = $state<Status>(setStatus(''));

  let profilePictureInput: HTMLInputElement | undefined = $state();
  let pictureStatus = $state<Status>(setStatus(''));

  // Delete form
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
    if (!normalized) {
      profilePictureUrl = null;
      profilePictureStatusText = 'No profile picture available';
      return;
    }
    profilePictureUrl = `/api/v1/picture/${normalized}`;
    profilePictureStatusText = profilePictureUrl;
  }

  function clearProfilePicture() {
    profilePictureUrl = null;
    profilePictureStatusText = 'No profile picture uploaded';
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
    relayListDisplay = relays.length ? relays.join(', ') : '—';
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
    versionLabel = metadata.versionLabel;
    if (metadata.nip05Domain) nip05Domain = metadata.nip05Domain;
  }

  loadMetadata();
  bootstrapPortalSession();

  function handleSignOut() {
    clearAuthSession();
  }

  async function handleCopyEncrypted() {
    if (!encryptedKeyDisplay || encryptedKeyDisplay === '—') return;
    try {
      await navigator.clipboard.writeText(encryptedKeyDisplay);
      signinStatus = setStatus('Encrypted key copied to clipboard.', 'success');
    } catch {
      signinStatus = setStatus('Unable to copy key. Copy it manually.', 'error');
    }
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
      relayListDisplay = parsedRelays.join(', ');
      relayStatus = setStatus('Relays updated.', 'success');
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

  async function handlePictureSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!username || !password) {
      pictureStatus = setStatus('Sign in before uploading a profile picture.', 'error');
      return;
    }
    const file = profilePictureInput?.files?.[0];
    if (!file) {
      pictureStatus = setStatus('Choose an image file to upload.', 'error');
      return;
    }
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
      profilePictureStatusText = resolvedPictureUrl || 'Profile picture uploaded';
      pictureStatus = setStatus('Profile picture uploaded.', 'success');
      if (profilePictureInput) profilePictureInput.value = '';
    } catch (error) {
      pictureStatus = setStatus((error as Error).message, 'error');
    }
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
</script>

<svelte:head>
  <title>Noas | Portal</title>
  <meta name="description" content="Sign in to Noas to retrieve encrypted keys and manage your account." />
</svelte:head>

<Shell wide {versionLabel}>
  <div class="portal-top">
    <div>
      <h1 class="portal-title">NIP-05 Identity</h1>
      <p class="portal-subtitle">{portalIdentity}</p>
    </div>
    <Badge variant={signedIn ? 'success' : 'outline'}>{signedIn ? 'verified' : 'pending'}</Badge>
  </div>
  <div class="status mb-6" data-type={signinStatus.type}>{signinStatus.message}</div>

  <Tabs>
    <Tab active={activeTab === 'overview'} onselect={() => (activeTab = 'overview')}>Overview</Tab>
    <Tab active={activeTab === 'update'} onselect={() => (activeTab = 'update')}>Update</Tab>
    <Tab active={activeTab === 'delete'} onselect={() => (activeTab = 'delete')}>Delete</Tab>
  </Tabs>

  {#if activeTab === 'overview'}
    <div class="tab-panel">
      {#if signedIn}
        <Card>
          <div class="card-header" style="padding-bottom:0.75rem">
            <h2 class="card-title" style="font-size:1rem">Keys</h2>
          </div>
          <div class="card-content">
            {#if profilePictureUrl && !profilePictureError}
              <div class="profile-summary">
                <img
                  class="profile-picture"
                  alt="Profile picture preview"
                  src={profilePictureUrl}
                  onerror={() => (profilePictureError = true)}
                />
                <div>
                  <div class="field" style="margin:0">
                    <span class="small-label">Profile picture</span>
                    <code class="font-mono-key">{profilePictureStatusText}</code>
                  </div>
                </div>
              </div>
            {/if}

            <div class="field">
              <span class="small-label">Public key</span>
              <div class="key-line">
                <code class="overview-code font-mono-key">{publicKeyDisplay}</code>
              </div>
            </div>

            <div class="field">
              <span class="small-label">Encrypted private key (NIP-49)</span>
              <div class="key-line">
                <code class="overview-code font-mono-key">{encryptedKeyDisplay}</code>
                <button class="btn ghost copy-line" type="button" onclick={handleCopyEncrypted}>Copy</button>
              </div>
            </div>

            <div class="field">
              <span class="small-label">Decrypted private key</span>
              <div class="warning-banner" style="margin-bottom:0.5rem">⚠ This is your unencrypted private key. Never share it.</div>
              <div class="key-line">
                <code class="overview-code font-mono-key">{privateKeyDisplay}</code>
                <button class="btn subtle copy-line" type="button" onclick={handleDecryptPrivateKey}>Decrypt private key</button>
              </div>
            </div>

            <div class="field">
              <span class="small-label">Relays</span>
              <code class="overview-code font-mono-key">{relayListDisplay}</code>
            </div>
          </div>
        </Card>

        {#if showAdminPanel}
          <Card>
            <div class="card-header" style="padding-bottom:0.75rem">
              <h2 class="card-title" style="font-size:1rem">Admin console</h2>
              <p class="card-description">Review users, verify pending accounts, and manage roles.</p>
            </div>
            <div class="card-content">
              <div>
                <Button variant="secondary" onclick={loadAdminUsers}>Refresh users</Button>
              </div>
              <div class="status" data-type={adminStatus.type}>{adminStatus.message}</div>
              <div class="admin-list">
                {#if !adminUsers.length}
                  <div class="admin-empty">No users returned.</div>
                {:else}
                  {#each adminUsers as user (user.username)}
                    {@const isSelf = Boolean(username && user.username === username)}
                    {@const actorRank = roleRank(role)}
                    {@const canManage = canManageUser(role, user.role, user.username)}
                    <div class="admin-user">
                      <div class="admin-user-main">
                        <img
                          class="admin-avatar"
                          class:placeholder={!user.picture_url}
                          alt="{user.username} avatar"
                          src={user.picture_url || undefined}
                        />
                        <div class="admin-meta">
                          <div class="admin-name">{user.username}</div>
                          <div class="admin-sub">{user.registration_email || '—'}</div>
                          <div class="admin-sub">{formatUserIdentifier(user)}</div>
                        </div>
                      </div>
                      <div class="admin-tags">
                        <span class="tag">{user.role || 'user'}</span>
                        <span class="tag status-{user.status || 'unknown'}">{user.status || 'unknown'}</span>
                      </div>
                      <div class="admin-controls">
                        {#if role === 'admin'}
                          <select
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
                          <button class="btn danger" type="button" disabled={!canManage} onclick={() => handleDeleteUser(user)}>Delete</button>
                        {/if}
                      </div>
                    </div>
                  {/each}
                {/if}
              </div>
            </div>
          </Card>
        {/if}
      {/if}
    </div>
  {/if}

  {#if activeTab === 'update'}
    <div class="tab-panel">
      {#if signedIn}
        <Card>
          <div class="card-content">
            <section class="stack-4" style="padding-bottom:1rem;border-bottom:1px solid oklch(0.25 0.01 260 / 0.45)">
              <header>
                <h2 class="card-title" style="font-size:1rem;margin-bottom:0.2rem">Rotate password &amp; key</h2>
                <p class="card-description">This will re-encrypt your private key with the new password.</p>
              </header>
              <form class="form" onsubmit={handleCredentialsSubmit}>
                <div class="split-fields">
                  <label>
                    New password
                    <input type="password" bind:value={newPassword} autocomplete="new-password" placeholder="••••••••" />
                  </label>
                  <label>
                    New private key
                    <input type="text" bind:value={newPrivateKeyInput} placeholder="ncryptsec..., nsec1..., or hex" />
                  </label>
                </div>
                <div class="warning-banner">⚠ Your private key will be re-encrypted with the new password before upload.</div>
                <Button type="submit">Update password &amp; key</Button>
                <div class="status" data-type={credentialsStatus.type}>{credentialsStatus.message}</div>
              </form>
            </section>

            <section class="stack-4" style="padding-bottom:1rem;border-bottom:1px solid oklch(0.25 0.01 260 / 0.45)">
              <header>
                <h2 class="card-title" style="font-size:1rem;margin-bottom:0.2rem">Update relay list</h2>
              </header>
              <form class="form" onsubmit={handleRelaySubmit}>
                <label>
                  Relays (one per line)
                  <textarea bind:value={relaysText} rows="4" class="font-mono-key" placeholder="wss://relay.example.com"></textarea>
                </label>
                <Button type="submit">Save relays</Button>
                <div class="status" data-type={relayStatus.type}>{relayStatus.message}</div>
              </form>
            </section>

            <section class="stack-4">
              <header>
                <h2 class="card-title" style="font-size:1rem;margin-bottom:0.2rem">Profile picture</h2>
              </header>
              <form class="form" onsubmit={handlePictureSubmit}>
                <label>
                  Profile picture
                  <input type="file" accept="image/*" bind:this={profilePictureInput} />
                </label>
                <Button type="submit" variant="secondary">Upload</Button>
                <div class="status" data-type={pictureStatus.type}>{pictureStatus.message}</div>
              </form>
            </section>
          </div>
        </Card>
      {/if}
    </div>
  {/if}

  {#if activeTab === 'delete'}
    <div class="tab-panel">
      {#if signedIn}
        <Card class="danger-panel">
          <div class="card-header" style="padding-bottom:0.75rem">
            <h2 class="card-title" style="font-size:1rem;color:var(--destructive)">Delete account</h2>
            <p class="card-description">This action is permanent and cannot be undone. Your NIP-05 identity and all stored data will be removed.</p>
          </div>
          <form class="form" onsubmit={handleDeleteSubmit}>
            <label class="checkline">
              <input type="checkbox" bind:checked={deleteSavedKeyChecked} required />
              <span>I have saved my encrypted private key and understand it will be irrecoverable after deletion.</span>
            </label>
            <label>
              <span class="small-label">Type <code class="font-mono-key">{username}</code> to confirm</span>
              <input
                type="text"
                bind:value={deleteConfirmUsername}
                placeholder="username"
                autocomplete="off"
                autocapitalize="off"
                autocorrect="off"
                spellcheck="false"
                required
                onpaste={handleDeletePaste}
                ondrop={handleDeleteDrop}
              />
            </label>
            <Button type="submit" variant="destructive" class="w-full" disabled={!deleteGuardOk}>Delete my account permanently</Button>
            <div class="status" data-type={deleteStatus.type}>{deleteStatus.message}</div>
          </form>
        </Card>
      {/if}
    </div>
  {/if}

  <div class="mt-8" style="display:flex;justify-content:flex-end">
    <a class="btn ghost" href="/" onclick={handleSignOut}>Sign out</a>
  </div>
</Shell>
