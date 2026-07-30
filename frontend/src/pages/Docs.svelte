<script lang="ts">
  import Shell from '../components/Shell.svelte';

  interface Endpoint {
    method: 'GET' | 'POST';
    path: string;
    description: string;
    descriptionHtml?: boolean;
    requestBody?: string;
    extraNote?: string;
  }

  const endpoints: Endpoint[] = [
    { method: 'POST', path: '/api/v1/auth/register', description: 'Create account and send verification email.' },
    { method: 'GET', path: '/api/v1/auth/verify?token=...', description: 'Preview verification token state.' },
    {
      method: 'POST',
      path: '/api/v1/auth/verify',
      description: 'Verify token + password hash and activate account.',
      requestBody: `{
  "token": "verification_token",
  "password_hash": "sha256_hex"
}`,
    },
    {
      method: 'POST',
      path: '/api/v1/auth/resend',
      description: 'Resend verification email for a pending account.',
      requestBody: `{
  "username": "alice"
}`,
    },
    {
      method: 'POST',
      path: '/api/v1/auth/signin',
      description: 'Sign in and fetch encrypted key, pubkey, relays, and role.',
      requestBody: `{
  "username": "alice",
  "password_hash": "sha256_hex"
}`,
    },
    {
      method: 'POST',
      path: '/api/v1/auth/update',
      description: 'Update password/key bundle, relays, and profile picture. Auth accepts `password` or `password_hash`.',
      requestBody: `{
  "username": "alice",
  "password": "current_password",
  "updates": {
    "new_password": "new_password",
    "public_key": "64_char_hex",
    "private_key_encrypted": "ncryptsec1...",
    "relays": ["wss://relay.example.com"],
    "profile_picture_data": "base64",
    "profile_picture_content_type": "image/png"
  }
}`,
      extraNote: 'Credential rotation requires `new_password` or `new_password_hash` together with `public_key` and `private_key_encrypted`.',
    },
    { method: 'POST', path: '/api/v1/auth/delete', description: 'Delete authenticated account permanently.' },
    {
      method: 'POST',
      path: '/api/v1/relays',
      description: 'Add a relay URL for an authenticated account. Duplicate URLs are idempotent and domain-managed tenants reject manual edits.',
      requestBody: `{
  "username": "alice",
  "password_hash": "sha256_hex",
  "relay_url": "wss://relay.example.com",
  "policy": {
    "read": true,
    "write": true
  }
}`,
    },
    { method: 'POST', path: '/api/v1/admin/users/list', description: 'Admin/moderator user listing.' },
    { method: 'POST', path: '/api/v1/admin/users/verify', description: 'Admin/moderator verification of pending accounts.' },
    {
      method: 'POST',
      path: '/api/v1/admin/users/role',
      description: 'Admin-only role assignment (`user`, `moderator`, `admin`), including self-downgrade with immediate permission changes.',
    },
    {
      method: 'POST',
      path: '/api/v1/admin/users/delete',
      description: 'Admin/moderator user deletion (requires <code>confirm_username</code> matching <code>target_username</code>).',
      descriptionHtml: true,
    },
    { method: 'GET', path: '/api/v1/picture/:identifier', description: 'Fetch profile picture by pubkey (`hex`/`npub`) or username.' },
    { method: 'GET', path: '/.well-known/nostr.json', description: 'NIP-05 verification + Noas metadata (without `name`).' },
    { method: 'GET', path: '/api/v1/health', description: 'Health status endpoint.' },
    { method: 'GET', path: '/api/v1/nip46/info', description: 'NIP-46 signer metadata and supported methods.' },
    { method: 'GET', path: '/api/v1/nip46/connect/:username', description: 'Generate bunker connection URL for active account.' },
    { method: 'POST', path: '/api/v1/nip46/nostrconnect', description: 'Process `nostrconnect://` client handshake.' },
    { method: 'POST', path: '/api/v1/nip46/request', description: 'Handle encrypted NIP-46 request events.' },
    {
      method: 'POST',
      path: 'Legacy aliases and removed routes',
      description:
        'Use versioned routes only: `/api/v1/auth/*`, `/api/v1/admin/*`, `/api/v1/picture/:identifier`, `/api/v1/health`, `/api/v1/nip46/*`. Removed with `410`: `/register`, `/onboarding/start`, `/onboarding/complete`, `/verify-email` (POST), `/signin`, `/update`, `/delete`, `/picture/:identifier`, `/health`, `/nip46/*`. `/verify-email` (GET) redirects to `/verify`.',
    },
  ];
</script>

<svelte:head>
  <title>Noas | Docs</title>
  <meta name="description" content="Noas API endpoints and example payloads." />
</svelte:head>

<Shell wide>
  <h1 class="portal-title">API Reference</h1>
  <p class="docs-lead">
    All endpoints accept and return JSON. Authenticated endpoints use credentials in request body
    (`username` + `password_hash`, or `password` where supported), not Bearer tokens.
  </p>

  <section class="endpoint-list">
    {#each endpoints as endpoint (endpoint.path)}
      <article class="endpoint-card">
        <div class="endpoint-head">
          <span class="endpoint-method method-{endpoint.method.toLowerCase()}">{endpoint.method}</span>
          <code class="endpoint-path">{endpoint.path}</code>
        </div>
        {#if endpoint.descriptionHtml}
          <p class="endpoint-desc">{@html endpoint.description}</p>
        {:else}
          <p class="endpoint-desc">{endpoint.description}</p>
        {/if}
        {#if endpoint.requestBody}
          <p class="endpoint-label">Request body</p>
          <pre class="endpoint-pre"><code>{endpoint.requestBody}</code></pre>
        {/if}
        {#if endpoint.extraNote}
          <p class="endpoint-desc">{endpoint.extraNote}</p>
        {/if}
      </article>
    {/each}
  </section>
</Shell>
