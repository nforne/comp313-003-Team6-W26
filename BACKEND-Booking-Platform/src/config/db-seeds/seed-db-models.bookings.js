// src/config/db-seeds/seed-db-models.bookings.js
//
// Idempotent DB seed for bookings collection.
// - Creates 2 bookings for two seeded requests (both public).
// - Each booking uses a slot within the request.when window and references a provider and optional service.
// - Marks created bookings with metadata.seeded so repeated runs skip already-seeded bookings.
// - Exports async run() which is safe to call on server start and returns a summary.
// - Non-disruptive: will skip creation when a booking already exists for the same request_id and seeded metadata.

'use strict';

const mongoose = require('mongoose');
const Booking = require('../../models/booking.model');
const bookingRepo = require('../../repositories/booking.repo');
const Request = require('../../models/request.model');
const requestRepo = require('../../repositories/request.repo');
const User = require('../../models/user.model');
const Service = require('../../models/service.model');

const SEEDED_USER_IDS = [
  '1000000000000001', // Alice (seeker)
  '1000000000000002', // Bob (provider)
  '1000000000000003', // Carol (provider)
  '1000000000000004'  // Dana (admin)
];

const SEEDED_SERVICE_IDS = [
  'svc_000000000002',
  'svc_000000000003'
];

/**
 * Helper: pick two public seeded requests to book.
 * Preference: requests with metadata.seeded === true and isPrivate === false.
 * Returns array of request documents (lean).
 */
async function pickRequestsToBook(limit = 2) {
  // Find seeded public requests
  const seededPublic = await Request.find({ 'metadata.seeded': true, isPrivate: false, status: 'active' }).lean().exec();
  if (Array.isArray(seededPublic) && seededPublic.length >= limit) {
    return seededPublic.slice(0, limit);
  }
  // Fallback: any active public requests
  const anyPublic = await Request.find({ isPrivate: false, status: 'active' }).limit(limit).lean().exec();
  return anyPublic;
}

/**
 * Build a booking object for persistence.
 * - requestDoc: request document (lean) from DB
 * - providerUser: provider user document (mongoose doc) or null
 * - serviceDoc: service document (mongoose doc) or null
 */
