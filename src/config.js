/**
 * Configuration Module
 * 
 * Loads and exports application configuration from environment variables.
 * Handles .env file loading and provides typed config object for the app.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get the current directory for ES modules
const __dirname = dirname(fileURLToPath(import.meta.url));

// Load environment variables from .env file
dotenv.config({ path: join(__dirname, '../.env') });

function parseRelayList(value) {
  return String(value || '')
    .split(',')
    .map((relay) => relay.trim())
    .filter((relay) => relay.startsWith('wss://'));
}

function parseDomainRelayMap(value) {
  const map = {};
  const entries = String(value || '')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of entries) {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex <= 0) continue;
    const domain = entry.slice(0, separatorIndex).trim().toLowerCase();
    const relaysRaw = entry.slice(separatorIndex + 1).trim();
    if (!domain || !relaysRaw) continue;
    const relays = parseRelayList(relaysRaw);
    if (relays.length > 0) {
      map[domain] = relays;
    }
  }

  return map;
}

// Export configuration object with all app settings
export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL,
  domain: process.env.DOMAIN || `localhost:${process.env.PORT || '3000'}`,
  isTest: process.env.NODE_ENV === 'test',
  requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === 'true',
  allowedSignupEmailDomain: (process.env.ALLOWED_SIGNUP_EMAIL_DOMAIN || '').trim().toLowerCase(),
  tenantDefaultRelays: parseRelayList(process.env.TENANT_DEFAULT_RELAYS),
  domainRelayMap: parseDomainRelayMap(process.env.DOMAIN_RELAY_MAP),
  exposeVerificationTokenInResponse: process.env.EXPOSE_VERIFICATION_TOKEN_IN_RESPONSE === 'true',
  emailVerificationTokenTtlMinutes: parseInt(process.env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES || '30', 10),
};

// Ensure domain matches the actual port being used
if (!process.env.DOMAIN) {
  config.domain = `localhost:${config.port}`;
}
