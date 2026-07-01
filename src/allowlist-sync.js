import { config } from './config.js';
import { listActiveNostrUserPubkeys } from './db/users.js';
import { enqueueRelayAllowJobRecord } from './db/relay-allow-jobs.js';

async function fetchRelayAllowedPubkeys(relayManagerUrl, relayUsername, token) {
  const url = `${relayManagerUrl}/internal/noas/relay-acl/${encodeURIComponent(relayUsername)}/allowed`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      headers: { 'x-noas-internal-token': token },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`relay-manager responded ${res.status}: ${body}`);
    }
    const json = await res.json();
    return Array.isArray(json.pubkeys) ? json.pubkeys : [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function runRelaySyncTick({
  getActiveUsers = listActiveNostrUserPubkeys,
  enqueueJob = enqueueRelayAllowJobRecord,
} = {}) {
  const domains = Object.keys(config.domainRelayUsernameMap);
  if (domains.length === 0) {
    return { domains_skipped: 0, allows_enqueued: 0, bans_enqueued: 0 };
  }

  const relayManagerUrl = config.relayManagerInternalUrl;
  const token = config.relayManagerInternalToken;

  if (!relayManagerUrl || !token) {
    return {
      domains_skipped: domains.length,
      allows_enqueued: 0,
      bans_enqueued: 0,
      reason: 'RELAY_MANAGER_INTERNAL_URL or RELAY_MANAGER_INTERNAL_TOKEN not configured',
    };
  }

  let totalAllows = 0;
  let totalBans = 0;

  for (const domain of domains) {
    const relayUsername = config.domainRelayUsernameMap[domain];
    if (!relayUsername) continue;

    const relayAclUrl = `${relayManagerUrl}/internal/noas/relay-acl/${encodeURIComponent(relayUsername)}`;

    try {
      const [activePubkeys, allowedPubkeys] = await Promise.all([
        getActiveUsers(domain),
        fetchRelayAllowedPubkeys(relayManagerUrl, relayUsername, token),
      ]);

      const activeSet = new Set(activePubkeys);
      const allowedSet = new Set(allowedPubkeys);

      // Enqueue allows for active users not yet on the relay
      const toAllow = activePubkeys.filter((pk) => !allowedSet.has(pk));
      for (const pubkey of toAllow) {
        await enqueueJob({
          tenantDomain: domain,
          pubkey,
          relayUrl: relayAclUrl,
          method: 'allowpubkey',
          maxAttempts: config.relayAllowMaxAttempts,
        }).catch(() => {});
        totalAllows += 1;
      }

      // Enqueue bans for relay ACL entries whose users no longer exist in NOAS
      const toBan = allowedPubkeys.filter((pk) => !activeSet.has(pk));
      for (const pubkey of toBan) {
        await enqueueJob({
          tenantDomain: domain,
          pubkey,
          relayUrl: relayAclUrl,
          method: 'unallowpubkey',
          maxAttempts: config.relayAllowMaxAttempts,
        }).catch(() => {});
        totalBans += 1;
      }
    } catch (err) {
      console.warn(`relay sync tick failed for domain ${domain}:`, err?.message);
    }
  }

  return { domains_checked: domains.length, allows_enqueued: totalAllows, bans_enqueued: totalBans };
}