function buildBookingPayload({ requestDoc, providerUser = null, serviceDoc = null }) {
  // Determine seeker and provider
  const seekerId = String(requestDoc.createdBy);
  // If providerUser provided use its userId string; else pick a seeded provider (Bob) as fallback
  const providerId = providerUser ? String(providerUser.userId) : '1000000000000002';

  // Choose a slot inside the request.when window (use first when entry)
  const when = Array.isArray(requestDoc.when) && requestDoc.when.length ? requestDoc.when[0] : null;
  const now = Date.now();
  let slots = [];
  if (when && typeof when.from === 'number' && typeof when.to === 'number' && when.to > when.from) {
    // pick a short slot starting at when.from + 1 hour (bounded)
    const start = Math.max(when.from + 60 * 60 * 1000, when.from);
    const end = Math.min(start + 60 * 60 * 1000, when.to); // 1 hour slot
    if (end > start) {
      slots = [{ from: Number(start), to: Number(end) }];
    } else {
      // fallback: small slot near when.from
      slots = [{ from: Number(when.from), to: Number(Math.min(when.from + 30 * 60 * 1000, when.to)) }];
    }
  } else {
    // fallback: tomorrow 1-hour slot
    const tomorrow = now + 24 * 60 * 60 * 1000;
    slots = [{ from: tomorrow + 9 * 60 * 60 * 1000, to: tomorrow + 10 * 60 * 60 * 1000 }];
  }

  const quoteAmount = 100; // seeded nominal amount
  const currency = 'CAD';

  const services = serviceDoc ? [String(serviceDoc.serviceId || serviceDoc._id)] : [];

  return {
    request_id: String(requestDoc._id),
    seeker_id: String(seekerId),
    provider_id: String(providerId),
    bid_id: null,
    quote_amount: quoteAmount,
    currency,
    what: requestDoc.title || 'Seeded booking',
    where: (requestDoc.locations && requestDoc.locations[0]) ? requestDoc.locations[0] : '',
    slots,
    services,
    bids: [],
    description: 'Seeded booking created for integration/testing.',
    status: 'active',
    messages: [],
    metadata: { seeded: true, seedSource: 'seed-db-models.bookings' },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

/**
 * run
 * - Idempotent: skips if a seeded booking already exists for the request_id.
 * - Returns { created: [], skipped: [], errors: [] }.
 */
async function run() {
  const summary = { created: [], skipped: [], errors: [] };

  try {
    // Resolve provider user docs and service docs for reference
    const providers = await User.find({ userId: { $in: SEEDED_USER_IDS } }).exec();
    const providerMap = {};
    for (const p of providers) providerMap[String(p.userId)] = p;

    const services = await Service.find({ serviceId: { $in: SEEDED_SERVICE_IDS } }).exec();
    const serviceMap = {};
    for (const s of services) serviceMap[String(s.serviceId)] = s;

    // Pick two public requests to book
    const requestsToBook = await pickRequestsToBook(2);
    if (!requestsToBook || requestsToBook.length === 0) {
      summary.skipped.push({ reason: 'no suitable public requests found to book' });
      return summary;
    }

    for (const reqDoc of requestsToBook) {
      try {
        // Skip if a seeded booking already exists for this request
        const existingSeeded = await Booking.findOne({ request_id: String(reqDoc._id), 'metadata.seeded': true }).lean().exec();
        if (existingSeeded) {
          summary.skipped.push({ requestId: String(reqDoc._id), reason: 'seeded booking already exists', bookingId: existingSeeded.booking_id || existingSeeded._id });
          continue;
        }

        // Also skip if any booking exists for this request (avoid double-booking)
        const anyBooking = await Booking.findOne({ request_id: String(reqDoc._id) }).lean().exec();
        if (anyBooking) {
          summary.skipped.push({ requestId: String(reqDoc._id), reason: 'existing booking present (non-seeded)', bookingId: anyBooking.booking_id || anyBooking._id });
          continue;
        }

        // Choose provider and service heuristics:
        // - If request.services contains a serviceId, prefer that service's provider
        let chosenProvider = null;
        let chosenService = null;
        if (Array.isArray(reqDoc.services) && reqDoc.services.length) {
          for (const token of reqDoc.services) {
            if (!token) continue;
            if (String(token).startsWith('svc_') && serviceMap[String(token)]) {
              chosenService = serviceMap[String(token)];
              const provId = String(chosenService.providerId);
              if (providerMap[provId]) {
                chosenProvider = providerMap[provId];
                break;
              }
            } else if (providerMap[String(token)]) {
              chosenProvider = providerMap[String(token)];
              break;
            }
          }
        }

        // Fallback: pick Bob (1000000000000002) if available
        if (!chosenProvider && providerMap['1000000000000002']) chosenProvider = providerMap['1000000000000002'];

        // If chosenService is null but chosenProvider has services, pick first service owned by provider
        if (!chosenService && chosenProvider) {
          const svc = await Service.findOne({ providerId: String(chosenProvider.userId) }).lean().exec();
          if (svc) chosenService = svc;
        }

        const payload = buildBookingPayload({ requestDoc: reqDoc, providerUser: chosenProvider, serviceDoc: chosenService });

        // Persist booking via repo if available (ensures model hooks/validation)
        let created;
        if (bookingRepo && typeof bookingRepo.create === 'function') {
          created = await bookingRepo.create(payload);
        } else {
          // fallback to model
          const b = new Booking(payload);
          created = await b.save();
        }

        summary.created.push({
          requestId: payload.request_id,
          bookingId: created.booking_id || (created._id ? created._id.toString() : null),
          providerId: payload.provider_id,
          service: payload.services && payload.services.length ? payload.services[0] : null
        });
      } catch (err) {
        summary.errors.push({ requestId: String(reqDoc._id), message: err && err.message });
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

1) Create a booking (API)
   Endpoint: POST http://localhost:3000/api/bkns
   Headers:
     Authorization: Bearer <accessToken>
   Body (JSON):
   {
     "requestId": "<request_mongo_id_or_string>",
     "providerId": "1000000000000002",
     "seekerId": "1000000000000001",
     "quoteAmount": 120,
     "currency": "CAD",
     "services": ["svc_000000000002"],
     "slots": [{ "from": 1710000000000, "to": 1710003600000 }],
     "description": "Booking created from Postman"
   }
   Notes: Use the request _id returned by the requests seed or query /api/reqs to find a request.

2) Get booking by booking_id or _id
   Endpoint: GET http://localhost:3000/api/bkns/:id
   Example:
     GET http://localhost:3000/api/bkns/bkn_1610000000_ab12
   Notes: The seed creates booking.booking_id automatically; use the seed summary to find booking ids.

3) List bookings for provider
   Endpoint: GET http://localhost:3000/api/bkns?providerId=1000000000000002&page=1&pageSize=10
   Notes: Use this to verify seeded bookings for provider Bob.

Seed behavior:
 - Call `await require('./src/config/db-seeds/seed-db-models.bookings').run()` during server startup after users, services and requests seeds have run.
 - The run() function is idempotent: it will skip bookings when a seeded booking exists for the same request_id or when any booking already exists for that request.
*/
