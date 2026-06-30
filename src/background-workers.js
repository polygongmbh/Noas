import { config } from './config.js';
import { deleteExpiredPendingNostrUsers } from './db/users.js';
import { runRelaySyncTick } from './allowlist-sync.js';

function createIntervalWorker({ name, enabled, intervalMs, runTick, shouldLogSummary }) {
  let timer = null;
  let running = false;

  async function runIteration() {
    if (running) return;
    running = true;
    try {
      const summary = await runTick();
      if (!shouldLogSummary || shouldLogSummary(summary)) {
        console.log(`${name} worker tick summary`, summary);
      }
    } catch (error) {
      console.warn(`${name} worker tick failed`, {
        error: error?.message || String(error),
      });
    } finally {
      running = false;
    }
  }

  function start() {
    if (!enabled) {
      return { started: false, reason: 'disabled' };
    }
    if (timer) {
      return { started: true, already_started: true, interval_ms: intervalMs };
    }
    timer = setInterval(runIteration, intervalMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    runIteration().catch(() => {});
    return { started: true, interval_ms: intervalMs };
  }

  return { start };
}

async function runRetentionTick() {
  const deletedUnverifiedUsers = await deleteExpiredPendingNostrUsers(config.verificationExpiryMinutes);
  return {
    deleted_unverified_users: deletedUnverifiedUsers,
  };
}

async function runQuotaTick() {
  return {
    processed: 0,
    violations: 0,
    mode: 'noop',
  };
}

async function runReconcileTick() {
  return {
    checked: 0,
    repaired: 0,
    mode: 'noop',
  };
}

const retentionWorker = createIntervalWorker({
  name: 'retention',
  enabled: config.retentionWorkerEnabled,
  intervalMs: config.retentionWorkerIntervalMs,
  runTick: runRetentionTick,
  shouldLogSummary: (summary) => summary.deleted_unverified_users > 0,
});

const quotaWorker = createIntervalWorker({
  name: 'quota',
  enabled: config.quotaWorkerEnabled,
  intervalMs: config.quotaWorkerIntervalMs,
  runTick: runQuotaTick,
  shouldLogSummary: (summary) => summary.violations > 0,
});

const reconcileWorker = createIntervalWorker({
  name: 'reconcile',
  enabled: config.reconcileWorkerEnabled,
  intervalMs: config.reconcileWorkerIntervalMs,
  runTick: runReconcileTick,
  shouldLogSummary: (summary) => summary.repaired > 0,
});

const relaySyncWorker = createIntervalWorker({
  name: 'relay-sync',
  enabled: config.relaySyncWorkerEnabled && Object.keys(config.domainRelayUsernameMap).length > 0,
  intervalMs: config.relaySyncWorkerIntervalMs,
  runTick: runRelaySyncTick,
  shouldLogSummary: (summary) => (summary.allows_enqueued || 0) > 0 || (summary.bans_enqueued || 0) > 0,
});

export function startBackgroundWorkers() {
  return {
    retention: retentionWorker.start(),
    quota: quotaWorker.start(),
    reconcile: reconcileWorker.start(),
    relay_sync: relaySyncWorker.start(),
  };
}
