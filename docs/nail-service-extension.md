# The nail service extension (2026-07-12)

This document explains the set of changes commits `6ee863c..ec5672b`
introduced into noas, and the reasoning behind each. They were made to let
noas act as the identity backend for **nail** (`~/IT/nostr/nail`), the
"nostr on email" mailing-list product — but every piece is generic: noas
gained a reusable *service API* for trusted first-party services, not
nail-specific code. nail's requirements and the decision record live in
`nail/docs/DECISIONS.md` (D1) and `nail/docs/architecture.md` (§ noas
extension); this file is the noas-side view.

## Why extend noas at all

nail subscribes people by **email address only**. Each subscriber gets a
real nostr identity so they can comment on posts (from the web, or by
replying to an email) without ever seeing a key — and can later "graduate"
to a real nostr client via NIP-46 without the key ever being exported.

That requires exactly the primitives noas already had: NIP-49-encrypted key
storage, server-side event signing, multi-tenant NIP-05, and a NIP-46
bunker. The alternatives — rebuilding custody inside nail, or a third
service — would have duplicated the security-critical code noas already
tests. What noas *lacked* was the glue for an email-first product:

1. accounts identified by an email instead of a chosen username/password,
2. a custody mode that doesn't depend on a user-chosen password,
3. magic-link login and bearer sessions (noas auth was stateless
   username + password-hash on every request),
4. a direct "sign this event for account X" call (signing was reachable
   only through the NIP-46 kind-24133 envelope),
5. account provisioning/deletion callable by a trusted backend service.

Everything below is **additive**. Existing registration, sign-in, NIP-05,
NIP-46, and admin behavior is unchanged; existing accounts are untouched
(they default to the legacy custody mode via a column default).

## 1. Service authentication (`e787786`)

**What:** New env `SERVICE_API_KEYS` (comma-separated shared secrets). All
`/api/v1/service/*` routes require a matching `X-Noas-Service-Key` header.
The comparison is timing-safe (`crypto.timingSafeEqual` over
length-checked buffers). When no keys are configured, service routes
answer `503` — the API surface simply doesn't exist until an operator
opts in.

**Why:** nail's engine is a backend, not a user. It needs a
machine-to-machine credential that is independent of any user's secrets,
easy to rotate (multiple keys can be live at once — hence the list), and
cleanly disabled by default. Gating the whole `/service` prefix in one
router-level middleware keeps every future service route safe by
construction. `DELETE` was also added to the CORS method allowlist because
the new session-logout and account-deletion endpoints use it.

## 2. Master-key custody (`744f4be`)

**What:** Migration `20260712000000` adds a `custody` enum column
(`'password'` default, `'master_key'`) to `nostr_users`. New env
`CUSTODY_MASTER_KEY`. For `master_key` accounts the stored NIP-49
ciphertext is encrypted with the master key as the NIP-49 passphrase, and
`raw_password` stays `NULL`. A new shared module `src/custody.js`
(`resolveSigningSecret` / `unlockNostrUserSecretKey`) resolves the
decryption secret for signing — `raw_password` for legacy accounts, the
master key for custodial ones — and both the NIP-46 path (`src/nip46.js`)
and the new sign endpoint go through it. The unlock helper also verifies
that the decrypted key actually derives the stored pubkey before signing.

**Why:** noas's pre-existing "auto-generated key" flow achieved server-side
signing by permanently storing the user's **raw password** — acceptable as
a stopgap, but it makes the password column as sensitive as the key itself
and can't work for nail at all: magic-link subscribers *have no password*.
A single operator-held master key means:

- one secret to protect/rotate instead of one plaintext credential per row;
- a database dump alone (without the env) does not expose custodial keys;
- storage stays NIP-49 (`ncryptsec`), so nothing about the at-rest format
  or the existing encrypt/decrypt code path changed.

