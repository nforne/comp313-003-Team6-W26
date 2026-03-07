### Message acceptance criteria and test plan

A concise, actionable acceptance document for the **Messages** feature. Covers API contract, data model expectations, lifecycle rules, access control, DTO behavior, indexes, test scenarios, and rollout checklist.

---

### Scope
- **Files under test**: `src/models/message.model.js`, `src/repositories/message.repo.js`, `src/services/message.service.js`, `src/controllers/message.controller.js`, `src/routes/message.routes.js`, `src/validators/message.validator.js`.  
- **Features covered**: draft lifecycle, submit/send, idempotency, recipients and broadcast, threading (reply_to), attachments metadata, soft and hard delete, per-user listing and unread filtering, issue wall thread listing, admin-only flows, DTO behavior for deleted messages, audit and structured logging.

---

### Acceptance Criteria
- **API contract**: All endpoints return JSON shaped **{ ok: boolean, data?, results?, meta?, error?, action? }**.  
- **Draft lifecycle**: New messages persist with **status: draft**. Submitting a draft sets **status: submitted** and records `metadata.sentAt`. Only the author or an admin may submit a draft.  
- **Idempotency**: When **idempotencyKey** and **userId** are provided, repeated create requests return the existing message (no duplicate). Unique sparse index on `{ userId, idempotencyKey }` enforces this.  
- **Recipients and broadcast**: Messages support `recipientsAll` (broadcast) or explicit `recipients` list. Creating a broadcast is **admin-only**. When `recipientsAll` is true, `recipients` must be empty.  
- **Threading**: `replyTo` links messages. Issue wall listing returns root walls (messages with no `replyTo`) paginated and up to configured replies per wall.  
- **Attachments**: Attachments are metadata only (`filename`, `mimeType`, `size`, `storageRef`). Files are stored externally.  
- **Soft and hard delete**:  
  - **Soft delete**: sets `visible: false` and `status: deleted`; available to author and admin. Soft-deleted messages return a minimal deleted DTO.  
  - **Hard delete**: permanently removes the document; **admin-only**.  
- **DTO behavior**:  
  - **Deleted DTO**: `{ id, type, status, createdAt, updatedAt, reply_to }`.  
  - **Full DTO**: includes `id, type, status, avatar, subject, details, attachments, serviceId, userId, replyTo, recipientsAll, recipients, metadata, createdAt, updatedAt` with recipients redacted for non-admins when appropriate.  
- **Access control**: Auth required for reads and writes. Authors and admins can update and soft-delete. Hard delete requires admin role. Listing respects recipient access and broadcasts.  
- **Audit and logging**: All state-changing operations emit `auditService.logEvent`. Audit failures do not change HTTP responses. Structured logs include `event`, `correlationId`, and key identifiers.

---

### API Endpoints and Expected Behavior
#### Create and lifecycle
- **POST /messages**  
  - Creates a **draft** message. Accepts `type, recipientsAll, recipients, subject, details, attachments, replyTo, idempotencyKey, metadata, serviceId`. Server sets `userId` from actor if not provided. Returns **201** with created message. Duplicate idempotency returns existing message.  
- **POST /messages/:id/submit**  
  - Author or admin only. Transitions `draft` → `submitted`, sets `metadata.sentAt`, enqueues delivery for `email` and `notification` types (non-blocking). Returns **200** with `action: submitted`.  
#### Read and list
- **GET /messages**  
  - Lists messages for the current user: broadcasts, messages where user is in `recipients`, or authored by user. Query: `page, limit, type, since, unreadOnly, recipientId`. Returns paginated results and meta.  
- **GET /messages/:id**  
  - Returns full DTO for visible messages if actor is author, recipient, admin, or broadcast; returns deleted DTO for soft-deleted messages.  
- **GET /messages/type/:type**  
  - Admin can list all; non-admins receive filtered results relevant to them.  
- **GET /messages/metadata?key=&value=**  
  - Generic listing by metadata key/value (bookingId, reviewId, bidId).  
