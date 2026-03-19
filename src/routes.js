/**
 * API Routes
 * 
 * Defines all HTTP endpoints for the Noas server:
 * - POST /api/v1/auth/register - Create account and send verification email
 * - GET /api/v1/auth/verify - Preview verification token state
 * - POST /api/v1/auth/verify - Verify token + password hash and activate account
 * - POST /api/v1/auth/resend - Resend verification email
 * - POST /register - Legacy alias (deprecated)
 * - POST /signin - Authenticate and get encrypted key
 * - POST /verify-email - Legacy alias (deprecated)
 * - POST /update - Update user password or relays
 * - POST /delete - Delete user account
 * - POST /picture - Upload profile picture
 * - GET /picture/:pubkey - Serve profile picture by public key
 * - GET /.well-known/nostr.json - NIP-05 verification
 * - GET /health - Health check endpoint
 * - POST /nip46/request - Handle NIP-46 requests
 * - GET /nip46/connect/:username - Get connection token
 * - GET /nip46/info - Get signer information
 */

import express from 'express';
import { 
  recordUsedVerificationToken,
  isVerificationTokenUsed,
  createNostrUser,
  getNostrUserByUsername,
  getNostrUserByVerificationToken,
  activateNostrUserByUsername,
  updateNostrUserResendToken,
  deleteExpiredPendingNostrUsers,
  getActiveNostrUserForNip05,
  getActiveNostrUserByUsername,
  updateNostrUser,
  deleteNostrUser,
  getNostrUserProfilePictureByPublicKey,
  updateNostrUserProfilePicture,
} from './db/users.js';
import { 
  validateUsername, 
  validatePublicKey, 
  validateEncryptedPrivateKey,
} from './auth.js';
import { 
  createConnectionToken,
  processNip46Request,
  createResponseEvent,
  signerPubkey 
} from './nip46.js';
import { sendVerificationEmail } from './email.js';
import { config } from './config.js';
import { randomUUID, createHash } from 'crypto';

export const router = express.Router();

const MAX_PROFILE_PICTURE_BYTES = 2 * 1024 * 1024;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function getEmailDomain(email) {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === normalized.length - 1) return '';
  return normalized.slice(atIndex + 1);
}

function getDomainScopedRelays(email, fallbackRelays = []) {
  const emailDomain = getEmailDomain(email);
  const mappedRelays = config.domainRelayMap[emailDomain];
  if (Array.isArray(mappedRelays) && mappedRelays.length > 0) {
    return mappedRelays;
  }
  const protectedRelaySet = new Set(
    Object.values(config.domainRelayMap).flat()
  );
  const sanitizeFallback = (relayUrls) => relayUrls.filter((relayUrl) => !protectedRelaySet.has(relayUrl));
  if (config.tenantDefaultRelays.length > 0) {
    return sanitizeFallback(config.tenantDefaultRelays);
  }
  return sanitizeFallback(fallbackRelays);
}

function buildVerificationToken() {
  return randomUUID();
}

function buildVerificationLinkWithRedirect(token, redirect) {
  const params = new URLSearchParams({ token });
  if (redirect) params.set('redirect', redirect);
  return `${config.noasPublicUrl}${config.noasBasePath}/verify?${params.toString()}`;
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (!config.allowedOrigins.length) return true;
  return config.allowedOrigins.includes(origin);
}

function isValidSha256Hex(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || '').trim());
}

function buildNip05Identifier(username) {
  return `${username}@${config.nip05RootDomain}`;
}

function isNostrUserVerificationExpired(user, expiryMinutes) {
  const createdAtMs = new Date(user.created_at).getTime();
  if (Number.isNaN(createdAtMs)) return true;
  const ttlMs = Math.max(1, Number(expiryMinutes) || 1) * 60 * 1000;
  return Date.now() > createdAtMs + ttlMs;
}

function minutesBetween(nowMs, thenValue) {
  const thenMs = new Date(thenValue).getTime();
  if (Number.isNaN(thenMs)) return Number.POSITIVE_INFINITY;
  return (nowMs - thenMs) / 1000 / 60;
}

