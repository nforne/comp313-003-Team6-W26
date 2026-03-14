// src/config/db-seeds/seed-db-models.reviews.js
//
// Idempotent DB seed for reviews collection.
// - Creates reviews for seeded users and services in a deterministic, non-disruptive way.
// - Goals:
//     * 2 reviews per seeded user (4 users => 8 reviews total).
//     * Ensure each seeded service has at least 2 reviews.
// - Uses stable, clearly marked seeded metadata so repeated runs skip already-seeded data.
// - Exports async run() which is safe to call on server start and returns a summary.
//
// Notes:
// - This seed is defensive: it will skip if it detects any review documents with metadata.seeded === true.
// - The seed attempts to use a repository if available (review.repo), otherwise it writes via the Review model directly.
// - Review document shape is flexible to accommodate different schemas used in the project:
//     Common fields used: reviewer (ObjectId), targetType ('service'|'user'), targetId (ObjectId or serviceId string),
//     rating (1-5), title, body, metadata, createdAt, updatedAt.
// - Adjust field names if your Review model uses different property names.

'use strict';

const mongoose = require('mongoose');
const User = require('../../models/user.model');
const Service = require('../../models/service.model');

let Review;
let reviewRepo = null;
try {
  Review = require('../../models/review.model');
} catch (e) {
  Review = null;
}
try {
  reviewRepo = require('../../repositories/review.repo');
} catch (e) {
  reviewRepo = null;
}

/**
 * Stable seeded userIds and serviceIds used by other seeds.
 * Keep these in sync with seed-db-models.users.js and seed-db-models.services.js
 */
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
 * Helper: build a review object (flexible shape)
 */
function buildReview({ reviewerObjId, targetType, targetObjIdOrServiceId, rating = 5, title = '', body = '' }) {
  const now = Date.now();
  return {
    reviewer: reviewerObjId,
    targetType,
    targetId: targetObjIdOrServiceId,
    rating,
    title,
    body,
    metadata: { seeded: true },
    createdAt: now,
    updatedAt: now
  };
}

/**
 * run
 * - Idempotent: if any review with metadata.seeded === true exists, the seed will skip to avoid duplicates.
 * - Otherwise creates the planned reviews and returns a summary.
 */
