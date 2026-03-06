Service model acceptance checklist

- Create service:
  - POST /svcs with providerId matching authenticated provider -> 201, service returned with serviceId.
  - Duplicate service name for same provider -> 409 conflict.
- Read service:
  - GET /svcs/:id -> 200 with service details.
- Update service:
  - PATCH /svcs/:id by owner -> 200 with updated fields.
  - PATCH by non-owner non-admin -> 403.
- Delete service:
  - DELETE /svcs/:id by owner -> 204.
- Search:
  - GET /svcs?q=cleaning&page=1&pageSize=20 -> 200 with results, total, page metadata.
- Capacity:
  - capacity must be >= 1; invalid values return 400.
