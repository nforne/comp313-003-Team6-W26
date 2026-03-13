// src/jobs/bid.service.utils+.worker.js
/**
 * Bid worker helpers (polished, non-disruptive)
 *
 * - Pure, dependency-injected helpers for slot processing and message persistence/delivery.
 * - Preserves and propagates capacityNeeded from request.when through all derived segments.
 * - Expands into business-hour segments only when required and respects calendar off-limits.
 * - Returns structured conflict results when off-limits or capacity conflicts are detected so calling flows can act.
 *
 * Public API (exports):
 *  - processedBidSlots(requestWhen, requestMetadata, options)
 *  - splitSlotAcrossWeeks(slot)
 *  - startOfWeekUtc(epochMs)
 *  - endOfWeekUtc(epochMs)
 *  - startOfDayUtc(epochMs)
 *  - expandSegmentToBusinessHours(segment, options)
 *  - subtractOffLimits(candidates, offLimits)
 *  - normalizeWhenArray(whenArray)
 *  - defaultBusinessHoursForDay(dayStartEpoch, opts)
 *  - actorContext(actor)
 *  - persistAndSubmitMessage(payload, actorCtx, deps, correlationId)
 *  - deliverMessageIfPossible(messageDoc, actorCtx, deps, correlationId)
 *
 * Notes:
 *  - Worker performs no DB calls itself. All external lookups are injected via options:
 *      - options.getCalendar({ ownerId, serviceId, weekStartEpoch }) => mergedCalendar | null
 *      - options.getBusinessHoursForDay({ dayStartEpoch, calendar, options }) => [{from,to}]
 *      - options.checkCapacity?({ from, to, capacityNeeded, calendar }) => { ok: true } | { ok:false, code, message }
 *  - Weeks computed in UTC and start on Monday 00:00:00.000 UTC.
 */

'use strict';

const MS_PER_MIN = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MIN;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_WEEK = 7 * MS_PER_DAY;

const DEFAULT_BUSINESS_HOURS = { startHour: 9, endHour: 17 };

/* -------------------------
 * Week / day helpers
 * ------------------------- */

/**
 * Return Monday 00:00:00.000 UTC epoch ms for the week containing epochMs.
 */
function startOfWeekUtc(epochMs) {
  const d = new Date(Number(epochMs));
  const utcDay = d.getUTCDay(); // 0 (Sun) .. 6 (Sat)
  const daysToMonday = utcDay === 0 ? 6 : utcDay - 1;
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return dayStart - daysToMonday * MS_PER_DAY;
}

/**
 * Return end of week (next Monday 00:00 UTC) epoch ms.
 */
function endOfWeekUtc(epochMs) {
  return startOfWeekUtc(epochMs) + MS_PER_WEEK;
}

/**
 * Return start of UTC day epoch ms for epochMs.
 */
function startOfDayUtc(epochMs) {
  const d = new Date(Number(epochMs));
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/* -------------------------
 * Normalization
 * ------------------------- */

/**
 * Normalize request.when array into validated slots.
 * Each slot: { from:Number, to:Number, isBusinessHours:Boolean, capacityNeeded:Number }
 */
function normalizeWhenArray(whenArray) {
  if (!Array.isArray(whenArray)) return [];
  return whenArray
    .filter(Boolean)
    .map((w) => {
      const from = Number(w && w.from);
      const to = Number(w && w.to);
      const isBusinessHours = !!(w && w.isBusinessHours);
      const capacityNeeded = (w && typeof w.capacityNeeded === 'number') ? Number(w.capacityNeeded) : 1;
      return (Number.isFinite(from) && Number.isFinite(to) && to > from && Number.isInteger(capacityNeeded) && capacityNeeded >= 1)
        ? { from, to, isBusinessHours, capacityNeeded }
        : null;
    })
    .filter(Boolean);
}

/* -------------------------
 * Slot splitting
 * ------------------------- */

/**
 * Split a slot across week boundaries (Monday-based weeks).
 * Preserves capacityNeeded and isBusinessHours flag.
 */
function splitSlotAcrossWeeks(slot) {
  if (!slot || typeof slot.from !== 'number' || typeof slot.to !== 'number') return [];
  const from = Number(slot.from);
  const to = Number(slot.to);
  const capacityNeeded = Number.isFinite(Number(slot.capacityNeeded)) ? Number(slot.capacityNeeded) : 1;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];

  const segments = [];
  let cursor = from;

  while (cursor < to) {
    const weekEnd = endOfWeekUtc(cursor);
    const segEnd = Math.min(to, weekEnd);
    segments.push({
      from: cursor,
      to: segEnd,
      isBusinessHours: !!slot.isBusinessHours,
      capacityNeeded
    });
    cursor = segEnd;
  }

  return segments;
}

