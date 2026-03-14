/**
 * src/routes/bids.routes.js
 *
 * Route wiring for bid endpoints. RBAC middleware is applied where appropriate.
 * - auth.requireAuth: ensures req.user is present
 * - rbac.requireRole('service_provider'): restricts create to providers
 *
 * Note: auth and rbac middleware implementations are assumed to exist in src/middleware.
 */

const express = require('express');
const bidController = require('../controllers/bid.controller');
const auth = require('../middleware/auth.middleware'); // requireAuth / optionalAuth
const rbac = require('../middleware/rbac.middleware'); // requireRole('service_provider')

const router = express.Router();

/* Create a bid (provider only) */
router.post(
  '/reqs/:request_id/bids',
  auth.requireAuth,
  rbac.requireAnyRole(['service_provider', 'administrator']),
  bidController.createBid
);

/* List bids for a request (visibility enforced in service/repo) */
router.get('/reqs/:request_id/bids', auth.requireAuth, bidController.listBidsForRequest);

/* Update a bid (provider or request owner/admin) */
router.patch('/bids/:id', auth.requireAuth, bidController.updateBid);

/* Delete a bid (hard-delete for draft bids). Service enforces draft-only and permission checks.
   Require authentication; service will allow provider owner or administrator. */
router.delete('/bids/:id', auth.requireAuth, bidController.deleteBid);

module.exports = router;
