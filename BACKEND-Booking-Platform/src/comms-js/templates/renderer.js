// src/comms-js/templates/renderer.js
//
// Template renderer for comms-js
// - Renders templates (in-app, websocket, push, email, sms) with placeholder validation,
//   i18n overrides, sanitization, and channel-specific limits.
// - Produces a render snapshot suitable for persisting on message records:
//   { templateId, version, locale, renderedAt, channel, payloadPreview, rendered }
// - Designed to be used with the template repository (createTemplateRepo).
//
// Usage:
//   const renderer = createRenderer({ templateRepo, config, logger });
//   const result = await renderer.renderTemplate(templateId, 'en-US', payload, 'email');
//   // result: { ok: true, rendered: { subject, body, bodyHtml, cta }, snapshot: {...} }

const escapeHtml = (str) => {
  if (str === null || typeof str === 'undefined') return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const DEFAULT_LIMITS = {
  push: { titleMaxLength: 50, bodyMaxLength: 120 },
  in_app: { titleMaxLength: 100, bodyMaxLength: 1000 },
  websocket: { titleMaxLength: 100, bodyMaxLength: 1000 },
  email: { titleMaxLength: 200, bodyMaxLength: 10000 }
};

function _applyLimits(text, max) {
  if (typeof max !== 'number' || max <= 0) return text;
  if (!text || text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

function _renderString(templateStr, values, opts = {}) {
  // Simple named placeholder replacement: {{name}}
  // - values are escaped by default for safety; caller may request raw insertion for bodyHtml.
  const escape = opts.raw ? (v) => (v === null || typeof v === 'undefined' ? '' : String(v)) : escapeHtml;
  return String(templateStr).replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (m, key) => {
    // support nested keys like user.name
    const parts = key.split('.');
    let v = values;
    for (const p of parts) {
      if (v && Object.prototype.hasOwnProperty.call(v, p)) v = v[p];
      else { v = undefined; break; }
    }
    return escape(v);
  });
}

function _typeCheck(value, expectedType) {
  if (expectedType === 'string') return typeof value === 'string';
  if (expectedType === 'number') return typeof value === 'number' && !Number.isNaN(value);
  if (expectedType === 'boolean') return typeof value === 'boolean';
  if (expectedType === 'date') return (typeof value === 'string' || value instanceof Date);
  if (expectedType === 'url') return typeof value === 'string';
  if (expectedType === 'object') return value && typeof value === 'object' && !Array.isArray(value);
  if (expectedType === 'array') return Array.isArray(value);
  return true;
}

/**
 * createRenderer
 * @param {Object} deps
 *  { templateRepo, config, logger }
 */
function createRenderer(deps = {}) {
  const { templateRepo, config = {}, logger = console } = deps;
  if (!templateRepo || typeof templateRepo.findActive !== 'function') {
    throw new Error('templateRepo with findActive(id) required');
  }

  const defaultLocale = config.defaultLocale || 'en-US';

  /**
   * loadTemplateWithLocale
   * - Fetches active template and applies locale overrides if present.
   */
  async function loadTemplateWithLocale(templateId, locale) {
    const tpl = await templateRepo.findActive(templateId);
    if (!tpl) return null;

    // shallow clone
    const merged = JSON.parse(JSON.stringify(tpl));

    // apply locale overrides if present
    const loc = (merged.locales && locale && merged.locales[locale]) ? merged.locales[locale] : null;
    if (loc && Array.isArray(loc.channels)) {
      // map overrides by channel name
      const overrides = {};
      for (const ch of loc.channels) {
        if (ch && ch.name) overrides[ch.name] = ch;
      }
      merged.channels = merged.channels.map((c) => {
        if (overrides[c.name]) {
          return Object.assign({}, c, overrides[c.name]);
        }
        return c;
      });
    }

    return merged;
  }

  /**
   * validatePayloadAgainstPlaceholders
   * - Ensures required placeholders exist and types match (best-effort).
   */
  function validatePayloadAgainstPlaceholders(placeholders = {}, payload = {}) {
    const errors = [];
    for (const [key, spec] of Object.entries(placeholders || {})) {
      const required = (typeof spec.required === 'undefined') ? true : !!spec.required;
      const parts = key.split('.');
      let v = payload;
      for (const p of parts) {
        if (v && Object.prototype.hasOwnProperty.call(v, p)) v = v[p];
        else { v = undefined; break; }
      }
      if (typeof v === 'undefined' || v === null) {
        if (required) errors.push({ key, error: 'missing' });
        continue;
      }
      if (spec.type && !_typeCheck(v, spec.type)) {
        errors.push({ key, error: 'type_mismatch', expected: spec.type, actual: typeof v });
      }
    }
    return errors;
  }

  /**
   * findChannelTemplate
   */
  function findChannelTemplate(template, channelName) {
    if (!template || !Array.isArray(template.channels)) return null;
    return template.channels.find((c) => c.name === channelName) || null;
  }

  /**
   * renderTemplate
   * - Renders a single channel for a template id and payload.
   * - Returns { ok, rendered, warnings, errors, snapshot }
   */
  async function renderTemplate(templateId, locale, payload = {}, channelName, opts = {}) {
    const useLocale = locale || defaultLocale;
    const template = await loadTemplateWithLocale(templateId, useLocale);
    if (!template) return { ok: false, error: 'template_not_found' };

    const channel = findChannelTemplate(template, channelName);
    if (!channel) return { ok: false, error: 'channel_not_found' };

    // validate placeholders
    const placeholderErrors = validatePayloadAgainstPlaceholders(template.placeholders, payload);
    if (placeholderErrors.length > 0) {
      return { ok: false, error: 'payload_validation_failed', details: placeholderErrors };
    }

    const warnings = [];

    // determine limits: channel.limits overrides defaults
    const limits = Object.assign({}, DEFAULT_LIMITS[channelName] || {}, channel.limits || {});

    // Render fields
    const rendered = {};
    // subject (email/push)
    if (channel.subject) {
      rendered.subject = _renderString(channel.subject, payload, { raw: false });
      if (limits.titleMaxLength && rendered.subject.length > limits.titleMaxLength) {
        rendered.subject = _applyLimits(rendered.subject, limits.titleMaxLength);
        warnings.push({ field: 'subject', warning: 'truncated' });
      }
    }

    // title (in_app/push/websocket)
    if (channel.title) {
      rendered.title = _renderString(channel.title, payload, { raw: false });
      if (limits.titleMaxLength && rendered.title.length > limits.titleMaxLength) {
        rendered.title = _applyLimits(rendered.title, limits.titleMaxLength);
        warnings.push({ field: 'title', warning: 'truncated' });
      }
    }

    // body (plain text)
    if (channel.body) {
      rendered.body = _renderString(channel.body, payload, { raw: false });
      if (limits.bodyMaxLength && rendered.body.length > limits.bodyMaxLength) {
        rendered.body = _applyLimits(rendered.body, limits.bodyMaxLength);
        warnings.push({ field: 'body', warning: 'truncated' });
      }
    }

    // bodyHtml (email) - allow raw insertion but sanitize by escaping placeholders; caller should still sanitize before sending
    if (channel.bodyHtml) {
      // For bodyHtml we render placeholders without escaping HTML in the template itself,
      // but we still escape inserted values to avoid injection.
      // _renderString with raw=true will NOT escape; we therefore use raw=false to escape values.
      rendered.bodyHtml = _renderString(channel.bodyHtml, payload, { raw: false });
      // No length enforcement for HTML here; email provider should enforce size limits.
    }

    // CTA
    if (channel.cta) {
      const cta = {};
      if (channel.cta.label) cta.label = _renderString(channel.cta.label, payload, { raw: false });
      if (channel.cta.url) cta.url = _renderString(channel.cta.url, payload, { raw: false });
      if (channel.cta.deepLink) cta.deepLink = _renderString(channel.cta.deepLink, payload, { raw: false });
      rendered.cta = cta;
    }

    // Additional channel-specific payload (for websocket/in_app we include messageId, deepLink etc. at send time)
    // Provide a minimal payload preview for snapshot/audit
    const payloadPreview = {};
    for (const k of Object.keys(payload || {})) {
      const v = payload[k];
      // include primitives and short strings only
      if (v === null || typeof v === 'undefined') continue;
      if (typeof v === 'string' && v.length > 200) payloadPreview[k] = v.slice(0, 197) + '…';
      else if (typeof v === 'object') payloadPreview[k] = '[object]';
      else payloadPreview[k] = v;
    }

    const snapshot = {
      templateId: template.id,
      version: template.version,
      locale: useLocale,
      renderedAt: new Date().toISOString(),
      channel: channelName,
      payloadPreview,
      rendered: {
        subject: rendered.subject || null,
        title: rendered.title || null,
        body: rendered.body || null,
        bodyHtml: rendered.bodyHtml || null,
        cta: rendered.cta || null
      }
    };

    return { ok: true, rendered, warnings, snapshot };
  }

  /**
   * renderAllChannels
   * - Renders all channels defined on the active template for the given locale/payload.
   * - Returns map of channelName -> render result.
   */
  async function renderAllChannels(templateId, locale, payload = {}, opts = {}) {
    const useLocale = locale || defaultLocale;
    const template = await loadTemplateWithLocale(templateId, useLocale);
    if (!template) return { ok: false, error: 'template_not_found' };

    const results = {};
    for (const ch of template.channels || []) {
      try {
        const r = await renderTemplate(templateId, useLocale, payload, ch.name, opts);
        results[ch.name] = r;
      } catch (err) {
        logger && logger.error && logger.error({ event: 'templates.render_error', templateId, channel: ch.name, error: err && err.message });
        results[ch.name] = { ok: false, error: 'render_exception', message: err && err.message };
      }
    }
    return { ok: true, templateId, version: template.version, results };
  }

  return {
    renderTemplate,
    renderAllChannels
  };
}

module.exports = { createRenderer };
