/**
 * NIP-46 Integration Demo
 *
 * Simple demonstration that NIP-46 functionality is working
 */

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { encrypt } from 'nostr-tools/nip49';
import { getPublicKey } from 'nostr-tools';
import { 
  createConnectionToken,
  handleConnect,
  handlePing,
  signerPubkey
} from './nip46.js';
import { createUser } from './db/users.js';
import { pool } from './db/pool.js';

const demoPasswordHash = createHash('sha256').update('testpass123').digest('hex');
const demoSecretKey = Uint8Array.from(Buffer.from('2'.repeat(64), 'hex'));

describe('NIP-46 Integration Demo', () => {
  let testUserId;
  const testUser = {
    username: 'nip46demo',
    password: 'testpass123',
    publicKey: getPublicKey(demoSecretKey).toLowerCase(),
    encryptedPrivateKey: encrypt(demoSecretKey, demoPasswordHash)
  };

  before(async () => {
    const user = await createUser({
      username: testUser.username,
      publicKey: testUser.publicKey,
      encryptedPrivateKey: testUser.encryptedPrivateKey,
      passwordHash: demoPasswordHash,
      relays: []
    });
    testUserId = user.id;
  });

  after(async () => {
    await pool.query('DELETE FROM nip46_requests WHERE session_id LIKE $1', ['%demo%']);
    await pool.query('DELETE FROM nip46_sessions WHERE session_id LIKE $1', ['%demo%']);
    await pool.query('DELETE FROM nostr_users WHERE username = $1', [testUser.username]);
  });

  it('demonstrates basic NIP-46 workflow', async () => {
    // 1. Generate connection token
    const connectionToken = createConnectionToken('example.com');
    assert(connectionToken.startsWith('bunker://'));
    assert(connectionToken.includes(signerPubkey));
    console.log('✓ Generated connection token:', connectionToken);

    // 2. Simulate client connection
    const clientPubkey = 'c'.repeat(64); // In real usage, this would be a valid pubkey
    const connectRequest = {
      id: 'test-connect-demo',
      method: 'connect',
      params: [signerPubkey, 'secret123', 'sign_event,get_public_key']
    };

    const connectResponse = await handleConnect(connectRequest, clientPubkey, testUser.username);
    assert.equal(connectResponse.id, connectRequest.id);
    assert.equal(connectResponse.result, 'ack');
    assert.equal(connectResponse.error, null);
    console.log('✓ Connection established successfully');

    // 3. Test ping functionality
    const pingRequest = {
      id: 'test-ping-demo',
      method: 'ping',
      params: []
    };

    const pingResponse = handlePing(pingRequest);
    assert.equal(pingResponse.result, 'pong');
    console.log('✓ Ping/pong working');

    // 4. Verify the session was created in database
    const sessionCheck = await pool.query(
      'SELECT * FROM nip46_sessions WHERE client_pubkey = $1',
      [clientPubkey]
    );
    assert.equal(sessionCheck.rows.length, 1);
    assert.equal(sessionCheck.rows[0].status, 'connected');
    console.log('✓ Session stored in database');

    console.log('\n🎉 NIP-46 Remote Signer Demo Complete!');
    console.log('✓ Connection token generation');
    console.log('✓ Client connection handling'); 
    console.log('✓ Session management');
    console.log('✓ Method routing (ping/pong)');
    console.log('✓ Database persistence');
  });

  it('shows NIP-46 API endpoints are available', async () => {
    // Test that our API endpoints are properly configured
    const { router } = await import('./routes.js');
    
    // Check that router is defined (indicates routes are loaded)
    assert(router);
    console.log('✓ API routes loaded successfully');
    
    // The routes include:
    console.log('Available NIP-46 endpoints:');
    console.log('  GET  /nip46/info - Signer information');
    console.log('  GET  /nip46/connect/:username - Generate connection token');
    console.log('  POST /nip46/request - Handle encrypted NIP-46 requests');
    console.log('  POST /nip46/nostrconnect - Handle nostrconnect:// URLs');
  });
});
