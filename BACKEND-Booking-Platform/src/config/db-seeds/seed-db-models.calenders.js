// src/config/db-seeds/seed-db-models.calenders.js
//
// Idempotent DB seed for calendars collection.
// - Creates one weekly calendar per seeded user (user-level calendar).
// - Creates one weekly calendar per service (service-level calendar) for services owned by seeded providers.
// - Each calendar is materialized for the current week (Monday 00:00 UTC -> Sunday 23:59:59.999 UTC).
// - Each calendar includes sensible default off-limits slots (outside business hours) for every weekday.
// - Exports async run() which is safe to call on server start; skips calendars that already exist for the same owner/service + week.
// - Non-disruptive: does not create bookingsSlots (those are created by booking flows later) and will not overwrite existing calendars.

'use strict';

const mongoose = require('mongoose');
const { Calendar, mondayStartEpoch, sundayEndEpoch } = require('../../models/calendar.model');
const User = require('../../models/user.model');
const Service = require('../../models/service.model');

/**
 * Default business hours (local concept expressed in UTC for seed simplicity).
 * We treat business hours as 09:00 - 17:00 (UTC) and mark everything outside as off-limits.
 *
 * NOTE: In production you should compute business hours per-user timezone. For seeding we use UTC offsets
 * so results are deterministic and safe.
 */
const BUSINESS_START_HOUR = 9;   // 09:00
const BUSINESS_END_HOUR = 17;    // 17:00

/**
 * Build offLimitsSlots for a week starting at mondayEpoch.
 * - For each weekday (1..7) create two off-limits slots:
 *     1) midnight -> BUSINESS_START_HOUR
 *     2) BUSINESS_END_HOUR -> next midnight
 *
 * Returns array of OffLimitSlot objects matching Calendar model sub-schema.
 */
function buildWeeklyOffLimits(mondayEpoch) {
  const dayMs = 24 * 60 * 60 * 1000;
  const slots = [];

  for (let weekday = 1; weekday <= 7; weekday++) {
    const dayStart = mondayEpoch + (weekday - 1) * dayMs;

    // midnight -> business start
    const from1 = dayStart;
    const to1 = dayStart + BUSINESS_START_HOUR * 60 * 60 * 1000;
    if (from1 < to1) {
      slots.push({
        weekday,
        fromEpoch: from1,
        toEpoch: to1,
        reason: 'Outside business hours (before)'
      });
    }

    // business end -> next midnight
    const from2 = dayStart + BUSINESS_END_HOUR * 60 * 60 * 1000;
    const to2 = dayStart + dayMs; // next midnight
    if (from2 < to2) {
      slots.push({
        weekday,
        fromEpoch: from2,
        toEpoch: to2,
        reason: 'Outside business hours (after)'
      });
    }
  }

  return slots;
}

/**
 * run
 * - Idempotent: checks for existing calendar documents for the same owner/service and week startEpoch.
 * - Creates calendars where missing and returns a summary.
 */
