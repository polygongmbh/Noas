/**
 * Service Account Provisioning
 *
 * Creates custodial accounts on behalf of trusted services authenticated
 * with a service API key (e.g. the nail mailing-list engine). Accounts get
 * a NIP-05-safe username derived from the email local part, a freshly
 * generated keypair encrypted with the custody master key
 * (custody = 'master_key', raw_password NULL), and active status — email
 * ownership verification is the calling service's responsibility.
 */

import { randomBytes } from 'crypto';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { encrypt } from 'nostr-tools/nip49';
import { validateUsername } from './auth.js';
import { config } from './config.js';
import { CUSTODY_MODES } from './custody.js';
import {
  createNostrUser,
  getNostrUserByUsername,
  getNostrUserByRegistrationEmail,
} from './db/users.js';

const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 32;
const MAX_USERNAME_SUFFIX = 999;
const MAX_PROVISION_ATTEMPTS = 3;

/**
 * Derive a NIP-05-safe username base from an email address.
 * Lowercases the local part, strips characters outside a-z0-9-_. and pads
 * or trims to the allowed username length.
 * @param {string} email
 * @returns {string}
 */
export function deriveUsernameBaseFromEmail(email) {
  const localPart = String(email || '').trim().toLowerCase().split('@')[0];
  let base = localPart.replace(/[^a-z0-9._-]/g, '');
  if (!base) {
    base = 'subscriber';
  }
  while (base.length < USERNAME_MIN_LENGTH) {
    base = `${base}0`;
  }
  return base.slice(0, USERNAME_MAX_LENGTH);
}

/**
 * Find the first available username for a tenant: the derived base, then
 * base1, base2, ... on collision (or when the base is reserved).
 * @param {string} email
 * @param {string} tenantDomain
 * @returns {Promise<string>}
 */
async function pickAvailableServiceUsername(email, tenantDomain) {
  const base = deriveUsernameBaseFromEmail(email);
  for (let suffix = 0; suffix <= MAX_USERNAME_SUFFIX; suffix++) {
    const suffixText = suffix === 0 ? '' : String(suffix);
    const candidate = `${base.slice(0, USERNAME_MAX_LENGTH - suffixText.length)}${suffixText}`;
    if (!validateUsername(candidate).valid) continue;
    const existing = await getNostrUserByUsername(candidate, tenantDomain);
    if (!existing) return candidate;
  }
  throw new Error('Unable to derive an available username');
}

/**
 * Provision (or return) the custodial account for (tenant_domain, email).
 * Idempotent: repeat calls return the existing master_key-custody account
 * registered for the email.
 * @param {Object} params
 * @param {string} params.email - Normalized subscriber email
 * @param {string} params.tenantDomain - Tenant root domain
 * @returns {Promise<{ user: Object, created: boolean }>}
 */
export async function provisionServiceAccount({ email, tenantDomain }) {
  if (!config.custodyMasterKey) {
    throw new Error('CUSTODY_MASTER_KEY is not configured');
  }

  for (let attempt = 0; attempt < MAX_PROVISION_ATTEMPTS; attempt++) {
    const existing = await getNostrUserByRegistrationEmail(
      email,
      tenantDomain,
      CUSTODY_MODES.MASTER_KEY
    );
    if (existing) {
      return { user: existing, created: false };
    }

    const username = await pickAvailableServiceUsername(email, tenantDomain);
    const secretKey = generateSecretKey();
    try {
      const user = await createNostrUser({
        tenantDomain,
        username,
        // Random unguessable hash: custodial accounts have no password
        // sign-in; the service key or a session token is the credential.
        passwordSha256: randomBytes(32).toString('hex'),
        publicKey: getPublicKey(secretKey).toLowerCase(),
        privateKeyEncrypted: encrypt(secretKey, config.custodyMasterKey),
        registrationEmail: email,
        rawPassword: null,
        relays: [],
        status: 'active',
        verificationToken: null,
        custody: CUSTODY_MODES.MASTER_KEY,
      });
      return { user, created: true };
    } catch (error) {
      // Unique violation: a concurrent request claimed the username or
      // email; re-check idempotently.
      if (error?.code === '23505') continue;
      throw error;
    }
  }

  throw new Error('Account provisioning failed after retries');
}
