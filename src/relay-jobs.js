import { config } from './config.js';
import { sendAllowPubkeyToRelays } from './nip86.js';

const queue = [];
let processing = false;

function scheduleProcess() {
  if (processing) return;
  processing = true;
  setTimeout(processQueue, 0);
}

async function processQueue() {
  while (queue.length > 0) {
    const job = queue.shift();
    if (!job) continue;
    try {
      await sendAllowPubkeyToRelays({
        pubkey: job.pubkey,
        relayUrls: [job.relayUrl],
        method: config.nip86Method,
        timeoutMs: config.nip86TimeoutMs,
      });
    } catch (error) {
      console.warn('Relay allow job failed', {
        relay_url: job.relayUrl,
        pubkey: job.pubkey,
        error: error?.message || String(error),
      });
    }
  }
  processing = false;
}

export function enqueueRelayAllowJob({ pubkey, relayUrl }) {
  if (!pubkey || !relayUrl) return null;
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  queue.push({
    id,
    pubkey: String(pubkey || '').trim().toLowerCase(),
    relayUrl: String(relayUrl || '').trim(),
    createdAt: Date.now(),
  });
  scheduleProcess();
  return id;
}
