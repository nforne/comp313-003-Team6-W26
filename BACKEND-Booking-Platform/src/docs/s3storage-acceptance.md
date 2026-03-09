### s3storage acceptance criteria and test plan

A concise, executable acceptance document for the S3 storage feature covering setup, test cases, expected outcomes, monitoring, and sign‑off.

---

### Scope
- **Feature**: Presigned upload/download lifecycle, file record orchestration, replace and delete flows, background processing jobs.
- **Components tested**: `s3.client.factory`, `repositories/s3Storage.repo`, `repos/s3storedfiles.repo`, `services/s3Storage.service`, `controllers/s3Storage.controller`, `routes/s3Storage.routes`, `jobs/s3Storage.jobs`, validators, middleware.
- **Out of scope**: Third‑party virus scanner integration, image processing internals beyond job enqueueing, UI.

---

### Preconditions and environment
- **Environments**: test and staging with identical configuration except endpoints.
- **Required services**: MongoDB accessible to tests, S3-compatible bucket (real or localstack), optional Redis for job queue.
- **Environment variables**:
  - **AWS_REGION**
  - **STORAGE_BUCKET**
  - **STORAGE_PREFIX**
  - **PRESIGN_PUT_EXPIRES**
  - **PRESIGN_GET_EXPIRES**
  - **REDIS_URL** (optional)
  - **MONGODB_URI**
- **Test accounts**:
  - **actor.userId**: `user-123` with role `user`
  - **actor.adminId**: `admin-1` with role `admin`
- **Test tooling**: Jest, Supertest, localstack or real S3, Redis (if used), test runner with network access to services.

---

### Acceptance criteria (high level)
| **ID** | **Requirement** | **Pass condition** |
|---|---:|---|
| AC-1 | Request upload returns presigned PUT and creates DB placeholder | HTTP 201, response contains `presign.url`, `presign.key`, DB record with `status: pending` |
| AC-2 | Confirm upload validates S3 object and marks file available | HTTP 200, DB record `status: available`, `uploadedAt` set, processing job enqueued |
| AC-3 | Presign download returns short-lived GET only to authorized users | HTTP 200 for owner/admin, 403 for others, presign expires within configured TTL |
| AC-4 | Replace flow creates new pending record and returns presign | HTTP 201, new DB record `status: pending`, presign for new key |
| AC-5 | Delete flow soft-deletes DB record and schedules S3 deletion | HTTP 200, DB record `status: deleted`, delete job enqueued or S3 object removed |
| AC-6 | Background job processing is idempotent and marks processedAt | Job runs without duplicate side effects, DB `processedAt` set, status `available` |
| AC-7 | Validation and RBAC enforced consistently | Invalid inputs return 400, unauthorized actions return 403 |
| AC-8 | Rate limiting applied to endpoints | Requests beyond configured limits return 429 with headers |

---

### Test cases (detailed)
#### 1. Request upload — happy path
- **Setup**: actor `user-123` authenticated.
- **Request**: `POST /storage/request-upload` body `{ filename: "photo.jpg", contentType: "image/jpeg", size: 1024 }`.
- **Steps**:
  1. Call endpoint.
  2. Verify response status 201.
  3. Verify response contains `presign.url`, `presign.key`, `presign.bucket`.
  4. Query DB for record by `key` and verify `status: pending`, `ownerId: user-123`, `filename: photo.jpg`.
- **Expected**: AC-1 satisfied.

#### 2. Confirm upload — object exists
- **Setup**: Use key from test 1. Upload a small object to S3 at that key using the returned presign URL.
- **Request**: `POST /storage/confirm` body `{ fileId, key }`.
- **Steps**:
  1. PUT object to S3 using presign.
  2. Call confirm endpoint.
  3. Verify HTTP 200 and DB record `status: available`, `uploadedAt` set.
  4. Verify job `enqueueProcessUploadedFile` called or job queue contains job.
- **Expected**: AC-2 satisfied.

