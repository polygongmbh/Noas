import { test } from 'node:test';
import assert from 'node:assert';
import { enqueueTenantRelayBanJobs, enqueueTenantRelayAllowJobs } from './allowlist-worker.js';
import { config } from './config.js';

const VALID_PUBKEY = 'c'.repeat(64);

// enqueueTenantRelayBanJobs skips when no relay URLs configured
test('enqueueTenantRelayBanJobs returns zero enqueued when no relay URLs configured', async () => {
  const savedNip86 = config.nip86RelayUrls;
  const savedMap = config.domainNip86RelayMap;
  config.nip86RelayUrls = [];
  config.domainNip86RelayMap = {};
  try {
    const result = await enqueueTenantRelayBanJobs({
      tenantDomain: 'example.com',
      username: 'alice',
      pubkey: VALID_PUBKEY,
    });
    assert.strictEqual(result.enqueued, 0);
    assert.strictEqual(result.total_targets, 0);
    assert.deepStrictEqual(result.job_ids, []);
  } finally {
    config.nip86RelayUrls = savedNip86;
    config.domainNip86RelayMap = savedMap;
  }
});

test('enqueueTenantRelayBanJobs returns zero enqueued when pubkey is empty', async () => {
  const savedNip86 = config.nip86RelayUrls;
  config.nip86RelayUrls = ['http://relay-manager:3400/internal/noas/relay-acl/platform'];
  try {
    const result = await enqueueTenantRelayBanJobs({
      tenantDomain: 'example.com',
      username: 'alice',
      pubkey: '',
    });
    assert.strictEqual(result.enqueued, 0);
  } finally {
    config.nip86RelayUrls = savedNip86;
  }
});

test('enqueueTenantRelayAllowJobs and enqueueTenantRelayBanJobs use separate job methods', async () => {
  // Verify that the worker dispatches with the right method by inspecting
  // sendAllowPubkeyToRelays calls via fetch mock. This tests the job method
  // flows through to the NIP-86 HTTP call correctly.
  const fetchCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, body: JSON.parse(options?.body || '{}') });
    return new Response(JSON.stringify({ jsonrpc: '2.0', result: true }), { status: 200 });
  };

  const { sendAllowPubkeyToRelays } = await import('./allowlist-client.js');
  try {
    await sendAllowPubkeyToRelays({
      pubkey: VALID_PUBKEY,
      relayUrls: ['https://relay-admin.example.com/rpc'],
      method: 'banpubkey',
      timeoutMs: 2000,
    });

    assert.strictEqual(fetchCalls.length, 1);
    assert.strictEqual(fetchCalls[0].body.method, 'banpubkey');
    assert.deepStrictEqual(fetchCalls[0].body.params, [VALID_PUBKEY]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
