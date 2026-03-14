// src/config/db-seeds/seed-db-models.services.js
//
// Idempotent DB seed for services collection.
// - Creates two services owned by one seeded provider (Bob: userId '1000000000000002').
// - Leaves the other seeded provider (Carol: userId '1000000000000003') without services.
// - Uses stable 16-character serviceId values that start with 'svc_' so they match the length convention
//   described (total length equals userId length).
// - Exports async run() which is safe to call on server start; returns a summary of actions.
// - Non-disruptive: will skip creation for services that already exist by serviceId or providerId+name.

'use strict';

const Service = require('../../models/service.model');
const serviceRepo = require('../../repositories/service.repo');
const User = require('../../models/user.model');

/**
 * NOTE on serviceId format:
 * - userId length: 16 characters (digits).
 * - serviceId here is 16 characters total and begins with 'svc_' (4 chars) followed by 12 digits.
 *   Example: 'svc_000000000002'
 */

/**
 * Canonical seed payloads
 * - serviceId: stable application-level id (16 chars, starts with 'svc_')
 * - providerId: application-level userId (string) that must match an existing user document
 */
const SEED_SERVICES = [
  {
    serviceId: 'svc_000000000002',
    name: 'Handyman General Services',
    providerId: '1000000000000002', // Bob (provider)
    addresses: [{ label: 'Main', line1: '123 Example St', city: 'Brampton', country: 'CA' }],
    locations: ['Brampton', 'Toronto'],
    contacts: [{ use: 'office', value: 'office@handyman.example.com' }],
    emails: ['bob.services@example.com'],
    phones: ['+1-416-555-0202'],
    categories: ['handyman', 'maintenance'],
    capacity: 2,
    calendarId: null,
    descriptionCards: [{ cardId: 'card1', cardName: 'Overview', title: 'Reliable handyman', descriptions: ['Small repairs', 'Installations'] }],
    status: 'active',
    metadata: { seeded: true }
  },
  {
    serviceId: 'svc_000000000003',
    name: 'Home Cleaning Pro',
    providerId: '1000000000000002', // Bob (provider) — second service for same provider
    addresses: [{ label: 'HQ', line1: '456 Sample Ave', city: 'Brampton', country: 'CA' }],
    locations: ['Brampton'],
    contacts: [{ use: 'office', value: 'cleaning@homepro.example.com' }],
    emails: ['cleaning@example.com'],
    phones: ['+1-416-555-0203'],
    categories: ['cleaning', 'housekeeping'],
    capacity: 1,
    calendarId: null,
    descriptionCards: [{ cardId: 'card2', cardName: 'Cleaning', title: 'Thorough home cleaning', descriptions: ['Deep clean', 'Move-out clean'] }],
    status: 'active',
    metadata: { seeded: true }
  }
];

/**
 * run
 * - Idempotent: checks for existing services by serviceId or providerId+name and only creates missing ones.
 * - Returns { created: [], skipped: [], errors: [] }.
 */
async function run() {
  const summary = { created: [], skipped: [], errors: [] };

  try {
    // Ensure provider exists (we only seed services for existing seeded users)
    const providerIds = Array.from(new Set(SEED_SERVICES.map(s => s.providerId)));
    const users = await User.find({ userId: { $in: providerIds } }).exec();
    const userMap = {};
    for (const u of users) userMap[String(u.userId)] = u;

    for (const payload of SEED_SERVICES) {
      // Validate provider presence
      const providerUser = userMap[payload.providerId];
      if (!providerUser) {
        summary.skipped.push({ serviceId: payload.serviceId, reason: `provider ${payload.providerId} not found` });
        continue;
      }

      // Check existing by serviceId first
      const existingById = await Service.findOne({ serviceId: payload.serviceId }).lean().exec();
      if (existingById) {
        summary.skipped.push({ serviceId: payload.serviceId, note: 'exists by serviceId' });
        continue;
      }

      // Check existing by providerId + name to avoid duplicate listings
      const existingByName = await Service.findOne({ providerId: payload.providerId, name: payload.name }).lean().exec();
      if (existingByName) {
        summary.skipped.push({ serviceId: payload.serviceId, note: 'exists by providerId+name', existingServiceId: existingByName.serviceId || null });
        continue;
      }

      // Prepare object for creation: ensure providerId stored as string (application-level id)
      const obj = Object.assign({}, payload);

      try {
        const created = await serviceRepo.createService(obj);
        summary.created.push({ serviceId: created.serviceId, providerId: created.providerId, _id: created._id.toString() });
      } catch (err) {
        // handle duplicate key race and other errors gracefully
        if (err && err.code === 11000) {
          // attempt to find the conflicting document and report as skipped
          const conflict = await Service.findOne({ $or: [{ serviceId: payload.serviceId }, { providerId: payload.providerId, name: payload.name }] }).lean().exec();
          if (conflict) {
            summary.skipped.push({ serviceId: payload.serviceId, note: 'race-created by another process', existingServiceId: conflict.serviceId || null });
            continue;
          }
        }
        summary.errors.push({ serviceId: payload.serviceId, message: err && err.message });
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

1) Create a service (controller route)
   Endpoint: POST http://localhost:3000/api/svcs
   Headers:
     Authorization: Bearer <accessToken>   // must be provider or admin
   Body (JSON):
   {
     "serviceId": "svc_000000000004",
     "name": "Custom Service Name",
     "providerId": "1000000000000002",
     "addresses": [{ "label": "Main", "line1": "1 Example Rd", "city": "Brampton", "country": "CA" }],
     "locations": ["Brampton"],
     "categories": ["custom"],
     "capacity": 1
   }
   Notes: Controller enforces that non-admins can only create services for their own providerId.

2) Get a service by serviceId
   Endpoint: GET http://localhost:3000/api/svcs/svc_000000000002
   Notes: Returns the service document. Use this to verify seeded services.

3) Search services (text query / filters)
   Endpoint: GET http://localhost:3000/api/svcs?q=handyman&page=1&pageSize=10
   Notes: Uses service search; seeded services 'Handyman General Services' and 'Home Cleaning Pro' should be discoverable by name/category.

4) Update a service (provider or admin)
   Endpoint: PATCH http://localhost:3000/api/svcs/svc_000000000002
   Headers:
     Authorization: Bearer <accessToken>
   Body (JSON):
   {
     "capacity": 3,
     "status": "available"
   }
   Notes: Only provider owner or administrator may update; serviceRepo.updateByServiceId will persist changes.

Seed behavior:
 - Call `await require('./src/config/db-seeds/seed-db-models.services').run()` during server startup after users seed has run.
 - The run() function is idempotent: it will skip services that already exist by serviceId or providerId+name.
*/