async function run() {
  const summary = { created: [], skipped: [], errors: [] };

  try {
    // Resolve seeded users by stable userId values used in users seed.
    // If your users seed uses different userIds, adjust these values accordingly.
    const seededUserIds = [
      '1000000000000001', // Alice (seeker)
      '1000000000000002', // Bob (provider)
      '1000000000000003', // Carol (provider)
      '1000000000000004'  // Dana (admin)
    ];

    // Find user documents (we need ObjectId for ownerId)
    const users = await User.find({ userId: { $in: seededUserIds } }).exec();
    const userByUserId = {};
    for (const u of users) userByUserId[String(u.userId)] = u;

    // Determine week bracket (current week)
    const now = Date.now();
    const monday = mondayStartEpoch(now);
    const sunday = sundayEndEpoch(monday);

    // Build default off-limits for the week
    const defaultOffLimits = buildWeeklyOffLimits(monday);

    // 1) Create user-level calendars
    for (const uid of seededUserIds) {
      const userDoc = userByUserId[uid];
      if (!userDoc) {
        summary.skipped.push({ type: 'user-calendar', userId: uid, reason: 'user not found' });
        continue;
      }

      // Query by ownerId (ObjectId) and week startEpoch
      const existing = await Calendar.findOne({ ownerId: userDoc._id, 'datesBracket.startEpoch': monday, serviceId: { $in: [null, undefined] } }).exec();
      if (existing) {
        summary.skipped.push({ type: 'user-calendar', userId: uid, calendarId: existing._id.toString() });
        continue;
      }

      const payload = {
        ownerId: userDoc._id,
        serviceId: undefined,
        timezone: 'UTC',
        capacity: 1,
        datesBracket: { startEpoch: monday, endEpoch: sunday },
        offLimitsSlots: defaultOffLimits,
        bookingsSlots: [],
        isOverflow: false,
        docSizeBytes: 0,
        metadata: { seeded: true, seedFor: 'user' },
        createdAtEpoch: Date.now(),
        updatedAtEpoch: Date.now()
      };

      try {
        const created = await Calendar.create(payload);
        summary.created.push({ type: 'user-calendar', userId: uid, calendarId: created._id.toString() });
      } catch (err) {
        // possible race on unique index; try to fetch existing and skip
        if (err && err.code === 11000) {
          const existingAfter = await Calendar.findOne({ ownerId: userDoc._id, 'datesBracket.startEpoch': monday, serviceId: { $in: [null, undefined] } }).exec();
          if (existingAfter) {
            summary.skipped.push({ type: 'user-calendar', userId: uid, calendarId: existingAfter._id.toString(), note: 'race-created by another process' });
            continue;
          }
        }
        summary.errors.push({ type: 'user-calendar', userId: uid, message: err && err.message });
      }
    }

    // 2) Create service-level calendars for services owned by seeded providers
    // Find services whose providerId matches seeded provider userIds
    const providerUserIds = seededUserIds.filter(id => {
      // treat all seeded users as potential providers; service search will return actual services
      return true;
    });

    // Query services where providerId is one of seeded userIds
    const services = await Service.find({ providerId: { $in: seededUserIds } }).exec();

    for (const svc of services) {
      // Resolve provider user document to get ownerId ObjectId
      const providerUser = userByUserId[String(svc.providerId)];
      if (!providerUser) {
        summary.skipped.push({ type: 'service-calendar', serviceId: svc.serviceId, reason: 'provider user not found' });
        continue;
      }

      // Check existing calendar for this service + week
      const existing = await Calendar.findOne({ ownerId: providerUser._id, serviceId: svc._id, 'datesBracket.startEpoch': monday }).exec();
      if (existing) {
        summary.skipped.push({ type: 'service-calendar', serviceId: svc.serviceId, calendarId: existing._id.toString() });
        continue;
      }

      const payload = {
        ownerId: providerUser._id,
        serviceId: svc._id,
        timezone: 'UTC',
        capacity: Math.max(1, svc.capacity || 1),
        datesBracket: { startEpoch: monday, endEpoch: sunday },
        offLimitsSlots: defaultOffLimits,
        bookingsSlots: [],
        isOverflow: false,
        docSizeBytes: 0,
        metadata: { seeded: true, seedFor: 'service', serviceId: svc.serviceId },
        createdAtEpoch: Date.now(),
        updatedAtEpoch: Date.now()
      };

      try {
        const created = await Calendar.create(payload);
        summary.created.push({ type: 'service-calendar', serviceId: svc.serviceId, calendarId: created._id.toString() });
      } catch (err) {
        if (err && err.code === 11000) {
          const existingAfter = await Calendar.findOne({ ownerId: providerUser._id, serviceId: svc._id, 'datesBracket.startEpoch': monday }).exec();
          if (existingAfter) {
            summary.skipped.push({ type: 'service-calendar', serviceId: svc.serviceId, calendarId: existingAfter._id.toString(), note: 'race-created by another process' });
            continue;
          }
        }
        summary.errors.push({ type: 'service-calendar', serviceId: svc.serviceId, message: err && err.message });
      }
    }

    return summary;
  } catch (err) {
    summary.errors.push({ message: err && err.message });
    return summary;
  }
}

module.exports = { run };

/*
Postman testing payloads and endpoints (examples)

1) Get a calendar by id
   Endpoint: GET http://localhost:3000/api/clder/:id
   Example:
     GET http://localhost:3000/api/clder/605c9f2b8f1b2c0012345678
   Notes:
     - Replace :id with the calendar Mongo _id returned by the seed summary.
     - This endpoint is typically public for read; if your app requires auth include Authorization header.

2) Find or create weekly calendar (service-level or user-level)
   Endpoint: POST http://localhost:3000/api/clder/find-or-create
   Body (JSON):
   {
     "ownerId": "<userObjectId>",        // Mongo _id of the user (not userId string)
     "serviceId": "<serviceObjectId>",   // optional; omit for user-level calendar
     "dateEpoch": 1678838400000,         // optional epoch ms within desired week (defaults to now)
     "timezone": "UTC",
     "capacity": 1
   }
   Notes:
     - The server-side service will materialize the weekly calendar and copy-forward off-limits if available.
     - If your API uses different route names, adapt accordingly; the seed created calendars directly.

3) Inspect seeded calendars (list)
   Endpoint: GET http://localhost:3000/api/clder?seeded=true
   Notes:
     - If your calendar routes support query filters, you can list calendars created by the seed by filtering metadata.seeded=true.
     - Otherwise, use the calendar _ids returned in the seed summary.

Seed behavior:
 - Call `await require('./src/config/db-seeds/seed-db-models.calenders').run()` during server startup after users and services seeds have run.
 - The run() function is idempotent: it will skip calendars that already exist for the same owner/service + week.
 - Calendars created by this seed include default off-limits (outside 09:00-17:00 UTC) for every weekday and empty bookingsSlots.
*/
