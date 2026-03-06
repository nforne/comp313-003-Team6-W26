Request model acceptance checklist

- Create service request:
  - POST /reqs with {title, when:{from,to}, ...} by authenticated customer -> 201; request stored with createdBy.
  - Missing required fields -> 400.
  - Private request without allowedProviders -> 400.
- Read request:
  - GET /reqs/:id public request -> 200.
  - GET private request by non-allowed provider -> 403.
  - GET private request by allowed provider or admin or owner -> 200.
- Search open requests:
  - GET /reqs?q params -> 200 with results, pagination.
  - Provider sees only public + private allowed to them.
- Update request:
  - PATCH /reqs/:id by owner -> 200 with updated fields.
  - PATCH by non-owner non-admin -> 403.
- Geo:
  - Creating request with geo.coordinates -> stored and queryable via nearLng/nearLat params.
- Notifications:
  - Creating request triggers notification stub (non-blocking).
