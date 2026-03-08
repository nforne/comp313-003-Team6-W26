// src/comms-js/templates/preview.js
//
// Template preview helper for comms-js
// - Renders preview payloads for admin UI and QA using the renderer and template repository.
// - Produces safe, truncated previews for each channel and returns structured warnings/errors.
// - Does NOT persist anything; intended for previewing only.
//
// Usage:
//   const previewer = createPreviewer({ templateRepo, renderer, logger });
//   const res = await previewer.previewTemplate('auth.signin_success', 'en-US', { userName: 'A', device: 'Chrome' }, ['email','in_app']);

const { createRenderer } = require('./renderer');

const DEFAULT_PREVIEW_CHANNELS = ['in_app', 'websocket', 'push', 'email'];

/**
 * createPreviewer
 * @param {Object} deps
 *  { templateRepo, renderer (optional), config, logger }
 */
function createPreviewer(deps = {}) {
  const { templateRepo, renderer = null, config = {}, logger = console } = deps;
  if (!templateRepo) throw new Error('templateRepo required');

  // If renderer not provided, create one using templateRepo and config
  const _renderer = renderer || createRenderer({ templateRepo, config, logger });

  /**
   * _safePreviewString
   * - Returns a short, safe preview string for UI display.
   */
  function _safePreviewString(str, max = 300) {
    if (str === null || typeof str === 'undefined') return '';
    const s = String(str);
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + '…';
  }

  /**
   * previewTemplate
   * - Renders one or more channels for the active template using provided payload (or examplePayload).
   * - channels: optional array of channel names to render; defaults to common channels.
   * - returns { ok, templateId, version, locale, previews: { channel: { ok, rendered, warnings, errors, snapshotPreview } }, errors }
   */
  async function previewTemplate(templateId, locale = null, payload = {}, channels = null) {
    const useLocale = locale || (config && config.defaultLocale) || 'en-US';
    const tpl = await templateRepo.findActive(templateId);
    if (!tpl) return { ok: false, error: 'template_not_found' };

    // If no payload provided, use examplePayload from template
    const effectivePayload = (payload && Object.keys(payload).length > 0) ? payload : (tpl.examplePayload || {});

    // Determine channels to render
    const channelList = Array.isArray(channels) && channels.length > 0 ? channels : (tpl.channels || []).map((c) => c.name).filter(Boolean);
    if (channelList.length === 0) {
      // fallback to default common channels
      channelList.push(...DEFAULT_PREVIEW_CHANNELS);
    }

    const results = {};
    for (const ch of channelList) {
      try {
        const r = await _renderer.renderTemplate(templateId, useLocale, effectivePayload, ch, { preview: true });
        if (!r.ok) {
          results[ch] = { ok: false, error: r.error || 'render_failed', details: r.details || null };
          continue;
        }

        // Build a compact snapshot preview suitable for UI
        const snap = r.snapshot || {};
        const rendered = r.rendered || {};
        const preview = {
          ok: true,
          rendered: {
            subject: _safePreviewString(rendered.subject || ''),
            title: _safePreviewString(rendered.title || ''),
            body: _safePreviewString(rendered.body || '', 800),
            bodyHtml: _safePreviewString(rendered.bodyHtml || '', 2000),
            cta: rendered.cta || null
          },
          warnings: r.warnings || [],
          snapshot: {
            templateId: snap.templateId,
            version: snap.version,
            locale: snap.locale,
            renderedAt: snap.renderedAt,
            channel: snap.channel,
            payloadPreview: snap.payloadPreview
          }
        };

        results[ch] = preview;
      } catch (err) {
        logger && logger.error && logger.error({ event: 'templates.preview_error', templateId, channel: ch, error: err && err.message });
        results[ch] = { ok: false, error: 'exception', message: err && err.message };
      }
    }

    return {
      ok: true,
      templateId: tpl.id,
      version: tpl.version,
      locale: useLocale,
      payloadUsed: effectivePayload,
      previews: results
    };
  }

  /**
   * previewFromTemplateObject
   * - Accepts a full template object (not persisted) and renders channels for preview.
   * - Useful for "preview before save" flows in admin UI.
   */
  async function previewFromTemplateObject(templateObj, locale = null, payload = {}, channels = null) {
    if (!templateObj || !templateObj.id) return { ok: false, error: 'template_object_required' };

    // Create a lightweight in-memory repo wrapper that returns this template as active
    const tempRepo = {
      findActive: async (id) => {
        if (id === templateObj.id) return templateObj;
        return null;
      }
    };

    const tempRenderer = createRenderer({ templateRepo: tempRepo, config, logger });
    const effectivePayload = (payload && Object.keys(payload).length > 0) ? payload : (templateObj.examplePayload || {});
    const channelList = Array.isArray(channels) && channels.length > 0 ? channels : (templateObj.channels || []).map((c) => c.name).filter(Boolean);
    if (channelList.length === 0) channelList.push(...DEFAULT_PREVIEW_CHANNELS);

    const results = {};
    for (const ch of channelList) {
      try {
        const r = await tempRenderer.renderTemplate(templateObj.id, locale || config.defaultLocale || 'en-US', effectivePayload, ch, { preview: true });
        if (!r.ok) {
          results[ch] = { ok: false, error: r.error, details: r.details || null };
          continue;
        }
        results[ch] = {
          ok: true,
          rendered: {
            subject: _safePreviewString(r.rendered.subject || ''),
            title: _safePreviewString(r.rendered.title || ''),
            body: _safePreviewString(r.rendered.body || '', 800),
            bodyHtml: _safePreviewString(r.rendered.bodyHtml || '', 2000),
            cta: r.rendered.cta || null
          },
          warnings: r.warnings || [],
          snapshot: r.snapshot || null
        };
      } catch (err) {
        results[ch] = { ok: false, error: 'exception', message: err && err.message };
      }
    }

    return {
      ok: true,
      templateId: templateObj.id,
      version: templateObj.version || 0,
      locale: locale || config.defaultLocale || 'en-US',
      payloadUsed: effectivePayload,
      previews: results
    };
  }

  return {
    previewTemplate,
    previewFromTemplateObject
  };
}

module.exports = { createPreviewer };
