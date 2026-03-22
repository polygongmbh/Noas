/**
 * NIP-46 Database Tests
 * 
 * Tests for NIP-46 database operations including sessions and requests.
 */

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { 
  createNip46Session,
  getNip46Session,
  updateNip46SessionStatus,
  getUserActiveSessions,
  createNip46Request,
  getNip46Request,
  completeNip46Request,
  getPendingRequests,
  isMethodAllowed,
  getSessionByClientPubkey,
  cleanupExpiredSessions,
  cleanupExpiredRequests
} from '../db/nip46.js';
import { createUser } from '../db/users.js';
import { hashPassword } from '../auth.js';
import { pool } from '../db/pool.js';

// Test data
const testUser = {
  username: 'testnip46user',
  password: 'testpass123',
  publicKey: 'a'.repeat(64),
  encryptedPrivateKey: 'ncsec1q7l7ejcz3h9qztwtrgrkgcvq0h2f7nwu7qd8l8n4y8g9w3hql9nszpqyy2'
};

const testSession = {
  sessionId: 'test-session-123',
  clientPubkey: 'b'.repeat(64),
  remoteSigner: 'c'.repeat(64),
  secret: 'test-secret-456',
  permissions: ['sign_event', 'get_public_key']
};

let dbAvailable = true;
try {
  await pool.query('SELECT 1');
} catch (error) {
  dbAvailable = false;
  console.warn('[db/nip46.test] Skipping DB tests: database unavailable:', error.code || error.message);
}

