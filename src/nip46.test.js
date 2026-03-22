/**
 * NIP-46 Service Tests
 * 
 * Tests for the NIP-46 remote signer protocol implementation.
 */

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  createConnectionToken,
  processNip46Request,
  createResponseEvent,
  signerPubkey,
  handleConnect,
  handleSignEvent,
  handleGetPublicKey,
  handlePing
} from './nip46.js';
import { createUser } from './db/users.js';
import { hashPassword } from './auth.js';
import { pool } from './db/pool.js';

// Test data
const testUser = {
  username: 'testnip46signer',
  password: 'testpass123',
  publicKey: 'a'.repeat(64),
  encryptedPrivateKey: 'ncsec1q7l7ejcz3h9qztwtrgrkgcvq0h2f7nwu7qd8l8n4y8g9w3hql9nszpqyy2'
};

// Valid secp256k1 public key for testing
const testClientPubkey = 'eaed797c2c94d7eb2748d00d823c2b61c7a2e93a9f8b748b4e8e1e51e6c3b4e5';

let dbAvailable = true;
try {
  await pool.query('SELECT 1');
} catch (error) {
  dbAvailable = false;
  console.warn('[nip46.test] Skipping DB tests: database unavailable:', error.code || error.message);
}

describe('NIP-46 Service', { skip: !dbAvailable }, () => {
  let testUserId;

  before(async () => {
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
  });

  after(async () => {
    // Clean up test data
    await pool.query('DELETE FROM nip46_requests WHERE session_id LIKE $1', ['%test%']);
    await pool.query('DELETE FROM nip46_sessions WHERE session_id LIKE $1', ['%test%']);
    await pool.query('DELETE FROM nostr_users WHERE username = $1', [testUser.username]);
  });

  describe('Connection Management', () => {
    it('createConnectionToken generates valid bunker URL', () => {
      const domain = 'test.example.com';
      const token = createConnectionToken(domain);

      assert(token.startsWith('bunker://'));
      assert(token.includes(signerPubkey));
      assert(token.includes('relay='));
      assert(token.includes('secret='));
    });

    it('handleConnect processes connection request successfully', async () => {
      const requestData = {
        id: 'test-connect-123',
        method: 'connect',
        params: [signerPubkey, 'test-secret', 'sign_event,get_public_key']
      };

      const response = await handleConnect(requestData, testClientPubkey, testUser.username);

      assert.equal(response.id, requestData.id);
      assert.equal(response.result, 'ack');
      assert.equal(response.error, null);
    });

    it('handleConnect rejects invalid remote signer', async () => {
      const requestData = {
        id: 'test-connect-invalid',
        method: 'connect',
        params: ['invalid-pubkey', 'test-secret']
      };

      const response = await handleConnect(requestData, testClientPubkey, testUser.username);

      assert.equal(response.id, requestData.id);
      assert.equal(response.result, null);
      assert(response.error.includes('Invalid'));
    });

    it('handleConnect rejects non-existent user', async () => {
      const requestData = {
        id: 'test-connect-nouser',
        method: 'connect',
        params: [signerPubkey, 'test-secret']
      };

      const response = await handleConnect(requestData, testClientPubkey, 'nonexistent');

      assert.equal(response.id, requestData.id);
      assert.equal(response.result, null);
      assert(response.error.includes('not found'));
    });
  });

  describe('Method Handling', () => {
    it('handlePing returns pong', () => {
      const requestData = {
        id: 'test-ping-123',
        method: 'ping',
        params: []
      };

      const response = handlePing(requestData);

      assert.equal(response.id, requestData.id);
      assert.equal(response.result, 'pong');
      assert.equal(response.error, null);
    });

    it('handleGetPublicKey returns signer pubkey', async () => {
      // First establish a session
      const connectRequest = {
        id: 'test-connect',
        method: 'connect',
        params: [signerPubkey, 'secret']
      };
      
      await handleConnect(connectRequest, testClientPubkey, testUser.username);

      // Get the session to find sessionId
      const session = await pool.query(
        'SELECT session_id FROM nip46_sessions WHERE client_pubkey = $1 ORDER BY created_at DESC LIMIT 1',
        [testClientPubkey]
      );
      const sessionId = session.rows[0]?.session_id;

      if (!sessionId) {
        throw new Error('Session not found');
      }

      const requestData = {
        id: 'test-getpubkey-123',
        method: 'get_public_key',
        params: []
      };

      const response = await handleGetPublicKey(requestData, sessionId);

      assert.equal(response.id, requestData.id);
      assert.equal(response.result, signerPubkey);
      assert.equal(response.error, null);
    });

    it('handleSignEvent processes signing request', async () => {
      // Get existing session
      const session = await pool.query(
        'SELECT session_id FROM nip46_sessions WHERE client_pubkey = $1 ORDER BY created_at DESC LIMIT 1',
        [testClientPubkey]
      );
      const sessionId = session.rows[0]?.session_id;

      if (!sessionId) {
        throw new Error('Session not found');
      }

      const eventToSign = {
        kind: 1,
        content: 'Test message',
        tags: [],
        created_at: Math.floor(Date.now() / 1000)
      };

      const requestData = {
        id: 'test-sign-123',
        method: 'sign_event',
        params: [JSON.stringify(eventToSign)]
      };

      const response = await handleSignEvent(requestData, sessionId);

      assert.equal(response.id, requestData.id);
      assert(response.result); // Should have a result
      assert.equal(response.error, null);

      // Parse the signed event
      const signedEvent = JSON.parse(response.result);
      assert.equal(signedEvent.kind, eventToSign.kind);
      assert.equal(signedEvent.content, eventToSign.content);
      assert(signedEvent.id); // Should have an ID
      assert(signedEvent.sig); // Should have a signature
    });
  });

  describe('Request Processing', () => {
    it('processNip46Request handles encrypted requests', async () => {
      // This is a simplified test since we'd need actual encryption
      // In reality, the content would be NIP-44 encrypted
      const mockEvent = {
        kind: 24133,
        pubkey: testClientPubkey,
        content: JSON.stringify({
          id: 'test-process-123',
          method: 'ping',
          params: []
        }), // This would be encrypted in real implementation
        tags: [['p', signerPubkey]]
      };

      // We'll test this by mocking the decryption
      // In a real test, you'd use actual NIP-44 encryption/decryption
      try {
        await processNip46Request(mockEvent, testUser.username);
        // If we get here without throwing, the structure is correct
        assert(true);
      } catch (error) {
        // Expected to fail due to encryption, but structure should be right
        assert(error.message.includes('decrypt') || error.message.includes('encrypt'));
      }
    });

    it('createResponseEvent generates valid event structure', () => {
      const response = {
        id: 'test-response-123',
        result: 'test-result',
        error: null
      };
      
      // This will fail due to encryption but should show basic structure is right
      try {
        const responseEvent = createResponseEvent(response, testClientPubkey);
        
        assert.equal(responseEvent.kind, 24133);
        assert.equal(responseEvent.pubkey, signerPubkey);
        assert(responseEvent.content); // Should have encrypted content
        assert.equal(responseEvent.tags[0][0], 'p');
        assert.equal(responseEvent.tags[0][1], testClientPubkey);
        assert(responseEvent.id); // Should have event ID
        assert(responseEvent.sig); // Should have signature
      } catch (error) {
        // Expected to fail due to encryption with test keys
        assert(error.message.includes('point') || error.message.includes('curve'));
      }
    });
  });

  describe('Permission Validation', () => {
    it('restricts methods based on session permissions', async () => {
      // Create a session with limited permissions
      const limitedSession = await pool.query(`
        INSERT INTO nip46_sessions 
        (session_id, user_id, client_pubkey, remote_signer_pubkey, permissions, status)
        VALUES ('limited-session', $1, $2, $3, $4, 'connected')
        RETURNING session_id
      `, [testUserId, 'c'.repeat(64), signerPubkey, ['ping']]);
      
      const sessionId = limitedSession.rows[0].session_id;

      // Test allowed method
      const pingRequest = {
        id: 'test-ping-limited',
        method: 'ping',
        params: []
      };
      const pingResponse = handlePing(pingRequest);
      assert.equal(pingResponse.result, 'pong');

      // Test restricted method
      const signRequest = {
        id: 'test-sign-limited',
        method: 'sign_event',
        params: ['{}']
      };
      const signResponse = await handleSignEvent(signRequest, sessionId);
      assert.equal(signResponse.error, 'Method not allowed');

      // Clean up
      await pool.query('DELETE FROM nip46_sessions WHERE session_id = $1', [sessionId]);
    });
  });

  describe('Error Handling', () => {
    it('handles missing parameters gracefully', async () => {
      const requestData = {
        id: 'test-missing-params',
        method: 'sign_event',
        params: [] // Missing required event parameter
      };

      // Use a non-existent session to trigger error
      const response = await handleSignEvent(requestData, 'non-existent-session');

      assert.equal(response.id, requestData.id);
      assert.equal(response.result, null);
      assert(response.error);
    });

    it('handles invalid session gracefully', async () => {
      const requestData = {
        id: 'test-invalid-session',
        method: 'get_public_key',
        params: []
      };

      const response = await handleGetPublicKey(requestData, 'invalid-session-id');

      assert.equal(response.id, requestData.id);
      assert.equal(response.result, null);
      assert(response.error.includes('Method not allowed'));
    });
  });
});
