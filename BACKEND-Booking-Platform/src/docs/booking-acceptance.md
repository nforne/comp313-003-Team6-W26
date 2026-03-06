### Booking Acceptance Criteria

**Purpose**  
Define the functional acceptance criteria, API contract, scheduling behavior, calendar interactions, and test expectations for booking flows.

---

### Acceptance Criteria

- **Create Booking**
  - **Success**: POST `/bkns/confirm` creates a booking when the request is active, calendar availability is confirmed, and payload passes validation.
  - **Atomicity**: Booking creation, request status update to **booked**, and bid transitions must be atomic (use DB transaction). If calendar operations cannot be transactional, use tentative reservations + post-commit confirmation or outbox reconciliation.
  - **Calendar Targeting**: If `services` are present on the accepted bid or payload, check **service** calendars first; otherwise check **provider** calendar.
  - **Conflict**: If calendar check fails, return **409 Conflict** with conflict details; do not create booking.
  - **Post-commit**: Schedule honor job and send notifications best-effort; failures in post-commit tasks must not roll back booking.

- **Cancel Booking**
  - **Who**: seeker, provider, or admin may cancel.
  - **Status**: set to `seeker_cancelled` or `provider_cancelled` (admin may set `suspended`).
  - **Side effects**: cancel scheduled honor job and release calendar slots (best-effort).

- **Update Booking**
  - **Admin-only**: PATCH `/bkns/:id` allowed only for administrators.
  - **Status transitions**: only admin may set `honored` or `suspended` manually; seeker/provider cannot manually set `honored`.
  - **Slots change**: if `slots` are updated, perform calendar availability checks and reschedule honor job if booking remains `active`.

- **Honor Automation**
  - **Automatic**: bookings transition from `active` → `honored` automatically after the booking end time plus buffer, provided status remains `active`.
  - **Scheduler**: use a persistent scheduler (Agenda) in production; in-memory timers are acceptable for tests but not for production.
  - **Cancelation**: any status change away from `active` must cancel the scheduled honor job.

- **Request Expiry**
  - **expiresAt** field on Request model (epoch ms) controls expiration.
  - **In-process timer**: when a request becomes `active` and `expiresAt` is set, schedule a countdown (setTimeout) to mark it `expired` at `expiresAt`.
  - **Rescheduling**: status changes away from `active` or changes to `expiresAt` must clear and/or reschedule the timer.
  - **Production note**: setTimeout timers do not survive restarts; use persistent scheduler or reconciliation job for production guarantees.

- **Validation and Time Handling**
  - **Slots** are epoch ms UTC. Validators enforce `to > from`.
  - **Timezone/DST**: store slots as epoch ms; tests must verify DST normalization (epoch difference reflects real elapsed time).

---

### API Contract

| Method | Path | Auth | Description |
|---|---:|---|---|
| POST | /bkns/confirm | **required** | Create booking; validates payload; checks calendar; transactional. |
| POST | /bkns/:id/cancel | **required** | Cancel booking; seeker/provider/admin allowed; cancels honor job. |
| PATCH | /bkns/:id | **admin only** | Update booking fields or status; calendar checks if slots change. |
| GET | /bkns/:id | optional | Read booking. |
| GET | /bkns/provider/:providerId? | optional | List bookings for provider with pagination and optional status filter. |
| GET | /bkns/seeker/:seekerId? | optional | List bookings for seeker with pagination and optional status filter. |

**Errors**
- **400** Bad Request for validation errors.
- **401** Authentication required.
- **403** Forbidden for RBAC violations.
- **404** Not found.
- **409** Conflict for calendar availability or request not active.
- **500** Server error.

---

### Calendar and Availability Rules

- **Target selection**: prefer **service** calendars when `services` exist; otherwise use **provider** calendar.
- **Availability check flow**
  1. **Pre-check** (best-effort): call `calendarService.checkAvailability({ type, id, slots })`.
  2. **Tentative reservation** (if supported): `reserveTentativeSlots({ type, id, slots, metadata }, { session })` inside transaction.
  3. **Confirm**: after booking record is created and transaction committed, call `confirmSlots({ reservationToken, bookingId })`.
  4. **Fallback**: if calendar cannot participate in transaction, perform pre-check + post-commit confirmation and use outbox/reconciliation for eventual consistency.
- **Conflict detection**: overlapping logic uses `existing.from < new.to && existing.to > new.from` semantics; multi-slot bookings require `$elemMatch` checks.
- **Release**: on cancellation or failed booking, call `releaseTentativeSlots` or `releaseSlots` best-effort.

---

### Scheduler and Honor Automation

- **Scheduler**: prefer Agenda (Mongo-backed) for production. Provide:
  - `init(mongoConnection)` at app startup.
  - `scheduleHonorJob(bookingId, runAtEpochMs, correlationId)`.
  - `cancelHonorJob(bookingId)`.
- **Run time**: schedule job at `max(slot.to)` + buffer (default **1 minute**).
- **Job behavior**: job loads booking; if `status === active` and `max(slot.to) <= now`, set `status = honored`, log audit event.
- **Idempotency**: job must be idempotent; safe to run multiple times.
- **Reconciliation**: periodic job to find bookings with `status === active` and `max(slot.to) < now - buffer` and mark honored as safety net.
- **Testing**: unit tests should mock scheduler and verify `scheduleHonorJob` and `cancelHonorJob` calls; integration tests should run Agenda against test DB.

---

### Tests and QA Checklist

- **Concurrency**
  - Simulate two concurrent booking attempts for overlapping slots against the same calendar target.
  - Expect one success and one 409 conflict; DB must contain a single booking for the overlapping slot.
  - Use a calendar mock that enforces tentative reservation semantics.

- **DST and Timezone**
  - Create slots using a timezone that crosses DST (spring-forward) and verify epoch ms difference equals real elapsed time (e.g., local 01:30 → 03:30 may be 1 hour elapsed).
  - Verify stored epochs convert back to original local wall-clock strings.

- **Scheduler**
  - Verify honor job is scheduled post-commit.
  - Verify honor job marks booking `honored` only if status remains `active`.
  - Verify cancellation clears scheduled job.

- **Request Expiry**
  - Create request with `expiresAt` and status `active`; verify in-process timer marks it `expired` at the right time.
  - Update request to non-active before expiry; verify timer cleared and request not expired.
  - Update request back to `active` with `expiresAt` set; verify timer rescheduled.

- **RBAC**
  - Confirm `PATCH /bkns/:id` returns **403** for non-admins.
  - Confirm cancel endpoint enforces seeker/provider/admin permissions.

- **Edge Cases**
  - Booking creation when calendar service is unavailable: ensure booking is not created if calendar check fails; if tentative reservation succeeded but commit fails, ensure release is attempted.
  - Booking with multiple services: ensure all relevant service calendars are checked; define business rule for whether all must be available or only primary.

---

### Operational Notes

- **Production readiness**
  - Replace in-memory timers for request expiry with persistent scheduler or reconciliation job.
  - Ensure calendar service supports session-aware operations or implement outbox pattern.
  - Monitor scheduled jobs and reconciliation runs; add metrics and alerts for scheduling failures.
- **Auditing**
  - Emit audit events for create, update, cancel, schedule, honor, and expiry actions.
- **Data model**
  - **Booking statuses**: `active`, `honored`, `seeker_cancelled`, `provider_cancelled`, `suspended`.
  - **Request**: includes `expiresAt` (epoch ms) and optional `expiresAtDate` for TTL indexing if desired.

---