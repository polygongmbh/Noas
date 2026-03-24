-- migrate:up
ALTER TABLE nostr_users
  ADD COLUMN IF NOT EXISTS tenant_domain TEXT NOT NULL DEFAULT '';

UPDATE nostr_users
SET tenant_domain = ''
WHERE tenant_domain IS NULL;

ALTER TABLE nostr_users
  DROP CONSTRAINT IF EXISTS nostr_users_username_key;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_nostr_users_username'
  ) THEN
    DROP INDEX idx_nostr_users_username;
  END IF;
END $$;

ALTER TABLE nostr_users
  ADD CONSTRAINT nostr_users_tenant_username_key UNIQUE (tenant_domain, username);

CREATE INDEX IF NOT EXISTS idx_nostr_users_tenant_username ON nostr_users(tenant_domain, username);
CREATE INDEX IF NOT EXISTS idx_nostr_users_username ON nostr_users(username);

-- migrate:down
ALTER TABLE nostr_users
  DROP CONSTRAINT IF EXISTS nostr_users_tenant_username_key;

ALTER TABLE nostr_users
  ADD CONSTRAINT nostr_users_username_key UNIQUE (username);
DROP INDEX IF EXISTS idx_nostr_users_tenant_username;

ALTER TABLE nostr_users
  DROP COLUMN IF EXISTS tenant_domain;
