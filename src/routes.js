/**
 * API Routes
 * 
 * Defines all HTTP endpoints for the Noas server:
 * - POST /register - Create new user account
 * - POST /signin - Authenticate and get encrypted key
 * - POST /update - Update user password or relays
 * - GET /.well-known/nostr.json - NIP-05 verification
 * - GET /health - Health check endpoint
 */

import express from 'express';
import { createUser, getUserByUsername, updateUser, getUserForNip05 } from './db/users.js';
import { 
  hashPassword, 
  verifyPassword, 
  validateUsername, 
  validatePublicKey, 
  validateEncryptedPrivateKey 
} from './auth.js';
import { config } from './config.js';

export const router = express.Router();

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
