# BIOFLOW Architecture

BIOFLOW is a monorepo with:

- `apps/backend`: NestJS REST API, Prisma, PostgreSQL, Swagger.
- `apps/web`: Next.js web panel connected to the REST API.
- `apps/mobile`: Flutter app connected to the same REST API.
- `packages/shared-types`: shared enums/contracts.
- `packages/api-client`: typed API client aligned with the backend OpenAPI contract.
- `infrastructure`: Docker, Nginx, backup scripts.

Core domain:

- Waybill creation generates a protected QR token. QR contains no personal or commercial data.
- Acceptance is transactional and idempotent. A waybill cannot be accepted twice.
- Inventory balances are derived through immutable inventory movements. Direct quantity edits are avoided in API flows.
- Inventory movements carry typed links to waybills, material types, and product types where applicable.
- Movement APIs and reports include warehouse, material, product, and waybill context for traceability.
- Write-off and shipment APIs/reports include warehouse and material/product context.
- Transfer APIs and reports include source/target warehouse context and item material/product context.
- Transfer list endpoint returns paginated responses with status filtering and whitelisted sorting.
- Washing and production are confirmed transactionally and reject invalid or negative stock scenarios.
- Warehouse transfers are created as drafts and affect balances only after confirmation.
- Draft warehouse transfers can be cancelled with a mandatory reason; cancellation does not affect balances and is audited.
- Write-offs are confirmed operations that decrement stock through `WRITE_OFF` movements and audit logs.
- Finished goods shipments decrement `FINISHED` stock through `SHIPMENT` movements and audit logs.
- Inventory corrections are explicit `CORRECTION` movements with a mandatory reason and audit record; corrections that would make stock negative are rejected.
- Tenant, user ownership, and operational tables have database FKs and indexes for organization/status/date queries used by lists, reports, and audits.
- RBAC is enforced by backend guards using role permissions from the database.
- Backend uses Helmet, rate limiting, strict DTO validation, and production startup requires explicit CORS origin plus non-placeholder JWT/QR secrets.
- API responses for failures use a unified error envelope with `requestId`.
- `/api/v1/health` verifies database connectivity and reports Redis readiness from `REDIS_URL`.
- OpenAPI is available at `/api/docs` and can be exported to `packages/api-client/openapi/openapi.json` with `npm run openapi:generate`.
- User creation hashes temporary passwords server-side and marks the account for mandatory password change.
- Users can inspect active refresh sessions, revoke one session, revoke all sessions, and change password; password changes revoke active refresh tokens.
- User blocking/unblocking is audited with a reason; blocking revokes active refresh sessions.
- Password reset uses one-time hashed reset tokens with one-hour expiry; successful reset revokes active refresh sessions. The current development API returns the token until SMTP is configured.
- Login/refresh tokens can be associated with a registered device, including platform and push token metadata for mobile push support.
- Authenticated clients can update device metadata and push token through `POST /api/v1/auth/devices`.
- Seed creates the full role set from the specification: owner, admin, contractor representative, receiver, washing operator, production operator, and auditor. User roles can be reassigned through `POST /api/v1/users/:id/roles`.
- Acceptance discrepancy threshold is organization-configurable via `system_settings` key `acceptance.differenceThresholdPercent`; seed sets it to `3`.
- Waybill, washing batch, and production batch numbers are generated from organization-scoped `system_settings` counters instead of timestamps.
- Waybills support manual lookup by number and audited status transitions through `LOADED`, `IN_TRANSIT`, `ARRIVED`, `REJECTED`, and `CANCELLED`.
- Dashboard and report exports accept UTC `dateFrom` / `dateTo` filters, include full date-only `dateTo` days, reject inverted ranges, and include applied filters in report metadata.
- Waybill and inventory movement list endpoints support server-side pagination, search/filtering, and whitelisted sorting.
- Washing, production, shipment, and write-off list endpoints return paginated responses with server-side filters and whitelisted sorting.
- Audit log supports server-side pagination, search, action filtering, and whitelisted sorting.
- Notifications are returned as organization/user-scoped paginated responses; seeded roles include `notifications.read`.
- System settings can be updated through `POST /api/v1/settings`; changes are audited with a reason.
- Notifications are created by domain events: waybill creation/acceptance, discrepancies, transfer confirmation, washing, production, and write-offs.
- Files are stored in private S3-compatible storage through short-lived signed upload/download URLs; allowed MIME types and max size are validated before creating file records.

Default local user after seed:

- Email: `owner@bioflow.local`
- Password: `Bioflow123!`
