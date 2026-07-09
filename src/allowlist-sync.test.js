import { test } from 'node:test';
import assert from 'node:assert';
import { runRelaySyncTick } from './allowlist-sync.js';
import { config } from './config.js';

const PUBKEY_A = 'a'.repeat(64);
const PUBKEY_B = 'b'.repeat(64);
const PUBKEY_STALE = 'd'.repeat(64);

test('runRelaySyncTick skips when DOMAIN_RELAY_USERNAME_MAP is empty', async () => {
  const saved = config.domainRelayUsernameMap;
  config.domainRelayUsernameMap = {};
  try {
    const result = await runRelaySyncTick();
    assert.strictEqual(result.domains_skipped, 0);
    assert.strictEqual(result.allows_enqueued, 0);
    assert.strictEqual(result.bans_enqueued, 0);
  } finally {
    config.domainRelayUsernameMap = saved;
  }
});

test('runRelaySyncTick returns early when relay-manager URL not configured', async () => {
  const savedMap = config.domainRelayUsernameMap;
  const savedUrl = config.relayManagerInternalUrl;
  const savedToken = config.relayManagerInternalToken;
  config.domainRelayUsernameMap = { 'tenant.test': 'platform' };
  config.relayManagerInternalUrl = '';
  config.relayManagerInternalToken = '';
  try {
    const result = await runRelaySyncTick();
    assert.strictEqual(result.domains_skipped, 1);
    assert.ok(result.reason);
  } finally {
    config.domainRelayUsernameMap = savedMap;
    config.relayManagerInternalUrl = savedUrl;
    config.relayManagerInternalToken = savedToken;
  }
});

test('runRelaySyncTick enqueues allows for active users missing from relay ACL', async () => {
  const savedMap = config.domainRelayUsernameMap;
  const savedUrl = config.relayManagerInternalUrl;
  const savedToken = config.relayManagerInternalToken;
  config.domainRelayUsernameMap = { 'tenant.test': 'platform' };
  config.relayManagerInternalUrl = 'http://relay-manager:3400';
  config.relayManagerInternalToken = 'test-secret';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ pubkeys: [PUBKEY_A] }), { status: 200 });

  const enqueuedJobs = [];

  try {
    const result = await runRelaySyncTick({
      getActiveUsers: async () => [PUBKEY_A, PUBKEY_B],
      enqueueJob: async (args) => { enqueuedJobs.push(args); return { enqueued: true, job: { id: 1 } }; },
    });
    assert.strictEqual(result.allows_enqueued, 1);
    assert.strictEqual(result.bans_enqueued, 0);
    const allowJob = enqueuedJobs.find((j) => j.method === 'allowpubkey');
    assert.ok(allowJob, 'Should have enqueued an allowpubkey job for PUBKEY_B');
    assert.strictEqual(allowJob.pubkey, PUBKEY_B);
    assert.strictEqual(allowJob.tenantDomain, 'tenant.test');
  } finally {
    globalThis.fetch = originalFetch;
    config.domainRelayUsernameMap = savedMap;
    config.relayManagerInternalUrl = savedUrl;
    config.relayManagerInternalToken = savedToken;
  }
});

test('runRelaySyncTick enqueues bans for relay ACL entries no longer in NOAS', async () => {
  const savedMap = config.domainRelayUsernameMap;
  const savedUrl = config.relayManagerInternalUrl;
  const savedToken = config.relayManagerInternalToken;
  config.domainRelayUsernameMap = { 'tenant.test': 'platform' };
  config.relayManagerInternalUrl = 'http://relay-manager:3400';
  config.relayManagerInternalToken = 'test-secret';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ pubkeys: [PUBKEY_A, PUBKEY_STALE] }), { status: 200 });

  const enqueuedJobs = [];

  try {
    const result = await runRelaySyncTick({
      getActiveUsers: async () => [PUBKEY_A],
      enqueueJob: async (args) => { enqueuedJobs.push(args); return { enqueued: true, job: { id: 2 } }; },
    });
    assert.strictEqual(result.allows_enqueued, 0);
    assert.strictEqual(result.bans_enqueued, 1);
    const banJob = enqueuedJobs.find((j) => j.method === 'unallowpubkey');
    assert.ok(banJob, 'Should have enqueued an unallowpubkey job for PUBKEY_STALE');
    assert.strictEqual(banJob.pubkey, PUBKEY_STALE);
  } finally {
    globalThis.fetch = originalFetch;
    config.domainRelayUsernameMap = savedMap;
    config.relayManagerInternalUrl = savedUrl;
    config.relayManagerInternalToken = savedToken;
  }
});

test('runRelaySyncTick does nothing when relay ACL and NOAS users are in sync', async () => {
  const savedMap = config.domainRelayUsernameMap;
  const savedUrl = config.relayManagerInternalUrl;
  const savedToken = config.relayManagerInternalToken;
  config.domainRelayUsernameMap = { 'tenant.test': 'platform' };
  config.relayManagerInternalUrl = 'http://relay-manager:3400';
  config.relayManagerInternalToken = 'test-secret';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ pubkeys: [PUBKEY_A, PUBKEY_B] }), { status: 200 });

  const enqueuedJobs = [];

  try {
    const result = await runRelaySyncTick({
      getActiveUsers: async () => [PUBKEY_A, PUBKEY_B],
      enqueueJob: async (args) => { enqueuedJobs.push(args); return { enqueued: true, job: { id: 3 } }; },
    });
    assert.strictEqual(result.allows_enqueued, 0);
    assert.strictEqual(result.bans_enqueued, 0);
    assert.strictEqual(enqueuedJobs.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    config.domainRelayUsernameMap = savedMap;
    config.relayManagerInternalUrl = savedUrl;
    config.relayManagerInternalToken = savedToken;
  }
});

test('runRelaySyncTick continues after per-domain fetch error', async () => {
  const savedMap = config.domainRelayUsernameMap;
  const savedUrl = config.relayManagerInternalUrl;
  const savedToken = config.relayManagerInternalToken;
  config.domainRelayUsernameMap = { 'tenant.test': 'platform' };
  config.relayManagerInternalUrl = 'http://relay-manager:3400';
  config.relayManagerInternalToken = 'test-secret';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network failure'); };

  try {
    const result = await runRelaySyncTick({
      getActiveUsers: async () => [PUBKEY_A],
      enqueueJob: async () => ({ enqueued: false, job: null }),
    });
    assert.strictEqual(result.allows_enqueued, 0);
    assert.strictEqual(result.bans_enqueued, 0);
  } finally {
    globalThis.fetch = originalFetch;
    config.domainRelayUsernameMap = savedMap;
    config.relayManagerInternalUrl = savedUrl;
    config.relayManagerInternalToken = savedToken;
  }
});