/* -------------------------
 * Defaults and helpers
 * ------------------------- */

function defaultBusinessHoursForDay(dayStartEpoch, opts = {}) {
  const bh = opts.businessHours || DEFAULT_BUSINESS_HOURS;
  const start = dayStartEpoch + bh.startHour * MS_PER_HOUR;
  const end = dayStartEpoch + bh.endHour * MS_PER_HOUR;
  if (end <= start) return [];
  return [{ from: start, to: end }];
}

/**
 * Subtract offLimits from candidate intervals.
 * candidates: [{from,to}], offLimits: [{fromEpoch,toEpoch}]
 * returns allowed intervals (candidates minus offLimits)
 */
function subtractOffLimits(candidates, offLimits) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  if (!Array.isArray(offLimits) || offLimits.length === 0) return candidates.slice();

  const offs = offLimits
    .map(o => ({ from: Number(o.fromEpoch), to: Number(o.toEpoch) }))
    .filter(o => Number.isFinite(o.from) && Number.isFinite(o.to) && o.to > o.from)
    .sort((a, b) => a.from - b.from);

  const result = [];

  for (const cand of candidates) {
    let curFrom = cand.from;
    let curTo = cand.to;

    for (const o of offs) {
      if (o.to <= curFrom) continue;
      if (o.from >= curTo) break;

      if (o.from > curFrom) {
        result.push({ from: curFrom, to: Math.min(curTo, o.from) });
      }
      curFrom = Math.max(curFrom, o.to);
      if (curFrom >= curTo) break;
    }

    if (curFrom < curTo) result.push({ from: curFrom, to: curTo });
  }

  return result;
}

/* -------------------------
 * Business-hours expansion per segment (async)
 * ------------------------- */

/**
 * Expand a week-aligned segment into per-day business-hours segments.
 * Preserves capacityNeeded. Uses injected options for calendar, business hours, and capacity checks.
 *
 * Options:
 *  - ownerId, serviceId
 *  - getCalendar({ ownerId, serviceId, weekStartEpoch }) => mergedCalendar | null
 *  - getBusinessHoursForDay({ dayStartEpoch, calendar, options }) => [{from,to}]
 *  - businessHours: fallback {startHour,endHour}
 *  - checkCapacity?({ from, to, capacityNeeded, calendar }) => { ok:true } | { ok:false, code, message }
 */
