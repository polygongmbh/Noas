/**
 * User Database Operations
 *
 * The active account store is `nostr_users`.
 * A small set of legacy helper names is kept as wrappers so older tests can
 * continue to exercise the same behavior without depending on the removed
 * `users` table.
 */

import { query } from './pool.js';

const NOSTR_USER_STATUSES = {
  UNVERIFIED_EMAIL: 'unverified_email',
  ACTIVE: 'active',
  DISABLED: 'disabled',
};

const NOSTR_USER_ROLES = {
  ADMIN: 'admin',
  MODERATOR: 'moderator',
  USER: 'user',
};

function normalizeTenantDomain(value) {
  return String(value || '').trim().toLowerCase();
}

function mapLegacyUserRow(row) {
  if (!row) return undefined;
  return {
    ...row,
    encrypted_private_key: row.private_key_encrypted,
    password_hash: row.password_sha256,
    raw_password: row.raw_password,
    email: null,
    email_verified_at: row.status === NOSTR_USER_STATUSES.ACTIVE ? row.created_at : null,
  };
}

/**
 * Legacy wrapper for creating an active user account.
 * @param {Object} userData
 * @returns {Promise<Object>}
 */
export async function createUser({
  username,
  publicKey,
  encryptedPrivateKey,
  passwordHash,
  rawPassword = null,
  relays = [],
  tenantDomain = '',
}) {
  const result = await createNostrUser({
    username,
    passwordSha256: passwordHash,
    publicKey,
    privateKeyEncrypted: encryptedPrivateKey,
    rawPassword,
    relays,
    tenantDomain,
    status: NOSTR_USER_STATUSES.ACTIVE,
    verificationToken: null,
    role: NOSTR_USER_ROLES.USER,
  });
  return mapLegacyUserRow(result);
}

/**
 * Retrieve a user by username
 * Returns all user fields including sensitive data (for authentication)
 * @param {string} username - Username to look up
 * @returns {Promise<Object|undefined>} User object or undefined if not found
 */
export async function getUserByUsername(username, tenantDomain = null) {
  const params = [username];
  let sql = 'SELECT * FROM nostr_users WHERE username = $1';
  const tenant = normalizeTenantDomain(tenantDomain);
  if (tenant) {
    params.push(tenant);
    sql += ' AND tenant_domain = $2';
  }
  const result = await query(sql, params);
  return mapLegacyUserRow(result.rows[0]);
}

/**
 * Retrieve a user by email.
 * @param {string} email
 * @returns {Promise<Object|undefined>}
 */
export async function getUserByEmail(email, tenantDomain = null) {
  const normalized = String(email || '').trim().toLowerCase();
  const username = normalized.split('@')[0];
  if (!username) return undefined;
  return getUserByUsername(username, tenantDomain);
}

/**
 * Retrieve user for NIP-05 verification
 * Returns only NIP-05-safe public fields (no password/key material)
 * @param {string} username - Username to look up
 * @returns {Promise<Object|undefined>} Object with username/public_key/verification state
 */
export async function getUserForNip05(username, tenantDomain = null) {
  const params = [username, NOSTR_USER_STATUSES.ACTIVE];
  let sql = `SELECT username,
                    public_key,
                    CASE WHEN status = $2 THEN created_at ELSE NULL END AS email_verified_at
             FROM nostr_users
             WHERE username = $1`;
  const tenant = normalizeTenantDomain(tenantDomain);
  if (tenant) {
    params.push(tenant);
    sql += ' AND tenant_domain = $3';
  }
  const result = await query(sql, params);
  return result.rows[0];
}

/**
 * Retrieve a user's profile picture by public key
 * Returns binary picture data and content type
 * @param {string} publicKey - Public key to look up
 * @returns {Promise<Object|undefined>} Object with profile_picture and profile_picture_type
 */
export async function getUserProfilePictureByPublicKey(publicKey) {
  return getNostrUserProfilePictureByPublicKey(publicKey);
}

/**
 * Update user profile picture
 * Stores binary picture data and content type
 * @param {string} username - Username of user to update
 * @param {Buffer} pictureData - Raw image bytes
 * @param {string} pictureType - MIME type of image
 * @returns {Promise<Object>} Updated user object
 */
