-- migrate:up
CREATE INDEX IF NOT EXISTS idx_nostr_users_tenant_registration_email
  ON nostr_users(tenant_domain, lower(registration_email))
  WHERE registration_email IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS idx_nostr_users_tenant_registration_email;
