/**
 * NIP-46 Database Operations
 * 
 * Handles database operations for NIP-46 remote signer sessions and requests.
 */

import { query } from './pool.js';

/**
 * Create a new NIP-46 session
 * @param {Object} params - Session parameters
 * @param {string} params.sessionId - Unique session identifier
 * @param {number} params.userId - User ID who owns this session
 * @param {string} params.clientPubkey - Client's public key
 * @param {string} params.remoteSigner - Remote signer's public key
 * @param {string} [params.secret] - Optional secret for connection
 * @param {string[]} [params.permissions] - Array of allowed permissions
 * @returns {Promise<Object>} Created session object
 */
export async function createNip46Session({
  sessionId,
  userId,
  clientPubkey,
  remoteSigner,
  secret = null,
  permissions = []
}) {
  const result = await query(
    `INSERT INTO nip46_sessions 
     (session_id, user_id, client_pubkey, remote_signer_pubkey, secret, permissions)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [sessionId, userId, clientPubkey, remoteSigner, secret, permissions]
  );
  return result.rows[0];
}

/**
 * Get a NIP-46 session by session ID
 * @param {string} sessionId - Session identifier
 * @returns {Promise<Object|null>} Session object or null if not found
 */
export async function getNip46Session(sessionId) {
  const result = await query(
    'SELECT * FROM nip46_sessions WHERE session_id = $1',
    [sessionId]
  );
  return result.rows[0] || null;
}

/**
 * Update a NIP-46 session status
 * @param {string} sessionId - Session identifier
 * @param {string} status - New status ('pending', 'connected', 'disconnected')
 * @returns {Promise<Object|null>} Updated session object or null if not found
 */
export async function updateNip46SessionStatus(sessionId, status) {
  const result = await query(
    `UPDATE nip46_sessions 
     SET status = $2, last_activity = CURRENT_TIMESTAMP
     WHERE session_id = $1
     RETURNING *`,
    [sessionId, status]
  );
  return result.rows[0] || null;
}

/**
 * Delete expired NIP-46 sessions
 * @returns {Promise<number>} Number of deleted sessions
 */
export async function cleanupExpiredSessions() {
  const result = await query(
    'DELETE FROM nip46_sessions WHERE expires_at < CURRENT_TIMESTAMP'
  );
  return result.rowCount;
}

/**
 * Get active sessions for a user
 * @param {number} userId - User ID
 * @returns {Promise<Array>} Array of active sessions
 */
export async function getUserActiveSessions(userId) {
  const result = await query(
    `SELECT * FROM nip46_sessions 
     WHERE user_id = $1 AND status = 'connected' AND expires_at > CURRENT_TIMESTAMP
     ORDER BY last_activity DESC`,
    [userId]
  );
  return result.rows;
}

/**
 * Create a new NIP-46 request
 * @param {Object} params - Request parameters
 * @param {string} params.requestId - Unique request identifier
 * @param {string} params.sessionId - Associated session ID
 * @param {string} params.method - Method name (e.g., 'sign_event', 'get_public_key')
 * @param {Object} [params.params] - Request parameters
 * @returns {Promise<Object>} Created request object
 */
export async function createNip46Request({
  requestId,
  sessionId,
  method,
  params = null
}) {
  const result = await query(
    `INSERT INTO nip46_requests (request_id, session_id, method, params)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [requestId, sessionId, method, params]
  );
  return result.rows[0];
}

/**
 * Get a NIP-46 request by request ID
 * @param {string} requestId - Request identifier
 * @returns {Promise<Object|null>} Request object or null if not found
 */
export async function getNip46Request(requestId) {
  const result = await query(
    'SELECT * FROM nip46_requests WHERE request_id = $1',
    [requestId]
  );
  return result.rows[0] || null;
}

/**
 * Update a NIP-46 request with response
 * @param {string} requestId - Request identifier
 * @param {Object} response - Response data
 * @param {string} [error] - Error message if failed
 * @returns {Promise<Object|null>} Updated request object or null if not found
 */
export async function completeNip46Request(requestId, response, error = null) {
  const status = error ? 'failed' : 'completed';
  const result = await query(
    `UPDATE nip46_requests 
     SET status = $2, response = $3, error = $4, completed_at = CURRENT_TIMESTAMP
     WHERE request_id = $1
     RETURNING *`,
    [requestId, status, response, error]
  );
  return result.rows[0] || null;
}

/**
 * Get pending requests for a session
 * @param {string} sessionId - Session identifier
 * @returns {Promise<Array>} Array of pending requests
 */
export async function getPendingRequests(sessionId) {
  const result = await query(
    `SELECT * FROM nip46_requests 
     WHERE session_id = $1 AND status = 'pending' AND expires_at > CURRENT_TIMESTAMP
     ORDER BY created_at ASC`,
    [sessionId]
  );
  return result.rows;
}

/**
 * Delete expired NIP-46 requests
 * @returns {Promise<number>} Number of deleted requests
 */
export async function cleanupExpiredRequests() {
  const result = await query(
    'DELETE FROM nip46_requests WHERE expires_at < CURRENT_TIMESTAMP'
  );
  return result.rowCount;
}

/**
 * Get session by client pubkey (for connection lookup)
 * @param {string} clientPubkey - Client's public key
 * @returns {Promise<Object|null>} Session object or null if not found
 */
export async function getSessionByClientPubkey(clientPubkey) {
  const result = await query(
    `SELECT * FROM nip46_sessions 
     WHERE client_pubkey = $1 AND status IN ('pending', 'connected') 
     AND expires_at > CURRENT_TIMESTAMP
     ORDER BY created_at DESC
     LIMIT 1`,
    [clientPubkey]
  );
  return result.rows[0] || null;
}

/**
 * Check if a method is allowed for a session
 * @param {string} sessionId - Session identifier
 * @param {string} method - Method to check
 * @returns {Promise<boolean>} True if method is allowed
 */
export async function isMethodAllowed(sessionId, method) {
  const session = await getNip46Session(sessionId);
  if (!session || session.status !== 'connected') {
    return false;
  }
  
  // If no specific permissions are set, allow all methods
  if (!session.permissions || session.permissions.length === 0) {
    return true;
  }
  
  // Check if method is explicitly allowed
  return session.permissions.includes(method) || session.permissions.includes('*');
}