function normalizeBase64Payload(data, contentType) {
  if (!data || typeof data !== 'string') {
    return { error: 'Image data is required' };
  }

  let base64Data = data;
  let resolvedType = contentType;

  if (data.startsWith('data:')) {
    const match = data.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return { error: 'Invalid data URL format' };
    }
    resolvedType = resolvedType || match[1];
    base64Data = match[2];
  }

  if (!resolvedType || typeof resolvedType !== 'string') {
    return { error: 'Content type is required' };
  }
  if (!resolvedType.startsWith('image/')) {
    return { error: 'Content type must be an image' };
  }

  const base64Clean = base64Data.replace(/\s+/g, '');
  let buffer;
  try {
    buffer = Buffer.from(base64Clean, 'base64');
  } catch (error) {
    return { error: 'Invalid base64 image data' };
  }

  if (!buffer.length) {
    return { error: 'Image data is empty' };
  }
  if (buffer.length > MAX_PROFILE_PICTURE_BYTES) {
    return { error: 'Image exceeds 2MB limit' };
  }

  const normalized = buffer.toString('base64').replace(/=+$/, '');
  const incoming = base64Clean.replace(/=+$/, '');
  if (normalized !== incoming) {
    return { error: 'Invalid base64 image data' };
  }

  return { buffer, contentType: resolvedType };
}

/**
 * POST /api/v1/auth/register
 * Create account and send verification email.
 */