async function expandSegmentToBusinessHours(segment, options = {}) {
  const from = Number(segment.from);
  const to = Number(segment.to);
  const capacityNeeded = Number.isFinite(Number(segment.capacityNeeded)) ? Number(segment.capacityNeeded) : 1;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];

  const opts = options || {};
  const businessHoursFallback = opts.businessHours || DEFAULT_BUSINESS_HOURS;

  const dayStartFirst = startOfDayUtc(from);
  const dayStartLast = startOfDayUtc(to - 1);

  const results = [];

  // Fetch calendar once per segment if not provided
  let calendar = opts.calendar || null;
  if (!calendar && typeof opts.getCalendar === 'function') {
    try {
      const weekStart = startOfWeekUtc(from);
      calendar = await opts.getCalendar({ ownerId: opts.ownerId, serviceId: opts.serviceId, weekStartEpoch: weekStart });
    } catch (e) {
      calendar = null;
    }
  }

  for (let day = dayStartFirst; day <= dayStartLast; day += MS_PER_DAY) {
    let candidates = [];

    if (typeof opts.getBusinessHoursForDay === 'function') {
      try {
        const bh = await opts.getBusinessHoursForDay({ dayStartEpoch: day, calendar, options: opts });
        if (Array.isArray(bh) && bh.length) {
          candidates = bh.map(x => ({ from: Number(x.from), to: Number(x.to) })).filter(x => x.to > x.from);
        } else {
          candidates = defaultBusinessHoursForDay(day, { businessHours: businessHoursFallback });
        }
      } catch (e) {
        candidates = defaultBusinessHoursForDay(day, { businessHours: businessHoursFallback });
      }
    } else {
      candidates = defaultBusinessHoursForDay(day, { businessHours: businessHoursFallback });
    }

    // Clip to segment
    candidates = candidates
      .map(c => ({ from: Math.max(c.from, from), to: Math.min(c.to, to) }))
      .filter(c => c.to > c.from);

    // Subtract offLimits if calendar provides them
    if (calendar && Array.isArray(calendar.offLimitsSlots) && calendar.offLimitsSlots.length > 0) {
      const offs = calendar.offLimitsSlots
        .map(o => {
          if (o && typeof o.fromEpoch === 'number' && typeof o.toEpoch === 'number') return { fromEpoch: o.fromEpoch, toEpoch: o.toEpoch };
          if (o && typeof o.from === 'number' && typeof o.to === 'number') return { fromEpoch: o.from, toEpoch: o.to };
          return null;
        })
        .filter(Boolean);

      if (offs.length > 0) {
        const allowed = subtractOffLimits(candidates, offs);
        for (const a of allowed) results.push({ from: a.from, to: a.to, isBusinessHours: true, capacityNeeded });
        continue;
      }
    }

    for (const c of candidates) results.push({ from: c.from, to: c.to, isBusinessHours: true, capacityNeeded });
  }

  return results;
}

/* -------------------------
 * Main processor (async)
 * ------------------------- */

/**
 * processedBidSlots(requestWhen, requestMetadata, options)
 *
 * - requestWhen: array of when slots from Request
 * - requestMetadata: object; reads IsMultipleBusinessDays (case-insensitive)
 * - options:
 *    - ownerId, serviceId
 *    - getCalendar({ownerId,serviceId,weekStartEpoch}) async
 *    - getBusinessHoursForDay({dayStartEpoch, calendar, options}) async
 *    - checkCapacity?({ from, to, capacityNeeded, calendar }) async
 *    - businessHours: fallback {startHour,endHour}
 *
 * Returns:
 *  - { ok: true, slots: [ {from,to,isBusinessHours,capacityNeeded} ] }
 *  - OR { ok: false, code: 'OFF_LIMITS_CONFLICT'|'CAPACITY_CONFLICT', conflicts: [ { segment, reason, details } ] }
 */
