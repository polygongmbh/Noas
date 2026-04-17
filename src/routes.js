/**
 * API Routes
 * 
 * Defines all HTTP endpoints for the Noas server:
 * - POST /api/v1/auth/register - Create account and send verification email
 * - GET /api/v1/auth/verify - Preview verification token state
 * - POST /api/v1/auth/verify - Verify token + password hash and activate account
 * - POST /api/v1/auth/resend - Resend verification email
 * - POST /register - Legacy alias (deprecated)
 * - POST /api/v1/auth/signin - Authenticate and get encrypted key
 * - POST /verify-email - Legacy alias (deprecated)
 * - POST /api/v1/auth/update - Update user password or relays
 * - POST /api/v1/auth/delete - Delete user account
 * - POST /api/v1/admin/users/list - Admin list of users
 * - POST /api/v1/admin/users/verify - Admin verify a user
 * - POST /api/v1/admin/users/role - Admin update role
 * - POST /api/v1/admin/users/delete - Admin delete a user
 * - GET /api/v1/picture/:identifier - Serve profile picture by pubkey or username
 * - GET /.well-known/nostr.json - NIP-05 verification
 * - GET /api/v1/health - Health check endpoint
 * - POST /api/v1/nip46/request - Handle NIP-46 requests
 * - GET /api/v1/nip46/connect/:username - Get connection token
 * - GET /api/v1/nip46/info - Get signer information
 */

import express from 'express';
import { 
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
  updateNostrUserRole,
  updateNostrUserStatus,
  listNostrUsers,
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
  signerPubkey,
  handleConnect,
} from './nip46.js';
import { sendVerificationEmail } from './email.js';
import { config, detectLocalHost, rootDomainFromHostLike } from './config.js';
import { randomUUID, createHash } from 'crypto';
import { sendAllowPubkeyToRelays } from './nip86.js';

export const router = express.Router();

const MAX_PROFILE_PICTURE_BYTES = 2 * 1024 * 1024;
const NOSTR_USER_ROLES = {
  ADMIN: 'admin',
  MODERATOR: 'moderator',
  USER: 'user',
};
const ROLE_RANK = {
  [NOSTR_USER_ROLES.ADMIN]: 3,
  [NOSTR_USER_ROLES.MODERATOR]: 2,
  [NOSTR_USER_ROLES.USER]: 1,
};

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

function buildVerificationLinkWithRedirect(token, redirect, noasPublicUrl = config.noasPublicUrl) {
  const params = new URLSearchParams({ token });
  if (redirect) params.set('redirect', redirect);
  return `${noasPublicUrl}${config.noasBasePath}/verify?${params.toString()}`;
}

function isValidRedirectUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return true;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function isValidSha256Hex(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || '').trim());
}

function isValidEmailAddress(value) {
  const normalized = normalizeEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

function resolveRequestHostLike(req) {
  const forwardedHost = String(req.get('x-forwarded-host') || '').split(',')[0].trim();
  if (forwardedHost) return forwardedHost.toLowerCase();
  const directHost = String(req.get('host') || '').split(',')[0].trim();
  return directHost.toLowerCase();
}

function resolveRequestNip05RootDomain(req) {
  const requestDomain = rootDomainFromHostLike(resolveRequestHostLike(req));
  if (config.nip05DomainsConfigured) {
    if (requestDomain) {
      const matchedDomain = config.nip05Domains.find(
        (domain) => requestDomain === domain || requestDomain.endsWith(`.${domain}`)
      );
      if (matchedDomain) {
        return matchedDomain;
      }
    }
    return config.nip05Domains[0] || config.nip05RootDomain;
  }
  return requestDomain || config.nip05RootDomain;
}

function resolveRequestPublicUrl(req) {
  const tenantDomain = resolveRequestNip05RootDomain(req);
  if (tenantDomain && config.noasPublicUrlMap?.[tenantDomain]) {
    return config.noasPublicUrlMap[tenantDomain];
  }

  // If NOAS_PUBLIC_URL is explicitly configured, always use it
  if (config.noasPublicUrlConfigured) {
    return config.noasPublicUrl;
  }

  // Otherwise derive from request headers
  const hostLike = resolveRequestHostLike(req);
  if (!hostLike) return config.noasPublicUrl;

  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
  const fallbackProtocol = detectLocalHost(hostLike) ? 'http' : 'https';
  const protocol = forwardedProto || req.protocol || fallbackProtocol;
  const safeProtocol = protocol === 'http' || protocol === 'https' ? protocol : fallbackProtocol;
  return `${safeProtocol}://${hostLike}`;
}

function resolveTenantContext(req) {
  const nip05RootDomain = resolveRequestNip05RootDomain(req);
  const noasPublicUrl = resolveRequestPublicUrl(req);
  return {
    nip05RootDomain,
    noasPublicUrl,
    apiBase: `${noasPublicUrl}${config.noasBasePath}/api/v1`,
  };
}

function buildNip05Identifier(username, nip05RootDomain = config.nip05RootDomain) {
  return `${username}@${nip05RootDomain}`;
}

function resolveRegistrationEmail({ mode, requestedEmail, username, tenantDomain }) {
  const normalizedRequestedEmail = normalizeEmail(requestedEmail);
  const nip05Email = normalizeEmail(buildNip05Identifier(username, tenantDomain));

  if (mode === 'off') {
    return { email: normalizedRequestedEmail || null };
  }

  if (mode === 'required') {
    if (!normalizedRequestedEmail) {
      return { error: 'email is required' };
    }
    if (!isValidEmailAddress(normalizedRequestedEmail)) {
      return { error: 'email must be a valid email address' };
    }
    return { email: normalizedRequestedEmail };
  }

  if (mode === 'required_nip05_domains') {
    if (normalizedRequestedEmail && normalizedRequestedEmail !== nip05Email) {
      return { error: `email must be ${nip05Email} when EMAIL_VERIFICATION_MODE=required_nip05_domains` };
    }
    return { email: nip05Email };
  }

  return { error: 'Invalid EMAIL_VERIFICATION_MODE value' };
}

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase();
  if (role === NOSTR_USER_ROLES.ADMIN || role === NOSTR_USER_ROLES.MODERATOR || role === NOSTR_USER_ROLES.USER) {
    return role;
  }
  return NOSTR_USER_ROLES.USER;
}