#### 3. Confirm upload — object missing
- **Setup**: Create DB record pending but do not upload object.
- **Request**: `POST /storage/confirm` with fileId and key.
- **Expected**: HTTP 404, DB record updated to `status: failed` or remains pending with clear error logged.

#### 4. Presign download — owner allowed, others denied
- **Setup**: File record `status: available`.
- **Requests**:
  - Owner requests `GET /storage/presign-download?fileId=...` expect 200 and `presign.url`.
  - Different user requests same endpoint expect 403.
- **Expected**: AC-3 satisfied.

#### 5. Replace file — create pending replacement
- **Setup**: Existing file owned by `user-123`.
- **Request**: `POST /storage/replace` body `{ fileId, newFilename: "photo-v2.jpg" }`.
- **Steps**:
  1. Call endpoint.
  2. Verify HTTP 201, new DB record `status: pending`.
  3. Verify presign returned for new key.
- **Expected**: AC-4 satisfied.

#### 6. Delete file — soft delete and S3 deletion
- **Setup**: File record `status: available` with object present in S3.
- **Request**: `DELETE /storage/:id`.
- **Steps**:
  1. Call endpoint as owner.
  2. Verify HTTP 200 and DB `status: deleted`, `deletedAt` set.
  3. Verify delete job enqueued or object removed from S3.
- **Expected**: AC-5 satisfied.

#### 7. Background processing idempotency
- **Setup**: Create file record and ensure object present.
- **Action**: Trigger `processUploadedFile` job twice with same payload.
- **Expected**: Second run is a no-op or safe; DB `processedAt` set once; no duplicate thumbnails or metadata corruption.

#### 8. Validation and RBAC
- **Tests**:
  - Missing filename/contentType on request-upload returns 400.
  - Confirm with mismatched key/fileId returns 400.
  - Non-owner attempts to confirm/replace/delete return 403.
- **Expected**: AC-7 satisfied.

#### 9. Rate limiting
- **Setup**: Configure limiter to low threshold for test.
- **Action**: Send requests exceeding limit.
- **Expected**: 429 responses with `X-RateLimit-*` headers. AC-8 satisfied.

#### 10. Error handling and logging
- **Tests**:
  - Simulate S3 errors during presign generation and confirm service surfaces 5xx with logs.
  - Simulate DB duplicate on createFileRecord and expect 409.
- **Expected**: Clear error codes, logs include correlationId.

---

### Test data and fixtures
- **S3 objects**: small text and image files for upload tests.
- **DB fixtures**: minimal file records for pending, available, failed states.
- **Idempotency**: use `idempotencyKey` values to test duplicate request handling.

---

### Monitoring, observability and postconditions
- **Logs**: Ensure structured logs include `event`, `fileId`, `key`, `ownerId`, `correlationId`.
- **Metrics**:
  - Presign requests per minute
  - Confirm success rate
  - Job queue length and job failures
  - S3 delete success rate
- **Alerts**:
  - Job failure rate > 5% in 10 minutes
  - Presign generation errors spike
  - Redis or Mongo connectivity errors
- **Postconditions after acceptance**:
  - No pending records older than configured threshold without scheduled cleanup
  - Orphan S3 objects cleaned by `cleanupOrphans` job within SLA

---

### Rollback and remediation
- **If critical failure in staging**:
  1. Disable new endpoints by removing route mount or toggling feature flag.
  2. Revert deployment to previous release.
  3. Run `cleanupOrphans` in dry-run to assess orphan objects.
  4. Restore DB from backup if corruption detected.
- **Data safety**: Soft-delete policy ensures recoverability until hard-delete job runs.

---

### Sign-off checklist
- [ ] All acceptance criteria AC-1 through AC-8 pass in staging.
- [ ] Automated tests (unit and integration) pass in CI.
- [ ] Job workers registered and processing successfully.
- [ ] Monitoring dashboards updated and alerts configured.
- [ ] Documentation updated: API contract, validators, example requests.
- **Approved by**: ____________________  
- **Date**: ____________________

---