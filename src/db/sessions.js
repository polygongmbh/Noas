/**
 * Session Token Database Operations
 *
 * Opaque bearer session tokens created by magic link verification, with a
 * sliding expiry: every authenticated use pushes the expiry window forward.
 */

import { query } from './pool.js';

/**
 * Create a session token.
 * @param {Object} params
 * @param {string} params.token - Opaque token value
 * @param {number} params.userId - Account the session belongs to
 * @param {Date} params.expiresAt - Initial expiry timestamp
 * @returns {Promise<Object>} Created session row
 */
export async function createSessionToken({ token, userId, expiresAt }) {
  const result = await query(
    `INSERT INTO session_tokens (token, user_id, expires_at)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [token, userId, expiresAt]
  );
  return result.rows[0];
}

/**
 * Resolve an unexpired session by token and slide its expiry forward.
 * @param {string} token
 * @param {number} ttlDays - Sliding expiry window in days
 * @returns {Promise<Object|undefined>} Updated session row or undefined
 */
export async function touchSessionToken(token, ttlDays) {
  const days = Math.max(1, Number(ttlDays) || 1);
  const result = await query(
    `UPDATE session_tokens
     SET last_seen_at = NOW(),
         expires_at = NOW() + ($2::int * INTERVAL '1 day')
     WHERE token = $1
       AND expires_at > NOW()
     RETURNING *`,
    [token, days]
  );
  return result.rows[0];
}

/**
 * Delete a session token (logout).
 * @param {string} token
 * @returns {Promise<Object|undefined>} Deleted session row or undefined
 */
export async function deleteSessionToken(token) {
  const result = await query(
    'DELETE FROM session_tokens WHERE token = $1 RETURNING *',
    [token]
  );
  return result.rows[0];
}

/**
 * Delete expired session tokens and return number of deleted rows.
 * @returns {Promise<number>}
 */
export async function deleteExpiredSessionTokens() {
  const result = await query(
    'DELETE FROM session_tokens WHERE expires_at <= NOW()'
  );
  return result.rowCount || 0;
}
