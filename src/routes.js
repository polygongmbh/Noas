/**
 * API Routes
 * 
 * Defines all HTTP endpoints for the Noas server:
 * - POST /onboarding/start - Begin two-step account onboarding
 * - POST /onboarding/complete - Finalize account with private key after verification
 * - POST /register - Create new user account
 * - POST /signin - Authenticate and get encrypted key
 * - POST /verify-email - Verify account email with token
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
  createUser, 
  getUserByUsername, 
  getUserByEmail,
  updateUser, 
  getUserForNip05,
  getUserProfilePictureByPublicKey,
  updateUserProfilePicture,
  deleteUser,
  verifyUserEmail,
  upsertUserOnboarding,
  getUserOnboardingByUsername,
  getUserOnboardingByEmail,
  getUserOnboardingByVerificationToken,
  markUserOnboardingEmailVerified,
  incrementUserOnboardingPinAttempt,
  deleteUserOnboarding,
  deleteUserOnboardingByToken,
  deleteExpiredUserOnboarding,
  recordUsedVerificationToken,
  isVerificationTokenUsed,
} from './db/users.js';
import { 
  hashPassword, 
  verifyPassword, 
  validateUsername, 
  validatePublicKey, 
  validateEncryptedPrivateKey,
  validateEmail,
} from './auth.js';
import { 
  createConnectionToken,
  processNip46Request,
  createResponseEvent,
  signerPubkey 
} from './nip46.js';
import { sendVerificationEmail } from './email.js';
import { config } from './config.js';
import { randomBytes, randomInt, randomUUID } from 'crypto';

export const router = express.Router();

const MAX_PROFILE_PICTURE_BYTES = 2 * 1024 * 1024;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isEmailAllowedForTenant(email) {
  if (!config.allowedSignupEmailDomain) return true;
  return normalizeEmail(email).endsWith(`@${config.allowedSignupEmailDomain}`);
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

function buildVerificationPin() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function isExpired(timestampValue) {
  if (!timestampValue) return true;
  const expiresAt = new Date(timestampValue).getTime();
  return Number.isNaN(expiresAt) || expiresAt <= Date.now();
}

function buildVerificationLinkWithOrigin(token, origin) {
  const params = new URLSearchParams({ token });
  if (origin) params.set('origin', origin);
  return `${config.noasPublicUrl}${config.noasBasePath}/verify?${params.toString()}`;
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (!config.allowedOrigins.length) return true;
  return config.allowedOrigins.includes(origin);
}

function emailMatchesNip05RootDomain(email) {
  const domain = getEmailDomain(email);
  return Boolean(domain) && domain === config.noasRootDomain;
}

function minutesBetween(nowMs, thenValue) {
  const thenMs = new Date(thenValue).getTime();
  if (Number.isNaN(thenMs)) return Number.POSITIVE_INFINITY;
  return (nowMs - thenMs) / 1000 / 60;
}

async function parseAndEncryptPrivateKey(nsecKey, password) {
  const { getPublicKey, nip19 } = await import('nostr-tools');
  const nip49 = await import('nostr-tools/nip49');
  let privateKey;

  try {
    if (String(nsecKey || '').startsWith('nsec1')) {
      privateKey = nip19.decode(nsecKey).data;
    } else if (/^[a-f0-9]{64}$/i.test(String(nsecKey || ''))) {
      privateKey = hexToBytes(nsecKey);
    } else {
      throw new Error('invalid-format');
    }
  } catch (error) {
    throw new Error('Invalid private key format. Use nsec1... or 64-character hex');
  }

  const publicKey = getPublicKey(privateKey);
  const pubkeyCheck = validatePublicKey(publicKey);
  if (!pubkeyCheck.valid) {
    throw new Error(pubkeyCheck.error);
  }

  const encryptedPrivateKey = await nip49.encrypt(privateKey, password);
  const encKeyCheck = validateEncryptedPrivateKey(encryptedPrivateKey);
  if (!encKeyCheck.valid) {
    throw new Error(encKeyCheck.error);
  }

  return { publicKey, encryptedPrivateKey };
}

function hexToBytes(hex) {
  const normalized = String(hex || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error("Invalid hex private key");
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
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
 * Create or refresh pending account and send verification email.
 */