function isValidRole(value) {
  const role = String(value || '').trim().toLowerCase();
  return role === NOSTR_USER_ROLES.ADMIN || role === NOSTR_USER_ROLES.MODERATOR || role === NOSTR_USER_ROLES.USER;
}

function resolveInitialRole(username, publicKey) {
  const normalizedUsername = String(username || '').trim().toLowerCase();
  const normalizedPublicKey = String(publicKey || '').trim().toLowerCase();
  if (normalizedUsername && config.adminUsernames.includes(normalizedUsername)) {
    return NOSTR_USER_ROLES.ADMIN;
  }
  if (normalizedPublicKey && config.adminPublicKeys.includes(normalizedPublicKey)) {
    return NOSTR_USER_ROLES.ADMIN;
  }
  return NOSTR_USER_ROLES.USER;
}

function roleRank(role) {
  return ROLE_RANK[normalizeRole(role)] || 0;
}

function canActOnUser(actor, target) {
  if (!actor || !target) return false;
  if (actor.username === target.username) return false;
  return roleRank(actor.role) > roleRank(target.role);
}

function isNostrUserVerificationExpired(user, expiryMinutes) {
  const createdAtMs = new Date(user.created_at).getTime();
  if (Number.isNaN(createdAtMs)) return true;
  const expiresAtMs = createdAtMs + Math.max(1, Number(expiryMinutes) || 1) * 60 * 1000;
  return Number.isNaN(expiresAtMs) || Date.now() > expiresAtMs;
}

async function resolveRegistrationKeyMaterial(publicKeyRaw, privateKeyEncryptedRaw, nip49Password) {
  const hasPublic = Boolean(String(publicKeyRaw || '').trim());
  const hasPrivate = Boolean(String(privateKeyEncryptedRaw || '').trim());

  if (!hasPublic && !hasPrivate) {
    const normalizedPassword = String(nip49Password || '');
    if (!normalizedPassword) {
      throw new Error('password is required when auto-generating a keypair');
    }
    const { generateSecretKey, getPublicKey } = await import('nostr-tools');
    const { encrypt } = await import('nostr-tools/nip49');
    const secretKey = generateSecretKey();
    return {
      publicKey: getPublicKey(secretKey).toLowerCase(),
      privateKeyEncrypted: encrypt(secretKey, normalizedPassword),
      keySource: 'generated',
    };
  }

  if (hasPublic !== hasPrivate) {
    throw new Error('Provide both public_key and private_key_encrypted together, or omit both to auto-generate');
  }

  const candidate = String(publicKeyRaw || '').trim();
  let normalizedPublicKey = null;
  if (candidate.startsWith('npub1')) {
    const { nip19 } = await import('nostr-tools');
    const decoded = nip19.decode(candidate);
    if (decoded.type !== 'npub' || typeof decoded.data !== 'string') {
      throw new Error('public_key must be a valid npub or hex pubkey');
    }
    normalizedPublicKey = decoded.data.toLowerCase();
  } else {
    normalizedPublicKey = candidate.toLowerCase();
  }

  const publicKeyCheck = validatePublicKey(normalizedPublicKey);
  if (!publicKeyCheck.valid) {
    throw new Error(publicKeyCheck.error);
  }
  const normalizedPrivateKeyEncrypted = String(privateKeyEncryptedRaw || '').trim();
  const encryptedCheck = validateEncryptedPrivateKey(normalizedPrivateKeyEncrypted);
  if (!encryptedCheck.valid) {
    throw new Error(encryptedCheck.error);
  }

  return {
    publicKey: normalizedPublicKey,
    privateKeyEncrypted: normalizedPrivateKeyEncrypted,
    keySource: 'provided',
  };
}

function resolveRegistrationPasswordHash({ password, passwordHash, hasKeyMaterial }) {
  const normalizedPassword = String(password || '');
  const normalizedPasswordHash = String(passwordHash || '').trim().toLowerCase();

  if (!hasKeyMaterial) {
    if (!normalizedPassword) {
      throw new Error('password is required when auto-generating a keypair');
    }
    return createHash('sha256').update(normalizedPassword).digest('hex');
  }

  if (normalizedPassword) {
    throw new Error('password must not be sent when providing encrypted key material');
  }
  if (!isValidSha256Hex(normalizedPasswordHash)) {
    throw new Error('password_hash must be a 64-character SHA-256 hex string when providing encrypted key material');
  }
  return normalizedPasswordHash;
}

function getUpdatePrivateKeyEncrypted(updates) {
  if (!updates || typeof updates !== 'object') return '';
  return String(updates.private_key_encrypted ?? '').trim();
}

function getUpdatePublicKey(updates) {
  if (!updates || typeof updates !== 'object') return '';
  return String(updates.public_key ?? '').trim().toLowerCase();
}

