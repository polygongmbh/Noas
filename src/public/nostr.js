(function attachNoasNostr(globalScope) {
  function hexToBytes(hex) {
    const normalized = String(hex || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) return null;
    const bytes = [];
    for (let index = 0; index < normalized.length; index += 2) {
      bytes.push(parseInt(normalized.slice(index, index + 2), 16));
    }
    return bytes;
  }

  function convertBits(data, fromBits, toBits) {
    let value = 0;
    let bits = 0;
    const result = [];
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

  function bech32Polymod(values) {
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

  function bech32HumanReadablePartExpand(prefix) {
    const result = [];
    for (let index = 0; index < prefix.length; index += 1) {
      result.push(prefix.charCodeAt(index) >> 5);
    }
    result.push(0);
    for (let index = 0; index < prefix.length; index += 1) {
      result.push(prefix.charCodeAt(index) & 31);
    }
    return result;
  }

  function bech32CreateChecksum(prefix, data) {
    const values = bech32HumanReadablePartExpand(prefix).concat(data, [0, 0, 0, 0, 0, 0]);
    const polymod = bech32Polymod(values) ^ 1;
    const checksum = [];
    for (let index = 0; index < 6; index += 1) {
      checksum.push((polymod >> (5 * (5 - index))) & 31);
    }
    return checksum;
  }

  function npubFromHexPublicKey(publicKey) {
    const bytes = hexToBytes(publicKey);
    if (!bytes) return String(publicKey || '').trim() || 'unknown';
    const alphabet = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    const words = convertBits(bytes, 8, 5);
    const checksum = bech32CreateChecksum('npub', words);
    return `npub1${words.concat(checksum).map((value) => alphabet[value]).join('')}`;
  }

  globalScope.NoasNostr = {
    npubFromHexPublicKey,
  };
}(window));
