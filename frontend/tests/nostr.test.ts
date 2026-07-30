import { describe, expect, it } from 'vitest';
import { encryptPrivateKey, decryptPrivateKey, normalizeSecretKey, npubFromHexPublicKey } from '../src/lib/nostr';

const TEST_PRIVKEY_HEX_64 = '0'.repeat(63) + '1';

describe('npubFromHexPublicKey', () => {
  it('encodes a hex public key as a bech32 npub', async () => {
    const { publicKey } = await normalizeSecretKey(TEST_PRIVKEY_HEX_64);
    const npub = npubFromHexPublicKey(publicKey);
    expect(npub.startsWith('npub1')).toBe(true);
  });

  it('falls back to returning the input when it is not a valid 32-byte hex key', () => {
    expect(npubFromHexPublicKey('not-hex')).toBe('not-hex');
    expect(npubFromHexPublicKey('')).toBe('unknown');
  });
});

describe('normalizeSecretKey / encryptPrivateKey / decryptPrivateKey round trip', () => {
  it('round-trips a hex private key through encrypt and decrypt', async () => {
    const password = 'correct horse battery staple';
    const encrypted = await encryptPrivateKey(TEST_PRIVKEY_HEX_64, password);
    expect(encrypted.privateKeyEncrypted.startsWith('ncryptsec1')).toBe(true);

    const decrypted = await decryptPrivateKey(encrypted.privateKeyEncrypted, password);
    expect(decrypted.hex).toBe(TEST_PRIVKEY_HEX_64);
    expect(decrypted.publicKey).toBe(encrypted.publicKey);
  });

  it('round-trips an nsec-encoded private key', async () => {
    const normalized = await normalizeSecretKey(TEST_PRIVKEY_HEX_64);
    const fromNsec = await normalizeSecretKey(normalized.nsec);
    expect(fromNsec.hex).toBe(TEST_PRIVKEY_HEX_64);
  });

  it('rejects an invalid private key format', async () => {
    await expect(normalizeSecretKey('not-a-valid-key')).rejects.toThrow(
      'Private key must be valid hex, nsec, or ncryptsec',
    );
  });

  it('requires a password to decrypt', async () => {
    await expect(decryptPrivateKey('ncryptsec1abc', '')).rejects.toThrow('Password is required');
  });
});