async function processedBidSlots(requestWhen = [], requestMetadata = {}, options = {}) {
  const normalized = normalizeWhenArray(requestWhen);
  const meta = requestMetadata || {};
  const flagKey = Object.keys(meta).find(k => k.toLowerCase() === 'ismultiplebusinessdays');
  const isMultipleBusinessDays = !!(flagKey ? meta[flagKey] : meta.IsMultipleBusinessDays);

  const derived = [];
  const conflicts = [];

  for (const slot of normalized) {
    const parts = splitSlotAcrossWeeks(slot);
    const crossesWeek = parts.length > 1;
    const needsBusinessExpansion = isMultipleBusinessDays || !!slot.isBusinessHours;

    // If single-week and no expansion required, quick checks
    if (!crossesWeek && !needsBusinessExpansion) {
      let calendar = options.calendar || null;
      if (!calendar && typeof options.getCalendar === 'function') {
        try {
          const weekStart = startOfWeekUtc(slot.from);
          calendar = await options.getCalendar({ ownerId: options.ownerId, serviceId: options.serviceId, weekStartEpoch: weekStart });
        } catch (e) {
          calendar = null;
        }
      }

      if (calendar && Array.isArray(calendar.offLimitsSlots) && calendar.offLimitsSlots.length > 0) {
        const offs = calendar.offLimitsSlots
          .map(o => {
            if (o && typeof o.fromEpoch === 'number' && typeof o.toEpoch === 'number') return { fromEpoch: o.fromEpoch, toEpoch: o.toEpoch };
            if (o && typeof o.from === 'number' && typeof o.to === 'number') return { fromEpoch: o.from, toEpoch: o.to };
            return null;
          })
          .filter(Boolean);

        const overlap = offs.find(o => o.fromEpoch < slot.to && o.toEpoch > slot.from);
        if (overlap) {
          conflicts.push({
            segment: { from: slot.from, to: slot.to, capacityNeeded: slot.capacityNeeded },
            reason: 'OFF_LIMITS',
            details: { overlap }
          });
          continue;
        }
      }

      if (typeof options.checkCapacity === 'function') {
        try {
          const capRes = await options.checkCapacity({ from: slot.from, to: slot.to, capacityNeeded: slot.capacityNeeded, calendar: calendar, ownerId: options.ownerId, serviceId: options.serviceId });
          if (!capRes || !capRes.ok) {
            conflicts.push({
              segment: { from: slot.from, to: slot.to, capacityNeeded: slot.capacityNeeded },
              reason: 'CAPACITY',
              details: { message: capRes && capRes.message ? capRes.message : 'capacity exceeded' }
            });
            continue;
          }
        } catch (e) {
          conflicts.push({
            segment: { from: slot.from, to: slot.to, capacityNeeded: slot.capacityNeeded },
            reason: 'CAPACITY_CHECK_FAILED',
            details: { error: e && e.message ? e.message : String(e) }
          });
          continue;
        }
      }

      derived.push({ from: slot.from, to: slot.to, isBusinessHours: !!slot.isBusinessHours, capacityNeeded: slot.capacityNeeded });
      continue;
    }

    // Otherwise process each week-aligned part
    for (const p of parts) {
      const segmentNeedsExpansion = isMultipleBusinessDays || !!p.isBusinessHours;
      if (!segmentNeedsExpansion) {
        let calendar = options.calendar || null;
        if (!calendar && typeof options.getCalendar === 'function') {
          try {
            const weekStart = startOfWeekUtc(p.from);
            calendar = await options.getCalendar({ ownerId: options.ownerId, serviceId: options.serviceId, weekStartEpoch: weekStart });
          } catch (e) {
            calendar = null;
          }
        }

        if (calendar && Array.isArray(calendar.offLimitsSlots) && calendar.offLimitsSlots.length > 0) {
          const offs = calendar.offLimitsSlots
            .map(o => {
              if (o && typeof o.fromEpoch === 'number' && typeof o.toEpoch === 'number') return { fromEpoch: o.fromEpoch, toEpoch: o.toEpoch };
              if (o && typeof o.from === 'number' && typeof o.to === 'number') return { fromEpoch: o.from, toEpoch: o.to };
              return null;
            })
            .filter(Boolean);

          const overlap = offs.find(o => o.fromEpoch < p.to && o.toEpoch > p.from);
          if (overlap) {
            conflicts.push({
              segment: { from: p.from, to: p.to, capacityNeeded: p.capacityNeeded },
              reason: 'OFF_LIMITS',
              details: { overlap }
            });
            continue;
          }
        }

        if (typeof options.checkCapacity === 'function') {
          try {
            const capRes = await options.checkCapacity({ from: p.from, to: p.to, capacityNeeded: p.capacityNeeded, calendar: calendar, ownerId: options.ownerId, serviceId: options.serviceId });
            if (!capRes || !capRes.ok) {
              conflicts.push({
                segment: { from: p.from, to: p.to, capacityNeeded: p.capacityNeeded },
                reason: 'CAPACITY',
                details: { message: capRes && capRes.message ? capRes.message : 'capacity exceeded' }
              });
              continue;
            }
          } catch (e) {
            conflicts.push({
              segment: { from: p.from, to: p.to, capacityNeeded: p.capacityNeeded },
              reason: 'CAPACITY_CHECK_FAILED',
              details: { error: e && e.message ? e.message : String(e) }
            });
            continue;
          }
        }

        derived.push({ from: p.from, to: p.to, isBusinessHours: !!p.isBusinessHours, capacityNeeded: p.capacityNeeded });
        continue;
      }

      // expansion required
      const expanded = await expandSegmentToBusinessHours(p, Object.assign({}, options, { calendar: options.calendar }));
      if (!expanded || expanded.length === 0) {
        conflicts.push({
          segment: { from: p.from, to: p.to, capacityNeeded: p.capacityNeeded },
          reason: 'OFF_LIMITS',
          details: { message: 'segment fully blocked by off-limits' }
        });
        continue;
      }

      for (const e of expanded) {
        if (typeof options.checkCapacity === 'function') {
          try {
            const capRes = await options.checkCapacity({ from: e.from, to: e.to, capacityNeeded: e.capacityNeeded || p.capacityNeeded, calendar: options.calendar, ownerId: options.ownerId, serviceId: options.serviceId });
            if (!capRes || !capRes.ok) {
              conflicts.push({
                segment: { from: e.from, to: e.to, capacityNeeded: e.capacityNeeded || p.capacityNeeded },
                reason: 'CAPACITY',
                details: { message: capRes && capRes.message ? capRes.message : 'capacity exceeded' }
              });
              continue;
            }
          } catch (err) {
            conflicts.push({
              segment: { from: e.from, to: e.to, capacityNeeded: e.capacityNeeded || p.capacityNeeded },
              reason: 'CAPACITY_CHECK_FAILED',
              details: { error: err && err.message ? err.message : String(err) }
            });
            continue;
          }
        }

        derived.push({ from: Number(e.from), to: Number(e.to), isBusinessHours: true, capacityNeeded: Number(e.capacityNeeded || p.capacityNeeded) });
      }
    }
  }

  if (conflicts.length > 0) {
    const hasOff = conflicts.some(c => c.reason && c.reason.startsWith('OFF_LIMITS'));
    const code = hasOff ? 'OFF_LIMITS_CONFLICT' : 'CAPACITY_CONFLICT';
    return { ok: false, code, conflicts };
  }

  // merge contiguous segments with same attributes
  derived.sort((a, b) => a.from - b.from);
  const merged = [];
  for (const seg of derived) {
    if (!merged.length) {
      merged.push(Object.assign({}, seg));
      continue;
    }
    const last = merged[merged.length - 1];
    if (last.to === seg.from && last.isBusinessHours === seg.isBusinessHours && last.capacityNeeded === seg.capacityNeeded) {
      last.to = seg.to;
    } else {
      merged.push(Object.assign({}, seg));
    }
  }

  return { ok: true, slots: merged };
}

