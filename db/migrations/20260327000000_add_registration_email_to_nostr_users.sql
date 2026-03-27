-- migrate:up
ALTER TABLE nostr_users
  ADD COLUMN IF NOT EXISTS registration_email TEXT;

-- migrate:down
ALTER TABLE nostr_users
  DROP COLUMN IF EXISTS registration_email;
