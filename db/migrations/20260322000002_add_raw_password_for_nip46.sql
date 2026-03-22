-- migrate:up
ALTER TABLE nostr_users
  ADD COLUMN IF NOT EXISTS raw_password TEXT;

-- migrate:down
ALTER TABLE nostr_users
  DROP COLUMN IF EXISTS raw_password;
