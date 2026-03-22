/**
 * Database Setup Script
 *
 * Creates the current database schema for Noas.
 */

import { pool } from './pool.js';

const schema = `
DO $$
BEGIN
  CREATE TYPE nostr_user_status AS ENUM ('unverified_email', 'active', 'disabled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS nostr_users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(32) UNIQUE NOT NULL,
  password_sha256 TEXT NOT NULL,
  public_key TEXT,
  private_key_encrypted TEXT,
  relays JSONB DEFAULT '[]'::jsonb,
  status nostr_user_status NOT NULL DEFAULT 'unverified_email',
  verification_token UUID UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT nostr_username_format CHECK (username ~ '^[a-z0-9._-]{3,32}$')
);

CREATE INDEX IF NOT EXISTS idx_nostr_users_username ON nostr_users(username);
CREATE INDEX IF NOT EXISTS idx_nostr_users_public_key ON nostr_users(public_key) WHERE public_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nostr_users_unverified_created_at ON nostr_users(created_at) WHERE status = 'unverified_email';
CREATE INDEX IF NOT EXISTS idx_nostr_users_verification_token ON nostr_users(verification_token) WHERE verification_token IS NOT NULL;

ALTER TABLE nostr_users
  DROP CONSTRAINT IF EXISTS nostr_username_format;

ALTER TABLE nostr_users
  ADD CONSTRAINT nostr_username_format CHECK (username ~ '^[a-z0-9._-]{3,32}$');

ALTER TABLE nostr_users
  ADD COLUMN IF NOT EXISTS relays JSONB DEFAULT '[]'::jsonb;

ALTER TABLE nostr_users
  RENAME COLUMN password_hash TO password_sha256;

ALTER TABLE nostr_users
  ALTER COLUMN verification_token TYPE UUID USING verification_token::uuid;

ALTER TABLE nostr_users
  DROP COLUMN IF EXISTS last_resend_at;

DROP INDEX IF EXISTS idx_nostr_users_public_key;
DROP INDEX IF EXISTS idx_nostr_users_status_created_at;
DROP INDEX IF EXISTS idx_nostr_users_public_key_unique;

CREATE INDEX IF NOT EXISTS idx_nostr_users_public_key ON nostr_users(public_key) WHERE public_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nostr_users_unverified_created_at ON nostr_users(created_at) WHERE status = 'unverified_email';
CREATE INDEX IF NOT EXISTS idx_nostr_users_verification_token ON nostr_users(verification_token) WHERE verification_token IS NOT NULL;

DROP TABLE IF EXISTS user_onboarding;
DROP TABLE IF EXISTS used_verification_tokens;

ALTER TABLE nostr_users
  DROP COLUMN IF EXISTS verification_expires_at;

CREATE TABLE IF NOT EXISTS profile_pictures (
  account_id INTEGER PRIMARY KEY REFERENCES nostr_users(id) ON DELETE CASCADE,
  content_type VARCHAR(100) NOT NULL,
  data BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profile_pictures_updated_at ON profile_pictures(updated_at);

ALTER TABLE nostr_users
  DROP COLUMN IF EXISTS profile_picture_updated_at;

ALTER TABLE nostr_users
  DROP COLUMN IF EXISTS profile_picture_type;

ALTER TABLE nostr_users
  DROP COLUMN IF EXISTS profile_picture;

CREATE TABLE IF NOT EXISTS nip46_sessions (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(64) UNIQUE NOT NULL,
  user_id INTEGER REFERENCES nostr_users(id) ON DELETE CASCADE,
  client_pubkey VARCHAR(64) NOT NULL,
  remote_signer_pubkey VARCHAR(64) NOT NULL,
  secret VARCHAR(64),
  permissions TEXT[],
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'disconnected')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours')
);

CREATE TABLE IF NOT EXISTS nip46_requests (
  id SERIAL PRIMARY KEY,
  request_id VARCHAR(64) UNIQUE NOT NULL,
  session_id VARCHAR(64) REFERENCES nip46_sessions(session_id) ON DELETE CASCADE,
  method VARCHAR(50) NOT NULL,
  params JSONB,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'expired')),
  response JSONB,
  error TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '5 minutes')
);

CREATE INDEX IF NOT EXISTS idx_nip46_sessions_session_id ON nip46_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_nip46_sessions_user_id ON nip46_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_nip46_sessions_client_pubkey ON nip46_sessions(client_pubkey);
CREATE INDEX IF NOT EXISTS idx_nip46_sessions_status ON nip46_sessions(status);
CREATE INDEX IF NOT EXISTS idx_nip46_requests_request_id ON nip46_requests(request_id);
CREATE INDEX IF NOT EXISTS idx_nip46_requests_session_id ON nip46_requests(session_id);
CREATE INDEX IF NOT EXISTS idx_nip46_requests_status ON nip46_requests(status);

DROP TABLE IF EXISTS users;
`;

async function setup() {
  try {
    console.log('Setting up database...');
    await pool.query(schema);
    console.log('Database setup complete');
    await pool.end();
  } catch (error) {
    console.error('Database setup failed:', error);
    process.exit(1);
  }
}

setup();
