### Calendar acceptance criteria and test plan

> **Polished Express controller for calendar endpoints.**  
> **Responses: consistent JSON shape { ok: boolean, data?, error?, results?, action? }.**

---

### Scope
- **Files under test:** `src/controllers/calendar.controller.js`, `src/routes/calendar.routes.js`, `src/validators/calendar.validator.js`, `src/services/calendar.service.js`.  
- **Features covered:** read endpoints (latest/default), availability check, reservation flow (multi-week split + atomic tentative reservations + rollback), admin cleanup and scheduler control, timezone detection, validation, logging/audit events.

---

### High-level acceptance criteria
1. **API contract:** All endpoints return JSON with the shape **{ ok, data?, error?, results?, action? }** where applicable.  
2. **Validation:** Route-level Joi validation runs for query/body/params and places validated values on `req.validated`. Controller reads `req.validated` and falls back to raw inputs. Invalid payloads return **400** with `error.code = VALIDATION`.  
3. **Auth / RBAC:**  
   - `POST /reserve` requires authentication.  
   - `POST /cleanup` and `POST /cleanup/scheduler` require admin role. Non-authorized requests return **403**.  
4. **Availability:** If no persisted calendar exists, controller returns the computed default calendar and an appropriate code (e.g., `DEFAULT_CALENDAR` or `OUT_OF_BUSINESS_HOURS`).  
5. **Reservation atomicity:** Multi-week reservations are split by week; if any segment fails, tentative reservations are released and response indicates `action: 'rolled_back'`. Successful flows return `action: 'committed'`.  
6. **Scheduler:** Single in-process scheduler can be started/stopped via admin endpoint; starting when already running is a no-op and returns current state.  
7. **Timezone detection:** Controller prefers explicit timezone headers/params/body, then best-effort IP detection via service helper, then `UTC`.  
8. **Logging & audit:** Important events (requests, successes, failures, scheduler start/stop, cleanup results) are logged via app logger and recorded via `auditService.logEvent` (best-effort; audit failures do not break flows).

---

### Acceptance test scenarios (priority order)
1. **GET /calendar/service/:serviceId/latest — default fallback**
   - **Setup:** `service.getLatestCalendarByService` returns `null`.  
   - **Action:** GET with `dateEpoch` and no timezone header.  
   - **Expect:** `200`, `ok: true`, `meta.source === 'default'`, `auditService.logEvent` called with `calendar.service.get.default`.

2. **GET /calendar/user/:ownerId/latest — persisted**
   - **Setup:** `service.getLatestCalendarByUser` returns a calendar object.  
   - **Expect:** `200`, `ok: true`, `data` equals persisted calendar, `meta.source === 'persisted'`.

3. **GET /calendar/default — query validation**
   - **Action:** GET with valid `ownerId` and `dateEpoch`.  
   - **Expect:** `200`, `ok: true`, `service.getDefaultCalendarView` called with validated params.

4. **POST /calendar/availability — validation and default calendar check**
   - **Valid payload:** returns `200` with `{ ok: true, data: { ok: true } }`.  
   - **Out-of-hours:** returns `200` with `ok: false`, `error.code === 'OUT_OF_BUSINESS_HOURS'`, and `defaultCalendar` present.

5. **POST /calendar/reserve — happy path**
   - **Setup:** `reserveSlotRange` returns `{ ok: true, results: [...], action: 'committed' }`.  
   - **Expect:** `200`, `ok: true`, `action === 'committed'`, audit event `calendar.reserve.success`.

6. **POST /calendar/reserve — rollback path**
   - **Setup:** `reserveSlotRange` returns `{ ok: false, results: [...], action: 'rolled_back' }`.  
   - **Expect:** `409`, `ok: false`, `action === 'rolled_back'`, audit event `calendar.reserve.failed`.

7. **POST /calendar/cleanup — admin flow**
   - **Non-admin:** `403`.  
   - **Admin:** `200`, `ok: true`, `service.cleanupBlankCalendars` called with validated epoch, audit events for trigger/result.

8. **POST /calendar/cleanup/scheduler — start/stop**
   - **Start when not running:** returns scheduler info `{ running: true }`.  
   - **Start when already running:** returns current state and logs no-op.  
   - **Stop:** returns `{ stopped: true }`.  
   - **Non-admin:** `403`.

9. **Timezone detection**
   - **Header present:** used.  
   - **Query/body present:** used.  
   - **No explicit tz:** `service.detectTimezoneFromIp` called with client IP; fallback to `UTC` if detection fails.

10. **Validation middleware integration**
    - Ensure `req.validated` is populated by `validate()` and controller uses `validatedBody()` / `validatedQuery()`.

---

### Test data & environment
- **Test harness:** Jest + Supertest; mock `calendar.service`, `audit.service`, `auth.middleware`, `rbac.middleware`.  
- **Sample payloads:** include minimal valid `ownerId`, `fromEpoch`, `toEpoch`, `bookingId`. Use epoch ms integers.  
- **Logger:** provide a test logger via `app.set('logger', testLogger)` to capture structured logs; assert that key events are logged.

---

### Logging & audit expectations
- **Log entries (structured):** include `event`, `correlationId`, `ownerId/serviceId/bookingId`, and `result` where applicable.  
- **Audit events:** controller calls `auditService.logEvent` for request start, success, failure, and admin actions. Audit failures must not change HTTP response.  
- **Scheduler logs:** `cleanup.scheduler.started`, `cleanup.start`, `cleanup.success`, `cleanup.error`, `cleanup.scheduler.stopped`.

---

### Notes for rollout
- Ensure route-level validation is wired in `src/routes/calendar.routes.js` so controller receives `req.validated`.  
- Start the scheduler only from a single process (or use external cron) to avoid duplicate runs in multi-instance deployments. The in-process scheduler is acceptable for single-instance deployments and testing.  
- Document the admin endpoints and required RBAC roles for ops.

---

### Quick checklist before sign-off
- [ ] All tests in `tests/calendar.spec.js` pass.  
- [ ] Validation errors return consistent `VALIDATION` error shape.  
- [ ] Auth and RBAC enforced at route level.  
- [ ] Audit events emitted for all critical flows.  
- [ ] Scheduler start/stop idempotency verified.  
- [ ] Timezone detection behaves as specified.

---