// src/config/db-seeds/seed-db-models.requests.js
//
// Idempotent DB seed for requests collection.
// - Creates one request per seeded user (4 requests total).
// - One request is private and includes a services list containing one provider userId and one serviceId.
// - The other requests are public.
// - Uses stable titles and metadata.seeded to ensure idempotency (skips already-seeded requests).
// - Exports async run() which is safe to call on server start and returns a summary.
//
// Notes:
// - This seed uses the request repository to persist documents so model hooks and validations run.
// - If your environment uses different seeded user/service ids, update SEEDED_USER_IDS / SEEDED_SERVICE_IDS accordingly.

'use strict';

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
 * Helper: build a request payload for repo.createRequest
 * - createdBy must be the application-level userId string.
 */
function buildRequestPayload({ title, description, createdByUserId, services = [], isPrivate = false, whenFromEpoch, whenToEpoch, expiresAt = null }) {
  const when = [
    {
      from: Number(whenFromEpoch),
      to: Number(whenToEpoch),
      isBusinessHours: false,
      capacityNeeded: 1
    }
  ];

  return {
    title,
    description: description || '',
    createdBy: String(createdByUserId),
    services: Array.isArray(services) ? services.slice() : [],
    categories: [],
    locations: [],
    geo: null,
    when,
    bids: [],
    isPrivate: !!isPrivate,
    allowedProviders: isPrivate ? [] : [],
    expiresAt: expiresAt ? Number(expiresAt) : null,
    metadata: { seeded: true, seedSource: 'seed-db-models.requests' },
    status: 'active'
  };
}

/**
 * run
 * - Idempotent: checks for existing seeded requests by createdBy + title and metadata.seeded flag.
 * - Returns { created: [], skipped: [], errors: [] }.
 */
