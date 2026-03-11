/**
 * src/services/bid.service.js
 *
 * Complete bid service:
 * - createBid: provider-only; rejects when request is not active/booked/closed; prevents duplicates.
 * - updateBid: provider updates allowed (draft/submit/withdraw); owner/admin may accept/reject/cancel.
 *   Rejects updates when request is booked/closed.
 * - deleteDraftBid: hard-delete only for bids in 'draft' status; provider owner or admin only.
 *
 * Notes:
 * - The accept flow must be implemented with a booking service and DB transaction.
 * - Calendar operations are TODOs and must be implemented with idempotency and reconciliation.
 */

const mongoose = require("mongoose");
const bidRepo = require("../repositories/bid.repo");
const requestRepo = require("../repositories/request.repo");
const auditService = require("./audit.service");
// Optional services to implement and wire in production:
// const bookingService = require('./booking.service');
// const calendarService = require('./calendar.service');
// const notificationService = require('./notification.service');

async function createBid(actor, request_id, payload, correlationId = null) {
  const actorCtx = { userId: actor && actor.userId, role: actor && actor.role };

  // Authorization: only service_provider may create bids
  if (!actor || actor.role !== "service_provider") {
    const err = new Error("Only service_provider may create bids");
    err.status = 403;
    await auditService.logEvent({
      eventType: "bid.create.forbidden",
      actor: actorCtx,
      target: { type: "Request", id: request_id },
      outcome: "failure",
      severity: "warning",
      correlationId,
    });
    throw err;
  }

  // Validate request existence and visibility
  const request = await requestRepo.findById(request_id);
  if (!request) {
    const err = new Error("Request not found");
    err.status = 404;
    await auditService.logEvent({
      eventType: "bid.create.failed.request_not_found",
      actor: actorCtx,
      target: { type: "Request", id: request_id },
      outcome: "failure",
      severity: "warning",
      correlationId,
    });
    throw err;
  }

  // Prevent bidding if request is not active
  // Standard statuses: 'draft', 'active', 'booked', 'expired', 'suspended', 'cancelled', 'closed' (if used)
  if (request.status !== "active") {
    const err = new Error("Bidding closed for this request");
    err.status = 409;
    await auditService.logEvent({
      eventType: "bid.create.failed.request_not_open",
      actor: actorCtx,
      target: { type: "Request", id: request_id },
      outcome: "failure",
      severity: "warning",
      correlationId,
      details: { requestStatus: request.status },
    });
    throw err;
  }

  // Private request visibility check (allowed_providers field name may vary)
  if (request.isPrivate) {
    const allowed = Array.isArray(
      request.allowedProviders || request.allowed_providers,
    )
      ? (request.allowedProviders || request.allowed_providers).includes(
          actor.userId,
        )
      : false;
    if (!allowed && actor.role !== "administrator") {
      const err = new Error("Not allowed to bid on this private request");
      err.status = 403;
      await auditService.logEvent({
        eventType: "bid.create.forbidden.private_request",
        actor: actorCtx,
        target: { type: "Request", id: request_id },
        outcome: "failure",
        severity: "warning",
        correlationId,
      });
      throw err;
    }
  }

  // Prevent duplicate active bid (repo + DB unique index)
  const existing = await bidRepo.findByRequestAndProvider(
    request_id,
    actor.userId,
  );
  if (existing) {
    const err = new Error(
      "Active bid already exists for this provider and request",
    );
    err.status = 409;
    await auditService.logEvent({
      eventType: "bid.create.failed.duplicate",
      actor: actorCtx,
      target: { type: "Request", id: request_id },
      outcome: "failure",
      severity: "warning",
      correlationId,
      details: { existingId: existing._id.toString() },
    });
    throw err;
  }

  const obj = {
    request_id,
    provider_id: actor.userId,
    quote_amount: payload.quote_amount,
    currency: payload.currency,
    services: payload.services || [],
    message: payload.message || "",
    status: payload.status || "submitted",
    metadata: payload.metadata || {},
  };

  // TODO   10 submitted bids max by default. or set limit
  // use the metadata to check for a set maxAllowedBids

  try {
    const created = await bidRepo.create(obj);

    await auditService.logEvent({
      eventType: "bid.create",
      actor: actorCtx,
      target: { type: "Bid", id: created._id.toString() },
      outcome: "success",
      severity: "info",
      correlationId,
      details: {
        request_id,
        provider_id: actor.userId,
        quote_amount: created.quote_amount,
      },
    });

    // TODO: Update service calendar if this bid includes scheduled services or affects provider availability.
    // - Reserve tentative slots (not confirmed) for the provider/services referenced by this bid.
    // - calendarService.reserveTentativeSlots({ providerId: created.provider_id, services: created.services, metadata: { bidId: created._id.toString(), requestId: request_id } })
    // - Ensure calendarService is idempotent and supports cancellation/release.
    //
    // Note: Do NOT confirm calendar slots here; confirmation must happen inside the accept->booking transaction.

    // TODO: Trigger notification to request owner (best-effort)
    // await notificationService.notifyUser(request.createdBy, { type: 'new_bid', bidId: created._id.toString(), requestId: request_id });

    return created;
  } catch (err) {
    // Duplicate key race handling
    if (err && err.code === 11000) {
      const conflict = new Error("Duplicate bid (db)");
      conflict.status = 409;
      await auditService.logEvent({
        eventType: "bid.create.failed.duplicate_db",
        actor: actorCtx,
        target: { type: "Request", id: request_id },
        outcome: "failure",
        severity: "warning",
        correlationId,
        details: { error: err.message },
      });
      throw conflict;
    }

    await auditService.logEvent({
      eventType: "bid.create.failed",
      actor: actorCtx,
      target: { type: "Request", id: request_id },
      outcome: "failure",
      severity: "error",
      correlationId,
      details: { error: err.message },
    });
    throw err;
  }
}

