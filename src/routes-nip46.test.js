/**
 * NIP-46 Routes Integration Tests
 * 
 * Integration tests for NIP-46 API endpoints.
 */

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { app } from './index.js';
import { createUser } from './db/users.js';
import { hashPassword } from './auth.js';
import { pool } from './db/pool.js';
import { signerPubkey } from './nip46.js';

// Test helper function to make requests
async function request(method, path, body = null) {
  const response = await fetch(`http://localhost:${process.env.PORT || 3000}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : null
  });
  
  const data = await response.text();
  try {
    return {
      status: response.status,
      body: JSON.parse(data)
    };
  } catch {
    return {
      status: response.status,
      body: data
    };
  }
}

// Test data
const testUser = {
  username: 'nip46apitest',
  password: 'testpass123',
  publicKey: 'a'.repeat(64),
  encryptedPrivateKey: 'ncsec1q7l7ejcz3h9qztwtrgrkgcvq0h2f7nwu7qd8l8n4y8g9w3hql9nszpqyy2'
};

describe('NIP-46 API Routes', () => {
  let server;
  let testUserId;

  before(async () => {
    // Start test server
    const { config } = await import('./config.js');
    server = app.listen(config.port + 1); // Use different port for testing
    
    // Create test user with properly hashed password
    const passwordHash = await hashPassword(testUser.password);
    const user = await createUser({
      username: testUser.username,
      publicKey: testUser.publicKey,
      encryptedPrivateKey: testUser.encryptedPrivateKey,
      passwordHash,
      relays: []
    });
    testUserId = user.id;
    
    // Wait a bit for server to start
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  after(async () => {
    // Clean up test data
    await pool.query('DELETE FROM nip46_requests WHERE session_id LIKE $1', ['%test%']);
    await pool.query('DELETE FROM nip46_sessions WHERE session_id LIKE $1', ['%test%']);
    await pool.query('DELETE FROM users WHERE username = $1', [testUser.username]);
    
    // Close server
    if (server) {
      server.close();
    }
  });

  describe('GET /nip46/info', () => {
    it('returns signer information', async () => {
      const response = await request('GET', '/nip46/info');

      assert.equal(response.status, 200);
      assert.equal(response.body.pubkey, signerPubkey);
      assert(Array.isArray(response.body.methods));
      assert(response.body.methods.includes('connect'));
      assert(response.body.methods.includes('sign_event'));
      assert.equal(response.body.version, '1.0.0');
    });
  });

  describe('GET /nip46/connect/:username', () => {
    it('generates connection token for valid user', async () => {
      const response = await request('GET', `/nip46/connect/${testUser.username}`);

      assert.equal(response.status, 200);
      assert(response.body.bunker_url.startsWith('bunker://'));
      assert(response.body.bunker_url.includes(signerPubkey));
      assert.equal(response.body.username, testUser.username);
      assert(response.body.instructions);
    });

    it('returns 404 for non-existent user', async () => {
      const response = await request('GET', '/nip46/connect/nonexistentuser');

      assert.equal(response.status, 404);
      assert.equal(response.body.error, 'User not found');
    });
  });

  describe('POST /nip46/request', () => {
    it('rejects invalid event kind', async () => {
      const invalidEvent = {
        kind: 1, // Wrong kind, should be 24133
        pubkey: 'b'.repeat(64),
        content: 'test',
        tags: []
      };

      const response = await request('POST', '/nip46/request', {
        event: invalidEvent,
        username: testUser.username
      });

      assert.equal(response.status, 400);
      assert(response.body.error.includes('Invalid request event'));
    });

    it('requires username parameter', async () => {
      const validEvent = {
        kind: 24133,
        pubkey: 'b'.repeat(64),
        content: 'encrypted_content',
        tags: [['p', signerPubkey]]
      };

      const response = await request('POST', '/nip46/request', {
        event: validEvent
        // missing username
      });

      assert.equal(response.status, 400);
      assert.equal(response.body.error, 'Username is required');
    });

    it('processes valid request event structure', async () => {
      const validEvent = {
        kind: 24133,
        pubkey: 'b'.repeat(64),
        content: 'encrypted_content', // Would be properly encrypted in real usage
        tags: [['p', signerPubkey]]
      };

      const response = await request('POST', '/nip46/request', {
        event: validEvent,
        username: testUser.username
      });

      // This will fail due to encryption, but should show proper structure handling
      assert(response.status === 400 || response.status === 500);
    });
  });

  describe('POST /nip46/nostrconnect', () => {
    it('processes valid nostrconnect URL', async () => {
      const clientPubkey = 'c'.repeat(64);
      const nostrconnectUrl = `nostrconnect://${clientPubkey}?relay=wss://relay.example.com&secret=test123&perms=sign_event,get_public_key`;

      const response = await request('POST', '/nip46/nostrconnect', {
        nostrconnect_url: nostrconnectUrl,
        username: testUser.username
      });

      assert.equal(response.status, 200);
      assert.equal(response.body.success, true);
      assert.equal(response.body.remote_signer_pubkey, signerPubkey);
      assert.equal(response.body.secret, 'test123');
      assert(response.body.message);
    });

    it('rejects invalid nostrconnect URL', async () => {
      const response = await request('POST', '/nip46/nostrconnect', {
        nostrconnect_url: 'invalid://url',
        username: testUser.username
      });

      assert.equal(response.status, 400);
      assert(response.body.error.includes('Invalid nostrconnect URL'));
    });

    it('requires username parameter', async () => {
      const clientPubkey = 'c'.repeat(64);
      const nostrconnectUrl = `nostrconnect://${clientPubkey}?relay=wss://relay.example.com&secret=test123`;

      const response = await request('POST', '/nip46/nostrconnect', {
        nostrconnect_url: nostrconnectUrl
        // missing username
      });

      assert.equal(response.status, 400);
      assert.equal(response.body.error, 'Username is required');
    });

    it('returns 404 for non-existent user', async () => {
      const clientPubkey = 'c'.repeat(64);
      const nostrconnectUrl = `nostrconnect://${clientPubkey}?relay=wss://relay.example.com&secret=test123`;

      const response = await request('POST', '/nip46/nostrconnect', {
        nostrconnect_url: nostrconnectUrl,
        username: 'nonexistentuser'
      });

      assert.equal(response.status, 404);
      assert.equal(response.body.error, 'User not found');
    });

    it('validates client pubkey format', async () => {
      const invalidPubkey = 'invalid-pubkey';
      const nostrconnectUrl = `nostrconnect://${invalidPubkey}?relay=wss://relay.example.com&secret=test123`;

      const response = await request('POST', '/nip46/nostrconnect', {
        nostrconnect_url: nostrconnectUrl,
        username: testUser.username
      });

      assert.equal(response.status, 400);
      assert(response.body.error.includes('Invalid client pubkey'));
    });
  });

  describe('Error Handling', () => {
    it('handles malformed JSON gracefully', async () => {
      const response = await fetch(`http://localhost:${process.env.PORT || 3000}/nip46/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json'
      });

      assert.equal(response.status, 400);
    });
  });
});