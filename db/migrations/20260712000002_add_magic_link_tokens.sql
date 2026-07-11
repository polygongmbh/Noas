-- migrate:up
CREATE TABLE IF NOT EXISTS magic_link_tokens (
  id BIGSERIAL PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES nostr_users(id) ON DELETE CASCADE,
  tenant_domain TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'confirm')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_user_id ON magic_link_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_expires_at ON magic_link_tokens(expires_at);

-- migrate:down
DROP TABLE IF EXISTS magic_link_tokens;