async function run() {
  const summary = { created: [], skipped: [], errors: [] };

  try {
    // Quick guard: if any seeded reviews already exist, skip seeding entirely.
    const ReviewModel = reviewRepo ? null : Review;
    if (!reviewRepo && !ReviewModel) {
      summary.errors.push({ message: 'Review model or repository not found. Provide src/models/review.model.js or src/repositories/review.repo.js' });
      return summary;
    }

    // If repository exists and exposes a count/search, use it; otherwise use model.
    const seededExists = reviewRepo
      ? (typeof reviewRepo.countSeeded === 'function' ? await reviewRepo.countSeeded() > 0 : null)
      : (await ReviewModel.countDocuments({ 'metadata.seeded': true }).exec()) > 0;

    if (seededExists === true) {
      summary.skipped.push({ reason: 'seeded reviews already present' });
      return summary;
    }
    // If seededExists is null (repo doesn't expose countSeeded), fall through and check model if available
    if (seededExists === null && reviewRepo) {
      // try repo.list or repo.search for seeded flag; if not available, continue and create but avoid duplicates by unique check
    }

    // Resolve users and services
    const users = await User.find({ userId: { $in: SEEDED_USER_IDS } }).exec();
    const userMap = {};
    for (const u of users) userMap[String(u.userId)] = u;

    const services = await Service.find({ serviceId: { $in: SEEDED_SERVICE_IDS } }).exec();
    const serviceMap = {};
    for (const s of services) serviceMap[String(s.serviceId)] = s;

    // Validate presence
    for (const uid of SEEDED_USER_IDS) {
      if (!userMap[uid]) {
        summary.skipped.push({ type: 'user-missing', userId: uid, reason: 'user not found; ensure users seed ran' });
      }
    }
    for (const sid of SEEDED_SERVICE_IDS) {
      if (!serviceMap[sid]) {
        summary.skipped.push({ type: 'service-missing', serviceId: sid, reason: 'service not found; ensure services seed ran' });
      }
    }

    // Build review payloads:
    // - For each seeded user create two reviews:
    //     * one review for svc_000000000002
    //     * one review for svc_000000000003 (if service exists), otherwise for a provider profile (Bob)
    // - This ensures 2 reviews per user and at least 2 reviews per service (since multiple users review same services).
    const payloads = [];

    for (const uid of SEEDED_USER_IDS) {
      const userDoc = userMap[uid];
      if (!userDoc) continue;

      // Review A -> svc_000000000002 (if exists)
      if (serviceMap[SEEDED_SERVICE_IDS[0]]) {
        payloads.push(buildReview({
          reviewerObjId: userDoc._id,
          targetType: 'service',
          targetObjIdOrServiceId: serviceMap[SEEDED_SERVICE_IDS[0]]._id,
          rating: 5,
          title: `Excellent service by ${serviceMap[SEEDED_SERVICE_IDS[0]].name}`,
          body: `Very satisfied with the work performed by ${serviceMap[SEEDED_SERVICE_IDS[0]].name}. Professional and on time.`
        }));
      } else {
        // fallback: review provider Bob (if exists)
        const bob = userMap['1000000000000002'];
        if (bob) {
          payloads.push(buildReview({
            reviewerObjId: userDoc._id,
            targetType: 'user',
            targetObjIdOrServiceId: bob._id,
            rating: 5,
            title: 'Great provider',
            body: 'Helpful and responsive.'
          }));
        }
      }

      // Review B -> svc_000000000003 (if exists) else another provider or skip
      if (serviceMap[SEEDED_SERVICE_IDS[1]]) {
        payloads.push(buildReview({
          reviewerObjId: userDoc._id,
          targetType: 'service',
          targetObjIdOrServiceId: serviceMap[SEEDED_SERVICE_IDS[1]]._id,
          rating: 4,
          title: `Good experience with ${serviceMap[SEEDED_SERVICE_IDS[1]].name}`,
          body: `Service was good; minor follow-up required but overall positive.`
        }));
      } else {
        // fallback: review provider Carol (if exists)
        const carol = userMap['1000000000000003'];
        if (carol) {
          payloads.push(buildReview({
            reviewerObjId: userDoc._id,
            targetType: 'user',
            targetObjIdOrServiceId: carol._id,
            rating: 4,
            title: 'Solid work',
            body: 'Would recommend for similar tasks.'
          }));
        }
      }
    }

    // Ensure each service has at least 2 reviews: if not, add extra reviews from admin user
    for (const sid of SEEDED_SERVICE_IDS) {
      const svc = serviceMap[sid];
      if (!svc) continue;
      // Count planned reviews for this service in payloads
      const plannedForService = payloads.filter(p => p.targetType === 'service' && String(p.targetId) === String(svc._id));
      if (plannedForService.length < 2) {
        // find admin user to author extra reviews (Dana)
        const admin = userMap['1000000000000004'];
        if (admin) {
          const needed = 2 - plannedForService.length;
          for (let i = 0; i < needed; i++) {
            payloads.push(buildReview({
              reviewerObjId: admin._id,
              targetType: 'service',
              targetObjIdOrServiceId: svc._id,
              rating: 5 - i, // vary rating a bit
              title: `Seeded review ${i + 1} for ${svc.name}`,
              body: `Seeded review ${i + 1} to ensure minimum coverage for service ${svc.name}.`
            }));
          }
        }
      }
    }

    // Final guard: if no payloads, nothing to do
    if (!payloads.length) {
      summary.skipped.push({ reason: 'no review payloads generated (missing users/services)' });
      return summary;
    }

    // Insert reviews: use repo if available, otherwise model.create
    for (const p of payloads) {
      try {
        let created;
        if (reviewRepo && typeof reviewRepo.create === 'function') {
          created = await reviewRepo.create(p);
        } else if (ReviewModel) {
          created = await ReviewModel.create(p);
        } else {
          throw new Error('No review creation path available');
        }
        summary.created.push({ id: created._id ? created._id.toString() : null, reviewer: created.reviewer ? created.reviewer.toString() : null, targetType: created.targetType, targetId: created.targetId ? String(created.targetId) : null });
      } catch (err) {
        // If duplicate key or other race, record and continue
        summary.errors.push({ payload: { reviewer: String(p.reviewer), targetType: p.targetType, targetId: String(p.targetId) }, message: err && err.message });
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

1) Create a review (controller route)
   Endpoint: POST http://localhost:3000/api/rvws
   Headers:
     Authorization: Bearer <accessToken>
   Body (JSON):
   {
     "targetType": "service",
     "targetId": "svc_000000000002",   // or service Mongo _id depending on API
     "rating": 5,
     "title": "Excellent work",
     "body": "Completed quickly and professionally."
   }
   Notes: Controller may require targetId to be a Mongo _id or application-level id; adapt accordingly.

2) List reviews for a service
   Endpoint: GET http://localhost:3000/api/rvws?serviceId=svc_000000000002&page=1&pageSize=10
   Notes: Use query params supported by your review routes to filter by service or user.

3) Get a single review
   Endpoint: GET http://localhost:3000/api/rvws/:id
   Example:
     GET http://localhost:3000/api/rvws/605c9f2b8f1b2c0012345678

Seed behavior:
 - Call `await require('./src/config/db-seeds/seed-db-models.reviews').run()` during server startup after users and services seeds have run.
 - The run() function is idempotent: it will skip seeding if it detects previously-seeded reviews (metadata.seeded === true).
 - If your Review model uses different field names, adapt the buildReview helper accordingly.
*/
