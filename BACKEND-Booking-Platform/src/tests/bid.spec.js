// tests/bid.spec.js
//
// Jest unit tests for src/services/bid.service.js
// - Mocks repositories and audit service to test business rules:
//   * createBid: success, reject when request not active, reject duplicate
//   * updateBid: provider update allowed; reject update when request is booked/closed
//   * deleteDraftBid: hard-delete allowed for owner/admin; forbidden otherwise
//
// Run with: jest tests/bid.spec.js

const bidService = require('../src/services/bid.service');
const bidRepo = require('../src/repositories/bid.repo');
const requestRepo = require('../src/repositories/request.repo');
const auditService = require('../src/services/audit.service');

jest.mock('../src/repositories/bid.repo');
jest.mock('../src/repositories/request.repo');
jest.mock('../src/services/audit.service');

describe('bid.service', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('createBid', () => {
    it('creates a bid when actor is provider and request is active', async () => {
      const actor = { userId: 'prov_1', role: 'service_provider' };
      const request_id = 'req_1';
      const payload = { quote_amount: 100, currency: 'USD', services: ['svc_a'] };

      // request exists and is active
      requestRepo.findById.mockResolvedValue({ _id: request_id, status: 'active', isPrivate: false });

      // no existing bid
      bidRepo.findByRequestAndProvider.mockResolvedValue(null);

      // create returns created doc
      const createdDoc = Object.assign({ _id: 'bid_1' }, payload, { provider_id: actor.userId, request_id });
      bidRepo.create.mockResolvedValue(createdDoc);

      const result = await bidService.createBid(actor, request_id, payload, 'corr-1');

      expect(result).toBe(createdDoc);
      expect(bidRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        request_id,
        provider_id: actor.userId,
        quote_amount: payload.quote_amount
      }));
      expect(auditService.logEvent).toHaveBeenCalled();
    });

    it('rejects when request is not active (booked)', async () => {
      const actor = { userId: 'prov_1', role: 'service_provider' };
      const request_id = 'req_2';
      const payload = { quote_amount: 50, currency: 'USD' };

      requestRepo.findById.mockResolvedValue({ _id: request_id, status: 'booked', isPrivate: false });

      await expect(bidService.createBid(actor, request_id, payload, 'corr-2'))
        .rejects.toMatchObject({ message: 'Bidding closed for this request', status: 409 });

      expect(bidRepo.create).not.toHaveBeenCalled();
      expect(auditService.logEvent).toHaveBeenCalled();
    });

    it('rejects duplicate active bid', async () => {
      const actor = { userId: 'prov_2', role: 'service_provider' };
      const request_id = 'req_3';
      const payload = { quote_amount: 75, currency: 'USD' };

      requestRepo.findById.mockResolvedValue({ _id: request_id, status: 'active', isPrivate: false });
      bidRepo.findByRequestAndProvider.mockResolvedValue({ _id: 'existing_bid' });

      await expect(bidService.createBid(actor, request_id, payload, 'corr-3'))
        .rejects.toMatchObject({ message: 'Active bid already exists for this provider and request', status: 409 });

      expect(bidRepo.create).not.toHaveBeenCalled();
      expect(auditService.logEvent).toHaveBeenCalled();
    });

    it('rejects non-provider actor', async () => {
      const actor = { userId: 'user_x', role: 'service_seeker' };
      const request_id = 'req_4';
      const payload = { quote_amount: 10, currency: 'USD' };

      await expect(bidService.createBid(actor, request_id, payload, 'corr-4'))
        .rejects.toMatchObject({ message: 'Only service_provider may create bids', status: 403 });

      expect(bidRepo.create).not.toHaveBeenCalled();
      expect(auditService.logEvent).toHaveBeenCalled();
    });
  });

  describe('updateBid', () => {
    it('allows provider to update own bid when request is active', async () => {
      const actor = { userId: 'prov_3', role: 'service_provider' };
      const bidId = 'bid_up_1';
      const patch = { message: 'updated message', quote_amount: 120 };

      // existing bid
      bidRepo.findById.mockResolvedValue({ _id: bidId, provider_id: actor.userId, request_id: 'req_up_1', status: 'submitted' });
      // request active
      requestRepo.findById.mockResolvedValue({ _id: 'req_up_1', status: 'active', createdBy: 'seeker_1' });
      // update returns updated doc
      bidRepo.updateById.mockResolvedValue(Object.assign({ _id: bidId }, patch));

      const updated = await bidService.updateBid(actor, bidId, patch, 'corr-5');

      expect(updated).toMatchObject({ _id: bidId, message: 'updated message' });
      expect(bidRepo.updateById).toHaveBeenCalledWith(bidId, expect.objectContaining({ message: 'updated message' }));
      expect(auditService.logEvent).toHaveBeenCalled();
    });

    it('rejects updates when request is booked', async () => {
      const actor = { userId: 'prov_4', role: 'service_provider' };
      const bidId = 'bid_up_2';
      const patch = { message: 'try update' };

      bidRepo.findById.mockResolvedValue({ _id: bidId, provider_id: actor.userId, request_id: 'req_up_2', status: 'submitted' });
      requestRepo.findById.mockResolvedValue({ _id: 'req_up_2', status: 'booked', createdBy: 'seeker_2' });

      await expect(bidService.updateBid(actor, bidId, patch, 'corr-6'))
        .rejects.toMatchObject({ message: 'Cannot update bid: request is already booked or closed', status: 409 });

      expect(bidRepo.updateById).not.toHaveBeenCalled();
      expect(auditService.logEvent).toHaveBeenCalled();
    });

    it('allows owner to accept bid and runs accept flow skeleton (transaction attempt)', async () => {
      const actor = { userId: 'seeker_3', role: 'service_seeker' };
      const bidId = 'bid_accept_1';
      const patch = { status: 'accepted' };

      // existing bid
      bidRepo.findById.mockResolvedValue({ _id: bidId, provider_id: 'prov_accept', request_id: 'req_accept_1', status: 'submitted', services: [], quote_amount: 200, currency: 'USD', metadata: {} });
      // request exists and owner is seeker_3 and active
      requestRepo.findById.mockResolvedValue({ _id: 'req_accept_1', status: 'active', createdBy: actor.userId });

      // Mock session-aware repo methods if called; for unit test we allow updateByIdWithSession to resolve
      bidRepo.updateByIdWithSession = jest.fn().mockResolvedValue({ _id: bidId, status: 'accepted' });
      // requestRepo.updateByIdWithSession may not exist in unit test; ensure no throw if not used
      requestRepo.updateByIdWithSession = jest.fn().mockResolvedValue({ _id: 'req_accept_1', status: 'booked' });

      // Simulate findById after accept returns accepted status
      bidRepo.findById.mockResolvedValueOnce({ _id: bidId, provider_id: 'prov_accept', request_id: 'req_accept_1', status: 'accepted' });

      const result = await bidService.updateBid(actor, bidId, patch, 'corr-7');

      // After accept flow, service returns the updated bid (we mocked findById to return accepted)
      expect(result).toBeDefined();
      expect(auditService.logEvent).toHaveBeenCalled();
    });
  });

  describe('deleteDraftBid', () => {
    it('hard-deletes a draft bid when actor is owner', async () => {
      const actor = { userId: 'prov_del', role: 'service_provider' };
      const bidId = 'bid_del_1';

      bidRepo.findById.mockResolvedValue({ _id: bidId, provider_id: actor.userId, status: 'draft' });
      bidRepo.hardDeleteById.mockResolvedValue({ deletedCount: 1 });

      const deleted = await bidService.deleteDraftBid(actor, bidId, 'corr-8');

      expect(deleted).toBeDefined();
      expect(deleted._id).toBe(bidId);
      expect(bidRepo.hardDeleteById).toHaveBeenCalledWith(bidId);
      expect(auditService.logEvent).toHaveBeenCalled();
    });

    it('forbids hard-delete when bid is not draft', async () => {
      const actor = { userId: 'prov_del2', role: 'service_provider' };
      const bidId = 'bid_del_2';

      bidRepo.findById.mockResolvedValue({ _id: bidId, provider_id: actor.userId, status: 'submitted' });

      await expect(bidService.deleteDraftBid(actor, bidId, 'corr-9'))
        .rejects.toMatchObject({ message: 'Only draft bids may be hard deleted', status: 400 });

      expect(bidRepo.hardDeleteById).not.toHaveBeenCalled();
      expect(auditService.logEvent).toHaveBeenCalled();
    });

    it('forbids hard-delete when actor is not owner or admin', async () => {
      const actor = { userId: 'someone_else', role: 'service_provider' };
      const bidId = 'bid_del_3';

      bidRepo.findById.mockResolvedValue({ _id: bidId, provider_id: 'prov_owner', status: 'draft' });

      await expect(bidService.deleteDraftBid(actor, bidId, 'corr-10'))
        .rejects.toMatchObject({ message: 'Forbidden', status: 403 });

      expect(bidRepo.hardDeleteById).not.toHaveBeenCalled();
      expect(auditService.logEvent).toHaveBeenCalled();
    });

    it('allows admin to hard-delete any draft bid', async () => {
      const actor = { userId: 'admin_1', role: 'administrator' };
      const bidId = 'bid_del_4';

      bidRepo.findById.mockResolvedValue({ _id: bidId, provider_id: 'prov_owner2', status: 'draft' });
      bidRepo.hardDeleteById.mockResolvedValue({ deletedCount: 1 });

      const deleted = await bidService.deleteDraftBid(actor, bidId, 'corr-11');

      expect(deleted).toBeDefined();
      expect(bidRepo.hardDeleteById).toHaveBeenCalledWith(bidId);
      expect(auditService.logEvent).toHaveBeenCalled();
    });
  });
});
