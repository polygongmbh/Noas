-- migrate:up
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

CREATE TABLE IF NOT EXISTS profile_pictures (
  account_id INTEGER PRIMARY KEY REFERENCES nostr_users(id) ON DELETE CASCADE,
  content_type VARCHAR(100) NOT NULL,
  data BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profile_pictures_updated_at ON profile_pictures(updated_at);

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

-- migrate:down
DROP TABLE IF EXISTS nip46_requests;
DROP TABLE IF EXISTS nip46_sessions;
DROP TABLE IF EXISTS profile_pictures;
DROP TABLE IF EXISTS nostr_users;
DROP TYPE IF EXISTS nostr_user_status;