describe('NIP-46 Database Operations', { skip: !dbAvailable }, () => {
  let testUserId;

  // Clean up before and after tests
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
    await pool.query('DELETE FROM nip46_requests WHERE session_id LIKE $1', ['test-%']);
    await pool.query('DELETE FROM nip46_sessions WHERE session_id LIKE $1', ['test-%']);
    await pool.query('DELETE FROM nostr_users WHERE username = $1', [testUser.username]);
  });

  describe('Session Management', () => {
    it('createNip46Session creates a new session', async () => {
      const session = await createNip46Session({
        ...testSession,
        userId: testUserId
      });

      assert.equal(session.session_id, testSession.sessionId);
      assert.equal(session.user_id, testUserId);
      assert.equal(session.client_pubkey, testSession.clientPubkey);
      assert.equal(session.remote_signer_pubkey, testSession.remoteSigner);
      assert.equal(session.secret, testSession.secret);
      assert.deepEqual(session.permissions, testSession.permissions);
      assert.equal(session.status, 'pending');
    });

    it('getNip46Session retrieves an existing session', async () => {
      const session = await getNip46Session(testSession.sessionId);

      assert(session);
      assert.equal(session.session_id, testSession.sessionId);
      assert.equal(session.status, 'pending');
    });

    it('updateNip46SessionStatus updates session status', async () => {
      const updated = await updateNip46SessionStatus(testSession.sessionId, 'connected');

      assert(updated);
      assert.equal(updated.status, 'connected');
    });

    it('getSessionByClientPubkey finds session by client pubkey', async () => {
      const session = await getSessionByClientPubkey(testSession.clientPubkey);

      assert(session);
      assert.equal(session.client_pubkey, testSession.clientPubkey);
      assert.equal(session.status, 'connected');
    });

    it('getUserActiveSessions returns active sessions for user', async () => {
      const sessions = await getUserActiveSessions(testUserId);

      assert(Array.isArray(sessions));
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].session_id, testSession.sessionId);
    });

    it('isMethodAllowed checks permissions correctly', async () => {
      const allowed = await isMethodAllowed(testSession.sessionId, 'sign_event');
      const notAllowed = await isMethodAllowed(testSession.sessionId, 'unknown_method');

      assert.equal(allowed, true);
      assert.equal(notAllowed, false);
    });
  });

  describe('Request Management', () => {
    const testRequestId = 'test-request-789';
    const testMethod = 'sign_event';
    const testParams = { kind: 1, content: 'test event' };

    it('createNip46Request creates a new request', async () => {
      const request = await createNip46Request({
        requestId: testRequestId,
        sessionId: testSession.sessionId,
        method: testMethod,
        params: testParams
      });

      assert.equal(request.request_id, testRequestId);
      assert.equal(request.session_id, testSession.sessionId);
      assert.equal(request.method, testMethod);
      assert.deepEqual(request.params, testParams);
      assert.equal(request.status, 'pending');
    });

    it('getNip46Request retrieves an existing request', async () => {
      const request = await getNip46Request(testRequestId);

      assert(request);
      assert.equal(request.request_id, testRequestId);
      assert.equal(request.method, testMethod);
      assert.equal(request.status, 'pending');
    });

    it('getPendingRequests returns pending requests for session', async () => {
      const requests = await getPendingRequests(testSession.sessionId);

      assert(Array.isArray(requests));
      assert.equal(requests.length, 1);
      assert.equal(requests[0].request_id, testRequestId);
    });

    it('completeNip46Request updates request with response', async () => {
      const response = { result: 'success' };
      const updated = await completeNip46Request(testRequestId, response);

      assert(updated);
      assert.equal(updated.status, 'completed');
      assert.deepEqual(updated.response, response);
    });
  });

  describe('Cleanup Operations', () => {
    it('cleanupExpiredSessions removes expired sessions', async () => {
      // Create an expired session
      const expiredSessionId = 'expired-session-123';
      await pool.query(`
        INSERT INTO nip46_sessions 
        (session_id, user_id, client_pubkey, remote_signer_pubkey, expires_at)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP - INTERVAL '1 hour')
      `, [expiredSessionId, testUserId, 'd'.repeat(64), 'e'.repeat(64)]);

      const deletedCount = await cleanupExpiredSessions();
      assert(deletedCount >= 1);

      // Verify it was deleted
      const session = await getNip46Session(expiredSessionId);
      assert.equal(session, null);
    });

    it('cleanupExpiredRequests removes expired requests', async () => {
      // Create an expired request
      const expiredRequestId = 'expired-request-123';
      await pool.query(`
        INSERT INTO nip46_requests 
        (request_id, session_id, method, expires_at)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP - INTERVAL '1 hour')
      `, [expiredRequestId, testSession.sessionId, 'ping']);

      const deletedCount = await cleanupExpiredRequests();
      assert(deletedCount >= 1);

      // Verify it was deleted
      const request = await getNip46Request(expiredRequestId);
      assert.equal(request, null);
    });
  });

  describe('Edge Cases', () => {
    it('getNip46Session returns null for non-existent session', async () => {
      const session = await getNip46Session('non-existent-session');
      assert.equal(session, null);
    });

    it('updateNip46SessionStatus returns null for non-existent session', async () => {
      const updated = await updateNip46SessionStatus('non-existent-session', 'connected');
      assert.equal(updated, null);
    });

    it('isMethodAllowed returns false for invalid session', async () => {
      const allowed = await isMethodAllowed('non-existent-session', 'sign_event');
      assert.equal(allowed, false);
    });

    it('isMethodAllowed allows all methods when no permissions set', async () => {
      // Create session with no permissions
      const noPermsSessionId = 'no-perms-session-123';
      await createNip46Session({
        sessionId: noPermsSessionId,
        userId: testUserId,
        clientPubkey: 'f'.repeat(64),
        remoteSigner: 'g'.repeat(64),
        permissions: []
      });

      await updateNip46SessionStatus(noPermsSessionId, 'connected');

      const allowed = await isMethodAllowed(noPermsSessionId, 'any_method');
      assert.equal(allowed, true);

      // Clean up
      await pool.query('DELETE FROM nip46_sessions WHERE session_id = $1', [noPermsSessionId]);
    });
  });
});
