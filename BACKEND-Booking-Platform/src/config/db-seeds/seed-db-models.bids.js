// src/config/db-seeds/seed-db-models.bids.js
//
// Idempotent DB seed for bids collection.
// - Creates up to 10 bids per selected request (seeded requests).
// - Respects request visibility:
//     * For private requests, only providers listed in request.allowedProviders will be used as bidders.
//     * For public requests, bidders are chosen from available service_providers in the DB.
// - Sets bid status according to request/booking state:
//     * If request.status === 'booked' and a booking exists for that request, one bid (if any) is marked 'accepted' and others 'rejected'.
//     * If request.status === 'active' bids are created with status 'submitted' (default).
// - Marks created bids with metadata.seeded so repeated runs skip already-seeded bids.
// - Uses repository layer when available (bid.repo) to persist bids so model-level hooks and indexes are respected.
// - Exports async run() which is safe to call on server start and returns a summary of actions.
// - Non-disruptive: will skip seeding for a request if seeded bids already exist for that request.

'use strict';

const mongoose = require('mongoose');
const Bid = require('../../models/bid.model');
const bidRepo = require('../../repositories/bid.repo');
const Request = require('../../models/request.model');
const Booking = require('../../models/booking.model');
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
 * Utility: random integer in [min, max]
 */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Build a bid payload
 * - providerId: application-level userId string
 * - requestDoc: request mongoose doc or lean doc
 * - serviceIds: optional array of serviceId strings to include in the bid
 * - status: optional override
 */
function buildBidPayload({ requestDoc, providerId, serviceIds = [], status = 'submitted' }) {
  const now = Date.now();
  const quote = randInt(50, 500); // nominal seeded quote
  return {
    request_id: String(requestDoc._id),
    provider_id: String(providerId),
    quote_amount: quote,
    currency: 'CAD',
    services: Array.isArray(serviceIds) ? serviceIds.slice(0, 5) : [],
    message: null,
    status,
    metadata: { seeded: true, seedSource: 'seed-db-models.bids' },
    createdAt: now,
    updatedAt: now,
    archived: false
  };
}

/**
 * Choose up to `count` provider userIds for bidding on a request.
 * - For private requests: use request.allowedProviders (if present).
 * - For public requests: use active service_providers from the DB.
 * - Exclude the request creator (seeker) from providers.
 */
async function chooseProvidersForRequest(requestDoc, count = 10) {
  const seekerId = String(requestDoc.createdBy);
  let providerIds = [];

  if (requestDoc.isPrivate && Array.isArray(requestDoc.allowedProviders) && requestDoc.allowedProviders.length > 0) {
    providerIds = requestDoc.allowedProviders.map(String).filter(id => id !== seekerId);
  } else {
    // public: pick active providers from DB (role === 'service_provider' && status === 'active')
    const providers = await User.find({ role: 'service_provider', status: 'active' }, { userId: 1 }).lean().exec();
    providerIds = providers.map(p => String(p.userId)).filter(id => id !== seekerId);
  }

  // Deduplicate and limit
  providerIds = Array.from(new Set(providerIds));
  if (providerIds.length <= count) return providerIds;
  // deterministic-ish selection: sort then slice
  providerIds.sort();
  return providerIds.slice(0, count);
}

/**
 * run
 * - Main entrypoint for seeding bids.
 * - Finds seeded requests (metadata.seeded === true) and creates up to 10 bids per request if none seeded yet.
 */
