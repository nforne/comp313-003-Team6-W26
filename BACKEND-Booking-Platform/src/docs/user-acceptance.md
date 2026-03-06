User model acceptance checklist

- Register valid user:
  - POST /auth/register with {email, password, firstName} -> 201, user returned, password not exposed.
- Duplicate email:
  - POST /auth/register with existing email -> 409, no new user.
- Login success:
  - POST /auth/login -> 200, returns accessToken and sets httpOnly refresh cookie.
- Login failure:
  - Wrong password -> 401.
- Protected route access:
  - GET /users/:id (self) with valid Bearer token -> 200.
- RBAC enforcement:
  - PATCH /users/:id/role by non-admin -> 403.
- Logout:
  - POST /auth/logout clears refresh cookie and invalidates stored refresh token.