- **GET /messages/thread/issue_wall**  
  - Returns paginated walls (roots with no `replyTo`) and up to `messagesPerWall` replies per wall. Defaults: `wallsPerPage=3`, `messagesPerWall=20`.  
#### Update and delete
- **PATCH /messages/:id**  
  - Author or admin may update allowed fields (`subject, details, attachments, recipients, recipientsAll, serviceId, replyTo, metadata`). If content changes and message was `submitted`, set status back to `draft` for re-review.  
- **DELETE /messages/:id**  
  - Soft delete by author or admin. Returns `action: soft_deleted`.  
- **DELETE /messages/:id/hard**  
  - Hard delete admin-only. Returns `action: hard_deleted`.  

---

### Data Model Indexes and DTOs
- **Indexes required**:  
  - `type`, `serviceId`, `recipientsAll`, `visible`, `createdAt` for common queries.  
  - Sparse unique index `{ userId, idempotencyKey }` for idempotency.  
  - Index on `metadata.bookingId`, `metadata.reviewId` for metadata lookups.  
- **DTO rules**:  
  - **Deleted messages**: return only deleted DTO.  
  - **Recipients**: redact recipient list for non-admin public reads unless the actor is a recipient or author.  
  - **Epoch timestamps**: `createdAt` and `updatedAt` returned as epoch ms in DTOs.

---

### Test Plan and Scenarios
#### Core scenarios
1. **Create draft**  
   - POST valid payload → **201**, `status: draft`, `auditService.logEvent` called.  
2. **Idempotent create**  
   - Repeat POST with same `userId` + `idempotencyKey` → returns same message, no duplicate.  
3. **Submit draft happy path**  
   - POST `/messages/:id/submit` by author → **200**, `action: submitted`, `status: submitted`, delivery enqueued for `email`/`notification`.  
4. **Submit forbidden**  
   - Submit by non-author non-admin → **403**.  
5. **Soft delete and read behavior**  
   - DELETE `/messages/:id` by author → **200**, `action: soft_deleted`. GET returns deleted DTO.  
6. **Hard delete admin**  
   - DELETE `/messages/:id/hard` by admin → **200**, document removed.  
7. **List for user**  
   - GET `/messages` returns broadcasts + direct messages + authored messages; pagination meta present.  
8. **Issue wall thread listing**  
   - GET `/messages/thread/issue_wall` returns up to 3 walls per page and up to 20 messages per wall.  
9. **List by metadata**  
   - GET `/messages/metadata?key=bookingId&value=...` returns matching messages.  
10. **Attachments and metadata persistence**  
    - Create message with attachments → attachments present in DTO `attachments[].storageRef`; files not stored in DB.  
11. **Broadcast enforcement**  
    - Non-admin attempts `recipientsAll=true` → **403**. Admin allowed.

#### Edge and error cases
- Attempt to submit non-draft → **400** with `error.code = INVALID_STATE`.  
- Create with invalid recipient ids → **400** validation error.  
- Duplicate idempotency race condition returns existing message, not error.  
- Audit failures logged but do not change HTTP response.

---

### Rollout Checklist
- [ ] Ensure DB indexes are created including sparse unique index on `{ userId, idempotencyKey }`.  
- [ ] Wire route-level validation and ensure `req.validated` is used by controllers.  
- [ ] Enforce RBAC: broadcast creation and hard delete require admin role.  
- [ ] Integrate communications engine to enqueue delivery for `email` and `notification` types; record delivery status in `metadata`.  
- [ ] Implement per-user read state store (`MessageRead` collection or cache) for `unreadOnly` filtering.  
- [ ] Add integration tests covering idempotency, draft lifecycle, soft/hard delete, issue wall threading, and metadata queries.  
- [ ] Provide operational docs for admin endpoints and scheduler/queue behavior.  
- [ ] Monitor audit logs and delivery queue errors; ensure audit failures are non-blocking.

---
