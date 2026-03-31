import { test } from 'node:test';
import assert from 'node:assert';
import { sendAllowPubkeyToRelays } from './nip86.js';

test('sendAllowPubkeyToRelays posts JSON-RPC allowpubkey requests', async () => {
  const fetchCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return new Response(JSON.stringify({ jsonrpc: '2.0', result: true, id: '1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const results = await sendAllowPubkeyToRelays({
      pubkey: 'A'.repeat(64),
      relayUrls: ['https://relay-admin.example.com/rpc'],
      method: 'allowpubkey',
      timeoutMs: 2000,
    });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].relay_url, 'https://relay-admin.example.com/rpc');
    assert.strictEqual(results[0].success, true);
    assert.strictEqual(fetchCalls.length, 1);
    assert.strictEqual(fetchCalls[0].url, 'https://relay-admin.example.com/rpc');

    const payload = JSON.parse(fetchCalls[0].options.body);
    assert.strictEqual(payload.jsonrpc, '2.0');
    assert.strictEqual(payload.method, 'allowpubkey');
    assert.deepStrictEqual(payload.params, ['a'.repeat(64)]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sendAllowPubkeyToRelays returns failures for network errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('dial failure');
  };

  try {
    const results = await sendAllowPubkeyToRelays({
      pubkey: 'b'.repeat(64),
      relayUrls: ['https://relay-admin.example.com/rpc'],
      method: 'allowpubkey',
      timeoutMs: 2000,
    });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].success, false);
    assert.strictEqual(results[0].status_code, null);
    assert.strictEqual(results[0].error, 'dial failure');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

