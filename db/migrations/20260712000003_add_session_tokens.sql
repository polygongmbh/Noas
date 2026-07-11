-- migrate:up
CREATE TABLE IF NOT EXISTS session_tokens (
  id BIGSERIAL PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES nostr_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_tokens_user_id ON session_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_session_tokens_expires_at ON session_tokens(expires_at);

-- migrate:down
DROP TABLE IF EXISTS session_tokens;
