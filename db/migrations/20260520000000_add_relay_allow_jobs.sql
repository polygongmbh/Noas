-- migrate:up
CREATE TABLE IF NOT EXISTS relay_allow_jobs (
  id BIGSERIAL PRIMARY KEY,
  tenant_domain TEXT NOT NULL,
  username VARCHAR(32),
  pubkey VARCHAR(64) NOT NULL,
  relay_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'retrying', 'processing', 'succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  last_attempt_at TIMESTAMPTZ,
  succeeded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_domain, pubkey, relay_url)
);

CREATE INDEX IF NOT EXISTS idx_relay_allow_jobs_due
  ON relay_allow_jobs (next_attempt_at)
  WHERE status IN ('queued', 'retrying');

CREATE INDEX IF NOT EXISTS idx_relay_allow_jobs_status
  ON relay_allow_jobs (status);

-- migrate:down
DROP TABLE IF EXISTS relay_allow_jobs;