/**
 * Update a bid.
 * - Providers may update their own bids (draft/submit/withdrawn).
 * - Request owner or administrator may accept/reject/cancel.
 * - No updates allowed once the request is booked/closed.
 */
async function updateBid(actor, bidId, patch, correlationId = null) {
  const actorCtx = { userId: actor && actor.userId, role: actor && actor.role };
  const bid = await bidRepo.findById(bidId);
  if (!bid) {
    const err = new Error("Bid not found");
    err.status = 404;
    await auditService.logEvent({
      eventType: "bid.update.failed.not_found",
      actor: actorCtx,
      target: { type: "Bid", id: bidId },
      outcome: "failure",
      severity: "warning",
      correlationId,
    });
    throw err;
  }

  // Load request to check status and owner
  const request = await requestRepo.findById(bid.request_id);
  if (!request) {
    const err = new Error("Request not found");
    err.status = 404;
    await auditService.logEvent({
      eventType: "bid.update.failed.request_not_found",
      actor: actorCtx,
      target: { type: "Bid", id: bidId },
      outcome: "failure",
      severity: "warning",
      correlationId,
    });
    throw err;
  }

  // Prevent updates if request is booked/closed
  if (request.status === "booked" || request.status === "closed") {
    const err = new Error(
      "Cannot update bid: request is already booked or closed",
    );
    err.status = 409;
    await auditService.logEvent({
      eventType: "bid.update.failed.request_closed",
      actor: actorCtx,
      target: { type: "Bid", id: bidId },
      outcome: "failure",
      severity: "warning",
      correlationId,
      details: { requestStatus: request.status },
    });
    throw err;
  }

  // Provider actions: update own bid
  if (actor.userId === bid.provider_id && actor.role === "service_provider") {
    const allowedStatus = ["draft", "submitted", "withdrawn"];
    if (patch.status && !allowedStatus.includes(patch.status)) {
      const err = new Error("Invalid status transition for provider");
      err.status = 400;
      throw err;
    }

    const allowed = {};
    [
      "message",
      "quote_amount",
      "currency",
      "services",
      "status",
      "metadata",
    ].forEach((k) => {
      if (k in patch) allowed[k] = patch[k];
    });

    const updated = await bidRepo.updateById(bidId, allowed);
    await auditService.logEvent({
      eventType: "bid.update",
      actor: actorCtx,
      target: { type: "Bid", id: bidId },
      outcome: "success",
      severity: "info",
      correlationId,
      details: { updatedFields: Object.keys(allowed) },
    });

    // TODO: If provider changed services or availability, update the service calendar accordingly.
    // Example:
    // if ('services' in allowed || 'metadata' in allowed) {
    //   await calendarService.updateTentativeSlots({ bidId, providerId: updated.provider_id, services: updated.services });
    //   await auditService.logEvent({ eventType: 'bid.calendar.update', actor: actorCtx, target: { type: 'Bid', id: bidId }, outcome: 'info', severity: 'info', correlationId });
    // }

    return updated;
  }

  // Owner/admin actions: accept/reject/cancel
  const isOwner = request && request.createdBy === actor.userId;
  const isAdmin = actor.role === "administrator";
  if (!isOwner && !isAdmin) {
    const err = new Error("Forbidden");
    err.status = 403;
    await auditService.logEvent({
      eventType: "bid.update.forbidden",
      actor: actorCtx,
      target: { type: "Bid", id: bidId },
      outcome: "failure",
      severity: "warning",
      correlationId,
    });
    throw err;
  }

  // Accept flow: atomic booking + request update + bid update + calendar confirmation
  if (patch.status === "accepted") {
    // IMPORTANT: implement with real DB transaction and session-aware repo/service methods.
    // The pseudocode below shows the intended sequence.
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      /*
        check the calendar first, do the booking and then update the calendar
      
      */

      // 1) Create booking (bookingService should accept session)
      // const booking = await bookingService.createBookingTransactional({
      //   request_id: request._id.toString(),
      //   seeker_id: request.createdBy,
      //   provider_id: bid.provider_id,
      //   quote_amount: bid.quote_amount,
      //   currency: bid.currency,
      //   services: bid.services,
      //   slots: bid.metadata && bid.metadata.slots ? bid.metadata.slots : []
      // }, session);

      // 2) Update request status -> 'booked' (session-aware)
      // await requestRepo.updateByIdWithSession(request._id.toString(), { status: 'booked' }, session);

      // 3) Update accepted bid -> 'accepted' (session-aware)
      // await bidRepo.updateByIdWithSession(bidId, { status: 'accepted' }, session);

      // 4) Update other submitted bids -> 'rejected' (session-aware)
      // await bidRepo.updateMany({ request_id: bid.request_id, _id: { $ne: bid._id }, status: 'submitted', archived: false }, { status: 'rejected' }, session);

      // 5) Hard-delete draft bids for this request (session-aware)
      // await mongoose.model('Bid').deleteMany({ request_id: bid.request_id, status: 'draft' }).session(session).exec();

      // 6) Confirm calendar slots for provider (session-aware)
      // await calendarService.confirmSlots({ bookingId: booking._id.toString(), bidId }, { session });

      await session.commitTransaction();
      session.endSession();

      // Post-commit: audit + notifications
      await auditService.logEvent({
        eventType: "bid.accept",
        actor: actorCtx,
        target: { type: "Bid", id: bidId },
        outcome: "success",
        severity: "info",
        correlationId,
        details: { request_id: bid.request_id },
      });

      // TODO: notify accepted provider, rejected providers, and request owner (best-effort)
      // await notificationService.notifyUser(bid.provider_id, { type: 'bid_accepted', bidId, bookingId: booking._id.toString() });

      // Return updated bid (fresh read)
      return await bidRepo.findById(bidId);
    } catch (e) {
      try {
        await session.abortTransaction();
      } catch (er) {
        /* ignore */
      }
      session.endSession();
      await auditService.logEvent({
        eventType: "bid.accept.failed",
        actor: actorCtx,
        target: { type: "Bid", id: bidId },
        outcome: "failure",
        severity: "error",
        correlationId,
        details: { error: e && e.message },
      });
      throw e;
    }
  }

  if (["rejected", "cancelled"].includes(patch.status)) {
    const updated = await bidRepo.updateById(bidId, { status: patch.status });
    await auditService.logEvent({
      eventType: `bid.${patch.status}`,
      actor: actorCtx,
      target: { type: "Bid", id: bidId },
      outcome: "success",
      severity: "info",
      correlationId,
    });

    // TODO: On rejection/cancellation, release any tentative calendar slots associated with this bid.
    // await calendarService.releaseTentativeSlots({ bidId });

    return updated;
  }

  const err = new Error("Invalid operation");
  err.status = 400;
  throw err;
}

