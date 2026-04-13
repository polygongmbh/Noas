-- migrate:up
DO $$
BEGIN
  CREATE TYPE nostr_user_role AS ENUM ('admin', 'moderator', 'user');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE nostr_users
  ADD COLUMN IF NOT EXISTS role nostr_user_role NOT NULL DEFAULT 'user';

UPDATE nostr_users
SET role = 'user'
WHERE role IS NULL;

CREATE INDEX IF NOT EXISTS idx_nostr_users_role ON nostr_users(role);

-- migrate:down
DROP INDEX IF EXISTS idx_nostr_users_role;

ALTER TABLE nostr_users
  DROP COLUMN IF EXISTS role;

DROP TYPE IF EXISTS nostr_user_role;