export async function updateUserProfilePicture(username, pictureData, pictureType, tenantDomain = null) {
  const user = await getNostrUserByUsername(username, tenantDomain);
  if (!user) return undefined;
  await updateNostrUserProfilePicture(user.id, pictureData, pictureType);
  return {
    id: user.id,
    username: user.username,
    public_key: user.public_key,
  };
}

/**
 * Update user fields
 * Can update password hash, encrypted private key, or relays
 * @param {string} username - Username of user to update
 * @param {Object} updates - Fields to update
 * @param {string} updates.passwordHash - New password hash
 * @param {string} updates.encryptedPrivateKey - New encrypted private key
 * @param {Array} updates.relays - New relay list
 * @returns {Promise<Object>} Updated user object
 */
export async function updateUser(username, updates, tenantDomain = null) {
  const updated = await updateNostrUser(username, {
    passwordSha256: updates.passwordHash,
    privateKeyEncrypted: updates.encryptedPrivateKey,
    publicKey: updates.publicKey,
    relays: updates.relays,
  }, tenantDomain);
  return mapLegacyUserRow(updated);
}

/**
 * Delete a user account by username
 * @param {string} username - Username of user to delete
 * @returns {Promise<Object|undefined>} Deleted user summary or undefined if not found
 */
export async function deleteUser(username, tenantDomain = null) {
  const result = await deleteNostrUser(username, tenantDomain);
  return mapLegacyUserRow(result);
}

/**
 * Mark a user email as verified if the token is valid and not expired.
 * @param {string} username - Username of user to verify
 * @param {string} token - Email verification token
 * @returns {Promise<Object|undefined>} Updated user summary or undefined if not verified
 */
export async function verifyUserEmail(username, token, tenantDomain = null) {
  const tenant = normalizeTenantDomain(tenantDomain);
  const user = await getNostrUserByVerificationToken(token, tenant);
  if (!user || user.username !== username) {
    return undefined;
  }
  const params = [NOSTR_USER_STATUSES.ACTIVE, username];
  let sql = `UPDATE nostr_users
             SET status = $1,
                 verification_token = NULL
             WHERE username = $2`;
  if (tenant) {
    params.push(tenant);
    sql += ' AND tenant_domain = $3';
  }
  sql += ' RETURNING *';
  const result = await query(sql, params);
  return mapLegacyUserRow(result.rows[0]);
}

/**
 * Delete expired pending nostr users and return number of deleted rows.
 * Expiry is derived from created_at + expiry window.
 * @param {number} expiryMinutes
 * @returns {Promise<number>}
 */
export async function deleteExpiredPendingNostrUsers(expiryMinutes) {
  const minutes = Math.max(1, Number(expiryMinutes) || 1);
  const result = await query(
    `DELETE FROM nostr_users
     WHERE status = $1
       AND created_at < NOW() - ($2::int * INTERVAL '1 minute')`,
    [NOSTR_USER_STATUSES.UNVERIFIED_EMAIL, minutes]
  );
  return result.rowCount || 0;
}

/**
 * Retrieve nostr user by username.
 * @param {string} username
 * @returns {Promise<Object|undefined>}
 */
export async function getNostrUserByUsername(username, tenantDomain = null) {
  const params = [username];
  let sql = 'SELECT * FROM nostr_users WHERE username = $1';
  const tenant = normalizeTenantDomain(tenantDomain);
  if (tenant) {
    params.push(tenant);
    sql += ' AND tenant_domain = $2';
  }
  const result = await query(sql, params);
  return result.rows[0];
}

/**
 * Retrieve nostr user by verification token.
 * @param {string} token
 * @returns {Promise<Object|undefined>}
 */
export async function getNostrUserByVerificationToken(token, tenantDomain = null) {
  const params = [token];
  let sql = 'SELECT * FROM nostr_users WHERE verification_token = $1';
  const tenant = normalizeTenantDomain(tenantDomain);
  if (tenant) {
    params.push(tenant);
    sql += ' AND tenant_domain = $2';
  }
  const result = await query(sql, params);
  return result.rows[0];
}

/**
 * Create a nostr user.
 * @param {Object} data
 * @returns {Promise<Object>}
 */