router.post('/api/v1/auth/register', async (req, res) => {
  try {
    const {
      username,
      email,
      password,
      origin,
      relays,
    } = req.body || {};
    if (req.body?.public_key || req.body?.private_key_encrypted) {
      return res.status(400).json({
        error: 'Submit key material only after email confirmation',
      });
    }

    if (!config.emailVerificationEnabled) {
      return res.status(400).json({
        error: 'Email verification flow is disabled on this server',
      });
    }

    const normalizedUsername = String(username || '').trim().toLowerCase();
    const normalizedEmail = normalizeEmail(email);
    const normalizedOrigin = origin ? String(origin).trim() : null;

    const usernameCheck = validateUsername(normalizedUsername);
    if (!usernameCheck.valid) return res.status(400).json({ error: usernameCheck.error });
    const emailCheck = validateEmail(normalizedEmail);
    if (!emailCheck.valid) return res.status(400).json({ error: emailCheck.error });
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!emailMatchesNip05RootDomain(normalizedEmail)) {
      return res.status(400).json({
        error: `Email domain must match NIP-05 root domain ${config.noasRootDomain}`,
      });
    }
    if (!isAllowedOrigin(normalizedOrigin)) {
      return res.status(400).json({ error: 'Origin is not allowed' });
    }

    await deleteExpiredUserOnboarding();

    const existingActiveByUsername = await getUserByUsername(normalizedUsername);
    if (existingActiveByUsername) {
      return res.status(409).json({ error: 'Username already active. Sign in.' });
    }
    const existingActiveByEmail = await getUserByEmail(normalizedEmail);
    if (existingActiveByEmail) {
      return res.status(409).json({ error: 'Email already active. Sign in.' });
    }

    const existingPendingByUsername = await getUserOnboardingByUsername(normalizedUsername);
    const existingPendingByEmail = await getUserOnboardingByEmail(normalizedEmail);
    const existingPending = existingPendingByUsername || existingPendingByEmail;
    if (existingPending) {
      if (existingPending.username !== normalizedUsername || existingPending.email !== normalizedEmail) {
        return res.status(409).json({ error: 'Username or email is currently pending verification' });
      }
      const sinceLastEmailMinutes = minutesBetween(Date.now(), existingPending.last_email_sent_at);
      if (sinceLastEmailMinutes < 1) {
        return res.status(429).json({ error: 'Resend available after one minute' });
      }
    }

    const passwordHash = await hashPassword(password);
    const verificationToken = buildVerificationToken();
    const verificationMinutes = Math.max(1, config.verificationExpiryMinutes);
    const verificationExpiresAt = new Date(Date.now() + verificationMinutes * 60 * 1000);
    const resolvedRelays = getDomainScopedRelays(normalizedEmail, relays || []);
    const emailVerificationPin = buildVerificationPin();
    const compatibilityPinHash = await hashPassword(emailVerificationPin);

    await upsertUserOnboarding({
      username: normalizedUsername,
      email: normalizedEmail,
      passwordHash,
      relays: resolvedRelays,
      emailVerificationToken: verificationToken,
      emailVerificationPinHash: compatibilityPinHash,
      emailVerificationExpiresAt: verificationExpiresAt,
      verificationOrigin: normalizedOrigin,
      publicKey: null,
      encryptedPrivateKey: null,
    });

    const verificationLink = buildVerificationLinkWithOrigin(verificationToken, normalizedOrigin);
    let emailDelivery = { sent: false, reason: 'not_attempted' };
    try {
      emailDelivery = await sendVerificationEmail({
        to: normalizedEmail,
        username: normalizedUsername,
        identifier: `${normalizedUsername}@${config.noasRootDomain}`,
        pin: emailVerificationPin,
        verificationLink,
        expiresAt: verificationExpiresAt,
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
      status: 'pending',
      message: `Check ${normalizedEmail} to confirm your account.`,
      verification_pin: emailVerificationPin,
    };
    if (config.exposeVerificationTokenInResponse || config.isTest) {
      responseBody.verification_token = verificationToken;
      responseBody.verify_url = verificationLink;
    }
    res.status(200).json(responseBody);
  } catch (error) {
    console.error('V1 register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * GET /api/v1/auth/verify
 * Preview pending verification details by token.
 */
router.get('/api/v1/auth/verify', async (req, res) => {
  try {
    const token = String(req.query.token || '').trim();
    if (!token) {
      return res.status(400).json({ error: 'token is required' });
    }
    const pending = await getUserOnboardingByVerificationToken(token);
    if (!pending) {
      if (await isVerificationTokenUsed(token)) {
        return res.status(410).json({ error: 'Link already used.' });
      }
      return res.status(404).json({ error: 'Invalid link.' });
    }
    if (isExpired(pending.email_verification_expires_at)) {
      await deleteUserOnboardingByToken(token);
      return res.status(410).json({ error: 'Link expired. Register again.' });
    }
    res.json({
      success: true,
      username: pending.username,
      identifier: `${pending.username}@${config.noasRootDomain}`,
      email: pending.email,
      expires_at: pending.email_verification_expires_at,
      redirect_to: pending.verification_origin || null,
    });
  } catch (error) {
    console.error('V1 verify preview error:', error);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

/**
 * POST /api/v1/auth/verify
 * Confirm pending email using token + PIN.
 */
router.post('/api/v1/auth/verify', async (req, res) => {
  try {
    const { token, pin } = req.body || {};
    const normalizedToken = String(token || '').trim();
    const normalizedPin = String(pin || '').trim();
    if (!normalizedToken || !normalizedPin) {
      return res.status(400).json({ error: 'token and pin are required' });
    }

    if (await isVerificationTokenUsed(normalizedToken)) {
      return res.status(410).json({ error: 'Link already used.' });
    }

    const pending = await getUserOnboardingByVerificationToken(normalizedToken);
    if (!pending) {
      return res.status(404).json({ error: 'Invalid link.' });
    }

    if (isExpired(pending.email_verification_expires_at)) {
      await deleteUserOnboardingByToken(normalizedToken);
      return res.status(410).json({ error: 'Link expired. Register again.' });
    }

    if (pending.email_verified_at) {
      return res.status(409).json({ error: 'Account already active. Sign in.' });
    }

    if (pending.pin_attempt_count >= 5) {
      return res.status(429).json({ error: 'Too many failed PIN attempts. Register again.' });
    }
    const pinMatch = await verifyPassword(normalizedPin, pending.email_verification_pin_hash);
    if (!pinMatch) {
      await incrementUserOnboardingPinAttempt(pending.username);
      return res.status(401).json({ error: 'Incorrect verification PIN.' });
    }

    await markUserOnboardingEmailVerified(pending.username);
    await recordUsedVerificationToken(normalizedToken);

    res.json({
      success: true,
      status: 'email_confirmed',
      redirect_to: pending.verification_origin || null,
      username: pending.username,
      next_step: 'submit_private_key',
    });
  } catch (error) {
    console.error('V1 verify error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

async function handleOnboardingStart(req, res) {
  try {
    const { username, password, relays, email, origin } = req.body;
    const normalizedUsername = String(username || '').trim().toLowerCase();
    const normalizedOrigin = origin ? String(origin).trim() : null;

    const usernameCheck = validateUsername(normalizedUsername);
    if (!usernameCheck.valid) {
      return res.status(400).json({ error: usernameCheck.error });
    }

    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const normalizedEmail = normalizeEmail(email);
    const emailCheck = validateEmail(normalizedEmail);
    if (!emailCheck.valid) {
      return res.status(400).json({ error: emailCheck.error });
    }
    if (!isEmailAllowedForTenant(normalizedEmail)) {
      return res.status(403).json({
        error: `Only ${config.allowedSignupEmailDomain} email addresses can sign up`,
      });
    }
    if (normalizedOrigin && !isAllowedOrigin(normalizedOrigin)) {
      return res.status(400).json({ error: 'Origin is not allowed' });
    }
    await deleteExpiredUserOnboarding();

    const existingUser = await getUserByUsername(normalizedUsername);
    if (existingUser) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const emailPending = await getUserOnboardingByEmail(normalizedEmail);
    if (emailPending && emailPending.username !== normalizedUsername) {
      return res.status(409).json({
        error: 'Email is already used by another pending onboarding',
      });
    }

    const passwordHash = await hashPassword(password);
    const emailVerificationToken = buildVerificationToken();
    const emailVerificationPin = buildVerificationPin();
    const emailVerificationPinHash = await hashPassword(emailVerificationPin);
    const verificationMinutes = Math.max(1, config.verificationExpiryMinutes);
    const emailVerificationExpiresAt = new Date(Date.now() + verificationMinutes * 60 * 1000);
    const resolvedRelays = getDomainScopedRelays(normalizedEmail, relays || []);

    const onboarding = await upsertUserOnboarding({
      username: normalizedUsername,
      email: normalizedEmail,
      passwordHash,
      relays: resolvedRelays,
      emailVerificationToken,
      emailVerificationPinHash,
      emailVerificationExpiresAt,
      verificationOrigin: normalizedOrigin,
    });

    const verificationLink = buildVerificationLinkWithOrigin(emailVerificationToken, normalizedOrigin);
    let emailDelivery = { sent: false, reason: 'not_attempted' };
    try {
      emailDelivery = await sendVerificationEmail({
        to: normalizedEmail,
        username: normalizedUsername,
        identifier: `${normalizedUsername}@${config.noasRootDomain || getEmailDomain(normalizedEmail)}`,
        pin: emailVerificationPin,
        verificationLink,
        expiresAt: emailVerificationExpiresAt,
      });
    } catch (error) {
      emailDelivery = {
        sent: false,
        reason: 'smtp_send_failed',
      };
      console.error('Email delivery error:', error);
    }

    const canFallbackWithoutEmail = config.exposeVerificationTokenInResponse || config.isTest;
    if (!emailDelivery.sent && (config.requireEmailDelivery || !canFallbackWithoutEmail)) {
      return res.status(502).json({
        error: 'Failed to send verification email. Check SMTP configuration.',
      });
    }

    console.log(
      `Email verification for ${normalizedUsername} (${normalizedEmail})\n` +
      `Link: ${verificationLink}\nPIN: ${emailVerificationPin}`
    );

    const responseBody = {
      success: true,
      onboarding: {
        username: onboarding.username,
        email: onboarding.email,
        emailVerificationRequired: true,
        emailVerified: false,
        expiresAt: onboarding.email_verification_expires_at,
        nextStep: 'verify_email',
        delivery: emailDelivery.sent ? 'email' : 'fallback',
      },
    };

    responseBody.emailVerificationPin = emailVerificationPin;
    if (config.exposeVerificationTokenInResponse || config.isTest) {
      responseBody.emailVerificationToken = emailVerificationToken;
      responseBody.emailVerificationLink = verificationLink;
    }

    res.status(200).json(responseBody);
  } catch (error) {
    if (String(error.message || '').includes('duplicate key')) {
      return res.status(409).json({ error: 'Username or email already has pending onboarding' });
    }
    console.error('Onboarding start error:', error);
    res.status(500).json({ error: 'Failed to start onboarding' });
  }
}

/**
 * POST /onboarding/start
 * Start secure two-step onboarding without submitting private key.
 */
router.post('/onboarding/start', handleOnboardingStart);

/**
 * POST /register
 * Backward-compatible registration endpoint.
 * In strict mode, starts onboarding and blocks private key submission.
 */
router.post('/register', async (req, res) => {
  if (config.emailVerificationEnabled) {
    if (req.body?.nsecKey) {
      return res.status(400).json({
        error: 'Private key submission is only allowed after email verification',
      });
    }
    return handleOnboardingStart(req, res);
  }

  try {
    const { username, password, nsecKey, relays, email } = req.body;
    const normalizedUsername = String(username || '').trim().toLowerCase();

    const usernameCheck = validateUsername(normalizedUsername);
    if (!usernameCheck.valid) {
      return res.status(400).json({ error: usernameCheck.error });
    }

    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    if (!nsecKey || nsecKey.trim().length === 0) {
      return res.status(400).json({ error: 'Private key (nsec) is required' });
    }

    const normalizedEmail = normalizeEmail(email);
    const emailCheck = validateEmail(normalizedEmail);
    if (!emailCheck.valid) {
      return res.status(400).json({ error: emailCheck.error });
    }
    if (!isEmailAllowedForTenant(normalizedEmail)) {
      return res.status(403).json({
        error: `Only ${config.allowedSignupEmailDomain} email addresses can sign up`,
      });
    }
    const existing = await getUserByUsername(normalizedUsername);
    if (existing) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const { publicKey, encryptedPrivateKey } = await parseAndEncryptPrivateKey(nsecKey, password);
    const passwordHash = await hashPassword(password);
    const resolvedRelays = getDomainScopedRelays(normalizedEmail, relays || []);

    const user = await createUser({
      username: normalizedUsername,
      publicKey,
      encryptedPrivateKey,
      passwordHash,
      relays: resolvedRelays,
      email: normalizedEmail,
      emailVerifiedAt: new Date(),
      emailVerificationToken: null,
      emailVerificationExpiresAt: null,
    });

    res.status(201).json({
      success: true,
      user: {
        username: user.username,
        publicKey: user.public_key,
        email: user.email,
      },
      emailVerificationRequired: false,
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * POST /signin
 * Authenticate user and return encrypted private key
 * 
 * Verifies username and password, then returns the NIP-49 encrypted
 * private key that the client can decrypt locally.
 */
router.post('/signin', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (config.emailVerificationEnabled && !user.email_verified_at) {
      return res.status(403).json({
        error: 'Email verification required before sign in',
      });
    }

    res.json({
      success: true,
      encryptedPrivateKey: user.encrypted_private_key,
      publicKey: user.public_key,
      relays: getDomainScopedRelays(user.email, user.relays || []),
      emailVerified: Boolean(user.email_verified_at),
    });
  } catch (error) {
    console.error('Signin error:', error);
    res.status(500).json({ error: 'Sign in failed' });
  }
});

/**
 * POST /verify-email
 * Verify a user's email address with a one-time token.
 */
router.post('/verify-email', async (req, res) => {
  try {
    const { username, token, pin } = req.body;
    const normalizedUsername = String(username || '').trim().toLowerCase();

    if (!normalizedUsername) {
      return res.status(400).json({ error: 'Username is required' });
    }
    if (!token && !pin) {
      return res.status(400).json({ error: 'Either token or pin is required' });
    }

    const onboarding = await getUserOnboardingByUsername(normalizedUsername);
    if (!onboarding) {
      if (!token) {
        return res.status(404).json({ error: 'Pending onboarding not found' });
      }
      // Backward compatibility for legacy flow.
      const verifiedLegacy = await verifyUserEmail(normalizedUsername, String(token).trim());
      if (!verifiedLegacy) {
        return res.status(400).json({ error: 'Invalid or expired verification token' });
      }
      return res.json({
        success: true,
        user: {
          username: verifiedLegacy.username,
          publicKey: verifiedLegacy.public_key,
          email: verifiedLegacy.email,
        },
      });
    }

    if (isExpired(onboarding.email_verification_expires_at)) {
      return res.status(400).json({ error: 'Verification has expired. Start onboarding again.' });
    }

    if (onboarding.email_verified_at) {
      return res.json({
        success: true,
        onboarding: {
          username: onboarding.username,
          email: onboarding.email,
          emailVerified: true,
          nextStep: 'submit_private_key',
        },
      });
    }

    let verified = false;

    if (token) {
      verified = String(token).trim() === onboarding.email_verification_token;
    } else if (pin) {
      if (onboarding.pin_attempt_count >= 5) {
        return res.status(429).json({ error: 'Too many failed PIN attempts. Start onboarding again.' });
      }
      verified = await verifyPassword(String(pin).trim(), onboarding.email_verification_pin_hash);
      if (!verified) {
        await incrementUserOnboardingPinAttempt(normalizedUsername);
      }
    }

    if (!verified) {
      return res.status(400).json({ error: 'Invalid verification token or PIN' });
    }

    const marked = await markUserOnboardingEmailVerified(normalizedUsername);
    res.json({
      success: true,
      onboarding: {
        username: marked.username,
        email: marked.email,
        emailVerified: true,
        nextStep: 'submit_private_key',
      },
    });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ error: 'Email verification failed' });
  }
});

/**
 * GET /verify-email
 * Link-friendly email verification endpoint.
 */
router.get('/verify-email', async (req, res) => {
  try {
    const token = String(req.query.token || '').trim();
    const origin = String(req.query.origin || '').trim();
    if (!token) {
      return res.status(400).send('Missing token');
    }
    const params = new URLSearchParams({ token });
    if (origin) params.set('origin', origin);
    return res.redirect(`/verify?${params.toString()}`);
  } catch (error) {
    console.error('Verify email link error:', error);
    res.status(500).send('Email verification failed');
  }
});

/**
 * POST /onboarding/complete
 * Accept private key only after verified email.
 */
router.post('/onboarding/complete', async (req, res) => {
  try {
    const { username, password, nsecKey } = req.body;
    const normalizedUsername = String(username || '').trim().toLowerCase();

    if (!normalizedUsername || !password || !nsecKey) {
      return res.status(400).json({ error: 'Username, password, and private key are required' });
    }

    const existingUser = await getUserByUsername(normalizedUsername);
    if (existingUser) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const onboarding = await getUserOnboardingByUsername(normalizedUsername);
    if (!onboarding) {
      return res.status(404).json({ error: 'Pending onboarding not found' });
    }
    if (isExpired(onboarding.email_verification_expires_at)) {
      return res.status(400).json({ error: 'Onboarding expired. Start again.' });
    }
    if (!onboarding.email_verified_at) {
      return res.status(403).json({ error: 'Email must be verified before private key submission' });
    }

    const validPassword = await verifyPassword(password, onboarding.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const { publicKey, encryptedPrivateKey } = await parseAndEncryptPrivateKey(nsecKey, password);
    const user = await createUser({
      username: onboarding.username,
      publicKey,
      encryptedPrivateKey,
      passwordHash: onboarding.password_hash,
      relays: onboarding.relays || [],
      email: onboarding.email,
      emailVerifiedAt: onboarding.email_verified_at,
      emailVerificationToken: null,
      emailVerificationExpiresAt: null,
    });

    await deleteUserOnboarding(normalizedUsername);

    res.status(201).json({
      success: true,
      user: {
        username: user.username,
        publicKey: user.public_key,
        email: user.email,
      },
    });
  } catch (error) {
    if (String(error.message || '').includes('Invalid private key format')) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Onboarding complete error:', error);
    res.status(500).json({ error: 'Failed to complete onboarding' });
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
    const { username, password, updates } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const updateData = {};
    
    if (updates.newPassword) {
      if (updates.newPassword.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
      }
      updateData.passwordHash = await hashPassword(updates.newPassword);
    }

    if (updates.encryptedPrivateKey) {
      const encKeyCheck = validateEncryptedPrivateKey(updates.encryptedPrivateKey);
      if (!encKeyCheck.valid) {
        return res.status(400).json({ error: encKeyCheck.error });
      }
      updateData.encryptedPrivateKey = updates.encryptedPrivateKey;
    }

    if (updates.relays) {
      const mappedRelays = config.domainRelayMap[getEmailDomain(user.email)];
      if (Array.isArray(mappedRelays) && mappedRelays.length > 0) {
        return res.status(403).json({
          error: 'Relay list is managed by domain policy for this account',
        });
      }
      updateData.relays = updates.relays;
    }

    const updated = await updateUser(username, updateData);

    res.json({
      success: true,
      user: {
        username: updated.username,
        publicKey: updated.public_key,
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
    const { username, password, savedKey } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    if (!savedKey) {
      return res.status(400).json({ error: 'Confirm that you saved your private key' });
    }

    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await deleteUser(username);

    res.json({
      success: true,
      deleted: {
        username: user.username,
        publicKey: user.public_key,
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
    const { username, password, data, contentType } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const imageResult = normalizeBase64Payload(data, contentType);
    if (imageResult.error) {
      return res.status(400).json({ error: imageResult.error });
    }

    const updated = await updateUserProfilePicture(
      username,
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

    const picture = await getUserProfilePictureByPublicKey(pubkey);
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
      return res.status(400).json({ error: 'Name parameter is required' });
    }

    const user = await getUserForNip05(name);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (config.emailVerificationEnabled && !user.email_verified_at) {
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
    const user = await getUserByUsername(username);
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
    const user = await getUserByUsername(username);
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
