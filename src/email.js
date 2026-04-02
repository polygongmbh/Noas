import nodemailer from 'nodemailer';
import { config } from './config.js';

let cachedTransporter = null;

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function getTransportConfig() {
  if (config.smtpUrl) {
    return config.smtpUrl;
  }

  if (!config.smtpHost || !config.smtpPort) {
    return null;
  }

  const transport = {
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
  };

  if (config.smtpUser || config.smtpPass) {
    transport.auth = {
      user: config.smtpUser,
      pass: config.smtpPass,
    };
  }

  if (parseBool(process.env.SMTP_REJECT_UNAUTHORIZED, true) === false) {
    transport.tls = { rejectUnauthorized: false };
  }

  return transport;
}

function getTransporter() {
  const transportConfig = getTransportConfig();
  if (!transportConfig) return null;

  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport(transportConfig);
  }
  return cachedTransporter;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function resolvePublicKeyFormats(publicKey) {
  const raw = String(publicKey || '').trim();
  if (!raw) {
    return { npub: null, hex: null };
  }

  try {
    const { nip19 } = await import('nostr-tools');
    if (raw.startsWith('npub1')) {
      const decoded = nip19.decode(raw);
      if (decoded.type === 'npub' && typeof decoded.data === 'string') {
        return { npub: raw, hex: decoded.data.toLowerCase() };
      }
      return { npub: raw, hex: null };
    }

    if (/^[a-f0-9]{64}$/i.test(raw)) {
      const hex = raw.toLowerCase();
      return { npub: nip19.npubEncode(hex), hex };
    }
  } catch {
    return { npub: raw.startsWith('npub1') ? raw : null, hex: null };
  }

  return { npub: null, hex: null };
}

export async function sendVerificationEmail({
  to,
  username,
  identifier,
  redirectTarget = null,
  verificationLink,
  expiresAt,
  publicKey = null,
}) {
  const transporter = getTransporter();
  if (!transporter) {
    return {
      sent: false,
      reason: 'smtp_not_configured',
    };
  }

  const publicKeyFormats = await resolvePublicKeyFormats(publicKey);
  const publicKeyText = publicKeyFormats.npub
    ? [
        'Your public key (npub):',
        publicKeyFormats.npub,
        publicKeyFormats.hex ? `Hex: ${publicKeyFormats.hex}` : null,
      ].filter(Boolean).join('\n')
    : (publicKeyFormats.hex ? `Your public key (hex):\n${publicKeyFormats.hex}` : null);
  const publicKeyHtml = publicKeyFormats.npub
    ? [
        '<p>Your public key (npub):<br /><code>',
        escapeHtml(publicKeyFormats.npub),
        '</code></p>',
        publicKeyFormats.hex
          ? `<p>Hex:<br /><code>${escapeHtml(publicKeyFormats.hex)}</code></p>`
          : '',
      ].join('')
    : (publicKeyFormats.hex
      ? `<p>Your public key (hex):<br /><code>${escapeHtml(publicKeyFormats.hex)}</code></p>`
      : '');

  const expiresInMinutes = (() => {
    if (!expiresAt) return null;
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (!Number.isFinite(ms)) return null;
    return Math.max(1, Math.ceil(ms / 1000 / 60));
  })();
  const ttlLabel = expiresInMinutes ? `${expiresInMinutes} minute${expiresInMinutes === 1 ? '' : 's'}` : 'soon';
  const redirectLabel = String(redirectTarget || '').trim();
  const from = config.smtpFrom || `Noas <no-reply@${config.domain.split(':')[0]}>`;

  const text = [
    'Hi,',
    '',
    redirectLabel
      ? `The Nostr identity ${identifier} was registered for use on ${redirectLabel}.`
      : `Someone registered the Nostr identity ${identifier}.`,
    '',
    publicKeyText,
    '',
    'If this was you, verify your account:',
    verificationLink,
    '',
    'You will be asked to enter your password to confirm ownership.',
    '',
    `This link expires in ${ttlLabel}.`,
    '',
    'If you did not register this account, ignore this email.',
    'The username will be released automatically after the link expires.',
    '',
    '— Noas Team',
  ].join('\n');

  const html = [
    '<p>Hi,</p>',
    redirectLabel
      ? `<p>The Nostr identity <strong>${escapeHtml(identifier)}</strong> was registered for use on <strong>${escapeHtml(redirectLabel)}</strong>.</p>`
      : `<p>Someone registered the Nostr identity <strong>${escapeHtml(identifier)}</strong>.</p>`,
    publicKeyHtml,
    '<p>If this was you, verify your account:</p>',
    `<p><a href="${escapeHtml(verificationLink)}">${escapeHtml(verificationLink)}</a></p>`,
    '<p>You will be asked to enter your password to confirm ownership.</p>',
    `<p>This link expires in <strong>${escapeHtml(ttlLabel)}</strong>.</p>`,
    '<p>If you did not register this account, ignore this email.</p>',
    '<p>The username will be released automatically after the link expires.</p>',
    '<p>— Noas Team</p>',
  ].filter(Boolean).join('');

  await transporter.sendMail({
    from,
    to,
    replyTo: config.smtpReplyTo || undefined,
    subject: `Verify your Nostr identity: ${identifier}`,
    text,
    html,
  });

  return {
    sent: true,
    via: 'smtp',
  };
}