The mode lives in an explicit enum rather than being inferred (e.g. "has
no raw_password") so legacy client-encrypted accounts — where the server
genuinely *cannot* sign — remain unambiguously non-custodial. All
service-API operations that unlock or delete keys are restricted to
`custody = 'master_key'` rows, so the new machinery can never touch an
account a user created for themselves.

## 3. Email-first account provisioning (`e787786`)

**What:** `POST /api/v1/service/accounts` `{email, tenant_domain}` →
`{success, username, pubkey, created}`. Implemented in
`src/service-accounts.js`:

- **Username derivation:** lowercase email local part stripped to the
  NIP-05-safe alphabet `a-z0-9-_.`, padded to ≥3 chars (`subscriber` if
  nothing survives), truncated to 32, then `base`, `base1`, `base2`, …
  on collision or reserved names (re-using the existing
  `validateUsername`). The subscriber's NIP-05 identity
  (`username@tenant`) falls out of noas's existing `/.well-known/nostr.json`.
- **Idempotency:** keyed on `(tenant_domain, lower(registration_email))` —
  migration `20260712000001` adds a partial index for that lookup. A repeat
  call returns the existing account (`200`, `created: false`) instead of
  minting a second identity. The lookup matches **only**
  `custody = 'master_key'` rows, so a legacy user who happened to register
  with the same email can never be returned to (or hijacked by) a service.
- Accounts are created `active` with a random unguessable
  `password_sha256` (password sign-in is impossible), and enqueue the same
  tenant relay-allowlist (NIP-86) jobs as the normal verify/activation flow.

**Why:** nail's identifier *is* the email; usernames are an implementation
detail derived from it. Idempotency matters because nail (re)provisions on
every subscribe — including re-subscribing after an account wipe — and a
network retry must not create duplicate identities. Activation is
immediate because **double opt-in is the calling service's job** (nail's
first magic link is the opt-in confirmation); noas requiring its own email
verification here would double-verify the same address with worse UX.

## 4. Magic links and sessions (`669f2d9`)

**What:** Two new tables (migrations `20260712000002/3`), both
`ON DELETE CASCADE` from `nostr_users`:

- `POST /api/v1/service/magic-links` `{email, tenant_domain, purpose:
  login|confirm}` → single-use token; 30 min for `login`, 7 days for
  `confirm`; `404` for unknown emails. **noas sends no email for these.**
- Public `POST /api/v1/auth/magic/verify` `{token}` → `{session_token,
  username, pubkey, purpose, expires_at}`; consumption is atomic
  (single-use enforced in the UPDATE), `404` invalid / `410` used-or-expired.
- `GET /api/v1/auth/session` (Bearer) resolves the account and slides the
  30-day expiry; `DELETE` revokes it.

**Why:** Magic links are the login method that matches "identity = email
address" — nothing to remember, and the same mechanism doubles as opt-in
confirmation (hence the two purposes with different lifetimes: a login
link is security-sensitive and short; a confirm link sits in an inbox
until the subscriber gets around to it). noas deliberately does **not**
send these emails: nail owns all rendering, branding, and the outbound
SMTP path, and noas shouldn't need per-service email templates. Returning
the token to the authenticated service keeps the trust boundary clean —
only a service that already holds the service key can mint one.

Sessions are new to noas (auth was previously stateless password-hash per
request). Opaque random bearer tokens stored server-side were chosen over
JWTs so revocation is trivial (logout and account deletion actually
invalidate), no signing-key management is added, and a DB hit per request
is irrelevant at this scale. The `verify` response includes `purpose` so
callers can distinguish first-confirmation from routine login (nail uses
it for its onboarding screen).

## 5. Direct signing endpoint (`49849c5`)

**What:** `POST /api/v1/service/sign` `{username, tenant_domain, event}` →
`{success, event: <signed>}`. The template supplies `kind` (required)
plus optional `content`/`tags`/`created_at`; `pubkey`, `id`, and `sig` are
always server-derived. Only `master_key`-custody accounts can be signed
for. A subscriber **Bearer session is accepted in place of the service
key**, in which case the username must resolve to the session's account.