async function run() {
  const summary = { created: [], skipped: [], errors: [] };

  try {
    // Resolve user documents
    const users = await User.find({ userId: { $in: SEEDED_USER_IDS } }).exec();
    const userMap = {};
    for (const u of users) userMap[String(u.userId)] = u;

    // Resolve service documents
    const services = await Service.find({ serviceId: { $in: SEEDED_SERVICE_IDS } }).exec();
    const serviceMap = {};
    for (const s of services) serviceMap[String(s.serviceId)] = s;

    // Validate presence
    for (const uid of SEEDED_USER_IDS) {
      if (!userMap[uid]) summary.skipped.push({ type: 'user-missing', userId: uid, reason: 'user not found; ensure users seed ran' });
    }
    for (const sid of SEEDED_SERVICE_IDS) {
      if (!serviceMap[sid]) summary.skipped.push({ type: 'service-missing', serviceId: sid, reason: 'service not found; ensure services seed ran' });
    }

    // Build deterministic titles for idempotency
    const now = Date.now();
    const twoDays = 2 * 24 * 60 * 60 * 1000;
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    const whenFrom = now + twoDays;
    const whenTo = now + threeDays;
    const expiresAt = whenTo; // default expires at end of window

    // Plan requests: one per seeded user
    const planned = [];

    // Alice (seeker) -> private request targeting Bob and svc_000000000002
    if (userMap['1000000000000001']) {
      planned.push({
        title: 'Seeded Private Request - Alice -> Bob & svc_000000000002',
        createdBy: '1000000000000001',
        services: [
          '1000000000000002',        // provider userId (Bob)
          'svc_000000000002'         // serviceId
        ],
        isPrivate: true,
        whenFrom,
        whenTo,
        expiresAt
      });
    }

    // Bob (provider) -> public request (seeking other providers)
    if (userMap['1000000000000002']) {
      planned.push({
        title: 'Seeded Public Request - Bob',
        createdBy: '1000000000000002',
        services: [],
        isPrivate: false,
        whenFrom,
        whenTo,
        expiresAt
      });
    }

    // Carol (provider) -> public request
    if (userMap['1000000000000003']) {
      planned.push({
        title: 'Seeded Public Request - Carol',
        createdBy: '1000000000000003',
        services: [],
        isPrivate: false,
        whenFrom,
        whenTo,
        expiresAt
      });
    }

    // Dana (admin) -> public request
    if (userMap['1000000000000004']) {
      planned.push({
        title: 'Seeded Public Request - Dana',
        createdBy: '1000000000000004',
        services: [],
        isPrivate: false,
        whenFrom,
        whenTo,
        expiresAt
      });
    }

    // Iterate planned requests and create if missing
    for (const p of planned) {
      try {
        // Idempotency check: existing seeded request with same createdBy + title
        const existing = await Request.findOne({
          'metadata.seeded': true,
          createdBy: String(p.createdBy),
          title: p.title
        }).lean().exec();

        if (existing) {
          summary.skipped.push({ title: p.title, createdBy: p.createdBy, reason: 'already seeded' });
          continue;
        }

        // Additional check: avoid creating duplicates if a non-seeded request with same createdBy+title exists
        const existingAny = await Request.findOne({ createdBy: String(p.createdBy), title: p.title }).lean().exec();
        if (existingAny) {
          // mark as skipped but note that it wasn't created by seed
          summary.skipped.push({ title: p.title, createdBy: p.createdBy, reason: 'title exists (non-seeded)' });
          continue;
        }

        // Build payload
        const payload = buildRequestPayload({
          title: p.title,
          description: `Auto-seeded request for user ${p.createdBy}`,
          createdByUserId: p.createdBy,
          services: p.services,
          isPrivate: p.isPrivate,
          whenFromEpoch: p.whenFrom,
          whenToEpoch: p.whenTo,
          expiresAt: p.expiresAt
        });

        // For private requests, ensure allowedProviders is populated with provider userIds when possible.
        if (payload.isPrivate && Array.isArray(payload.services) && payload.services.length > 0) {
          // Resolve provider ids from services array: entries may be serviceId or provider userId
          const allowed = [];
          for (const token of payload.services) {
            if (!token) continue;
            if (String(token).startsWith('svc_')) {
              const svc = serviceMap[String(token)];
              if (svc && svc.providerId) allowed.push(String(svc.providerId));
            } else {
              // assume provider userId
              allowed.push(String(token));
            }
          }
          // Deduplicate
          payload.allowedProviders = Array.from(new Set(allowed));
        }

        // Persist via repository so model hooks run
        const created = await requestRepo.createRequest(payload);

        summary.created.push({ title: created.title, createdBy: created.createdBy, id: created._id ? created._id.toString() : null });
      } catch (err) {
        summary.errors.push({ title: p.title, createdBy: p.createdBy, message: err && err.message });
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

1) Create a request (API)
   Endpoint: POST http://localhost:3000/api/reqs
   Headers:
     Authorization: Bearer <accessToken>
   Body (JSON):
   {
     "title": "Example Request from Postman",
     "description": "Need help with a small job.",
     "services": ["svc_000000000002"],   // optional: serviceId or provider userId
     "when": [
       { "from": 1710000000000, "to": 1710086400000, "capacityNeeded": 1 }
     ],
     "isPrivate": false
   }
   Notes: When creating private requests via API, include "isPrivate": true and optionally "allowedProviders": ["1000000000000002"].

2) Get a request by id
   Endpoint: GET http://localhost:3000/api/reqs/:id
   Example:
     GET http://localhost:3000/api/reqs/605c9f2b8f1b2c0012345678

3) Search open requests
   Endpoint: GET http://localhost:3000/api/reqs?categories=&location=&page=1&pageSize=10
   Notes: Use query params supported by your requests routes. The seeded requests use status 'active' and should appear in open searches.

4) Inspect seeded requests directly (admin or DB)
   - Use the seed summary returned by run() to get created request _ids.
   - Alternatively query Mongo:
     db.requests.find({ "metadata.seeded": true }).pretty()

Seed behavior:
 - Call `await require('./src/config/db-seeds/seed-db-models.requests').run()` during server startup after users and services seeds have run.
 - The run() function is idempotent: it will skip requests that already exist with the same createdBy + title and metadata.seeded === true.
*/
