### Service model acceptance checklist

---

#### Overview
Acceptance tests for the Service HTTP surface and persistence layer. Covers create, read, update, delete, search, and validation rules (capacity). Each case lists **endpoint**, **request**, **expected status**, **key assertions**, and **notes** for DB state, audit events, and RBAC.

---

#### Endpoints and expected behavior

| **Scenario** | **Endpoint** | **Expected Status** | **Key Assertions** |
|---|---:|---:|---|
| Create service (owner) | `POST /svcs` | **201 Created** | Response contains `service.serviceId`; DB has record with `providerId` and `name`; audit event logged. |
| Duplicate name for same provider | `POST /svcs` | **409 Conflict** | No new record created; response indicates conflict; audit event logged for duplicate. |
| Read service | `GET /svcs/:id` | **200 OK** | Response contains full service details; sensitive internal fields not leaked; audit event logged. |
| Update by owner | `PATCH /svcs/:id` | **200 OK** | Returned service reflects patched fields; `updatedAt` changed; audit event logged. |
| Update by non-owner non-admin | `PATCH /svcs/:id` | **403 Forbidden** | No change in DB; response indicates forbidden; audit event logged. |
| Delete by owner | `DELETE /svcs/:id` | **204 No Content** | Service removed from DB (or soft-deleted per policy); audit event logged. |
| Search services | `GET /svcs?q=...&page=1&pageSize=20` | **200 OK** | Response contains `{ results, total, page, pageSize }`; results match filters and text search ranking. |
| Capacity validation | `POST /svcs` or `PATCH /svcs/:id` | **400 Bad Request** | `capacity` < 1 rejected with validation error; no DB change; audit event logged. |

---

#### Detailed test cases

1. **Create service happy path**
   - **Setup:** Authenticated `service_provider` with `userId = prov-1`.
   - **Request:** `POST /svcs` body:
     ```json
     { "providerId": "prov-1", "name": "Cleaning Pro", "capacity": 3 }
     ```
   - **Expect:** 201; response `{ ok: true, service }`; `service.serviceId` present; DB record exists; `createdAt` and `updatedAt` set.

2. **Create duplicate name**
   - **Setup:** Provider already has service named "Cleaning Pro".
   - **Request:** same as above.
   - **Expect:** 409; response indicates conflict; DB unchanged; audit logs duplicate attempt.

3. **Read service**
   - **Request:** `GET /svcs/:serviceId`
   - **Expect:** 200; response `{ ok: true, service }`; `service.serviceId` matches; no sensitive internal-only fields.

4. **Update by owner**
   - **Setup:** Authenticated provider equals `service.providerId`.
   - **Request:** `PATCH /svcs/:id` body `{ "capacity": 5, "name": "Cleaning Pro Plus" }`
   - **Expect:** 200; response contains updated fields; `updatedAt` newer; audit logs update.

5. **Update forbidden for non-owner**
   - **Setup:** Authenticated user not admin and not provider owner.
   - **Request:** same as update.
   - **Expect:** 403; DB unchanged; audit logs forbidden attempt.

6. **Delete by owner**
   - **Setup:** Authenticated provider owner.
   - **Request:** `DELETE /svcs/:id`
   - **Expect:** 204; service removed or marked deleted; audit logs deletion.

7. **Search and pagination**
   - **Request:** `GET /svcs?q=cleaning&page=1&pageSize=20`
   - **Expect:** 200; response includes `results` array, `total`, `page`, `pageSize`; when `q` present results sorted by text score.

8. **Capacity validation**
   - **Request:** `POST /svcs` or `PATCH /svcs/:id` with `{ "capacity": 0 }`
   - **Expect:** 400; response contains validation error; DB unchanged.

---

#### Test data and fixtures
- **Providers:** `prov-1` (service_provider), `prov-2`.
- **Services:** fixtures for `active` and `inactive` statuses, multiple categories and locations.
- **Edge cases:** long names, special characters, empty categories, missing providerId.

---

#### Observability and postconditions
- **Audit events:** verify events for create.attempt, create, create.failed, update.attempt, update, update.failed, delete, delete.failed, search, search.result.
- **Metrics to monitor:** create failures, duplicate name conflicts, search latency, update/delete error rates.
- **Postconditions:** no orphaned records; unique constraint holds for `(providerId, name)`; `capacity` never below 1.

---

#### Minimal example assertions (Jest + Supertest)
```js
expect(res.status).toBe(201);
expect(res.body.ok).toBe(true);
expect(res.body.service).toHaveProperty('serviceId');
expect(await repo.findByServiceId(res.body.service.serviceId)).not.toBeNull();
```

---
