/**
 * Database Setup Script
 * 
 * Creates the database schema (tables, indexes, constraints).
 * Run this once after creating the database: npm run db:setup
 */

import { pool } from './pool.js';

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(32) UNIQUE NOT NULL,
  public_key VARCHAR(64) NOT NULL,
  encrypted_private_key TEXT NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email VARCHAR(320),
  email_verified_at TIMESTAMP,
  email_verification_token VARCHAR(128),
  email_verification_expires_at TIMESTAMP,
  relays JSONB DEFAULT '[]'::jsonb,
  profile_picture BYTEA,
  profile_picture_type VARCHAR(100),
  profile_picture_updated_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT username_format CHECK (username ~ '^[a-z0-9._-]{3,32}$')
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_public_key ON users(public_key);

DO $$
BEGIN
  CREATE TYPE nostr_user_status AS ENUM ('unverified_email', 'active', 'disabled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS nostr_users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(32) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  public_key TEXT,
  private_key_encrypted TEXT,
  relays JSONB DEFAULT '[]'::jsonb,
  status nostr_user_status NOT NULL DEFAULT 'unverified_email',
  verification_token TEXT UNIQUE,
  last_resend_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT nostr_username_format CHECK (username ~ '^[a-z0-9._-]{3,32}$')
);

CREATE INDEX IF NOT EXISTS idx_nostr_users_username ON nostr_users(username);
CREATE INDEX IF NOT EXISTS idx_nostr_users_public_key ON nostr_users(public_key);
CREATE INDEX IF NOT EXISTS idx_nostr_users_status_created_at ON nostr_users(status, created_at);
CREATE INDEX IF NOT EXISTS idx_nostr_users_verification_token ON nostr_users(verification_token);

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS username_format;

ALTER TABLE users
  ADD CONSTRAINT username_format CHECK (username ~ '^[a-z0-9._-]{3,32}$');

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_picture BYTEA;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_picture_type VARCHAR(100);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_picture_updated_at TIMESTAMP;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email VARCHAR(320);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verification_token VARCHAR(128);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMP;

ALTER TABLE nostr_users
  DROP CONSTRAINT IF EXISTS nostr_username_format;

ALTER TABLE nostr_users
  ADD CONSTRAINT nostr_username_format CHECK (username ~ '^[a-z0-9._-]{3,32}$');

ALTER TABLE nostr_users
  ADD COLUMN IF NOT EXISTS relays JSONB DEFAULT '[]'::jsonb;

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

INSERT INTO profile_pictures (account_id, content_type, data, updated_at)
SELECT id, profile_picture_type, profile_picture, COALESCE(profile_picture_updated_at, NOW())
FROM nostr_users
WHERE profile_picture IS NOT NULL
ON CONFLICT (account_id) DO UPDATE
SET content_type = EXCLUDED.content_type,
    data = EXCLUDED.data,
    updated_at = EXCLUDED.updated_at;

CREATE INDEX IF NOT EXISTS idx_profile_pictures_updated_at ON profile_pictures(updated_at);

ALTER TABLE nostr_users
  DROP COLUMN IF EXISTS profile_picture_updated_at;

ALTER TABLE nostr_users
  DROP COLUMN IF EXISTS profile_picture_type;

ALTER TABLE nostr_users
  DROP COLUMN IF EXISTS profile_picture;

-- NIP-46 Remote Signer tables
CREATE TABLE IF NOT EXISTS nip46_sessions (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(64) UNIQUE NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  client_pubkey VARCHAR(64) NOT NULL,
  remote_signer_pubkey VARCHAR(64) NOT NULL,
  secret VARCHAR(64),
  permissions TEXT[], -- array of allowed methods/permissions
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
`;

/**
 * Set up the database schema
 * Creates tables and indexes if they don't exist
 */
async function setup() {
  try {
    console.log('Setting up database...');
    await pool.query(schema);
    console.log('✓ Database setup complete');
    await pool.end();
  } catch (error) {
    console.error('Database setup failed:', error);
    process.exit(1);
  }
}

setup();
