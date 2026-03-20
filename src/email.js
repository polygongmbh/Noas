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

export async function sendVerificationEmail({
  to,
  username,
  identifier,
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

  const ttlLabel = expiresAt ? new Date(expiresAt).toISOString() : 'soon';
  const from = config.smtpFrom || `Noas <no-reply@${config.domain.split(':')[0]}>`;

  const text = [
    'Hi,',
    '',
    `Someone registered the Nostr identity ${identifier}.`,
    '',
    publicKey ? `Your public key (npub):\n${publicKey}` : null,
    '',
    'If this was you, verify your account:',
    verificationLink,
    '',
    'You will be asked to enter your password to confirm ownership.',
    '',
    `This link expires at ${ttlLabel}.`,
    '',
    'If you did not register this account, ignore this email.',
    'The username will be released automatically after the link expires.',
    '',
    '— Nodal',
  ].join('\n');

  const html = [
    '<p>Hi,</p>',
    `<p>Someone registered the Nostr identity <strong>${escapeHtml(identifier)}</strong>.</p>`,
    publicKey
      ? `<p>Your public key (npub):<br /><code>${escapeHtml(publicKey)}</code></p>`
      : '',
    '<p>If this was you, verify your account:</p>',
    `<p><a href="${escapeHtml(verificationLink)}">${escapeHtml(verificationLink)}</a></p>`,
    '<p>You will be asked to enter your password to confirm ownership.</p>',
    `<p>This link expires at <strong>${escapeHtml(ttlLabel)}</strong>.</p>`,
    '<p>If you did not register this account, ignore this email.</p>',
    '<p>The username will be released automatically after the link expires.</p>',
    '<p>— Nodal</p>',
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