/* -------------------------
 * Message helpers (defensive)
 * ------------------------- */

/**
 * actorContext helper for audit/message payloads.
 */
function actorContext(actor) {
  return { userId: actor && actor.userId ? actor.userId : null, role: actor && actor.role ? actor.role : null };
}

/**
 * Persist and submit a message using injected deps (messageRepo, MessageModel, auditService).
 * Defensive: best-effort, returns messageDoc or null.
 */
async function persistAndSubmitMessage(payload, actorCtx, deps = {}, correlationId = null) {
  const { messageRepo, MessageModel, auditService } = deps || {};
  let messageDoc = null;

  if (messageRepo && typeof messageRepo.createMessage === 'function') {
    try {
      messageDoc = await messageRepo.createMessage(payload);
      if (messageDoc && messageDoc._id && MessageModel && typeof MessageModel.findById === 'function') {
        try { messageDoc = await MessageModel.findById(messageDoc._id).exec(); } catch (_) { /* ignore */ }
      }
      if (messageDoc && typeof messageDoc.markSubmitted === 'function') {
        try { await messageDoc.markSubmitted({ sentAt: new Date() }); } catch (_) { /* ignore */ }
      } else if (messageDoc && messageDoc._id && typeof messageRepo.updateMessage === 'function') {
        try { await messageRepo.updateMessage(messageDoc._id, { status: 'submitted', visible: true, 'metadata.sentAt': Date.now() }); } catch (_) { /* ignore */ }
        if (MessageModel && typeof MessageModel.findById === 'function') {
          try { messageDoc = await MessageModel.findById(messageDoc._id).exec(); } catch (_) { /* ignore */ }
        }
      }
    } catch (err) {
      if (auditService && typeof auditService.logEvent === 'function') {
        await auditService.logEvent({
          eventType: 'bid.message.create_failed',
          actor: actorCtx,
          target: { type: 'Request', id: payload && payload.metadata && payload.metadata.requestId ? payload.metadata.requestId : null },
          outcome: 'failure',
          severity: 'warning',
          correlationId,
          details: { error: err && err.message }
        });
      }
      messageDoc = null;
    }
  }

  if (!messageDoc && MessageModel && typeof MessageModel.buildDraft === 'function') {
    try {
      const draft = MessageModel.buildDraft(Object.assign({}, payload, { status: 'draft' }));
      messageDoc = await draft.save();
      if (messageDoc && typeof messageDoc.markSubmitted === 'function') {
        try { await messageDoc.markSubmitted({ sentAt: new Date() }); } catch (_) { /* ignore */ }
      } else if (messageRepo && typeof messageRepo.updateMessage === 'function') {
        try { await messageRepo.updateMessage(messageDoc._id, { status: 'submitted', visible: true, 'metadata.sentAt': Date.now() }); } catch (_) { /* ignore */ }
        try { messageDoc = await MessageModel.findById(messageDoc._id).exec(); } catch (_) { /* ignore */ }
      }
    } catch (err) {
      if (auditService && typeof auditService.logEvent === 'function') {
        await auditService.logEvent({
          eventType: 'bid.message.model_failed',
          actor: actorCtx,
          target: { type: 'Request', id: payload && payload.metadata && payload.metadata.requestId ? payload.metadata.requestId : null },
          outcome: 'failure',
          severity: 'warning',
          correlationId,
          details: { error: err && err.message }
        });
      }
      messageDoc = null;
    }
  }

  return messageDoc;
}

