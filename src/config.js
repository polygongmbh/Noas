/**
 * Configuration Module
 * 
 * Loads and exports application configuration from environment variables.
 * Handles .env file loading and provides typed config object for the app.
 */

import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { nip19 } from 'nostr-tools';

// Get the current directory for ES modules
const __dirname = dirname(fileURLToPath(import.meta.url));

// Load environment variables from .env file unless explicitly disabled
// (compose should be the runtime source of truth when NOAS_LOAD_DOTENV=false).
if (process.env.NOAS_LOAD_DOTENV !== 'false') {
  dotenv.config({ path: join(__dirname, '../.env') });
}

function readPackageVersion() {
  try {
    const packagePath = join(__dirname, '../package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    return String(packageJson.version || '').trim() || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

const packageVersion = readPackageVersion();

function parseRelayList(value) {
  return String(value || '')
    .split(',')
    .map((relay) => relay.trim())
    .filter((relay) => relay.startsWith('wss://'));
}

function normalizePrivateKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^[a-f0-9]{64}$/i.test(raw)) {
    return raw.toLowerCase();
  }
  if (raw.startsWith('nsec1')) {
    const decoded = nip19.decode(raw);
    if (decoded.type === 'nsec' && decoded.data instanceof Uint8Array) {
      return Array.from(decoded.data, (byte) => byte.toString(16).padStart(2, '0')).join('');
    }
  }
  throw new Error('NIP46_SIGNER_PRIVATE_KEY must be a hex private key or nsec');
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

function parseAllowedOrigins(value) {
  return String(value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function normalizeBasePath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw === '/') return '';
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeading.endsWith('/') ? withLeading.slice(0, -1) : withLeading;
}

function rootDomainFromHostLike(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withoutProtocol = raw.replace(/^[a-z]+:\/\//i, '');
  const hostPortPath = withoutProtocol.split('/')[0];
  const host = hostPortPath.split(':')[0];
  return host.toLowerCase();
}

function detectLocalHost(hostLike) {
  const domain = rootDomainFromHostLike(hostLike);
  return domain === 'localhost' || domain === '127.0.0.1' || domain === '::1';
}

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function hostLikeFromUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return parsed.host;
  } catch {
    return raw.replace(/^[a-z]+:\/\//i, '').split('/')[0];
  }
}

function resolveDomain({ domainEnv, noasPublicUrl, nip05Domain, port }) {
  const explicitDomain = String(domainEnv || '').trim();
  if (explicitDomain) return explicitDomain;

  const publicHost = hostLikeFromUrl(noasPublicUrl);
  if (publicHost) return publicHost.toLowerCase();

  const nip05 = String(nip05Domain || '').trim();
  if (nip05) return nip05;

  return `localhost:${port}`;
}

const configuredPort = parseInt(process.env.PORT || '3000', 10);
const configuredNip05Domain = process.env.NIP05_DOMAIN || process.env.NOAS_DOMAIN || '';

// Export configuration object with all app settings
export const config = {
  port: configuredPort,
  databaseUrl: process.env.DATABASE_URL,
  domain: resolveDomain({
    domainEnv: process.env.DOMAIN,
    noasPublicUrl: process.env.NOAS_PUBLIC_URL,
    nip05Domain: configuredNip05Domain,
    port: configuredPort,
  }),
  isTest: process.env.NODE_ENV === 'test',
  requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === 'true',
  emailVerificationEnabled:
    process.env.EMAIL_VERIFICATION_ENABLED
      ? process.env.EMAIL_VERIFICATION_ENABLED === 'true'
      : process.env.REQUIRE_EMAIL_VERIFICATION === 'true',
  allowedSignupEmailDomain: (process.env.ALLOWED_SIGNUP_EMAIL_DOMAIN || '').trim().toLowerCase(),
  tenantDefaultRelays: parseRelayList(process.env.TENANT_DEFAULT_RELAYS),
  domainRelayMap: parseDomainRelayMap(process.env.DOMAIN_RELAY_MAP),
  exposeVerificationTokenInResponse: process.env.EXPOSE_VERIFICATION_TOKEN_IN_RESPONSE === 'true',
  emailVerificationTokenTtlMinutes: parseInt(process.env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES || '30', 10),
  verificationExpiryMinutes: parseInt(
    process.env.VERIFICATION_EXPIRY_MINUTES || process.env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES || '15',
    10
  ),
  resendCooldownMinutes: parseInt(process.env.RESEND_COOLDOWN_MINUTES || '1', 10),
  requireEmailDelivery: process.env.REQUIRE_EMAIL_DELIVERY === 'true',
  smtpUrl: (process.env.SMTP_URL || '').trim(),
  smtpHost: (process.env.SMTP_HOST || '').trim(),
  smtpPort: parseInt(process.env.SMTP_PORT || '0', 10) || null,
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpUser: (process.env.SMTP_USER || '').trim(),
  smtpPass: process.env.SMTP_PASS || '',
  smtpFrom: (process.env.SMTP_FROM || '').trim(),
  smtpReplyTo: (process.env.SMTP_REPLY_TO || '').trim(),
  nip05Domain: (configuredNip05Domain || process.env.DOMAIN || '').trim(),
  noasPublicUrl: (process.env.NOAS_PUBLIC_URL || '').trim(),
  noasBasePath: normalizeBasePath(process.env.NOAS_BASE_PATH),
  allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
  apiVersion: process.env.NOAS_API_VERSION || packageVersion,
  nip46SignerPrivateKey: normalizePrivateKey(process.env.NIP46_SIGNER_PRIVATE_KEY),
  nip46Relays: parseRelayList(process.env.NIP46_RELAYS) || [],
};

if (!config.nip05Domain) {
  config.nip05Domain = config.domain;
}
config.nip05RootDomain = rootDomainFromHostLike(config.nip05Domain);
if (!config.noasPublicUrl) {
  const scheme = detectLocalHost(config.nip05Domain) ? 'http' : 'https';
  config.noasPublicUrl = `${scheme}://${config.nip05Domain}`;
}
config.noasPublicUrl = stripTrailingSlash(config.noasPublicUrl);
config.noasServiceHost = hostLikeFromUrl(config.noasPublicUrl);
