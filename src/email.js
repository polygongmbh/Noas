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
  pin,
  verificationLink,
  expiresAt,
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
    `Hello ${username},`,
    '',
    `Someone registered the Nostr identity ${identifier}.`,
    '',
    pin ? `Verification PIN: ${pin}` : null,
    '',
    'If this was you, confirm your account:',
    verificationLink,
    '',
    'Enter the verification PIN on the confirmation page.',
    '',
    `This expires at ${ttlLabel}.`,
    '',
    "If you didn't register, ignore this email.",
    'Your address will be released after expiry.',
  ].join('\n');

  const html = [
    `<p>Hello <strong>${escapeHtml(username)}</strong>,</p>`,
    `<p>Someone registered the Nostr identity <strong>${escapeHtml(identifier)}</strong>.</p>`,
    pin
      ? `<p>Your verification PIN: <strong style="font-size: 20px; letter-spacing: 3px;">${escapeHtml(pin)}</strong></p>`
      : '',
    '<p>If this was you, confirm your account:</p>',
    `<p><a href="${escapeHtml(verificationLink)}">${escapeHtml(verificationLink)}</a></p>`,
    '<p>Enter the verification PIN on the confirmation page.</p>',
    `<p>This expires at <strong>${escapeHtml(ttlLabel)}</strong>.</p>`,
    "<p>If you didn't register, ignore this email.</p>",
    '<p>Your address will be released after expiry.</p>',
  ].filter(Boolean).join('');

  await transporter.sendMail({
    from,
    to,
    replyTo: config.smtpReplyTo || undefined,
    subject: 'Verify your Noas account',
    text,
    html,
  });

  return {
    sent: true,
    via: 'smtp',
  };
}
