/**
 * API Routes
 * 
 * Defines all HTTP endpoints for the Noas server:
 * - POST /register - Create new user account
 * - POST /signin - Authenticate and get encrypted key
 * - POST /update - Update user password or relays
 * - POST /picture - Upload profile picture
 * - GET /picture/:pubkey - Serve profile picture by public key
 * - GET /.well-known/nostr.json - NIP-05 verification
 * - GET /health - Health check endpoint
 */

import express from 'express';
import { 
  createUser, 
  getUserByUsername, 
  updateUser, 
  getUserForNip05,
  getUserProfilePictureByPublicKey,
  updateUserProfilePicture,
} from './db/users.js';
import { 
  hashPassword, 
  verifyPassword, 
  validateUsername, 
  validatePublicKey, 
  validateEncryptedPrivateKey 
} from './auth.js';
import { config } from './config.js';

export const router = express.Router();

const MAX_PROFILE_PICTURE_BYTES = 2 * 1024 * 1024;

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
 * POST /register
 * Register a new user account
 * 
 * Validates inputs, checks for duplicate username, hashes password,
 * and stores user data in database.
 */
router.post('/register', async (req, res) => {
  try {
    const { username, password, publicKey, encryptedPrivateKey, relays } = req.body;

    // Validate inputs
    const usernameCheck = validateUsername(username);
    if (!usernameCheck.valid) {
      return res.status(400).json({ error: usernameCheck.error });
    }

    const pubkeyCheck = validatePublicKey(publicKey);
    if (!pubkeyCheck.valid) {
      return res.status(400).json({ error: pubkeyCheck.error });
    }

    const encKeyCheck = validateEncryptedPrivateKey(encryptedPrivateKey);
    if (!encKeyCheck.valid) {
      return res.status(400).json({ error: encKeyCheck.error });
    }

    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check if user already exists
    const existing = await getUserByUsername(username);
    if (existing) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password);
    const user = await createUser({
      username,
      publicKey,
      encryptedPrivateKey,
      passwordHash,
      relays: relays || [],
    });

    res.status(201).json({
      success: true,
      user: {
        username: user.username,
        publicKey: user.public_key,
      },
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

    res.json({
      success: true,
      encryptedPrivateKey: user.encrypted_private_key,
      publicKey: user.public_key,
      relays: user.relays,
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