router.post('/api/v1/auth/register', async (req, res) => {
  try {
    const {
      username,
      password_hash: passwordHash,
      public_key: publicKeyRaw,
      private_key_encrypted: privateKeyEncrypted,
      redirect,
    } = req.body || {};
    const normalizedUsername = String(username || '').trim().toLowerCase();
    const normalizedPasswordHash = String(passwordHash || '').trim().toLowerCase();
    const normalizedRedirect = String(redirect || '').trim() || null;

    const usernameCheck = validateUsername(normalizedUsername);
    if (!usernameCheck.valid) return res.status(400).json({ error: usernameCheck.error });
    if (!isValidSha256Hex(normalizedPasswordHash)) {
      return res.status(400).json({ error: 'password_hash must be a 64-character SHA-256 hex string' });
    }
    if (normalizedRedirect) {
      let redirectOrigin = '';
      try {
        redirectOrigin = new URL(normalizedRedirect).origin;
      } catch {
        return res.status(400).json({ error: 'Redirect must be a valid URL' });
      }
      if (!isAllowedOrigin(redirectOrigin)) {
        return res.status(400).json({ error: 'Redirect is not allowed' });
      }
    }
    let normalizedPublicKey = null;
    if (publicKeyRaw) {
      const candidate = String(publicKeyRaw || '').trim();
      if (candidate.startsWith('npub1')) {
        try {
          const { nip19 } = await import('nostr-tools');
          const decoded = nip19.decode(candidate);
          if (decoded.type !== 'npub' || typeof decoded.data !== 'string') {
            return res.status(400).json({ error: 'public_key must be a valid npub or hex pubkey' });
          }
          normalizedPublicKey = decoded.data.toLowerCase();
        } catch {
          return res.status(400).json({ error: 'public_key must be a valid npub or hex pubkey' });
        }
      } else {
        normalizedPublicKey = candidate.toLowerCase();
      }
      const publicKeyCheck = validatePublicKey(normalizedPublicKey);
      if (!publicKeyCheck.valid) return res.status(400).json({ error: publicKeyCheck.error });
    }
    if (privateKeyEncrypted) {
      const encryptedCheck = validateEncryptedPrivateKey(String(privateKeyEncrypted || '').trim());
      if (!encryptedCheck.valid) return res.status(400).json({ error: encryptedCheck.error });
    }

    const nip05 = buildNip05Identifier(normalizedUsername);
    const email = normalizeEmail(nip05);
    await deleteExpiredPendingNostrUsers(config.verificationExpiryMinutes);

    const existing = await getNostrUserByUsername(normalizedUsername);
    if (existing?.status === 'active') {
      return res.status(409).json({ error: 'Username already active. Sign in.' });
    }
    if (existing?.status === 'disabled') {
      return res.status(403).json({ error: 'Account is disabled.' });
    }
    if (existing?.status === 'unverified_email') {
      return res.status(409).json({ error: 'Username is currently pending verification.' });
    }

    if (!config.emailVerificationEnabled) {
      await createNostrUser({
        username: normalizedUsername,
        passwordHash: normalizedPasswordHash,
        publicKey: normalizedPublicKey,
        privateKeyEncrypted: privateKeyEncrypted ? String(privateKeyEncrypted).trim() : null,
        status: 'active',
        verificationToken: null,
      });
      return res.status(200).json({
        success: true,
        status: 'active',
        nip05,
        message: 'Account is active. You can now sign in.',
      });
    }

    const verificationToken = buildVerificationToken();
    await createNostrUser({
      username: normalizedUsername,
      passwordHash: normalizedPasswordHash,
      publicKey: normalizedPublicKey,
      privateKeyEncrypted: privateKeyEncrypted ? String(privateKeyEncrypted).trim() : null,
      status: 'unverified_email',
      verificationToken,
    });

    const verificationMinutes = Math.max(1, config.verificationExpiryMinutes);
    const verificationLink = buildVerificationLinkWithRedirect(verificationToken, normalizedRedirect);
    const expiresAt = new Date(Date.now() + verificationMinutes * 60 * 1000);
    let emailDelivery = { sent: false, reason: 'not_attempted' };
    try {
      emailDelivery = await sendVerificationEmail({
        to: email,
        username: normalizedUsername,
        identifier: nip05,
        verificationLink,
        expiresAt,
        publicKey: normalizedPublicKey,
      });
    } catch (error) {
      emailDelivery = { sent: false, reason: 'smtp_send_failed' };
      console.error('Verification email delivery error:', error);
    }

    if (!emailDelivery.sent && config.requireEmailDelivery) {
      return res.status(502).json({
        error: 'Failed to send verification email. Check SMTP configuration.',
      });
    }

    const responseBody = {
      success: true,
      status: 'unverified_email',
      nip05,
      message: `Check ${email} to verify your account.`,
    };
    if (config.exposeVerificationTokenInResponse || config.isTest) {
      responseBody.verification_token = verificationToken;
      responseBody.verify_url = verificationLink;
    }
    res.status(200).json(responseBody);
  } catch (error) {
    if (error?.code === '23505') {
      return res.status(409).json({ error: 'Username is currently pending verification.' });
    }
    console.error('V1 register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * GET /api/v1/auth/verify
 * Preview verification details by token.
 */
router.get('/api/v1/auth/verify', async (req, res) => {
  try {
    const token = String(req.query.token || '').trim();
    if (!token) {
      return res.status(400).json({ error: 'token is required' });
    }
    const user = await getNostrUserByVerificationToken(token);
    if (!user) {
      if (await isVerificationTokenUsed(token)) {
        return res.status(410).json({ error: 'Link already used.' });
      }
      return res.status(404).json({ error: 'Invalid link.' });
    }
    if (isNostrUserVerificationExpired(user, config.verificationExpiryMinutes)) {
      await deleteExpiredPendingNostrUsers(config.verificationExpiryMinutes);
      return res.status(410).json({ error: 'Link expired. Register again.' });
    }
    if (user.status === 'active') {
      return res.status(409).json({ error: 'Account already active. Sign in.' });
    }
    const expiresAt = new Date(
      new Date(user.created_at).getTime() + Math.max(1, config.verificationExpiryMinutes) * 60 * 1000
    );
    res.json({
      success: true,
      username: user.username,
      nip05: buildNip05Identifier(user.username),
      public_key: user.public_key || null,
      expires_at: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error('V1 verify preview error:', error);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

/**
 * POST /api/v1/auth/verify
 * Confirm pending email using token + password hash.
 */
router.post('/api/v1/auth/verify', async (req, res) => {
  try {
    const { token, password_hash: passwordHash } = req.body || {};
    const normalizedToken = String(token || '').trim();
    const normalizedPasswordHash = String(passwordHash || '').trim().toLowerCase();
    if (!normalizedToken || !normalizedPasswordHash) {
      return res.status(400).json({ error: 'token and password_hash are required' });
    }
    if (!isValidSha256Hex(normalizedPasswordHash)) {
      return res.status(400).json({ error: 'password_hash must be a 64-character SHA-256 hex string' });
    }

    if (await isVerificationTokenUsed(normalizedToken)) {
      return res.status(410).json({ error: 'Link already used.' });
    }

    const user = await getNostrUserByVerificationToken(normalizedToken);
    if (!user) {
      return res.status(404).json({ error: 'Invalid link.' });
    }

    if (user.status === 'active') {
      return res.status(409).json({ error: 'Account already active. Sign in.' });
    }

    if (isNostrUserVerificationExpired(user, config.verificationExpiryMinutes)) {
      await deleteExpiredPendingNostrUsers(config.verificationExpiryMinutes);
      return res.status(410).json({ error: 'Link expired. Register again.' });
    }

    if (user.password_hash !== normalizedPasswordHash) {
      return res.status(401).json({
        error: 'Incorrect password. Someone may have tried to register your email.',
      });
    }

    await activateNostrUserByUsername(user.username);
    await recordUsedVerificationToken(normalizedToken);

    res.json({
      success: true,
      activated: true,
      nip05: buildNip05Identifier(user.username),
    });
  } catch (error) {
    console.error('V1 verify error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

/**
 * POST /api/v1/auth/resend
 * Resend verification email for an unverified account.
 */
router.post('/api/v1/auth/resend', async (req, res) => {
  try {
    const normalizedUsername = String(req.body?.username || '').trim().toLowerCase();
    const usernameCheck = validateUsername(normalizedUsername);
    if (!usernameCheck.valid) return res.status(400).json({ error: usernameCheck.error });

    await deleteExpiredPendingNostrUsers(config.verificationExpiryMinutes);
    const user = await getNostrUserByUsername(normalizedUsername);
    if (!user || user.status !== 'unverified_email') {
      return res.status(404).json({ error: 'Invalid link.' });
    }

    if (isNostrUserVerificationExpired(user, config.verificationExpiryMinutes)) {
      await deleteExpiredPendingNostrUsers(config.verificationExpiryMinutes);
      return res.status(410).json({ error: 'Link expired. Register again.' });
    }

    const cooldownMinutes = Math.max(1, Number(config.resendCooldownMinutes) || 1);
    const minutesSinceLastSend = minutesBetween(Date.now(), user.last_resend_at);
    if (Number.isFinite(minutesSinceLastSend) && minutesSinceLastSend < cooldownMinutes) {
      return res.status(429).json({ error: 'Resend available after one minute' });
    }

    const verificationToken = buildVerificationToken();
    const updated = await updateNostrUserResendToken(normalizedUsername, verificationToken);
    const verificationLink = buildVerificationLinkWithRedirect(verificationToken, null);
    const expiresAt = new Date(
      new Date(updated.created_at).getTime() + Math.max(1, config.verificationExpiryMinutes) * 60 * 1000
    );
    const email = normalizeEmail(buildNip05Identifier(normalizedUsername));

    let emailDelivery = { sent: false, reason: 'not_attempted' };
    try {
      emailDelivery = await sendVerificationEmail({
        to: email,
        username: normalizedUsername,
        identifier: buildNip05Identifier(normalizedUsername),
        verificationLink,
        expiresAt,
        publicKey: updated.public_key || null,
      });
    } catch (error) {
      emailDelivery = { sent: false, reason: 'smtp_send_failed' };
      console.error('Verification resend delivery error:', error);
    }

    if (!emailDelivery.sent && config.requireEmailDelivery) {
      return res.status(502).json({
        error: 'Failed to send verification email. Check SMTP configuration.',
      });
    }

    const responseBody = {
      success: true,
      message: 'Verification email resent.',
    };
    if (config.exposeVerificationTokenInResponse || config.isTest) {
      responseBody.verification_token = verificationToken;
      responseBody.verify_url = verificationLink;
    }
    return res.status(200).json(responseBody);
  } catch (error) {
    console.error('V1 resend error:', error);
    return res.status(500).json({ error: 'Resend failed' });
  }
});

router.post('/onboarding/start', (req, res) => {
  res.status(410).json({
    error: 'Legacy endpoint removed. Use POST /api/v1/auth/register.',
  });
});

router.post('/onboarding/complete', (req, res) => {
  res.status(410).json({
    error: 'Legacy endpoint removed. Use /api/v1/auth/verify flow.',
  });
});

router.post('/verify-email', (req, res) => {
  res.status(410).json({
    error: 'Legacy endpoint removed. Use POST /api/v1/auth/verify.',
  });
});

router.get('/verify-email', (req, res) => {
  const token = String(req.query.token || '').trim();
  const redirect = String(req.query.redirect || req.query.origin || '').trim();
  const params = new URLSearchParams();
  if (token) params.set('token', token);
  if (redirect) params.set('redirect', redirect);
  return res.redirect(`/verify?${params.toString()}`);
});

router.post('/register', (req, res) => {
  res.status(410).json({
    error: 'Legacy endpoint removed. Use POST /api/v1/auth/register.',
  });
});

function normalizePasswordHashFromSignin(passwordHash, password) {
  const fromHash = String(passwordHash || '').trim().toLowerCase();
  if (isValidSha256Hex(fromHash)) return fromHash;
  const raw = String(password || '');
  if (!raw) return '';
  return createHash('sha256').update(raw).digest('hex');
}

router.post('/signin', async (req, res) => {
  try {
    const normalizedUsername = String(req.body?.username || '').trim().toLowerCase();
    const normalizedPasswordHash = normalizePasswordHashFromSignin(
      req.body?.password_hash,
      req.body?.password
    );
    if (!normalizedUsername || !normalizedPasswordHash) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await getNostrUserByUsername(normalizedUsername);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (user.status === 'disabled') {
      return res.status(403).json({ error: 'Account is disabled.' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Email verification required before sign in' });
    }
    if (user.password_hash !== normalizedPasswordHash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const derivedEmail = normalizeEmail(buildNip05Identifier(normalizedUsername));
    res.json({
      success: true,
      encryptedPrivateKey: user.private_key_encrypted || null,
      publicKey: user.public_key || null,
      relays: getDomainScopedRelays(derivedEmail, user.relays || []),
      status: user.status,
    });
  } catch (error) {
    console.error('Signin error:', error);
    res.status(500).json({ error: 'Sign in failed' });
  }
});

/**
 * POST /update
 * Update user account information
 * 
 * Allows changing password, re-encrypting private key, or updating relay list.
 * Requires authentication with current password.
 */
router.post('/update', async (req, res) => {
  try {
    const { username, password, password_hash: passwordHashInput, updates } = req.body;
    const normalizedUsername = String(username || '').trim().toLowerCase();
    const normalizedPasswordHash = normalizePasswordHashFromSignin(passwordHashInput, password);

    if (!normalizedUsername || !normalizedPasswordHash) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await getActiveNostrUserByUsername(normalizedUsername);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (user.password_hash !== normalizedPasswordHash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const updateData = {};
    
    if (updates?.newPasswordHash || updates?.newPassword) {
      const nextPasswordHash = String(
        updates.newPasswordHash || normalizePasswordHashFromSignin('', updates.newPassword)
      ).trim().toLowerCase();
      if (!isValidSha256Hex(nextPasswordHash)) {
        return res.status(400).json({ error: 'newPasswordHash must be a 64-character SHA-256 hex string' });
      }
      updateData.passwordHash = nextPasswordHash;
    }

    if (updates?.encryptedPrivateKey) {
      const encKeyCheck = validateEncryptedPrivateKey(updates.encryptedPrivateKey);
      if (!encKeyCheck.valid) {
        return res.status(400).json({ error: encKeyCheck.error });
      }
      updateData.privateKeyEncrypted = updates.encryptedPrivateKey;
    }

    if (updates?.relays) {
      const mappedRelays = config.domainRelayMap[config.nip05RootDomain];
      if (Array.isArray(mappedRelays) && mappedRelays.length > 0) {
        return res.status(403).json({
          error: 'Relay list is managed by domain policy for this account',
        });
      }
      updateData.relays = updates.relays;
    }

    const updated = await updateNostrUser(normalizedUsername, updateData);

    res.json({
      success: true,
      user: {
        username: updated.username,
        publicKey: updated.public_key || null,
      },
    });
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ error: 'Update failed' });
  }
});

/**
 * POST /delete
 * Delete a user account
 * 
 * Requires authentication and an explicit confirmation that the user
 * has saved their private key.
 */
router.post('/delete', async (req, res) => {
  try {
    const { username, password, password_hash: passwordHashInput, savedKey } = req.body;
    const normalizedUsername = String(username || '').trim().toLowerCase();
    const normalizedPasswordHash = normalizePasswordHashFromSignin(passwordHashInput, password);

    if (!normalizedUsername || !normalizedPasswordHash) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    if (!savedKey) {
      return res.status(400).json({ error: 'Confirm that you saved your private key' });
    }

    const user = await getActiveNostrUserByUsername(normalizedUsername);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.password_hash !== normalizedPasswordHash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await deleteNostrUser(normalizedUsername);

    res.json({
      success: true,
      deleted: {
        username: user.username,
        publicKey: user.public_key || null,
      },
    });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Account deletion failed' });
  }
});

/**
 * POST /picture
 * Upload a profile picture for a user
 * 
 * Authenticates user and stores a profile picture (base64-encoded).
 * Returns a standard URL for use in kind:0 events.
 */
router.post('/picture', async (req, res) => {
  try {
    const { username, password, password_hash: passwordHashInput, data, contentType } = req.body;
    const normalizedUsername = String(username || '').trim().toLowerCase();
    const normalizedPasswordHash = normalizePasswordHashFromSignin(passwordHashInput, password);

    if (!normalizedUsername || !normalizedPasswordHash) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await getActiveNostrUserByUsername(normalizedUsername);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.password_hash !== normalizedPasswordHash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const imageResult = normalizeBase64Payload(data, contentType);
    if (imageResult.error) {
      return res.status(400).json({ error: imageResult.error });
    }

    const updated = await updateNostrUserProfilePicture(
      normalizedUsername,
      imageResult.buffer,
      imageResult.contentType
    );

    if (!updated) {
      return res.status(500).json({ error: 'Profile picture update failed' });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({
      success: true,
      publicKey: updated.public_key,
      url: `${baseUrl}/picture/${updated.public_key}`,
    });
  } catch (error) {
    console.error('Profile picture upload error:', error);
    res.status(500).json({ error: 'Profile picture upload failed' });
  }
});

/**
 * GET /picture/:pubkey
 * Serve a user's profile picture by public key
 */
router.get('/picture/:pubkey', async (req, res) => {
  try {
    const { pubkey } = req.params;

    const pubkeyCheck = validatePublicKey(pubkey);
    if (!pubkeyCheck.valid) {
      return res.status(400).json({ error: pubkeyCheck.error });
    }

    const picture = await getNostrUserProfilePictureByPublicKey(pubkey);
    if (!picture || !picture.profile_picture) {
      return res.status(404).json({ error: 'Profile picture not found' });
    }

    res.set('Content-Type', picture.profile_picture_type || 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(picture.profile_picture);
  } catch (error) {
    console.error('Profile picture fetch error:', error);
    res.status(500).json({ error: 'Profile picture fetch failed' });
  }
});

/**
 * GET /.well-known/nostr.json
 * NIP-05 verification endpoint
 * 
 * Returns user's public key for Nostr identity verification.
 * Enables username@domain.com style identifiers.
 * When email verification is enabled, only verified users are exposed.
 */
router.get('/.well-known/nostr.json', async (req, res) => {
  try {
    const { name } = req.query;

    if (!name) {
      return res.json({
        noas: {
          version: config.apiVersion,
          nip05_domain: config.nip05RootDomain,
          public_url: config.noasPublicUrl,
          base_path: config.noasBasePath || '/',
          api_base: `${config.noasPublicUrl}${config.noasBasePath}/api/v1`,
          email_verification_enabled: config.emailVerificationEnabled,
        },
      });
    }

    const user = await getActiveNostrUserForNip05(String(name).trim().toLowerCase());
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (!user.public_key) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      names: {
        [user.username]: user.public_key,
      },
    });
  } catch (error) {
    console.error('NIP-05 error:', error);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

/**
 * GET /health
 * Health check endpoint
 * 
 * Returns server status and configuration info.
 */
router.get('/health', (req, res) => {
  res.json({ status: 'ok', domain: config.domain });
});

/**
 * GET /nip46/info
 * Get NIP-46 signer information
 * 
 * Returns the public key and supported methods of this remote signer.
 */
router.get('/nip46/info', (req, res) => {
  res.json({
    pubkey: signerPubkey,
    domain: config.domain,
    methods: [
      'connect',
      'ping', 
      'get_public_key',
      'sign_event',
      'nip04_encrypt',
      'nip04_decrypt',
      'nip44_encrypt', 
      'nip44_decrypt'
    ],
    version: '1.0.0'
  });
});

/**
 * GET /nip46/connect/:username
 * Generate a connection token for a specific user
 * 
 * Creates a bunker:// URL that clients can use to initiate a connection.
 */
router.get('/nip46/connect/:username', async (req, res) => {
  try {
    const { username } = req.params;

    // Validate username exists
    const user = await getActiveNostrUserByUsername(String(username || '').trim().toLowerCase());
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate connection token
    const connectionToken = createConnectionToken(config.domain);
    
    res.json({
      bunker_url: connectionToken,
      username,
      instructions: 'Copy this URL and paste it into your NIP-46 compatible client'
    });

  } catch (error) {
    console.error('NIP-46 connect error:', error);
    res.status(500).json({ error: 'Failed to generate connection token' });
  }
});

/**
 * POST /nip46/request
 * Handle NIP-46 requests
 * 
 * Processes encrypted NIP-46 request events and returns encrypted responses.
 * This endpoint simulates relay-based communication via HTTP.
 */
router.post('/nip46/request', async (req, res) => {
  try {
    const { event, username } = req.body;

    if (!event || !event.kind || event.kind !== 24133) {
      return res.status(400).json({ error: 'Invalid request event' });
    }

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    // Process the NIP-46 request
    const response = await processNip46Request(event, username);
    
    if (!response) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Create response event
    const responseEvent = createResponseEvent(response, event.pubkey);

    res.json({
      event: responseEvent,
      success: true
    });

  } catch (error) {
    console.error('NIP-46 request error:', error);
    res.status(500).json({ error: 'Request processing failed' });
  }
});

/**
 * POST /nip46/nostrconnect
 * Handle nostrconnect:// protocol connections
 * 
 * Processes client-initiated connections using the nostrconnect protocol.
 */
router.post('/nip46/nostrconnect', async (req, res) => {
  try {
    const { nostrconnect_url, username } = req.body;

    if (!nostrconnect_url || !nostrconnect_url.startsWith('nostrconnect://')) {
      return res.status(400).json({ error: 'Invalid nostrconnect URL' });
    }

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    // Parse the nostrconnect URL
    const url = new URL(nostrconnect_url);
    const clientPubkey = url.pathname.replace('//', '');
    const secret = url.searchParams.get('secret');
    const relays = url.searchParams.getAll('relay');
    const perms = url.searchParams.get('perms');

    // Validate client pubkey
    if (!clientPubkey || clientPubkey.length !== 64) {
      return res.status(400).json({ error: 'Invalid client pubkey' });
    }

    // Create a mock connect request to process
    const connectRequest = {
      id: Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(''),
      method: 'connect',
      params: [signerPubkey, secret, perms]
    };

    // Create a mock event
    const mockEvent = {
      kind: 24133,
      pubkey: clientPubkey,
      content: 'encrypted_content', // Would be properly encrypted in real implementation
      tags: [['p', signerPubkey]]
    };

    // For demo purposes, we'll simulate the connection
    const user = await getActiveNostrUserByUsername(String(username || '').trim().toLowerCase());
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      remote_signer_pubkey: signerPubkey,
      secret: secret,
      message: 'Connection initiated. Use /nip46/request endpoint to send encrypted commands.',
      relays: ['wss://relay.nostr.org'] // Default relay
    });

  } catch (error) {
    console.error('NIP-46 nostrconnect error:', error);
    res.status(500).json({ error: 'Connection failed' });
  }
});
