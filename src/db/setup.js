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

-- Pending onboarding records for secure two-step signup
CREATE TABLE IF NOT EXISTS user_onboarding (
  id SERIAL PRIMARY KEY,
  username VARCHAR(32) UNIQUE NOT NULL,
  email VARCHAR(320) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  relays JSONB DEFAULT '[]'::jsonb,
  email_verification_token VARCHAR(128) NOT NULL,
  email_verification_pin_hash VARCHAR(255) NOT NULL,
  email_verification_expires_at TIMESTAMP NOT NULL,
  email_verified_at TIMESTAMP,
  pin_attempt_count INTEGER NOT NULL DEFAULT 0,
  verification_origin TEXT,
  public_key VARCHAR(64),
  encrypted_private_key TEXT,
  last_email_sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT onboarding_username_format CHECK (username ~ '^[a-z0-9._-]{3,32}$')
);

CREATE INDEX IF NOT EXISTS idx_user_onboarding_username ON user_onboarding(username);
CREATE INDEX IF NOT EXISTS idx_user_onboarding_email ON user_onboarding(email);
CREATE INDEX IF NOT EXISTS idx_user_onboarding_expires ON user_onboarding(email_verification_expires_at);
CREATE INDEX IF NOT EXISTS idx_user_onboarding_token ON user_onboarding(email_verification_token);

ALTER TABLE user_onboarding
  DROP CONSTRAINT IF EXISTS onboarding_username_format;

ALTER TABLE user_onboarding
  ADD CONSTRAINT onboarding_username_format CHECK (username ~ '^[a-z0-9._-]{3,32}$');

ALTER TABLE user_onboarding
  ADD COLUMN IF NOT EXISTS verification_origin TEXT;

ALTER TABLE user_onboarding
  ADD COLUMN IF NOT EXISTS public_key VARCHAR(64);

ALTER TABLE user_onboarding
  ADD COLUMN IF NOT EXISTS encrypted_private_key TEXT;

ALTER TABLE user_onboarding
  ADD COLUMN IF NOT EXISTS last_email_sent_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS used_verification_tokens (
  token VARCHAR(128) PRIMARY KEY,
  used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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
