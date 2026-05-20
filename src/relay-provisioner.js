import { config } from './config.js';
import { sendAllowPubkeyToRelays } from './nip86.js';
import {
  enqueueRelayAllowJobRecord,
  claimDueRelayAllowJobs,
  markRelayAllowJobSucceeded,
  markRelayAllowJobFailed,
} from './db/relay-allow-jobs.js';

let workerTimer = null;
let workerRunning = false;

function getTenantRelayAdminUrls(tenantDomain) {
  const normalizedTenant = String(tenantDomain || '').trim().toLowerCase();
  const mapped = config.domainNip86RelayMap[normalizedTenant];
  if (Array.isArray(mapped) && mapped.length > 0) {
    return mapped;
  }
  return config.nip86RelayUrls;
}

function backoffSecondsForAttempt(attemptNumber) {
  const base = Math.max(1, config.relayAllowRetryBaseSeconds);
  const max = Math.max(base, config.relayAllowRetryMaxSeconds);
  const exponent = Math.max(0, Number(attemptNumber) || 0);
  return Math.min(max, base * (2 ** exponent));
}

export async function enqueueTenantRelayAllowJobs({ tenantDomain, username, pubkey }) {
  const relayUrls = getTenantRelayAdminUrls(tenantDomain);
  if (!pubkey || relayUrls.length === 0) {
    return { enqueued: 0, total_targets: relayUrls.length, job_ids: [] };
  }

  const results = await Promise.all(
    relayUrls.map((relayUrl) => enqueueRelayAllowJobRecord({
      tenantDomain,
      username,
      pubkey,
      relayUrl,
      maxAttempts: config.relayAllowMaxAttempts,
    }))
  );

  const jobIds = results.map((result) => result.job?.id).filter(Boolean);
  const enqueuedCount = results.filter((result) => result.enqueued).length;
  return {
    enqueued: enqueuedCount,
    total_targets: relayUrls.length,
    job_ids: jobIds,
  };
}

export async function enqueueRelayAllowJobForRelayUrl({
  tenantDomain,
  username,
  pubkey,
  relayUrl,
}) {
  const result = await enqueueRelayAllowJobRecord({
    tenantDomain,
    username,
    pubkey,
    relayUrl,
    maxAttempts: config.relayAllowMaxAttempts,
  });
  return {
    enqueued: Boolean(result.enqueued),
    job_id: result.job?.id || null,
  };
}

export async function processRelayAllowJobsTick({ limit = config.relayAllowWorkerBatchSize } = {}) {
  const claimed = await claimDueRelayAllowJobs({ limit });
  let succeeded = 0;
  let retrying = 0;
  let failed = 0;

  for (const job of claimed) {
    try {
      const results = await sendAllowPubkeyToRelays({
        pubkey: job.pubkey,
        relayUrls: [job.relay_url],
        method: config.nip86Method,
        timeoutMs: config.nip86TimeoutMs,
      });
      const outcome = results[0] || null;
      if (outcome?.success) {
        await markRelayAllowJobSucceeded(job.id);
        succeeded += 1;
        continue;
      }
      const errorMessage = outcome?.error || `http_status_${outcome?.status_code || 'unknown'}`;
      const delay = backoffSecondsForAttempt((job.attempts || 0) + 1);
      await markRelayAllowJobFailed({ jobId: job.id, error: errorMessage, retryDelaySeconds: delay });
      if ((job.attempts || 0) + 1 >= (job.max_attempts || config.relayAllowMaxAttempts)) {
        failed += 1;
      } else {
        retrying += 1;
      }
    } catch (error) {
      const delay = backoffSecondsForAttempt((job.attempts || 0) + 1);
      await markRelayAllowJobFailed({
        jobId: job.id,
        error: error?.message || 'request_failed',
        retryDelaySeconds: delay,
      });
      if ((job.attempts || 0) + 1 >= (job.max_attempts || config.relayAllowMaxAttempts)) {
        failed += 1;
      } else {
        retrying += 1;
      }
    }
  }

  return {
    processed: claimed.length,
    succeeded,
    retrying,
    failed,
  };
}

async function runWorkerIteration() {
  if (workerRunning) return;
  workerRunning = true;
  try {
    const summary = await processRelayAllowJobsTick();
    if (summary.processed > 0) {
      console.log('relay allow worker tick summary', summary);
    }
  } catch (error) {
    console.warn('relay allow worker tick failed', {
      error: error?.message || String(error),
    });
  } finally {
    workerRunning = false;
  }
}

export function startRelayAllowWorker() {
  if (!config.relayAllowWorkerEnabled) {
    return { started: false, reason: 'disabled' };
  }
  if (workerTimer) {
    return { started: true, already_started: true };
  }

  workerTimer = setInterval(runWorkerIteration, config.relayAllowWorkerIntervalMs);
  if (typeof workerTimer.unref === 'function') {
    workerTimer.unref();
  }
  runWorkerIteration().catch(() => {});
  return { started: true, interval_ms: config.relayAllowWorkerIntervalMs };
}
