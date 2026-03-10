### User model acceptance checklist (polished)

---

#### Overview
Acceptance tests for the user authentication and profile surface. Each case lists **endpoint**, **request**, **expected status**, **key assertions**, and **notes** about cookies, tokens, and sensitive fields.

---

#### 1. Register valid user
- **Endpoint:** `POST /auth/register`  
- **Request body:**  
  ```json
  { "email": "user@example.com", "password": "P@ssw0rd!", "firstName": "Jane" }
  ```
- **Expected:** **201 Created**
- **Key assertions:**
  - Response JSON contains `{ ok: true, user: { userId, firstName, emails, ... } }`.
  - **Password or passwordHash is not present** in response.
  - DB contains a user record with `emails[0].value === "user@example.com"` and `status === 'active'` (or default).
- **Notes:** verify `userId` format and that `emails[0].primary === true`.

---

#### 2. Duplicate email
- **Endpoint:** `POST /auth/register` (same body as above)
- **Expected:** **409 Conflict**
- **Key assertions:**
  - No new user created in DB.
  - Response JSON contains `{ ok: false, error: { code: 'DUPLICATE' | 'CONFLICT', message } }` or similar.
  - Audit event logged for duplicate registration attempt.

---

#### 3. Login success
- **Endpoint:** `POST /auth/login`
- **Request body:**  
  ```json
  { "email": "user@example.com", "password": "P@ssw0rd!" }
  ```
- **Expected:** **200 OK**
- **Key assertions:**
  - Response JSON contains `{ ok: true, accessToken: "<jwt>", user: { userId, ... } }`.
  - **HttpOnly refresh cookie** is set (check `Set-Cookie` header; cookie flagged `HttpOnly`, `Secure` in prod).
  - Server stores a hashed refresh token for the user (verify DB `refreshTokens` contains a hash).
  - Access token decodes to expected `userId` and `role`.
- **Notes:** check cookie path and expiry match refresh token TTL.

---

#### 4. Login failure (wrong password)
- **Endpoint:** `POST /auth/login`
- **Request body:** wrong password
- **Expected:** **401 Unauthorized**
- **Key assertions:**
  - Response JSON `{ ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' } }`.
  - No cookie set.
  - Audit event logged for failed login attempt.

---

#### 5. Protected route access (self)
- **Endpoint:** `GET /users/:id`
- **Precondition:** obtain valid **Bearer** access token from login
- **Request:** `Authorization: Bearer <accessToken>`
- **Expected:** **200 OK**
- **Key assertions:**
  - Response contains public profile (use `toPublicJSON()` shape).
  - Sensitive fields (`passwordHash`, `refreshTokens`) are not present.
  - Access allowed when `req.user.userId === :id`.
- **Negative check:** same request without token returns **401**.

---

#### 6. RBAC enforcement (role change)
- **Endpoint:** `PATCH /users/:id/role`
- **Request body:** `{ "role": "administrator" }`
- **Actor:** authenticated non-admin user
- **Expected:** **403 Forbidden**
- **Key assertions:**
  - Controller/service reject with `{ ok: false, error: { code: 'FORBIDDEN' } }`.
  - No role change in DB.
  - Audit event logged for forbidden attempt.
- **Positive check:** admin actor can change roles per service rules.

---

#### 7. Logout
- **Endpoint:** `POST /auth/logout`
- **Request:** include refresh cookie or send refresh token in body
- **Expected:** **200 OK** (or 204)
- **Key assertions:**
  - Response clears refresh cookie (`Set-Cookie` with expired value).
  - Server removes corresponding refresh token hash from user's `refreshTokens` array.
  - Subsequent use of the cleared refresh token to obtain new access token fails.
  - Audit event logged for logout.

---

### Test execution notes
- **Environment:** run tests against a dedicated test DB and isolated S3/Redis if used; reset DB between tests.
- **Token validation:** decode JWTs in tests to assert `userId` and `role` claims.
- **Cookie checks:** inspect `Set-Cookie` header for `HttpOnly`, `Secure` (in prod), `SameSite` settings.
- **Audit verification:** if audit service is mocked, assert expected events were emitted; if real, verify audit records.
- **Timing:** allow for eventual consistency where background jobs update records (e.g., processedAt) — poll briefly if needed.

---

### Minimal example assertions (Jest + Supertest)
```js
expect(res.status).toBe(200);
expect(res.body.ok).toBe(true);
expect(res.body.user).toHaveProperty('userId');
expect(res.headers['set-cookie']).toEqual(
  expect.arrayContaining([expect.stringContaining('refreshToken')])
);
```

---

