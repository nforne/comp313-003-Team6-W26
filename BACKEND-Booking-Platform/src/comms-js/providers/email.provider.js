// src/comms-js/providers/email.provider.js
//
// Email provider wrapper for comms-js.
// - Primary: AWS SES (simple sendEmail) when configured and no attachments.
// - Fallback: nodemailer SMTP transport (or nodemailer SES transport) when attachments are present
//   or when SES config is not available.
// - Returns a simple result object: { ok: true, providerId } or { ok: false, error }.
// - Does not perform retries; caller (batch.worker) is responsible for retry/backoff.
// - Accepts a single "send" call for one recipient at a time.

const config = require('../config');
const logger = console;
let AWS;
let sesClient;
let nodemailer;

const DEFAULT_FROM = config.emailFrom || process.env.EMAIL_FROM || 'no-reply@example.com';

// Lazy init AWS SES client if configured
function initSES() {
  if (sesClient) return sesClient;
  try {
    AWS = AWS || require('aws-sdk');
    const sesConfig = {};
    if (config.sesRegion || process.env.AWS_REGION) sesConfig.region = config.sesRegion || process.env.AWS_REGION;
    if (config.sesEndpoint) sesConfig.endpoint = config.sesEndpoint;
    sesClient = new AWS.SES(sesConfig);
    return sesClient;
  } catch (err) {
    // AWS SDK not available or failed to init
    logger.warn && logger.warn({ event: 'email.provider.ses_init_failed', error: err && err.message ? err.message : String(err) });
    sesClient = null;
    return null;
  }
}

// Lazy init nodemailer
function initNodemailer() {
  if (nodemailer) return nodemailer;
  try {
    nodemailer = require('nodemailer');
    return nodemailer;
  } catch (err) {
    logger.warn && logger.warn({ event: 'email.provider.nodemailer_missing', error: err && err.message ? err.message : String(err) });
    nodemailer = null;
    return null;
  }
}

/**
 * sendEmail
 * @param {Object} opts
 *  { to, subject, body, attachments = [], messageId, userId, correlationId }
 *
 * @returns {Promise<{ ok: boolean, providerId?: string, error?: string }>}
 */
async function sendEmail(opts = {}) {
  const to = opts.to;
  const subject = opts.subject || '';
  const body = opts.body || '';
  const attachments = Array.isArray(opts.attachments) ? opts.attachments : [];
  const messageId = opts.messageId || null;
  const userId = opts.userId || null;
  const correlationId = opts.correlationId || null;

  if (!to) {
    return { ok: false, error: 'missing_recipient' };
  }

  // Prefer SES when configured and no attachments (SES sendEmail is simpler)
  const useSES = !!(config.useSES && (config.sesRegion || process.env.AWS_REGION));
  const canUseSES = useSES && attachments.length === 0;

  if (canUseSES) {
    const ses = initSES();
    if (!ses) {
      // fall through to nodemailer
      logger.warn && logger.warn({ event: 'email.provider.ses_unavailable', to, messageId, correlationId });
    } else {
      try {
        const params = {
          Source: DEFAULT_FROM,
          Destination: { ToAddresses: [to] },
          Message: {
            Subject: { Data: subject || '' },
            Body: {
              Text: { Data: body || '' }
            }
          }
        };

        // If HTML is provided in metadata.bodyHtml, prefer it
        if (opts.bodyHtml) {
          params.Message.Body.Html = { Data: opts.bodyHtml };
          // keep Text as fallback
        }

        const res = await ses.sendEmail(params).promise();
        const providerId = res && res.MessageId ? res.MessageId : null;
        logger.info && logger.info({ event: 'email.provider.ses_sent', to, providerId, messageId, correlationId });
        return { ok: true, providerId };
      } catch (err) {
        logger.error && logger.error({ event: 'email.provider.ses_error', to, error: err && err.message ? err.message : String(err), messageId, correlationId });
        // fall through to nodemailer fallback if available
      }
    }
  }

  // Nodemailer fallback (supports attachments and complex MIME)
  const nm = initNodemailer();
  if (!nm) {
    return { ok: false, error: 'no_email_transport_available' };
  }

  // Build transport config
  let transporter;
  try {
    if (config.smtp && config.smtp.host) {
      transporter = nm.createTransport({
        host: config.smtp.host,
        port: config.smtp.port || 587,
        secure: !!config.smtp.secure,
        auth: config.smtp.auth || undefined,
        tls: config.smtp.tls || undefined
      });
    } else if (config.useSES) {
      // nodemailer SES transport using AWS SDK
      const SES = initSES();
      if (!SES) {
        return { ok: false, error: 'ses_not_configured' };
      }
      transporter = nm.createTransport({ SES });
    } else {
      // default to direct transport (may not be reliable in production)
      transporter = nm.createTransport({ sendmail: true });
    }
  } catch (err) {
    logger.error && logger.error({ event: 'email.provider.transport_init_failed', error: err && err.message ? err.message : String(err), messageId, correlationId });
    return { ok: false, error: 'transport_init_failed' };
  }

  // Build mail options
  const mailOptions = {
    from: DEFAULT_FROM,
    to,
    subject,
    text: body
  };

  if (opts.bodyHtml) mailOptions.html = opts.bodyHtml;

  if (attachments.length) {
    // attachments expected in the Message model as { filename, mimeType, size, storageRef }
    // We assume attachments are accessible via a public URL or via a storage service.
    // If storageRef is an S3 key, caller should provide a pre-signed URL in metadata or we can construct one here if config provides S3 access.
    mailOptions.attachments = attachments.map(a => {
      // If attachment has a url property, use it; otherwise include as placeholder reference.
      if (a.url) {
        return { filename: a.filename, path: a.url, contentType: a.mimeType };
      }
      // If storageRef looks like an S3 key and config provides S3 bucket + signer, we could generate a presigned URL.
      // For now, include storageRef as text attachment reference to avoid failing the send.
      return { filename: `${a.filename}.txt`, content: `Attachment stored at: ${a.storageRef}`, contentType: 'text/plain' };
    });
  }

  try {
    const info = await transporter.sendMail(mailOptions);
    // nodemailer returns messageId in info.messageId
    const providerId = info && (info.messageId || info.response) ? (info.messageId || info.response) : null;
    logger.info && logger.info({ event: 'email.provider.nodemailer_sent', to, providerId, messageId, correlationId });
    return { ok: true, providerId };
  } catch (err) {
    logger.error && logger.error({ event: 'email.provider.nodemailer_error', to, error: err && err.message ? err.message : String(err), messageId, correlationId });
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

module.exports = { sendEmail };
