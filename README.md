# BIOFLOW

BIOFLOW is a monorepo for material logistics: NestJS backend, PostgreSQL/Redis/MinIO infrastructure, Next.js web panel, Flutter mobile app, shared types, and API client.

## Project requirements and design

The imported [BIOFLOW project materials](docs/project-context/bioflow/README.md) preserve the original specification and the latest documented decisions. Use the [requirements and source guide](docs/project-context/bioflow/IMPORT_REPORT.md) and the [implementation gap analysis](docs/project-context/bioflow/docs/IMPLEMENTATION_GAPS.md) alongside the existing technical documentation. The original specification defines the functional scope; the current Figma defines the visual layout. Only NAVY & PLATINUM is selected; GPS tracking is excluded. Acceptance criteria are not evidence that features have passed testing.

## Repository layout

- `apps/backend` - NestJS REST API, Prisma, Swagger.
- `apps/web` - Next.js admin panel.
- `apps/mobile` - Flutter mobile app.
- `packages/shared-types` - shared TS contracts.
- `packages/api-client` - typed API client and OpenAPI snapshot.
- `infrastructure` - Nginx, backup/restore scripts.
- `docs` - architecture, deployment, rollback, test plan.

## Local Start

```bash
cp .env.example .env
npm ci
npm run prisma:generate
docker compose up -d postgres redis minio
npm run prisma:migrate
npm run seed
npm run dev:backend
npm run dev:web
```

URLs:

- Web: `http://localhost:3000`
- API: `http://localhost:4000/api/v1`
- Swagger: `http://localhost:4000/api/docs`
- Health: `http://localhost:4000/api/v1/health`

Seed user:

- Email: `owner@bioflow.local`
- Password: `Bioflow123!`

## Checks

```bash
npm run openapi:generate
npm run lint
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Flutter, when Flutter SDK is available:

```bash
cd apps/mobile
flutter pub get
flutter analyze
flutter test
```

## Docker

```bash
docker compose config
docker compose up --build
```

Nginx is exposed at `http://localhost:8080`.

## GitHub and Codex Cloud

1. Push this repository to GitHub.
2. Open Codex Cloud and choose this repository.
3. Use a development/test environment only. Do not use production DB/S3 secrets for normal cloud development.
4. Run setup:

```bash
npm ci
npm run prisma:generate
```

5. Use the checks above before opening a pull request.

## Release Flow

- Develop in feature branches.
- Open a pull request into `main`.
- Pull requests run CI.
- Merging to `main` runs CI and then production deploy if deployment secrets are configured.
- Manual deploy is available in GitHub Actions: `Deploy Production`.

Required GitHub Actions secrets:

- `PROD_SSH_HOST`
- `PROD_SSH_PORT`
- `PROD_SSH_USER`
- `PROD_SSH_KEY`
- `PROD_SSH_KNOWN_HOSTS`
- `PROD_DEPLOY_PATH`
- `PROD_APP_URL`

Set repository variable `PROD_DEPLOY_ENABLED=true` only after these secrets are configured and the server has `$PROD_DEPLOY_PATH/shared/.env`.

Server layout:

- `$PROD_DEPLOY_PATH/shared/.env` - production env, not committed.
- `$PROD_DEPLOY_PATH/releases/<commit_sha>` - immutable releases.
- `$PROD_DEPLOY_PATH/current` - active release symlink.
- `$PROD_DEPLOY_PATH/backups` - pre-deploy database/config backups.

## Server Operations

GitHub Actions workflow `Server Operations` supports:

- `status` - health and current commit.
- `logs` - recent sanitized compose logs.
- `restart` - restart project services.
- `redeploy` - rerun deployment for the selected ref.
- `rollback` - switch to a previous compatible release SHA.

Do not use rollback to restore old database dumps over newer user data.

## Sync Local Copy

```bash
git fetch origin
git checkout main
git pull --ff-only
```

## Data

Production data is stored outside release directories:

- PostgreSQL volume/database.
- MinIO/S3 bucket.
- `$PROD_DEPLOY_PATH/shared/.env`.
- `$PROD_DEPLOY_PATH/backups`.