export async function createNostrUser({
  username,
  passwordSha256,
  publicKey = null,
  privateKeyEncrypted = null,
  registrationEmail = null,
  rawPassword = null,
  relays = [],
  tenantDomain = '',
  status = NOSTR_USER_STATUSES.UNVERIFIED_EMAIL,
  verificationToken = null,
  role = NOSTR_USER_ROLES.USER,
}) {
  const result = await query(
    `INSERT INTO nostr_users (
      tenant_domain,
      username,
      password_sha256,
      raw_password,
      public_key,
      private_key_encrypted,
      registration_email,
      relays,
      status,
      verification_token,
      role
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *`,
    [
      normalizeTenantDomain(tenantDomain),
      username,
      passwordSha256,
      rawPassword,
      publicKey,
      privateKeyEncrypted,
      registrationEmail,
      JSON.stringify(relays),
      status,
      verificationToken,
      role,
    ]
  );
  return result.rows[0];
}

/**
 * Activate user and clear verification token.
 * @param {string} username
 * @returns {Promise<Object|undefined>}
 */
export async function activateNostrUserByUsername(username, tenantDomain = null) {
  const params = [NOSTR_USER_STATUSES.ACTIVE, username];
  let sql = `UPDATE nostr_users
             SET status = $1
             WHERE username = $2`;
  const tenant = normalizeTenantDomain(tenantDomain);
  if (tenant) {
    params.push(tenant);
    sql += ' AND tenant_domain = $3';
  }
  sql += ' RETURNING *';
  const result = await query(sql, params);
  return result.rows[0];
}

/**
 * Rotate verification token for resend.
 * @param {string} username
 * @param {string} verificationToken
 * @returns {Promise<Object|undefined>}
 */
export async function updateNostrUserResendToken(username, verificationToken, tenantDomain = null) {
  const params = [verificationToken, username];
  let sql = `UPDATE nostr_users
             SET verification_token = $1
             WHERE username = $2`;
  const tenant = normalizeTenantDomain(tenantDomain);
  if (tenant) {
    params.push(tenant);
    sql += ' AND tenant_domain = $3';
  }
  sql += ' RETURNING *';
  const result = await query(sql, params);
  return result.rows[0];
}

/**
 * Retrieve active nostr user for NIP-05.
 * @param {string} username
 * @returns {Promise<Object|undefined>}
 */
export async function getActiveNostrUserForNip05(username, tenantDomain = null) {
  const params = [username, NOSTR_USER_STATUSES.ACTIVE];
  let sql = `SELECT username, public_key
             FROM nostr_users
             WHERE username = $1
               AND status = $2`;
  const tenant = normalizeTenantDomain(tenantDomain);
  if (tenant) {
    params.push(tenant);
    sql += ' AND tenant_domain = $3';
  }
  const result = await query(sql, params);
  return result.rows[0];
}

/**
 * Retrieve active nostr user by username for sign-in.
 * @param {string} username
 * @returns {Promise<Object|undefined>}
 */
export async function getActiveNostrUserByUsername(username, tenantDomain = null) {
  const params = [username, NOSTR_USER_STATUSES.ACTIVE];
  let sql = `SELECT *
             FROM nostr_users
             WHERE username = $1
               AND status = $2`;
  const tenant = normalizeTenantDomain(tenantDomain);
  if (tenant) {
    params.push(tenant);
    sql += ' AND tenant_domain = $3';
  }
  const result = await query(sql, params);
  return result.rows[0];
}

/**
 * Retrieve active nostr user by id.
 * @param {number} id
 * @returns {Promise<Object|undefined>}
 */
export async function getActiveNostrUserById(id) {
  const result = await query(
    `SELECT *
     FROM nostr_users
     WHERE id = $1
       AND status = $2`,
    [id, NOSTR_USER_STATUSES.ACTIVE]
  );
  return result.rows[0];
}

/**
 * Update nostr user fields.
 * @param {string} username
 * @param {Object} updates
 * @returns {Promise<Object|undefined>}
 */