async function run() {
  const summary = { created: [], skipped: [], errors: [] };

  try {
    // Find candidate requests to seed bids for:
    // Prefer seeded public/active requests; include private seeded requests as well.
    const requests = await Request.find({ 'metadata.seeded': true, status: { $in: ['active', 'booked'] } }).lean().exec();

    if (!requests || requests.length === 0) {
      summary.skipped.push({ reason: 'no seeded requests found with status active/booked' });
      return summary;
    }

    // Preload services map for quick lookup when assigning services to bids
    const services = await Service.find({ serviceId: { $in: SEEDED_SERVICE_IDS } }).lean().exec();
    const serviceMap = {};
    for (const s of services) serviceMap[String(s.serviceId)] = s;

    for (const reqDoc of requests) {
      try {
        // Idempotency: if any seeded bids exist for this request, skip it
        const existingSeeded = await Bid.findOne({ request_id: String(reqDoc._id), 'metadata.seeded': true }).lean().exec();
        if (existingSeeded) {
          summary.skipped.push({ requestId: String(reqDoc._id), reason: 'seeded bids already exist' });
          continue;
        }

        // Also skip if there are already many bids (avoid interfering with real data)
        const existingAny = await Bid.countDocuments({ request_id: String(reqDoc._id) }).exec();
        if (existingAny && existingAny >= 10) {
          summary.skipped.push({ requestId: String(reqDoc._id), reason: `existing bids present (${existingAny})` });
          continue;
        }

        // Choose providers
        const providerIds = await chooseProvidersForRequest(reqDoc, 10);
        if (!providerIds || providerIds.length === 0) {
          summary.skipped.push({ requestId: String(reqDoc._id), reason: 'no eligible providers found' });
          continue;
        }

        // Determine service candidates for bids:
        // If request.services contains serviceIds, prefer those; otherwise use seeded services if provider owns them.
        const requestServiceTokens = Array.isArray(reqDoc.services) ? reqDoc.services.slice() : [];
        const serviceCandidates = [];

        for (const token of requestServiceTokens) {
          if (!token) continue;
          if (String(token).startsWith('svc_') && serviceMap[String(token)]) {
            serviceCandidates.push(String(token));
          } else if (String(token).startsWith('svc_')) {
            // token references a service not in seeded list; include as-is
            serviceCandidates.push(String(token));
          }
        }

        // If no explicit services, try to attach a service owned by the provider when creating each bid
        // We'll fetch provider-owned service on the fly when building each bid.

        // If request is booked, find booking(s) for this request to decide accepted/rejected statuses
        let bookingForRequest = null;
        if (String(reqDoc.status) === 'booked') {
          bookingForRequest = await Booking.findOne({ request_id: String(reqDoc._id) }).lean().exec();
        }

        // Create bids: iterate providers and create one bid per provider up to 10
        const createdForRequest = [];
        for (let i = 0; i < providerIds.length && createdForRequest.length < 10; i++) {
          const provId = providerIds[i];

          // Determine services for this provider's bid
          let svcList = [];
          if (serviceCandidates.length > 0) {
            // include up to 2 service ids from requestServiceTokens
            svcList = serviceCandidates.slice(0, 2);
          } else {
            // try to find a service owned by this provider
            const svc = await Service.findOne({ providerId: provId }).lean().exec();
            if (svc) svcList = [String(svc.serviceId || svc._id)];
          }

          // Decide status:
          // - default: 'submitted'
          // - if request is booked and booking exists: one bid should be 'accepted' (prefer provider matching booking.provider_id)
          let status = 'submitted';
          if (bookingForRequest) {
            if (String(bookingForRequest.provider_id) === String(provId)) {
              status = 'accepted';
            } else {
              status = 'rejected';
            }
          }

          const payload = buildBidPayload({ requestDoc: reqDoc, providerId: provId, serviceIds: svcList, status });

          // Persist bid (use repo if available)
          try {
            let created;
            if (bidRepo && typeof bidRepo.create === 'function') {
              created = await bidRepo.create(payload);
            } else {
              created = await Bid.create(payload);
            }
            createdForRequest.push(created);
            summary.created.push({
              requestId: String(reqDoc._id),
              bidId: created._id ? created._id.toString() : null,
              providerId: provId,
              status: created.status
            });
          } catch (err) {
            // Unique index may prevent duplicate active bids per provider per request; record and continue
            summary.errors.push({
              requestId: String(reqDoc._id),
              providerId: provId,
              message: err && err.message
            });
            continue;
          }
        }

        // If request was booked but no bid matched booking.provider_id, attempt to mark one created bid as accepted
        if (bookingForRequest && createdForRequest.length > 0) {
          const hasAccepted = createdForRequest.some(b => String(b.status) === 'accepted' || (b.status && b.status === 'accepted'));
          if (!hasAccepted) {
            // pick first created bid and set to accepted
            const firstBid = createdForRequest[0];
            try {
              if (bidRepo && typeof bidRepo.updateById === 'function') {
                await bidRepo.updateById(firstBid._id, { status: 'accepted' });
              } else {
                await Bid.findByIdAndUpdate(firstBid._id, { $set: { status: 'accepted', updatedAt: Date.now() } }).exec();
              }
              // update summary entry if present
              const entry = summary.created.find(e => e.bidId === (firstBid._id ? firstBid._id.toString() : null));
              if (entry) entry.status = 'accepted';
            } catch (err) {
              summary.errors.push({ requestId: String(reqDoc._id), message: 'failed to mark bid accepted: ' + (err && err.message) });
            }
          }
        }
      } catch (err) {
        summary.errors.push({ requestId: String(reqDoc._id), message: err && err.message });
      }
    }

    return summary;
  } catch (err) {
    return { created: [], skipped: [], errors: [{ message: err && err.message }] };
  }
}

module.exports = { run };

/*
Postman testing payloads and endpoints (examples)

1) Create a bid (API)
   Endpoint: POST http://localhost:3000/api/reqs/:request_id/bids
   Headers:
     Authorization: Bearer <accessToken>   // provider auth required
   Body (JSON):
   {
     "quote_amount": 150,
     "currency": "CAD",
     "services": ["svc_000000000002"],
     "message": "I can do this on short notice",
     "status": "submitted"
   }
   Notes: Controller enforces provider role and request visibility rules.

2) List bids for a request
   Endpoint: GET http://localhost:3000/api/reqs/:request_id/bids?page=1&pageSize=20
   Notes: Public endpoint; repository enforces visibility rules.

3) Update a bid (provider or request owner/admin)
   Endpoint: PATCH http://localhost:3000/api/bids/:id
   Headers:
     Authorization: Bearer <accessToken>
   Body (JSON):
   {
     "quote_amount": 175,
     "status": "withdrawn"
   }

Seed behavior:
 - Call `await require('./src/config/db-seeds/seed-db-models.bids').run()` during server startup after users, services, requests and bookings seeds have run.
 - The run() function is idempotent: it will skip requests that already have seeded bids (metadata.seeded === true) and will avoid creating duplicate bids for the same provider/request due to repository/model unique constraints.
*/
