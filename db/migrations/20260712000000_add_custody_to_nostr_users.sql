-- migrate:up
DO $$
BEGIN
  CREATE TYPE nostr_user_custody AS ENUM ('password', 'master_key');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE nostr_users
  ADD COLUMN IF NOT EXISTS custody nostr_user_custody NOT NULL DEFAULT 'password';

-- migrate:down
ALTER TABLE nostr_users
  DROP COLUMN IF EXISTS custody;

DROP TYPE IF EXISTS nostr_user_custody;