/**
 * Hard delete a draft bid.
 * - Allowed only when bid.status === 'draft'.
 * - Only the bid owner (provider) or an administrator may perform the deletion.
 * - Returns the deleted bid document (as fetched before deletion).
 */
async function deleteDraftBid(actor, bidId, correlationId = null) {
  const actorCtx = { userId: actor && actor.userId, role: actor && actor.role };

  const bid = await bidRepo.findById(bidId);
  if (!bid) {
    const err = new Error("Bid not found");
    err.status = 404;
    await auditService.logEvent({
      eventType: "bid.hard_delete.failed.not_found",
      actor: actorCtx,
      target: { type: "Bid", id: bidId },
      outcome: "failure",
      severity: "warning",
      correlationId,
    });
    throw err;
  }

  // Only allow hard delete for draft bids
  if (bid.status !== "draft") {
    const err = new Error("Only draft bids may be hard deleted");
    err.status = 400;
    await auditService.logEvent({
      eventType: "bid.hard_delete.failed.invalid_status",
      actor: actorCtx,
      target: { type: "Bid", id: bidId },
      outcome: "failure",
      severity: "warning",
      correlationId,
      details: { currentStatus: bid.status },
    });
    throw err;
  }

  // Permission check: bid owner (provider) or admin
  const isOwner = actor && actor.userId && actor.userId === bid.provider_id;
  const isAdmin = actor && actor.role === "administrator";
  if (!isOwner && !isAdmin) {
    const err = new Error("Forbidden");
    err.status = 403;
    await auditService.logEvent({
      eventType: "bid.hard_delete.forbidden",
      actor: actorCtx,
      target: { type: "Bid", id: bidId },
      outcome: "failure",
      severity: "warning",
      correlationId,
    });
    throw err;
  }

  await auditService.logEvent({
    eventType: "bid.hard_delete.attempt",
    actor: actorCtx,
    target: { type: "Bid", id: bidId },
    outcome: "info",
    severity: "info",
    correlationId,
  });

  try {
    const res = await bidRepo.hardDeleteById(bidId);
    // res may be { deletedCount: n } or a write result depending on driver
    const deletedCount =
      res && typeof res.deletedCount !== "undefined"
        ? res.deletedCount
        : res && res.n
          ? res.n
          : null;
    if (deletedCount === 0 || deletedCount === null) {
      // If driver returns nothing, assume success if no error thrown; otherwise handle gracefully
      // We'll still return the original bid object for caller convenience.
    }

    await auditService.logEvent({
      eventType: "bid.hard_delete",
      actor: actorCtx,
      target: { type: "Bid", id: bidId },
      outcome: "success",
      severity: "info",
      correlationId,
      details: { deletedCount },
    });

    // TODO: If any tentative calendar slots were created for this draft bid, ensure they are released.
    // await calendarService.releaseTentativeSlots({ bidId });

    return bid;
  } catch (e) {
    await auditService.logEvent({
      eventType: "bid.hard_delete.failed.db_error",
      actor: actorCtx,
      target: { type: "Bid", id: bidId },
      outcome: "failure",
      severity: "error",
      correlationId,
      details: { error: e && e.message },
    });
    throw e;
  }
}

module.exports = { createBid, updateBid, deleteDraftBid };
