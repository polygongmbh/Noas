-- migrate:up
ALTER TABLE nip46_sessions
  DROP CONSTRAINT IF EXISTS nip46_sessions_user_id_fkey;

DELETE FROM nip46_sessions
WHERE user_id IS NOT NULL
  AND user_id NOT IN (SELECT id FROM nostr_users);

ALTER TABLE nip46_sessions
  ADD CONSTRAINT nip46_sessions_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES nostr_users(id)
  ON DELETE CASCADE;

-- migrate:down
ALTER TABLE nip46_sessions
  DROP CONSTRAINT IF EXISTS nip46_sessions_user_id_fkey;

ALTER TABLE nip46_sessions
  ADD CONSTRAINT nip46_sessions_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES users(id)
  ON DELETE CASCADE;
