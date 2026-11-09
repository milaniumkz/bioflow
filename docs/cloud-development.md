# Cloud development and owner dashboard

Use the existing checkout in `/workspace/bioflow`; do not create a worktree unless explicitly requested. Node 24 and npm 11 are required. Read `AGENTS.md`. Never use production database or object-storage credentials for cloud tests. Do not reset a database, remove volumes, overwrite existing `.env`, or build an APK for this workflow.

## Reproduce setup

Required network destinations include `registry.npmjs.org`, `binaries.prisma.sh` (including checksum downloads), and the configured Docker registry domains. Preserve inherited proxy variables and CA trust. Never disable checksum or TLS verification.

```bash
cd /workspace/bioflow
npm ci --cache /tmp/bioflow-npm-cache --https-proxy "${HTTPS_PROXY:-}" --proxy "${HTTP_PROXY:-}"
npm run prisma:generate
npm run build -w @bioflow/shared-types
npm run build -w @bioflow/api-client
```

For local API development, copy `.env.example` to `.env` only if `.env` does not already exist. Inspect the configured database destination before running migrations. On a separate development database only:

```bash
docker compose -p bioflow-cloud up -d postgres redis
node --env-file=.env --run prisma:deploy
# Only for a newly created development database:
node --env-file=.env --run seed
node --env-file=.env --run dev:backend
# In a separate terminal, same repository directory:
node --env-file=.env --run dev:web
```

Check the API health endpoint on port 4000, then sign in and exercise the owner dashboard against the real API. File upload workflows additionally require `docker compose -p bioflow-cloud up -d s3` and `npm run s3:init -w @bioflow/backend`; file upload readiness was not tested in this task. The Node 24 `--env-file` option loads the root configuration before npm enters workspace directories, including the browser API URL. Do not rely on workspace processes finding the root `.env` automatically. Live processes must be restarted in a new task; dependencies and files alone do not start services.

## Owner dashboard

The owner enterprise overview reads `/processing/owner-dashboard` with optional `dateFrom`, `dateTo`, `warehouseId`, `employeeId`, and `driverId`. It exposes source collection, transport, laboratory analyses, washing, factory processing, finished bags, stock, sales, customer delivery, losses, deviations, and observed driver stops. Cards open the contributing records, then the batch trace or trip route. Balances are current quantities for the selected batch cohort. Event stages use event dates and employees; their turnovers must not be summed as inventory. A driver filter follows associated batch provenance and delivery assignments.

Customer delivery is separate from the inventory posting. `/processing/deliveries` requires `processing.sell`, a real sold bag or confirmed shipment operation, and an organization-scoped driver. Transitions are `PLANNED → IN_TRANSIT → DELIVERED`; dispatch requires a driver. Every save records an immutable event snapshot. Updates use optimistic versions and never post stock movements. The additive `20261109130000_customer_deliveries` migration creates two tables and indexes and deletes no existing data. Apply it through the normal deployment migration workflow before using the new dashboard. Existing sales appear as delivery not planned until explicitly scheduled.

## Validation

```bash
npm run openapi:generate
npm run lint
npm test
npm run build
npm audit --omit=dev --audit-level=high --cache /tmp/bioflow-npm-cache --https-proxy "${HTTPS_PROXY:-}" --proxy "${HTTP_PROXY:-}"
```

The optional browser regression uses Playwright and installed Chromium. Install Playwright outside the checkout so setup does not change the lockfile:

```bash
npm install --prefix /tmp/bioflow-browser --cache /tmp/bioflow-npm-cache playwright --https-proxy "${HTTPS_PROXY:-}" --proxy "${HTTP_PROXY:-}"
PLAYWRIGHT_MODULE=/tmp/bioflow-browser/node_modules/playwright BIOFLOW_UI_URL=http://localhost:3000 node apps/web/scripts/check-owner-dashboard.cjs
```

This browser test intercepts API requests with isolated fixtures. It checks all 12 cards, records, five filters, a delivery save, batch trace, route, drawer closure, JavaScript errors, and mobile overflow. It does **not** replace an authenticated real-API integration check. Screenshots are written to `/tmp/bioflow-dashboard-{desktop,mobile}.png`.

## Current environment limitations

The onboarding configuration read and draft-save tools returned `INVALID_ARGUMENT`, so install/start instructions and the requested network addition could not be persisted in platform settings. This document preserves the instructions in Git instead; it is not evidence of platform configuration publication.

The proxy denied the native Prisma engine/checksum host with HTTP 403. Type generation for checks used the matching, npm-verified Prisma internals and the no-engine generator; no checksum or TLS checks were disabled. Type checks, builds, and unit tests can run, but this is not a working native Prisma runtime. The full authenticated API/database workflow remains unverified until platform network configuration can be saved and normal `npm run prisma:generate` succeeds. The new SQL migration was independently executed successfully in the separate local `bioflow_dashboard_spec` database. Production data and services were never accessed.
