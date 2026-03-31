import { randomUUID } from 'crypto';

function buildRpcRequest(pubkey, method) {
  return {
    jsonrpc: '2.0',
    id: randomUUID(),
    method,
    params: [pubkey],
  };
}

function parseRelayResponseBody(bodyText) {
  const raw = String(bodyText || '').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function sendAllowPubkeyToRelays({
  pubkey,
  relayUrls = [],
  method = 'allowpubkey',
  timeoutMs = 5000,
}) {
  const normalizedPubkey = String(pubkey || '').trim().toLowerCase();
  if (!normalizedPubkey || relayUrls.length === 0) {
    return [];
  }

  const attempts = relayUrls.map(async (relayUrl) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
    try {
      const response = await fetch(relayUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildRpcRequest(normalizedPubkey, method)),
        signal: controller.signal,
      });
      const bodyText = await response.text();
      const parsed = parseRelayResponseBody(bodyText);
      const rpcError = parsed && typeof parsed.error === 'object' ? parsed.error : null;
      return {
        relay_url: relayUrl,
        success: response.ok && !rpcError,
        status_code: response.status,
        error: rpcError?.message || null,
      };
    } catch (error) {
      const timeoutError = error?.name === 'AbortError' ? 'timeout' : null;
      return {
        relay_url: relayUrl,
        success: false,
        status_code: null,
        error: timeoutError || error?.message || 'request_failed',
      };
    } finally {
      clearTimeout(timeout);
    }
  });

  return Promise.all(attempts);
}

