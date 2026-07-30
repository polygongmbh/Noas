import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/lib/crypto';

describe('sha256Hex', () => {
  it('matches a known SHA-256 digest', async () => {
    // echo -n "hello" | sha256sum
    expect(await sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('produces different digests for different input', async () => {
    expect(await sha256Hex('a')).not.toBe(await sha256Hex('b'));
  });
});
