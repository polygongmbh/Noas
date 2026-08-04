// Ported from src/public/app.js's loadNoasVersion()/normalizeVersionLabel(). The
// original mutated global `state` and pushed DOM updates directly; this version
// returns plain data instead — pages apply it to their own reactive state, and
// the DOM updates happen through Svelte's reactivity rather than manual
// textContent/hidden toggling.

export type EmailVerificationMode = 'off' | 'required' | 'required_nip05_domains';

export interface NoasVersionMetadata {
  versionLabel: string;
  emailVerificationMode: EmailVerificationMode | null;
  nip05Domain: string | null;
  trustedAppOrigins: string[];
}

export function normalizeVersionLabel(version: string | undefined | null): string {
  const trimmed = String(version || '').trim().replace(/^v/i, '');
  if (!trimmed) return 'v—';
  const parts = trimmed.split('.');
  if (parts.length >= 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
    return `v${parts[0]}.${parts[1]}`;
  }
  return `v${trimmed}`;
}

export async function loadNoasVersion(): Promise<NoasVersionMetadata | null> {
  try {
    const response = await fetch('/.well-known/nostr.json');
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return null;

    const metadata = data?.noas || {};
    const versionLabel = normalizeVersionLabel(metadata.version);

    const modeFromMetadata = String(metadata.email_verification_mode || '').trim().toLowerCase();
    const emailVerificationMode: EmailVerificationMode | null =
      modeFromMetadata === 'off' || modeFromMetadata === 'required' || modeFromMetadata === 'required_nip05_domains'
        ? (modeFromMetadata as EmailVerificationMode)
        : null;

    const nip05Domain =
      typeof metadata.nip05_domain === 'string' && metadata.nip05_domain.trim()
        ? metadata.nip05_domain.trim().toLowerCase()
        : null;

    const trustedAppOrigins = Array.isArray(metadata.trusted_app_origins)
      ? metadata.trusted_app_origins.filter((origin: unknown): origin is string => typeof origin === 'string')
      : [];

    return { versionLabel, emailVerificationMode, nip05Domain, trustedAppOrigins };
  } catch {
    return null;
  }
}
