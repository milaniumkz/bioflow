# Test Plan

Backend:

- Auth login/refresh/logout-all.
- RBAC denial for missing permissions.
- Reference APIs should return conflict errors for duplicate unique values and ignore ownership fields in write payloads.
- Reference list search should use only fields that exist for each entity.
- Reference list sorting should use per-entity whitelists and safe fallback fields.
- Production security config should require explicit `WEB_ORIGIN` and non-placeholder JWT/QR secrets; DTO validation should reject unknown fields.
- Health endpoint should report database and Redis readiness.
- Waybill creation should reject references outside the actor organization.
- Waybill acceptance smoke test should create acceptance, receipt movement, and inventory balance update in one transaction.
- Reused acceptance idempotency keys should not leak or reuse acceptance records across organizations.
- Waybill acceptance should be rejected until the waybill reaches `ARRIVED`.
- Waybill create, QR resolve, single acceptance.
- Repeat acceptance and repeated idempotency key.
- Negative or insufficient inventory.
- Washing formula and stock transition.
- Production stock transition.

Implemented unit coverage:

- Acceptance threshold classification.
- Washing material balance.
- Production output guard.
- Transfer confirmation should reject insufficient source stock and create paired `TRANSFER_OUT` / `TRANSFER_IN` movements.
- Transfer creation should reject warehouses outside the actor organization.
- Operations, corrections, write-offs, shipments, and transfers should reject missing material/product references before stock mutation.
- Transfer cancellation should only allow draft transfers and must not create inventory movements.
- Write-off should reject insufficient stock and create one negative `WRITE_OFF` movement.
- Shipment should reject insufficient finished stock and create one negative `SHIPMENT` movement.
- Inventory correction should reject zero deltas and negative resulting balances.
- Inventory movement creation should persist material/product typed links for corrections, write-offs, and shipments.
- Domain operations should create user-visible notifications and support marking them as read.
- File upload URL creation should reject unsupported MIME types and oversized files.
- RBAC seed should create all production roles and role assignment should replace the user's current role set.
- Acceptance should use the organization setting `acceptance.differenceThresholdPercent`, defaulting to 3 when missing or invalid.
- Settings updates should persist to `system_settings` and create an audit entry.
- User blocking should revoke active sessions and write an audit record.
- Password reset should reject expired/used tokens and revoke active sessions after success.
- Login with device metadata should create/update a device and show it in session listings.
- Mobile device registration should update push token without requiring re-login.
- Dashboard and report endpoints should apply `dateFrom` / `dateTo` filters where the dataset has `createdAt`, include the full selected `dateTo` day, and reject inverted ranges.
- Waybill status transitions should reject invalid transitions and require reason for rejected/cancelled states.
- List endpoints should only accept whitelisted sort fields and apply server-side filters.
- Washing, production, shipment, and write-off list endpoints should return paginated page objects instead of raw arrays.
- Transfer list endpoint should return a paginated page object with status filtering.
- Audit log endpoint should paginate and filter by action/search text.
- Notifications endpoint should return only organization/user-scoped notifications in a paginated page object.
- Backend CI should run Jest with `--detectOpenHandles --runInBand`.

Web:

- Login.
- Dashboard data load.
- Tables load from API.
- Web reference sections should send server-side search/sort query params and render entity-specific columns for counterparties, vehicles, drivers, extraction sites, warehouses, plants, material/product types, users, roles, and settings.
- Web reference creation forms should POST to real reference APIs and refresh the server-backed table.
- Web reference edit forms should PATCH real reference APIs with a change reason and refresh the server-backed table.
- Waybill creation from reference data.
- QR resolve and acceptance.
- Washing and production forms.
- CSV, XLSX, and PDF report export.
- Report datasets: inventory, movements, waybills, discrepancies, washing, production, write-offs, shipments, transfers, audit.
- Logout.

Mobile:

- Login with secure storage.
- API screens loading/error/empty states.
- QR scanner/manual QR resolve, acceptance submission, disabled submit state, and offline queue sync after Flutter SDK is available.
