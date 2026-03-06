// tests/booking.spec.js
/**
 * Integration-style tests for booking flows
 *
 * - Concurrency simulation: two concurrent booking attempts for the same provider and overlapping slots.
 *   We mock a simple in-memory calendarService that supports tentative reservations and will allow
 *   only the first reservation to succeed for overlapping slots. The booking service uses that
 *   calendarService to reserve tentative slots inside the transaction; the second concurrent attempt
 *   should fail with a conflict.
 *
 * - DST / timezone normalization: verify that slots created using a local timezone that crosses
 *   a DST spring-forward transition are stored as epoch ms and the real elapsed time (epoch difference)
 *   reflects the timezone/DST behavior (i.e., wall-clock 2 hours may be 1 hour of real elapsed time).
 *
 * Requirements (devDependencies):
 *   - jest
 *   - mongodb-memory-server
 *   - mongoose
 *   - moment-timezone
 *
 * Run with:
 *   NODE_ENV=test npx jest tests/booking.spec.js --runInBand
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const moment = require('moment-timezone');

let mongoServer;

jest.setTimeout(30000);

describe('Booking concurrency and timezone tests', () => {
  let bookingService;
  let bookingRepo;
  let BookingModel;

  // Simple in-memory calendar mock to simulate tentative reservations and conflicts.
  // It supports:
  //  - requiresSession: true (so booking.service will call reserveTentativeSlots inside transaction)
  //  - reserveTentativeSlots({ type, id, slots, metadata }, { session }) => { token }
  //  - confirmSlots({ reservationToken, bookingId }, { session })
  //  - releaseTentativeSlots({ reservationToken })
  //
  // Reservation semantics: for a given calendar target (type+id) we keep an array of reserved slot ranges.
  // reserveTentativeSlots will check for overlap with existing tentative reservations and reject if overlap.
  const makeCalendarMock = () => {
    const reservations = new Map(); // key: `${type}:${id}` -> [{ token, slots }]
    let tokenCounter = 1;

    function keyFor(target) {
      return `${target.type}:${target.id}`;
    }

    function overlaps(a, b) {
      // a and b are { from, to } epoch ms
      return a.from < b.to && b.from < a.to;
    }

    return {
      requiresSession: true,
      async reserveTentativeSlots({ type, id, slots, metadata } = {}, { session } = {}) {
        if (!type || !id || !Array.isArray(slots) || slots.length === 0) {
          const err = new Error('Invalid reservation request');
          err.status = 400;
          throw err;
        }
        const k = keyFor({ type, id });
        const existing = reservations.get(k) || [];
        // check any overlap between any existing reservation slots and requested slots
        for (const ex of existing) {
          for (const s1 of ex.slots) {
            for (const s2 of slots) {
              if (overlaps(s1, s2)) {
                const err = new Error('Calendar conflict');
                err.status = 409;
                throw err;
              }
            }
          }
        }
        const token = `resv_${Date.now()}_${tokenCounter++}`;
        existing.push({ token, slots: slots.map(s => ({ from: Number(s.from), to: Number(s.to) })), metadata });
        reservations.set(k, existing);
        return { token, targetKey: k };
      },
      async confirmSlots({ reservationToken, bookingId } = {}, { session } = {}) {
        // no-op for mock; keep reservation as confirmed (we don't differentiate)
        return { ok: true };
      },
      async releaseTentativeSlots({ reservationToken } = {}) {
        // remove reservation by token
        for (const [k, arr] of reservations.entries()) {
          const idx = arr.findIndex(r => r.token === reservationToken);
          if (idx >= 0) {
            arr.splice(idx, 1);
            if (arr.length === 0) reservations.delete(k);
            return { released: true };
          }
        }
        return { released: false };
      },
      // helper for tests
      _dumpReservations() {
        return Array.from(reservations.entries()).map(([k, arr]) => ({ k, arr }));
      }
    };
  };

  beforeAll(async () => {
    // start in-memory mongo
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });

    // Ensure we mock calendar.service before requiring booking.service so the module picks up the mock.
    // Jest module mocking: create a manual mock for ../services/calendar.service
    const calendarMock = makeCalendarMock();
    jest.doMock('../src/services/calendar.service', () => calendarMock, { virtual: true });

    // Now require modules under test
    // Note: paths assume tests run from project root; adjust if your project layout differs.
    bookingService = require('../src/services/booking.service');
    bookingRepo = require('../src/repositories/booking.repo');
    BookingModel = require('../src/models/booking.model');

    // Ensure indexes are created
    await BookingModel.createIndexes();
  });

  afterAll(async () => {
    // cleanup mongoose and in-memory mongo
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
    // clear jest module mocks
    jest.resetModules();
  });

  afterEach(async () => {
    // clear bookings collection between tests
    await BookingModel.deleteMany({}).exec();
  });

  test('concurrent booking attempts for overlapping slots: only one should succeed', async () => {
    // Arrange: two actors attempt to book the same provider for overlapping slots
    const providerId = 'prov_abc';
    const seekerA = { userId: 'seeker_A', role: 'customer' };
    const seekerB = { userId: 'seeker_B', role: 'customer' };
    const requestId = 'req_1';

    // overlapping slot: now -> now + 1 hour
    const now = Date.now();
    const slot = { from: now + 60_000, to: now + 60_000 + 30 * 60_1000 }; // start in 1 minute, duration 30m

    const payloadA = {
      requestId,
      seekerId: seekerA.userId,
      providerId,
      quoteAmount: 100,
      currency: 'USD',
      services: [],
      slots: [slot]
    };
    const payloadB = {
      requestId,
      seekerId: seekerB.userId,
      providerId,
      quoteAmount: 120,
      currency: 'USD',
      services: [],
      slots: [slot]
    };

    // Act: run two createBookingTransactional calls concurrently
    const p1 = bookingService.createBookingTransactional(seekerA, payloadA, 'corrA');
    const p2 = bookingService.createBookingTransactional(seekerB, payloadB, 'corrB');

    // Wait for both to settle
    const results = await Promise.allSettled([p1, p2]);

    // Assert: exactly one succeeded, the other failed with conflict (status 409) or calendar conflict
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // The rejected reason should be an Error with status 409 (calendar conflict) or similar
    const rejReason = rejected[0].reason;
    expect(rejReason).toBeInstanceOf(Error);
    // Accept either explicit 409 or message containing 'Calendar' or 'conflict'
    const status = rejReason.status || null;
    expect([409, null]).toContain(status);
    expect(/conflict|Calendar|available/i.test(rejReason.message)).toBeTruthy();

    // Verify only one booking exists in DB for that provider and overlapping slot
    const all = await BookingModel.find({ provider_id: providerId }).lean().exec();
    expect(all.length).toBe(1);
    const stored = all[0];
    expect(stored.slots && stored.slots.length).toBe(1);
    expect(Number(stored.slots[0].from)).toBe(Number(slot.from));
    expect(Number(stored.slots[0].to)).toBe(Number(slot.to));
  });

  test('DST spring-forward normalization: epoch difference reflects real elapsed time', async () => {
    // Use America/Toronto (Eastern) DST spring-forward example: 2026-03-08
    // Local wall-clock: 01:30 -> 03:30 (appears 2 hours) but real elapsed time is 1 hour due to clock jump.
    const tz = 'America/Toronto';
    const fromLocal = '2026-03-08T01:30:00';
    const toLocal = '2026-03-08T03:30:00';

    const fromEpoch = moment.tz(fromLocal, tz).valueOf();
    const toEpoch = moment.tz(toLocal, tz).valueOf();

    // Sanity: ensure moment produced different epoch values and that difference is 1 hour (3600000 ms)
    const diff = toEpoch - fromEpoch;
    expect(diff).toBe(60 * 60 * 1000); // 1 hour in ms

    // Create booking using these epoch ms slots
    const providerId = 'prov_dst';
    const seeker = { userId: 'seeker_dst', role: 'customer' };
    const payload = {
      requestId: 'req_dst',
      seekerId: seeker.userId,
      providerId,
      quoteAmount: 50,
      currency: 'USD',
      services: [],
      slots: [{ from: fromEpoch, to: toEpoch }]
    };

    const booking = await bookingService.createBookingTransactional(seeker, payload, 'corrDST');

    // Verify stored slot difference equals diff
    expect(booking.slots && booking.slots.length).toBe(1);
    const storedFrom = Number(booking.slots[0].from);
    const storedTo = Number(booking.slots[0].to);
    expect(storedTo - storedFrom).toBe(diff);

    // Also verify that converting stored epoch back to local time yields the original local strings
    const storedFromLocal = moment.tz(storedFrom, tz).format('YYYY-MM-DDTHH:mm:ss');
    const storedToLocal = moment.tz(storedTo, tz).format('YYYY-MM-DDTHH:mm:ss');
    expect(storedFromLocal).toBe(fromLocal);
    expect(storedToLocal).toBe(toLocal);
  });
});
