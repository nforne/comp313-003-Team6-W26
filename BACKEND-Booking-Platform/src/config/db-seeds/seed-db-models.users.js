// src/config/db-seeds/seed-db-models.users.js
//
// Idempotent DB seed for users collection.
// - Creates 4 users if they do not already exist:
//     * 1 service_seeker
//     * 2 service_provider (one opted into public search, one not)
//     * 1 administrator
// - Exports async run() which is safe to call on server start.
// - Non-disruptive: will skip creation for users that already exist by userId or email.
//
// Usage:
//   const seedUsers = require('./src/config/db-seeds/seed-db-models.users');
//   await seedUsers.run();
'use strict';

const User = require('../../models/user.model');
const userRepo = require('../../repositories/user.repo');

/**
 * Seed payloads (canonical).
 * Keep userId stable so subsequent runs can detect existing seeds.
 */
const SEED_USERS = [
  {
    userId: '1000000000000001',
    firstName: 'Alice',
    lastName: 'Seeker',
    emails: [{ value: 'alice.seeker@example.com', primary: true }],
    phones: [{ value: '+1-416-555-0101', type: 'mobile' }],
    passwordHash: 'Password123!', // model pre-save will hash
    role: 'service_seeker',
    status: 'active',
    IsPublicSearchable: false,
    selfIntro: { text: 'Looking for reliable local providers.', images: [] }
  },
  {
    userId: '1000000000000002',
    firstName: 'Bob',
    lastName: 'Provider',
    emails: [{ value: 'bob.provider@example.com', primary: true }],
    phones: [{ value: '+1-416-555-0102', type: 'mobile' }],
    passwordHash: 'ProviderPass1!',
    role: 'service_provider',
    status: 'active',
    IsPublicSearchable: true, // opted into public search
    selfIntro: { text: 'Experienced handyman and general maintenance.', images: [] }
  },
  {
    userId: '1000000000000003',
    firstName: 'Carol',
    lastName: 'Provider',
    emails: [{ value: 'carol.provider@example.com', primary: true }],
    phones: [{ value: '+1-416-555-0103', type: 'mobile' }],
    passwordHash: 'ProviderPass2!',
    role: 'service_provider',
    status: 'active',
    IsPublicSearchable: false, // not public
    selfIntro: { text: 'Specialist in home cleaning and organization.', images: [] }
  },
  {
    userId: '1000000000000004',
    firstName: 'Dana',
    lastName: 'Admin',
    emails: [{ value: 'dana.admin@example.com', primary: true }],
    phones: [{ value: '+1-416-555-0104', type: 'mobile' }],
    passwordHash: 'AdminPass!23',
    role: 'administrator',
    status: 'active',
    IsPublicSearchable: false,
    selfIntro: { text: 'Platform administrator.', images: [] }
  }
];

/**
 * run
 * - Idempotent seeding: checks for existing users by userId or email and only creates missing ones.
 * - Returns an object summarizing actions taken.
 */
async function run() {
  const summary = { created: [], skipped: [], errors: [] };

  try {
    // Build lookup sets for existing userIds and emails
    const userIds = SEED_USERS.map(u => u.userId);
    const emails = SEED_USERS.reduce((acc, u) => {
      const e = (u.emails && u.emails[0] && u.emails[0].value) ? String(u.emails[0].value).toLowerCase() : null;
      if (e) acc.push(e);
      return acc;
    }, []);

    // Query existing users by userId or email
    const existingDocs = await User.find({
      $or: [
        { userId: { $in: userIds } },
        { 'emails.value': { $in: emails } }
      ]
    }).lean().exec();

    const existingUserIdSet = new Set(existingDocs.map(d => String(d.userId)));
    const existingEmailSet = new Set(
      existingDocs.flatMap(d => (Array.isArray(d.emails) ? d.emails.map(e => String(e.value).toLowerCase()) : []))
    );

    for (const payload of SEED_USERS) {
      const primaryEmail = (payload.emails && payload.emails[0] && payload.emails[0].value)
        ? String(payload.emails[0].value).toLowerCase()
        : null;

      if (existingUserIdSet.has(payload.userId) || (primaryEmail && existingEmailSet.has(primaryEmail))) {
        summary.skipped.push({ userId: payload.userId, email: primaryEmail });
        continue;
      }

      try {
        // Use repository createUser so pre-save hooks run consistently
        const created = await userRepo.createUser(payload);
        summary.created.push({ userId: created.userId, email: (created.emails && created.emails[0] && created.emails[0].value) || null });
      } catch (err) {
        // Collect error but continue seeding other users
        summary.errors.push({ userId: payload.userId, email: primaryEmail, message: err.message });
      }
    }

    return summary;
  } catch (err) {
    // Top-level failure
    summary.errors.push({ message: err.message });
    return summary;
  }
}

module.exports = { run };

/*
Postman testing payloads and endpoints (examples)

1) Register (if you prefer to test via API instead of seeding)
   Endpoint: POST http://localhost:3000/api/auth/register
   Body (JSON):
   {
     "firstName": "Eve",
     "lastName": "Tester",
     "email": "eve.tester@example.com",
     "password": "TestPass123!",
     "role": "service_provider"
   }
   Notes: This uses the auth.register flow. The seed uses direct persistence to create deterministic userIds.

2) Get public profile
   Endpoint: GET http://localhost:3000/api/users/1000000000000002
   Notes: Returns public projection. Provider profiles will include IsPublicSearchable flag.

3) Update profile (self or admin)
   Endpoint: PATCH http://localhost:3000/api/users/1000000000000002
   Headers: Authorization: Bearer <accessToken>
   Body (JSON) example to toggle public search opt-in:
   {
     "IsPublicSearchable": true,
     "selfIntro": { "text": "Updated intro for public listing." }
   }
   Notes: Only the user themself or an administrator may update this endpoint.

4) Authenticate (login) to obtain tokens
   Endpoint: POST http://localhost:3000/api/auth/login
   Body (JSON):
   {
     "email": "bob.provider@example.com",
     "password": "ProviderPass1!"
   }
   Notes: Use returned accessToken for protected endpoints.

Seed file behavior:
- Call `await require('./src/config/db-seeds/seed-db-models.users').run()` during server startup.
- The run() function is idempotent: it will skip users that already exist by userId or primary email.
*/
