-- migrate:up
ALTER TABLE relay_allow_jobs
  ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'allowpubkey'
    CHECK (method IN ('allowpubkey', 'banpubkey'));

-- Replace unique constraint to include method so allow and ban can coexist in queue
ALTER TABLE relay_allow_jobs
  DROP CONSTRAINT IF EXISTS relay_allow_jobs_tenant_domain_pubkey_relay_url_key;

ALTER TABLE relay_allow_jobs
  ADD CONSTRAINT relay_allow_jobs_tenant_domain_pubkey_relay_url_method_key
    UNIQUE (tenant_domain, pubkey, relay_url, method);

-- migrate:down
ALTER TABLE relay_allow_jobs
  DROP CONSTRAINT IF EXISTS relay_allow_jobs_tenant_domain_pubkey_relay_url_method_key;

ALTER TABLE relay_allow_jobs
  ADD CONSTRAINT relay_allow_jobs_tenant_domain_pubkey_relay_url_key
    UNIQUE (tenant_domain, pubkey, relay_url);

ALTER TABLE relay_allow_jobs
  DROP COLUMN IF EXISTS method;
