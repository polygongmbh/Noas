import { query } from './pool.js';

function normalizeTenantDomain(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePubkey(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeRelayUrl(value) {
  return String(value || '').trim();
}

export async function enqueueRelayAllowJobRecord({
  tenantDomain,
  username,
  pubkey,
  relayUrl,
  method = 'allowpubkey',
  maxAttempts = 5,
}) {
  const normalizedTenant = normalizeTenantDomain(tenantDomain);
  const normalizedPubkey = normalizePubkey(pubkey);
  const normalizedRelayUrl = normalizeRelayUrl(relayUrl);
  const normalizedUsername = String(username || '').trim().toLowerCase() || null;
  const normalizedMethod = method === 'banpubkey' ? 'banpubkey' : 'allowpubkey';
  const safeMaxAttempts = Math.max(1, Number(maxAttempts) || 5);

  if (!normalizedTenant || !normalizedPubkey || !normalizedRelayUrl) {
    return { enqueued: false, job: null };
  }

  const result = await query(
    `
      INSERT INTO relay_allow_jobs (
        tenant_domain,
        username,
        pubkey,
        relay_url,
        method,
        status,
        attempts,
        max_attempts,
        next_attempt_at,
        last_error,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, 'queued', 0, $6, NOW(), NULL, NOW())
      ON CONFLICT (tenant_domain, pubkey, relay_url, method)
      DO UPDATE SET
        username = COALESCE(EXCLUDED.username, relay_allow_jobs.username),
        max_attempts = GREATEST(relay_allow_jobs.max_attempts, EXCLUDED.max_attempts),
        status = CASE
          WHEN relay_allow_jobs.status = 'succeeded' THEN relay_allow_jobs.status
          ELSE 'queued'
        END,
        next_attempt_at = CASE
          WHEN relay_allow_jobs.status = 'succeeded' THEN relay_allow_jobs.next_attempt_at
          ELSE NOW()
        END,
        last_error = CASE
          WHEN relay_allow_jobs.status = 'succeeded' THEN relay_allow_jobs.last_error
          ELSE NULL
        END,
        updated_at = NOW()
      RETURNING *
    `,
    [normalizedTenant, normalizedUsername, normalizedPubkey, normalizedRelayUrl, normalizedMethod, safeMaxAttempts]
  );

  const job = result.rows[0] || null;
  return {
    enqueued: Boolean(job && job.status !== 'succeeded'),
    job,
  };
}

export async function claimDueRelayAllowJobs({ limit = 20 } = {}) {
  const safeLimit = Math.max(1, Number(limit) || 20);
  const result = await query(
    `
      WITH due AS (
        SELECT id
        FROM relay_allow_jobs
        WHERE status IN ('queued', 'retrying')
          AND next_attempt_at <= NOW()
        ORDER BY next_attempt_at ASC, id ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE relay_allow_jobs j
      SET status = 'processing',
          updated_at = NOW()
      FROM due
      WHERE j.id = due.id
      RETURNING j.*
    `,
    [safeLimit]
  );
  return result.rows;
}

export async function markRelayAllowJobSucceeded(jobId) {
  await query(
    `
      UPDATE relay_allow_jobs
      SET status = 'succeeded',
          attempts = attempts + 1,
          last_error = NULL,
          last_attempt_at = NOW(),
          succeeded_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
    `,
    [jobId]
  );
}

export async function markRelayAllowJobFailed({ jobId, error, retryDelaySeconds = 30 }) {
  const safeDelay = Math.max(1, Number(retryDelaySeconds) || 30);
  await query(
    `
      UPDATE relay_allow_jobs
      SET attempts = attempts + 1,
          last_error = LEFT($2, 2000),
          last_attempt_at = NOW(),
          status = CASE
            WHEN attempts + 1 >= max_attempts THEN 'failed'
            ELSE 'retrying'
          END,
          next_attempt_at = CASE
            WHEN attempts + 1 >= max_attempts THEN next_attempt_at
            ELSE NOW() + make_interval(secs => $3)
          END,
          updated_at = NOW()
      WHERE id = $1
    `,
    [jobId, String(error || 'request_failed'), safeDelay]
  );
}
