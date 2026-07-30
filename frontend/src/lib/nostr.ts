// Ported from src/public/nostr.js. Internals unchanged (including the hand-rolled
// hex/bech32 helpers used only for the read-only npub display path, to avoid
// pulling in nostr-tools just to render an npub) — this file just replaces the
// `window.NoasNostr` global with real ES module exports.

function hexToBytes(hex: string): number[] | null {
  const normalized = String(hex || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) return null;
  const bytes: number[] = [];
  for (let index = 0; index < normalized.length; index += 2) {
    bytes.push(parseInt(normalized.slice(index, index + 2), 16));
  }
  return bytes;
}

function convertBits(data: number[], fromBits: number, toBits: number): number[] {
  let value = 0;
  let bits = 0;
  const result: number[] = [];
  const maxValue = (1 << toBits) - 1;

  for (const item of data) {
    value = (value << fromBits) | item;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((value >> bits) & maxValue);
    }
  }

  if (bits > 0) {
    result.push((value << (toBits - bits)) & maxValue);
  }

  return result;
}

function bech32Polymod(values: number[]): number {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  for (const value of values) {
    const highBits = checksum >> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let bit = 0; bit < generators.length; bit += 1) {
      if ((highBits >> bit) & 1) {
        checksum ^= generators[bit];
      }
    }
  }
  return checksum;
}

function bech32HumanReadablePartExpand(prefix: string): number[] {
  const result: number[] = [];
  for (let index = 0; index < prefix.length; index += 1) {
    result.push(prefix.charCodeAt(index) >> 5);
  }
  result.push(0);
  for (let index = 0; index < prefix.length; index += 1) {
    result.push(prefix.charCodeAt(index) & 31);
  }
  return result;
}

function bech32CreateChecksum(prefix: string, data: number[]): number[] {
  const values = bech32HumanReadablePartExpand(prefix).concat(data, [0, 0, 0, 0, 0, 0]);
  const polymod = bech32Polymod(values) ^ 1;
  const checksum: number[] = [];
  for (let index = 0; index < 6; index += 1) {
    checksum.push((polymod >> (5 * (5 - index))) & 31);
  }
  return checksum;
}

export function npubFromHexPublicKey(publicKey: string): string {
  const bytes = hexToBytes(publicKey);
  if (!bytes) return String(publicKey || '').trim() || 'unknown';
  const alphabet = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const words = convertBits(bytes, 8, 5);
  const checksum = bech32CreateChecksum('npub', words);
  return `npub1${words
    .concat(checksum)
    .map((value) => alphabet[value])
    .join('')}`;
}

function bytesToHex(bytes: Uint8Array | number[]): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

let nip49ModulePromise: Promise<typeof import('nostr-tools/nip49')> | null = null;
let nostrToolsModulePromise: Promise<typeof import('nostr-tools')> | null = null;

function loadNip49Module() {
  if (!nip49ModulePromise) {
    nip49ModulePromise = import('nostr-tools/nip49');
  }
  return nip49ModulePromise;
}

function loadNostrToolsModule() {
  if (!nostrToolsModulePromise) {
    nostrToolsModulePromise = import('nostr-tools');
  }
  return nostrToolsModulePromise;
}

export async function decryptPrivateKey(ncryptsec: string, password: string) {
  const normalizedKey = String(ncryptsec || '').trim();
  const normalizedPassword = String(password || '');
  if (!normalizedKey) {
    throw new Error('Encrypted private key is required');
  }
  if (!normalizedPassword) {
    throw new Error('Password is required');
  }

  const [{ decrypt }, { nip19, getPublicKey }] = await Promise.all([
    loadNip49Module(),
    loadNostrToolsModule(),
  ]);
  const secretKey = decrypt(normalizedKey, normalizedPassword);

  return {
    hex: bytesToHex(secretKey),
    nsec: nip19.nsecEncode(secretKey),
    publicKey: getPublicKey(secretKey).toLowerCase(),
  };
}

export async function normalizeSecretKey(privateKeyInput: string) {
  const normalizedKey = String(privateKeyInput || '').trim();
  if (!normalizedKey) {
    throw new Error('Private key is required');
  }

  const { nip19, getPublicKey } = await loadNostrToolsModule();
  let secretKey: Uint8Array | null = null;

  if (/^[a-f0-9]{64}$/i.test(normalizedKey)) {
    const bytes = hexToBytes(normalizedKey);
    secretKey = Uint8Array.from(bytes as number[]);
  } else if (normalizedKey.startsWith('nsec1')) {
    const decoded = nip19.decode(normalizedKey);
    if (decoded.type !== 'nsec' || !(decoded.data instanceof Uint8Array)) {
      throw new Error('Private key must be valid hex, nsec, or ncryptsec');
    }
    secretKey = decoded.data;
  } else {
    throw new Error('Private key must be valid hex, nsec, or ncryptsec');
  }

  return {
    secretKey,
    hex: bytesToHex(secretKey),
    nsec: nip19.nsecEncode(secretKey),
    publicKey: getPublicKey(secretKey).toLowerCase(),
  };
}

export async function encryptPrivateKey(privateKeyInput: string, password: string) {
  const normalizedPassword = String(password || '');
  if (!normalizedPassword) {
    throw new Error('Password is required');
  }

  const [{ encrypt }, { nip19 }] = await Promise.all([loadNip49Module(), loadNostrToolsModule()]);
  const normalized = await normalizeSecretKey(privateKeyInput);

  return {
    privateKeyEncrypted: encrypt(normalized.secretKey, normalizedPassword),
    hex: normalized.hex,
    nsec: nip19.nsecEncode(normalized.secretKey),
    publicKey: normalized.publicKey,
  };
}
