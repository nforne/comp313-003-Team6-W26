### Bid acceptance policy

> Note: Accept flow should be implemented with a booking service and DB transaction (MongoDB session) when creating bookings and updating request status atomically.  
> When accepting a bid, update the service calendar to convert any tentative reservations into confirmed bookings for the provider and the specific services.

---

### Overview
This document defines the **acceptance** behavior and the system guarantees when a request owner accepts a bid. It enforces that **once a booking is created the request is closed for bidding**, no new bids may be created, and existing bids cannot be updated. The acceptance flow must be atomic and include calendar confirmation, bid state transitions, request status update, and notifications.

---

### Acceptance flow (atomic sequence)
1. **Preconditions**
   - Request must exist and be in **active** status.
   - Actor must be the request owner or an administrator.
   - Target bid must exist and be in a state eligible for acceptance such as **submitted**.

2. **Start DB transaction**
   - Start a MongoDB session and `startTransaction`.

3. **Create Booking record**
   - Create a `Booking` document using the booking service inside the session.
   - Booking must reference `requestId`, `bidId`, `providerId`, `seekerId`, `services`, `slots`, and `quote`.

4. **Update Request status**
   - Update `Request.status` to **booked** inside the same session.
   - This is the canonical signal that bidding is closed for the request.

5. **Update bids**
   - Update the accepted bid to **accepted** inside the session.
   - Update all other submitted bids for the same request to **rejected** inside the session.
   - Hard delete any draft bids for the same request inside the session.

6. **Confirm calendar slots**
   - Convert any tentative calendar reservations associated with the accepted bid into confirmed bookings inside the session.
   - Calendar operations must be idempotent and support session-aware confirmation or be coordinated via a compensating mechanism.

7. **Commit transaction**
   - Commit the session transaction.
   - If commit succeeds, the request is booked and bidding is closed.

8. **Post-commit actions**
   - Send notifications to the accepted provider, rejected providers, and the request owner.
   - Emit audit events for acceptance, rejections, calendar confirmations, and booking creation.

---

### Transaction and calendar guarantees
- **Atomicity**: Booking creation, request status update, bid status updates, and calendar confirmation must be performed in a single transaction when possible.
- **Idempotency**: Calendar and booking services must expose idempotent operations to tolerate retries and partial failures.
- **Reconciliation**: If calendar confirmation cannot be performed inside the DB transaction, implement a reliable outbox or reconciliation job that confirms or rolls back calendar state and notifies stakeholders.
- **Conflict handling**: Use conditional updates that check current status to avoid double-acceptance. For example use `findOneAndUpdate` with `status: { $in: ['active'] }` or similar guards.

---

### API behavior and error codes
- **POST /bookings** or owner `PATCH /bids/:id` to accept:
  - **200** or **201** on success with booking and accepted bid details.
  - **409 Conflict** if the request is not in an acceptable state for acceptance or if another accept already committed.
  - **404 Not Found** if bid or request does not exist.
  - **403 Forbidden** if actor is not owner or admin.
  - **500** for unexpected server errors.
- **POST /reqs/:request_id/bids**:
  - **201** on success when request status is **active**.
  - **409 Conflict** with message `Bidding closed for this request` when request status !== **active**.
- **PATCH /bids/:id**:
  - Reject updates with **409 Conflict** when the associated request status is **booked** or **closed**.

---

### Audit, logging, and notifications
- Emit audit events for:
  - Acceptance attempt, acceptance success, acceptance failure.
  - Request status change to **booked**.
  - Bid status transitions for accepted, rejected, and deleted bids.
  - Calendar confirmation and calendar release actions.
- Notifications:
  - Notify accepted provider with booking details and next steps.
  - Notify rejected providers that bidding closed and their bids were not selected.
  - Notify request owner with booking confirmation and provider contact details.

---

### Tests and acceptance criteria
- **Unit tests**
  - Accept flow attempts to start a transaction and calls booking, request update, bid updates, and calendar confirm functions.
  - `createBid` rejects when `request.status !== 'active'`.
  - `updateBid` rejects when `request.status === 'booked'` or `closed`.
  - `deleteDraftBid` only deletes when bid.status === `draft` and actor is owner or admin.
- **Integration tests**
  - Simulate concurrent provider bid creation and owner accept; accept must win and subsequent create attempts must return **409**.
  - Full accept flow with in-memory MongoDB: assert `Request.status === 'booked'`, accepted bid status, other bids rejected, draft bids removed, and booking record created.
  - Calendar reconciliation test: simulate calendar confirmation failure and verify rollback or reconciliation job corrects state.
- **Acceptance checklist**
  - Acceptance is atomic or reconciled.
  - No new bids accepted after booking.
  - Bid updates are blocked after booking.
  - Notifications and audit events are emitted for all major steps.

---

### Implementation notes
- Add or ensure session-aware repo methods exist such as `requestRepo.updateByIdWithSession`.
- Ensure `bidRepo.updateByIdWithSession` and `bookingService.createBookingTransactional` accept a `session` parameter.
- Calendar service must support tentative reservations, updates, confirmations, and releases with idempotency keys.
- Log and monitor metrics for acceptance failures, transaction aborts, and calendar reconciliation runs.