function getUpdatePasswordHash(updates) {
  if (!updates || typeof updates !== 'object') return '';
  return String(updates.new_password_hash ?? '').trim().toLowerCase();
}

function getUpdatePassword(updates) {
  if (!updates || typeof updates !== 'object') return '';
  return String(updates.new_password ?? '');
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

function parseOptionalProfilePicture(payload) {
  const pictureData = String(payload?.profile_picture_data || '').trim();
  const pictureContentType = String(payload?.profile_picture_content_type || '').trim().toLowerCase();
  const hasData = Boolean(pictureData);
  const hasContentType = Boolean(pictureContentType);

  if (!hasData && !hasContentType) {
    return { hasPicture: false };
  }
  if (!hasData || !hasContentType) {
    return {
      hasPicture: false,
      error: 'profile_picture_data and profile_picture_content_type are required together',
    };
  }

  const imageResult = normalizeBase64Payload(pictureData, pictureContentType);
  if (imageResult.error) {
    return { hasPicture: false, error: imageResult.error };
  }
  return {
    hasPicture: true,
    buffer: imageResult.buffer,
    contentType: imageResult.contentType,
  };
}

/**
 * POST /api/v1/auth/register
 * Create account and send verification email.
 */
router.post('/api/v1/auth/register', async (req, res) => {
  try {
    const tenant = resolveTenantContext(req);
    const {
      username,
      email,
      password,
      password_hash: passwordHash,
      public_key: publicKeyRaw,
      private_key_encrypted: privateKeyEncrypted,
      profile_picture_data: profilePictureData,
      profile_picture_content_type: profilePictureContentType,
      redirect,
      relays,
    } = req.body || {};
    const normalizedUsername = String(username || '').trim().toLowerCase();
    const normalizedEmail = normalizeEmail(email);
    const normalizedPassword = String(password || '');
    const normalizedRedirect = String(redirect || '').trim() || null;
    const requestedRelays = relays === undefined ? undefined : relays;
    const hasKeyMaterial = Boolean(String(publicKeyRaw || '').trim()) || Boolean(String(privateKeyEncrypted || '').trim());

    const usernameCheck = validateUsername(normalizedUsername);
    if (!usernameCheck.valid) return res.status(400).json({ error: usernameCheck.error });
    let normalizedPasswordHash = '';
    try {
      normalizedPasswordHash = resolveRegistrationPasswordHash({
        password: normalizedPassword,
        passwordHash,
        hasKeyMaterial,
      });
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Invalid password input' });
    }
    if (!isValidRedirectUrl(normalizedRedirect)) {
      return res.status(400).json({ error: 'Redirect must be a valid http(s) URL' });
    }
    let keyMaterial;
    try {
      keyMaterial = await resolveRegistrationKeyMaterial(publicKeyRaw, privateKeyEncrypted, normalizedPassword);
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Invalid key material' });
    }
    const profilePicture = parseOptionalProfilePicture({
      profile_picture_data: profilePictureData,
      profile_picture_content_type: profilePictureContentType,
    });
    if (profilePicture.error) {
      return res.status(400).json({ error: profilePicture.error });
    }
    if (requestedRelays !== undefined) {
      if (!Array.isArray(requestedRelays)) {
        return res.status(400).json({ error: 'relays must be an array of relay URLs' });
      }
      const mappedRelays = config.domainRelayMap[tenant.nip05RootDomain];
      if (Array.isArray(mappedRelays) && mappedRelays.length > 0) {
        return res.status(403).json({
          error: 'Relay list is managed by domain policy for this account',
        });
      }
    }

    const nip05 = buildNip05Identifier(normalizedUsername, tenant.nip05RootDomain);
    const registrationEmailResult = resolveRegistrationEmail({
      mode: config.emailVerificationMode,
      requestedEmail: normalizedEmail,
      username: normalizedUsername,
      tenantDomain: tenant.nip05RootDomain,
    });
    if (registrationEmailResult.error) {
      return res.status(400).json({ error: registrationEmailResult.error });
    }
    const registrationEmail = registrationEmailResult.email;
    await deleteExpiredPendingNostrUsers(config.verificationExpiryMinutes);

    const existing = await getNostrUserByUsername(normalizedUsername, tenant.nip05RootDomain);
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
      const createdUser = await createNostrUser({
        tenantDomain: tenant.nip05RootDomain,
        username: normalizedUsername,
        passwordSha256: normalizedPasswordHash,
        publicKey: keyMaterial.publicKey,
        privateKeyEncrypted: keyMaterial.privateKeyEncrypted,
        registrationEmail,
        rawPassword: normalizedPassword || null,
        relays: requestedRelays || [],
        status: 'active',
        verificationToken: null,
        role: resolveInitialRole(normalizedUsername, keyMaterial.publicKey),
      });
      if (profilePicture.hasPicture) {
        const updatedPicture = await updateNostrUserProfilePicture(
          createdUser.id,
          profilePicture.buffer,
          profilePicture.contentType
        );
        if (!updatedPicture) {
          return res.status(500).json({ error: 'Profile picture update failed' });
        }
      }
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      return res.status(200).json({
        success: true,
        status: 'active',
        nip05,
        public_key: keyMaterial.publicKey,
        picture_url: profilePicture.hasPicture ? `${baseUrl}/api/v1/picture/${keyMaterial.publicKey}` : undefined,
        key_source: keyMaterial.keySource,
        message: 'Account is active. You can now sign in.',
      });
    }

    const verificationToken = buildVerificationToken();
    const createdUser = await createNostrUser({
      tenantDomain: tenant.nip05RootDomain,
      username: normalizedUsername,
      passwordSha256: normalizedPasswordHash,
      publicKey: keyMaterial.publicKey,
      privateKeyEncrypted: keyMaterial.privateKeyEncrypted,
      registrationEmail,
      rawPassword: normalizedPassword || null,
      relays: requestedRelays || [],
      status: 'unverified_email',
      verificationToken,
      role: resolveInitialRole(normalizedUsername, keyMaterial.publicKey),
    });
    if (profilePicture.hasPicture) {
      const updatedPicture = await updateNostrUserProfilePicture(
        createdUser.id,
        profilePicture.buffer,
        profilePicture.contentType
      );
      if (!updatedPicture) {
        return res.status(500).json({ error: 'Profile picture update failed' });
      }
    }

    const verificationMinutes = Math.max(1, config.verificationExpiryMinutes);
    const verificationLink = buildVerificationLinkWithRedirect(
      verificationToken,
      normalizedRedirect,
      tenant.noasPublicUrl
    );
    const expiresAt = new Date(Date.now() + verificationMinutes * 60 * 1000);
    let emailDelivery = { sent: false, reason: 'not_attempted' };
    try {
      emailDelivery = await sendVerificationEmail({
        to: registrationEmail,
        username: normalizedUsername,
        identifier: nip05,
        redirectTarget: normalizedRedirect,
        verificationLink,
        expiresAt,
        publicKey: keyMaterial.publicKey,
      });
    } catch (error) {
      emailDelivery = { sent: false, reason: 'smtp_send_failed' };
      console.error('Verification email delivery error:', error);
    }

    const responseBody = {
      success: true,
      status: 'unverified_email',
      nip05,
      public_key: keyMaterial.publicKey,
      picture_uploaded: profilePicture.hasPicture,
      key_source: keyMaterial.keySource,
      message: `Check ${registrationEmail} to verify your account.`,
    };
    if (config.isTest) {
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
    const tenant = resolveTenantContext(req);
    const token = String(req.query.token || '').trim();
    if (!token) {
      return res.status(400).json({ error: 'token is required' });
    }
    const user = await getNostrUserByVerificationToken(token, tenant.nip05RootDomain);
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
    res.json({
      success: true,
      username: user.username,
      nip05: buildNip05Identifier(user.username, tenant.nip05RootDomain),
      registration_email: user.registration_email || null,
      public_key: user.public_key || null,
      expires_at: new Date(
        new Date(user.created_at).getTime() +
        Math.max(1, config.verificationExpiryMinutes) * 60 * 1000
      ).toISOString(),
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
    const tenant = resolveTenantContext(req);
    const { token, password_hash: passwordHash } = req.body || {};
    const normalizedToken = String(token || '').trim();
    const normalizedPasswordHash = String(passwordHash || '').trim().toLowerCase();
    if (!normalizedToken || !normalizedPasswordHash) {
      return res.status(400).json({ error: 'token and password_hash are required' });
    }
    if (!isValidSha256Hex(normalizedPasswordHash)) {
      return res.status(400).json({ error: 'password_hash must be a 64-character SHA-256 hex string' });
    }

    const user = await getNostrUserByVerificationToken(normalizedToken, tenant.nip05RootDomain);
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

    if (user.password_sha256 !== normalizedPasswordHash) {
      return res.status(401).json({
        error: 'Incorrect password. Someone may have tried to register your email.',
      });
    }

    await activateNostrUserByUsername(user.username, tenant.nip05RootDomain);

    let relayAllow = {
      attempted: false,
      relays_total: config.nip86RelayUrls.length,
      relays_success: 0,
      relays_failed: 0,
    };
    if (config.nip86RelayUrls.length > 0 && user.public_key) {
      const relayResults = await sendAllowPubkeyToRelays({
        pubkey: user.public_key,
        relayUrls: config.nip86RelayUrls,
        method: config.nip86Method,
        timeoutMs: config.nip86TimeoutMs,
      });
      const relaysSuccess = relayResults.filter((result) => result.success).length;
      relayAllow = {
        attempted: true,
        relays_total: relayResults.length,
        relays_success: relaysSuccess,
        relays_failed: relayResults.length - relaysSuccess,
      };
      if (relayAllow.relays_failed > 0) {
        console.warn('NIP-86 allowpubkey failed on one or more relays', {
          username: user.username,
          tenant_domain: tenant.nip05RootDomain,
          relay_results: relayResults,
        });
      }
    }

    res.json({
      success: true,
      activated: true,
      nip05: buildNip05Identifier(user.username, tenant.nip05RootDomain),
      relay_allow: relayAllow,
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
    const tenant = resolveTenantContext(req);
    const normalizedUsername = String(req.body?.username || '').trim().toLowerCase();
    const usernameCheck = validateUsername(normalizedUsername);
    if (!usernameCheck.valid) return res.status(400).json({ error: usernameCheck.error });

    await deleteExpiredPendingNostrUsers(config.verificationExpiryMinutes);
    const user = await getNostrUserByUsername(normalizedUsername, tenant.nip05RootDomain);
    if (!user || user.status !== 'unverified_email') {
      return res.status(404).json({ error: 'Invalid link.' });
    }

    if (isNostrUserVerificationExpired(user, config.verificationExpiryMinutes)) {
      await deleteExpiredPendingNostrUsers(config.verificationExpiryMinutes);
      return res.status(410).json({ error: 'Link expired. Register again.' });
    }

    const verificationToken = buildVerificationToken();
    const updated = await updateNostrUserResendToken(
      normalizedUsername,
      verificationToken,
      tenant.nip05RootDomain
    );
    const verificationLink = buildVerificationLinkWithRedirect(verificationToken, null, tenant.noasPublicUrl);
    const expiresAt = new Date(
      new Date(updated.created_at).getTime() +
      Math.max(1, config.verificationExpiryMinutes) * 60 * 1000
    );
    const identifier = buildNip05Identifier(normalizedUsername, tenant.nip05RootDomain);
    const email = normalizeEmail(updated.registration_email || identifier);

    let emailDelivery = { sent: false, reason: 'not_attempted' };
    try {
      emailDelivery = await sendVerificationEmail({
        to: email,
        username: normalizedUsername,
        identifier,
        redirectTarget: null,
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
    if (config.isTest) {
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

async function resolveAdminActor(req) {
  const tenant = resolveTenantContext(req);
  const normalizedUsername = String(req.body?.username || '').trim().toLowerCase();
  const normalizedPasswordHash = normalizePasswordHashFromSignin(
    req.body?.password_hash,
    req.body?.password
  );
  if (!normalizedUsername || !normalizedPasswordHash) {
    return { error: { status: 400, message: 'Username and password are required' } };
  }

  const user = await getNostrUserByUsername(normalizedUsername, tenant.nip05RootDomain);
  if (!user || user.password_sha256 !== normalizedPasswordHash) {
    return { error: { status: 401, message: 'Invalid credentials' } };
  }
  if (user.status !== 'active') {
    return { error: { status: 403, message: 'Account is not active.' } };
  }
  if (![NOSTR_USER_ROLES.ADMIN, NOSTR_USER_ROLES.MODERATOR].includes(user.role)) {
    return { error: { status: 403, message: 'Admin access required' } };
  }

  return { actor: user, tenant };
}

const handleSignin = async (req, res) => {
  try {
    const tenant = resolveTenantContext(req);
    const normalizedUsername = String(req.body?.username || '').trim().toLowerCase();
    const normalizedPasswordHash = normalizePasswordHashFromSignin(
      req.body?.password_hash,
      req.body?.password
    );
    if (!normalizedUsername || !normalizedPasswordHash) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    let user = await getNostrUserByUsername(normalizedUsername, tenant.nip05RootDomain);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (user.status === 'disabled') {
      return res.status(403).json({ error: 'Account is disabled.' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Email verification required before sign in' });
    }
    if (user.password_sha256 !== normalizedPasswordHash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const derivedEmail = normalizeEmail(buildNip05Identifier(normalizedUsername, tenant.nip05RootDomain));
    res.json({
      success: true,
      private_key_encrypted: user.private_key_encrypted || null,
      public_key: user.public_key || null,
      relays: getDomainScopedRelays(derivedEmail, user.relays || []),
      status: user.status,
      role: user.role || NOSTR_USER_ROLES.USER,
    });
  } catch (error) {
    console.error('Signin error:', error);
    res.status(500).json({ error: 'Sign in failed' });
  }
};

/**
 * POST /update
 * Update user account information
 * 
 * Allows changing password, re-encrypting private key, or updating relay list.
 * Requires authentication with current password.
 */
const handleUpdate = async (req, res) => {
  try {
    const tenant = resolveTenantContext(req);
    const { username, password, password_hash: passwordHashInput, updates } = req.body;
    const normalizedUsername = String(username || '').trim().toLowerCase();
    const normalizedPasswordHash = normalizePasswordHashFromSignin(passwordHashInput, password);

    if (!normalizedUsername || !normalizedPasswordHash) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await getActiveNostrUserByUsername(normalizedUsername, tenant.nip05RootDomain);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (user.password_sha256 !== normalizedPasswordHash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const updateData = {};
    const nextPasswordHashInput = getUpdatePasswordHash(updates);
    const nextPasswordInput = getUpdatePassword(updates);
    const requestedPasswordChange = Boolean(nextPasswordHashInput || nextPasswordInput);
    const nextPrivateKeyEncrypted = getUpdatePrivateKeyEncrypted(updates);
    const nextPublicKey = getUpdatePublicKey(updates);
    const requestedCredentialChange = requestedPasswordChange || Boolean(nextPrivateKeyEncrypted) || Boolean(nextPublicKey);
    const profilePictureUpdate = parseOptionalProfilePicture(updates || {});
    if (profilePictureUpdate.error) {
      return res.status(400).json({ error: profilePictureUpdate.error });
    }

    if (requestedPasswordChange) {
      const nextPasswordHash = String(
        nextPasswordHashInput || normalizePasswordHashFromSignin('', nextPasswordInput)
      ).trim().toLowerCase();
      if (!isValidSha256Hex(nextPasswordHash)) {
        return res.status(400).json({ error: 'new_password_hash must be a 64-character SHA-256 hex string' });
      }
      updateData.passwordSha256 = nextPasswordHash;
    }

    if (nextPrivateKeyEncrypted) {
      const encKeyCheck = validateEncryptedPrivateKey(nextPrivateKeyEncrypted);
      if (!encKeyCheck.valid) {
        return res.status(400).json({ error: encKeyCheck.error });
      }
      updateData.privateKeyEncrypted = nextPrivateKeyEncrypted;
    }

    if (nextPublicKey) {
      const publicKeyCheck = validatePublicKey(nextPublicKey);
      if (!publicKeyCheck.valid) {
        return res.status(400).json({ error: publicKeyCheck.error });
      }
      updateData.publicKey = nextPublicKey;
    }

    if (requestedCredentialChange && (!updateData.passwordSha256 || !updateData.privateKeyEncrypted || !updateData.publicKey)) {
      return res.status(400).json({
        error: 'Credential updates require new_password_hash/new_password, private_key_encrypted, and public_key together',
      });
    }

    if (updates?.relays) {
      const mappedRelays = config.domainRelayMap[tenant.nip05RootDomain];
      if (Array.isArray(mappedRelays) && mappedRelays.length > 0) {
        return res.status(403).json({
          error: 'Relay list is managed by domain policy for this account',
        });
      }
      updateData.relays = updates.relays;
    }

    const hasAccountFieldUpdates = Object.keys(updateData).length > 0;
    if (!hasAccountFieldUpdates && !profilePictureUpdate.hasPicture) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    let updated = user;
    if (hasAccountFieldUpdates) {
      updated = await updateNostrUser(normalizedUsername, updateData, tenant.nip05RootDomain);
    }
    if (profilePictureUpdate.hasPicture) {
      const updatedPicture = await updateNostrUserProfilePicture(
        user.id,
        profilePictureUpdate.buffer,
        profilePictureUpdate.contentType
      );
      if (!updatedPicture) {
        return res.status(500).json({ error: 'Profile picture update failed' });
      }
    }
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    res.json({
      success: true,
      user: {
        username: updated.username,
        public_key: updated.public_key || null,
      },
      picture_url: profilePictureUpdate.hasPicture && (updated.public_key || user.public_key)
        ? `${baseUrl}/api/v1/picture/${updated.public_key || user.public_key}`
        : undefined,
    });
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ error: 'Update failed' });
  }
};

/**
 * POST /delete
 * Delete a user account
 * 
 * Requires authentication and an explicit confirmation that the user
 * has saved their private key.
 */
const handleDelete = async (req, res) => {
  try {
    const tenant = resolveTenantContext(req);
    const { username, password, password_hash: passwordHashInput } = req.body;
    const normalizedUsername = String(username || '').trim().toLowerCase();
    const normalizedPasswordHash = normalizePasswordHashFromSignin(passwordHashInput, password);

    if (!normalizedUsername || !normalizedPasswordHash) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await getActiveNostrUserByUsername(normalizedUsername, tenant.nip05RootDomain);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.password_sha256 !== normalizedPasswordHash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await deleteNostrUser(normalizedUsername, tenant.nip05RootDomain);

    res.json({
      success: true,
      deleted: {
        username: user.username,
        public_key: user.public_key || null,
      },
    });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Account deletion failed' });
  }
};

/**
 * POST /api/v1/admin/users/list
 * List users for admin and moderator accounts.
 */
const handleAdminUserList = async (req, res) => {
  try {
    const auth = await resolveAdminActor(req);
    if (auth.error) {
      return res.status(auth.error.status).json({ error: auth.error.message });
    }
    const { actor, tenant } = auth;
    const limit = Math.max(1, Math.min(500, Number(req.body?.limit) || 200));
    const users = await listNostrUsers({ tenantDomain: tenant.nip05RootDomain, limit });
    const pictureBase = `${tenant.noasPublicUrl}${config.noasBasePath}/api/v1/picture/`;

    const responseUsers = users.map((user) => ({
      username: user.username,
      registration_email: user.registration_email || null,
      public_key: user.public_key || null,
      status: user.status,
      role: user.role || NOSTR_USER_ROLES.USER,
      picture_url: user.public_key ? `${pictureBase}${user.public_key}` : null,
      created_at: user.created_at,
      can_manage: canActOnUser(actor, user),
    }));

    return res.json({
      success: true,
      users: responseUsers,
      limit,
    });
  } catch (error) {
    console.error('Admin list error:', error);
    return res.status(500).json({ error: 'Admin list failed' });
  }
};

/**
 * POST /api/v1/admin/users/verify
 * Verify a pending account (admin/moderator).
 */
const handleAdminUserVerify = async (req, res) => {
  try {
    const auth = await resolveAdminActor(req);
    if (auth.error) {
      return res.status(auth.error.status).json({ error: auth.error.message });
    }
    const { actor, tenant } = auth;
    const targetUsername = String(req.body?.target_username || '').trim().toLowerCase();
    const usernameCheck = validateUsername(targetUsername);
    if (!usernameCheck.valid) return res.status(400).json({ error: usernameCheck.error });

    const target = await getNostrUserByUsername(targetUsername, tenant.nip05RootDomain);
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (!canActOnUser(actor, target)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    if (target.status === 'active') {
      return res.status(409).json({ error: 'User already active' });
    }
    if (target.status === 'disabled') {
      return res.status(409).json({ error: 'User is disabled' });
    }

    const updated = await updateNostrUserStatus(targetUsername, 'active', tenant.nip05RootDomain);

    let relayAllow = {
      attempted: false,
      relays_total: config.nip86RelayUrls.length,
      relays_success: 0,
      relays_failed: 0,
    };
    if (config.nip86RelayUrls.length > 0 && updated?.public_key) {
      const relayResults = await sendAllowPubkeyToRelays({
        pubkey: updated.public_key,
        relayUrls: config.nip86RelayUrls,
        method: config.nip86Method,
        timeoutMs: config.nip86TimeoutMs,
      });
      const relaysSuccess = relayResults.filter((result) => result.success).length;
      relayAllow = {
        attempted: true,
        relays_total: relayResults.length,
        relays_success: relaysSuccess,
        relays_failed: relayResults.length - relaysSuccess,
      };
    }

    return res.json({
      success: true,
      user: {
        username: updated.username,
        status: updated.status,
        role: updated.role || NOSTR_USER_ROLES.USER,
      },
      relay_allow: relayAllow,
    });
  } catch (error) {
    console.error('Admin verify error:', error);
    return res.status(500).json({ error: 'Admin verify failed' });
  }
};

/**
 * POST /api/v1/admin/users/role
 * Update a user's role (admin only).
 */
const handleAdminUserRole = async (req, res) => {
  try {
    const auth = await resolveAdminActor(req);
    if (auth.error) {
      return res.status(auth.error.status).json({ error: auth.error.message });
    }
    const { actor, tenant } = auth;
    if (actor.role !== NOSTR_USER_ROLES.ADMIN) {
      return res.status(403).json({ error: 'Admin role required' });
    }
    const targetUsername = String(req.body?.target_username || '').trim().toLowerCase();
    const rawRole = String(req.body?.new_role || '').trim().toLowerCase();
    const usernameCheck = validateUsername(targetUsername);
    if (!usernameCheck.valid) return res.status(400).json({ error: usernameCheck.error });
    if (!rawRole) return res.status(400).json({ error: 'new_role is required' });
    if (!isValidRole(rawRole)) {
      return res.status(400).json({ error: 'new_role must be admin, moderator, or user' });
    }
    const requestedRole = normalizeRole(rawRole);

    const target = await getNostrUserByUsername(targetUsername, tenant.nip05RootDomain);
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (actor.username === target.username && roleRank(requestedRole) >= roleRank(actor.role)) {
      return res.status(403).json({ error: 'You may only downgrade your own role' });
    }

    const updated = await updateNostrUserRole(targetUsername, requestedRole, tenant.nip05RootDomain);
    return res.json({
      success: true,
      user: {
        username: updated.username,
        role: updated.role,
        status: updated.status,
      },
    });
  } catch (error) {
    console.error('Admin role error:', error);
    return res.status(500).json({ error: 'Admin role update failed' });
  }
};

/**
 * POST /api/v1/admin/users/delete
 * Delete a user (admin/moderator).
 */
const handleAdminUserDelete = async (req, res) => {
  try {
    const auth = await resolveAdminActor(req);
    if (auth.error) {
      return res.status(auth.error.status).json({ error: auth.error.message });
    }
    const { actor, tenant } = auth;
    const targetUsername = String(req.body?.target_username || '').trim().toLowerCase();
    const confirmUsername = String(req.body?.confirm_username || '').trim().toLowerCase();
    const usernameCheck = validateUsername(targetUsername);
    if (!usernameCheck.valid) return res.status(400).json({ error: usernameCheck.error });
    if (confirmUsername !== targetUsername) {
      return res.status(400).json({ error: 'confirm_username must match target_username' });
    }

    const target = await getNostrUserByUsername(targetUsername, tenant.nip05RootDomain);
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (!canActOnUser(actor, target)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const deleted = await deleteNostrUser(targetUsername, tenant.nip05RootDomain);
    return res.json({
      success: true,
      user: {
        username: deleted.username,
        role: deleted.role || NOSTR_USER_ROLES.USER,
        status: deleted.status,
      },
    });
  } catch (error) {
    console.error('Admin delete error:', error);
    return res.status(500).json({ error: 'Admin delete failed' });
  }
};

/**
 * GET /picture/:identifier
 * Serve a user's profile picture by public key (hex/npub) or username.
 */
const handlePictureFetch = async (req, res) => {
  try {
    const tenant = resolveTenantContext(req);
    const rawIdentifier = String(req.params?.identifier || '').trim().toLowerCase();
    if (!rawIdentifier) {
      return res.status(400).json({ error: 'Picture identifier is required' });
    }

    let pubkey = rawIdentifier;

    if (rawIdentifier.startsWith('npub1')) {
      try {
        const { nip19 } = await import('nostr-tools');
        const decoded = nip19.decode(rawIdentifier);
        if (decoded.type !== 'npub' || typeof decoded.data !== 'string') {
          return res.status(400).json({ error: 'Public key must be a valid npub or hex pubkey' });
        }
        pubkey = decoded.data;
      } catch {
        return res.status(400).json({ error: 'Public key must be a valid npub or hex pubkey' });
      }
    }

    const pubkeyCheck = validatePublicKey(pubkey);
    if (!pubkeyCheck.valid) {
      const usernameCheck = validateUsername(rawIdentifier);
      if (!usernameCheck.valid) {
        return res.status(400).json({ error: 'Picture identifier must be a valid pubkey or username' });
      }

      const user = await getActiveNostrUserByUsername(rawIdentifier, tenant.nip05RootDomain);
      if (!user || !user.public_key) {
        return res.status(404).json({ error: 'Profile picture not found' });
      }
      pubkey = user.public_key;
    }

    const picture = await getNostrUserProfilePictureByPublicKey(pubkey);
    if (!picture || !picture.profile_picture) {
      return res.status(404).json({ error: 'Profile picture not found' });
    }

    const updatedAt = picture.profile_picture_updated_at
      ? new Date(picture.profile_picture_updated_at)
      : null;
    const ifModifiedSinceHeader = String(req.get('if-modified-since') || '').trim();
    if (updatedAt && ifModifiedSinceHeader) {
      const ifModifiedSince = new Date(ifModifiedSinceHeader);
      if (!Number.isNaN(ifModifiedSince.getTime()) && updatedAt.getTime() <= ifModifiedSince.getTime()) {
        res.status(304).end();
        return;
      }
    }

    res.set('Content-Type', picture.profile_picture_type || 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=3600');
    if (updatedAt && !Number.isNaN(updatedAt.getTime())) {
      res.set('Last-Modified', updatedAt.toUTCString());
    }
    res.send(picture.profile_picture);
  } catch (error) {
    console.error('Profile picture fetch error:', error);
    res.status(500).json({ error: 'Profile picture fetch failed' });
  }
};

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
    const tenant = resolveTenantContext(req);
    const { name } = req.query;

    if (!name) {
      return res.json({
        noas: {
          version: config.apiVersion,
          nip05_domain: tenant.nip05RootDomain,
          public_url: tenant.noasPublicUrl,
          base_path: config.noasBasePath || '/',
          api_base: tenant.apiBase,
          email_verification_mode: config.emailVerificationMode,
        },
      });
    }

    const user = await getActiveNostrUserForNip05(
      String(name).trim().toLowerCase(),
      tenant.nip05RootDomain
    );
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
 * Returns only server status.
 */
const handleHealth = (req, res) => {
  res.json({ status: 'ok' });
};

/**
 * GET /nip46/info
 * Get NIP-46 signer information
 * 
 * Returns the public key and supported methods of this remote signer.
 */
const handleNip46Info = (req, res) => {
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
    version: config.apiVersion
  });
};

/**
 * GET /nip46/connect/:username
 * Generate a connection token for a specific user
 * 
 * Creates a bunker:// URL that clients can use to initiate a connection.
 */
const handleNip46Connect = async (req, res) => {
  try {
    const tenant = resolveTenantContext(req);
    const { username } = req.params;

    // Validate username exists
    const user = await getActiveNostrUserByUsername(
      String(username || '').trim().toLowerCase(),
      tenant.nip05RootDomain
    );
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
};

/**
 * POST /nip46/request
 * Handle NIP-46 requests
 * 
 * Processes encrypted NIP-46 request events and returns encrypted responses.
 * This endpoint simulates relay-based communication via HTTP.
 */
const handleNip46Request = async (req, res) => {
  try {
    const tenant = resolveTenantContext(req);
    const { event, username } = req.body;

    if (!event || !event.kind || event.kind !== 24133) {
      return res.status(400).json({ error: 'Invalid request event' });
    }

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    // Process the NIP-46 request
    const response = await processNip46Request(event, username, tenant.nip05RootDomain);
    
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
};

/**
 * POST /nip46/nostrconnect
 * Handle nostrconnect:// protocol connections
 * 
 * Processes client-initiated connections using the nostrconnect protocol.
 */
const handleNip46Nostrconnect = async (req, res) => {
  try {
    const tenant = resolveTenantContext(req);
    const { nostrconnect_url, username } = req.body;

    if (!nostrconnect_url || !nostrconnect_url.startsWith('nostrconnect://')) {
      return res.status(400).json({ error: 'Invalid nostrconnect URL' });
    }

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const url = new URL(nostrconnect_url);
    const clientPubkey = String(url.host || url.pathname || '').replace(/^\/+/, '').toLowerCase();
    const secret = url.searchParams.get('secret');
    const relays = url.searchParams.getAll('relay').filter((relay) => relay.startsWith('wss://'));
    const perms = url.searchParams.get('perms');

    // Validate client pubkey
    if (!clientPubkey || clientPubkey.length !== 64) {
      return res.status(400).json({ error: 'Invalid client pubkey' });
    }

    const connectRequest = {
      id: Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(''),
      method: 'connect',
      params: [signerPubkey, secret, perms]
    };
    const response = await handleConnect(connectRequest, clientPubkey, username, tenant.nip05RootDomain);
    if (response.error === 'User not found') {
      return res.status(404).json({ error: response.error });
    }
    if (response.error) {
      return res.status(400).json({ error: response.error });
    }

    res.json({
      success: true,
      remote_signer_pubkey: signerPubkey,
      secret: secret,
      message: 'Connection established. Use /api/v1/nip46/request to exchange encrypted NIP-46 commands.',
      relays: relays.length ? relays : ['wss://relay.nostr.org']
    });

  } catch (error) {
    console.error('NIP-46 nostrconnect error:', error);
    res.status(500).json({ error: 'Connection failed' });
  }
};

router.post('/api/v1/auth/signin', handleSignin);
router.post('/signin', handleSignin);

router.post('/api/v1/auth/update', handleUpdate);
router.post('/update', handleUpdate);

router.post('/api/v1/auth/delete', handleDelete);
router.post('/delete', handleDelete);

router.post('/api/v1/admin/users/list', handleAdminUserList);
router.post('/api/v1/admin/users/verify', handleAdminUserVerify);
router.post('/api/v1/admin/users/role', handleAdminUserRole);
router.post('/api/v1/admin/users/delete', handleAdminUserDelete);

router.get('/api/v1/picture/:identifier', handlePictureFetch);
router.get('/picture/:identifier', handlePictureFetch);

router.get('/api/v1/health', handleHealth);
router.get('/health', handleHealth);

router.get('/api/v1/nip46/info', handleNip46Info);
router.get('/nip46/info', handleNip46Info);

router.get('/api/v1/nip46/connect/:username', handleNip46Connect);
router.get('/nip46/connect/:username', handleNip46Connect);

router.post('/api/v1/nip46/request', handleNip46Request);
router.post('/nip46/request', handleNip46Request);

router.post('/api/v1/nip46/nostrconnect', handleNip46Nostrconnect);
router.post('/nip46/nostrconnect', handleNip46Nostrconnect);