**Why:** signing existed only behind the NIP-46 kind-24133 encrypted
JSON-RPC protocol — the right interface for remote *nostr clients*, but
needless ceremony for a trusted backend one HTTP hop away (nail posts
comments, kind-0 profiles, and NIP-09 deletions on subscribers' behalf).
The endpoint is a thin wrapper over the same unlock path NIP-46 uses
(`src/custody.js`), so there is exactly one code path that ever touches
key material. Ignoring any caller-supplied `pubkey/id/sig` prevents a
confused service from publishing inconsistencies; the session variant
exists so a future client could sign as the logged-in subscriber without
holding the service key, and the cross-account check (session ≠ username →
`403`) is tested.

The NIP-46 bunker keeps working for custodial accounts through the same
module — that is nail's "graduation" story: a subscriber can connect a
real nostr client via `bunker://` later, keeping their identity while the
key never leaves noas.

## 6. Custodial account deletion (`ec5672b`)

**What:** `DELETE /api/v1/service/accounts` (body or query:
`email`-or-`username` + `tenant_domain`) → removes the account. Restricted
to `master_key`-custody rows; mirrors the existing user/admin delete paths
(row removal cascades sessions and magic-link tokens; NIP-86 relay
*unallow* jobs are enqueued for the pubkey).

**Why:** nail's "delete my account" flow first publishes best-effort
NIP-09 deletion requests with the subscriber's key, then must destroy the
identity itself — otherwise the operator retains signing power over an
identity whose owner asked for erasure. The custody restriction means a
service can never delete a self-managed user account, even with a valid
service key.

## Test and hygiene changes (`6ee863c`, `f6b2611`)

- `6ee863c` fixed a **pre-existing red** in `test-api.sh`: the script still
  expected duplicate-pubkey registration to succeed, but the server had
  already been changed (commit `6ebf404`) to answer `409`. The suite now
  encodes the intended 409 (and its expected-count arithmetic was off by
  two).
- New unit suites: `src/custody.test.js` (mode resolution, unlock
  failures, pubkey-mismatch), `src/service-accounts.test.js` (username
  derivation/collision/reserved names, idempotency),
  `src/routes-service.test.js` (20 HTTP tests: auth gating, provisioning,
  magic-link lifecycle incl. replay, session sliding expiry,
  cross-account sign `403`), `src/db/service-tokens.test.js`. All are
  DB-skip-safe like the existing suites. Unit total: 56 → **103**.
- `f6b2611` added service-API integration tests to `test-api.sh`, gated on
  `NOAS_TEST_SERVICE_KEY` so the script still passes on deployments that
  don't enable the service API (30/30 with the key, 24/24 without).

## Configuration summary

| Env var | Purpose | Default |
|---|---|---|
| `SERVICE_API_KEYS` | Comma-separated shared secrets for `/api/v1/service/*` | unset → service API disabled (503) |
| `CUSTODY_MASTER_KEY` | NIP-49 passphrase for `master_key`-custody ciphertexts | unset → provisioning/signing answer 503 |

Both are documented in `.env.example` and the README. The master key is
treated as an opaque passphrase (no format enforced); rotating it requires
re-encrypting existing custodial rows — there is no rotation tool yet
(see below).

## Security posture, in short

- Plaintext keys are never persisted; at-rest format remains NIP-49
  `ncryptsec`. The plaintext exists in memory only during generation and
  per-signing unlock, as before.
- A database dump without `CUSTODY_MASTER_KEY` does not expose custodial
  keys — an improvement over the `raw_password` scheme, which the new mode
  supersedes for all service-provisioned accounts (legacy rows keep
  working unchanged).
- Every service-API power (provision, sign, delete, magic links) is triple
  -gated: service key (timing-safe) → tenant scoping → custody-mode
  restriction.
- Sessions and magic tokens are single-purpose, expiring, revocable rows
  that cascade away with the account.

## Known limitations / follow-ups

- **No master-key rotation tooling** — would need a re-encryption
  migration script over `custody = 'master_key'` rows.
- The trust model is coarse: any holder of a service key can act on *all*
  custodial accounts across tenants. Per-tenant service keys (or scoping a
  key to a tenant list) would tighten this if a second service ever joins.
- No rate limiting on the public `magic/verify` endpoint (tokens are
  high-entropy and single-use; nail additionally rate-limits upstream).
- Expired magic-link/session rows are only dropped via cascade or use;
  a retention sweep in the existing background-worker framework would keep
  the tables tidy.
- `src/public/index.html` (the end-user portal docs) intentionally does not
  document the service API — it is operator-to-operator surface, not
  end-user surface; this file and the README are its documentation.