export async function updateNostrUser(username, updates, tenantDomain = null) {
  const fields = [];
  const values = [];
  let param = 1;

  if (updates.passwordSha256) {
    fields.push(`password_sha256 = $${param++}`);
    values.push(updates.passwordSha256);
  }
  if (updates.publicKey) {
    fields.push(`public_key = $${param++}`);
    values.push(updates.publicKey);
  }
  if (updates.privateKeyEncrypted) {
    fields.push(`private_key_encrypted = $${param++}`);
    values.push(updates.privateKeyEncrypted);
  }
  if (updates.relays) {
    fields.push(`relays = $${param++}`);
    values.push(JSON.stringify(updates.relays));
  }

  if (fields.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(username);
  const tenant = normalizeTenantDomain(tenantDomain);
  let whereClause = `WHERE username = $${param}`;
  if (tenant) {
    values.push(tenant);
    whereClause += ` AND tenant_domain = $${param + 1}`;
  }
  const result = await query(
    `UPDATE nostr_users
     SET ${fields.join(', ')}
     ${whereClause}
     RETURNING *`,
    values
  );
  return result.rows[0];
}

/**
 * Update nostr user role.
 * @param {string} username
 * @param {string} role
 * @returns {Promise<Object|undefined>}
 */
export async function updateNostrUserRole(username, role, tenantDomain = null) {
  const values = [role, username];
  const tenant = normalizeTenantDomain(tenantDomain);
  let whereClause = 'WHERE username = $2';
  if (tenant) {
    values.push(tenant);
    whereClause += ' AND tenant_domain = $3';
  }
  const result = await query(
    `UPDATE nostr_users
     SET role = $1
     ${whereClause}
     RETURNING *`,
    values
  );
  return result.rows[0];
}

/**
 * Update nostr user status.
 * @param {string} username
 * @param {string} status
 * @returns {Promise<Object|undefined>}
 */
export async function updateNostrUserStatus(username, status, tenantDomain = null) {
  const values = [status, username];
  const tenant = normalizeTenantDomain(tenantDomain);
  let whereClause = 'WHERE username = $2';
  if (tenant) {
    values.push(tenant);
    whereClause += ' AND tenant_domain = $3';
  }
  const result = await query(
    `UPDATE nostr_users
     SET status = $1
     ${whereClause}
     RETURNING *`,
    values
  );
  return result.rows[0];
}

/**
 * List nostr users for admin views.
 * @param {Object} options
 * @param {string} options.tenantDomain
 * @param {number} options.limit
 * @returns {Promise<Array>}
 */
export async function listNostrUsers({ tenantDomain = null, limit = 200 } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
  const params = [];
  let sql = `SELECT username,
                    registration_email,
                    public_key,
                    status,
                    role,
                    created_at
             FROM nostr_users`;
  const tenant = normalizeTenantDomain(tenantDomain);
  if (tenant) {
    params.push(tenant);
    sql += ` WHERE tenant_domain = $1`;
  }
  sql += ' ORDER BY created_at DESC';
  params.push(safeLimit);
  sql += ` LIMIT $${params.length}`;
  const result = await query(sql, params);
  return result.rows;
}

/**
 * Delete nostr user by username.
 * @param {string} username
 * @returns {Promise<Object|undefined>}
 */
export async function deleteNostrUser(username, tenantDomain = null) {
  const params = [username];
  let sql = 'DELETE FROM nostr_users WHERE username = $1';
  const tenant = normalizeTenantDomain(tenantDomain);
  if (tenant) {
    params.push(tenant);
    sql += ' AND tenant_domain = $2';
  }
  sql += ' RETURNING *';
  const result = await query(sql, params);
  return result.rows[0];
}

/**
 * Store or replace profile picture for a nostr account.
 * @param {number} accountId
 * @param {Buffer} pictureData
 * @param {string} pictureType
 * @returns {Promise<Object|undefined>}
 */
export async function updateNostrUserProfilePicture(accountId, pictureData, pictureType) {
  const result = await query(
    `INSERT INTO profile_pictures (account_id, content_type, data, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (account_id) DO UPDATE
     SET content_type = EXCLUDED.content_type,
         data = EXCLUDED.data,
         updated_at = EXCLUDED.updated_at
     RETURNING account_id`,
    [accountId, pictureType, pictureData]
  );
  return result.rows[0];
}

/**
 * Get profile picture for a nostr account by current public key.
 * @param {string} publicKey
 * @returns {Promise<Object|undefined>}
 */
export async function getNostrUserProfilePictureByPublicKey(publicKey) {
  const result = await query(
    `SELECT p.data AS profile_picture,
            p.content_type AS profile_picture_type,
            p.updated_at AS profile_picture_updated_at
     FROM nostr_users u
     JOIN profile_pictures p ON p.account_id = u.id
     WHERE u.public_key = $1`,
    [publicKey]
  );
  return result.rows[0];
}