/**
 * Deliver message if possible using commsJs; logs via auditService.
 */
async function deliverMessageIfPossible(messageDoc, actorCtx, deps = {}, correlationId = null) {
  const { MessageModel, commsJs, auditService } = deps || {};

  if (!messageDoc || !messageDoc._id) {
    if (auditService && typeof auditService.logEvent === 'function') {
      await auditService.logEvent({
        eventType: 'bid.message.deliver_skipped',
        actor: actorCtx,
        target: { type: 'Message', id: null },
        outcome: 'info',
        severity: 'info',
        correlationId,
        details: { reason: 'no_message' }
      });
    }
    return;
  }

  let doc = messageDoc;
  if (!doc.status && MessageModel && typeof MessageModel.findById === 'function') {
    try { doc = await MessageModel.findById(messageDoc._id).exec(); } catch (_) { doc = messageDoc; }
  }

  if (!doc || doc.status !== 'submitted') {
    if (auditService && typeof auditService.logEvent === 'function') {
      await auditService.logEvent({
        eventType: 'bid.message.deliver_skipped',
        actor: actorCtx,
        target: { type: 'Message', id: messageDoc._id.toString() },
        outcome: 'info',
        severity: 'info',
        correlationId,
        details: { reason: 'not_submitted', status: doc && doc.status }
      });
    }
    return;
  }

  if (commsJs && typeof commsJs.deliverMessage === 'function') {
    try {
      await commsJs.deliverMessage(messageDoc._id, { actor: actorCtx, logger: console, correlationId, asyncBroadcast: true });
      if (auditService && typeof auditService.logEvent === 'function') {
        await auditService.logEvent({
          eventType: 'bid.message.delivered',
          actor: actorCtx,
          target: { type: 'Message', id: messageDoc._id.toString() },
          outcome: 'success',
          severity: 'info',
          correlationId
        });
      }
    } catch (deliverErr) {
      if (auditService && typeof auditService.logEvent === 'function') {
        await auditService.logEvent({
          eventType: 'bid.message.deliver_failed',
          actor: actorCtx,
          target: { type: 'Message', id: messageDoc._id ? messageDoc._id.toString() : null },
          outcome: 'failure',
          severity: 'warning',
          correlationId,
          details: { error: deliverErr && deliverErr.message ? deliverErr.message : String(deliverErr) }
        });
      }
    }
  } else if (auditService && typeof auditService.logEvent === 'function') {
    await auditService.logEvent({
      eventType: 'bid.message.deliver_skipped',
      actor: actorCtx,
      target: { type: 'Message', id: messageDoc._id.toString() },
      outcome: 'info',
      severity: 'info',
      correlationId,
      details: { reason: 'comms-js not available' }
    });
  }
}

/* -------------------------
 * Exports
 * ------------------------- */

module.exports = {
  processedBidSlots,
  splitSlotAcrossWeeks,
  startOfWeekUtc,
  endOfWeekUtc,
  startOfDayUtc,
  expandSegmentToBusinessHours,
  subtractOffLimits,
  normalizeWhenArray,
  defaultBusinessHoursForDay,
  actorContext,
  persistAndSubmitMessage,
  deliverMessageIfPossible
};
