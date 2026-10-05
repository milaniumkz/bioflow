# BIOFLOW Agent Guide

## Project

Monorepo layout:

- `apps/backend`: NestJS API, Prisma, PostgreSQL, Redis, Swagger.
- `apps/web`: Next.js web panel.
- `apps/mobile`: Flutter mobile app.
- `packages/shared-types`: shared TypeScript contracts.
- `packages/api-client`: generated/aligned API client and OpenAPI snapshot.
- `infrastructure`: Nginx and backup/restore scripts.
- `docs`: architecture, deployment, rollback, screens, test plan.

## Rules

- Keep all application data dynamic through backend APIs and PostgreSQL. Do not add mock API data.
- Do not commit real `.env` files, secrets, keys, certificates, backups, uploaded files, local DB data, build output, or dependencies.
- Use `.env.example` / `.env.production.example` for variable names and safe placeholders.
- Preserve user data: production database/files live outside release directories and must not be deleted during deploy.
- Do not run destructive database changes without a separate migration review.
- If production deploy fails, roll back application code only. Do not restore an old database over newer user data automatically.

## Commands

Use Node 24 and npm workspaces.

```bash
npm ci
npm run prisma:generate
npm run openapi:generate
npm run lint
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Backend:

```bash
npm run dev:backend
npm run prisma:migrate
npm run seed
```

Web:

```bash
npm run dev:web
```

Docker:

```bash
docker compose config
docker compose up --build
```

Flutter checks require Flutter SDK:

```bash
cd apps/mobile
flutter pub get
flutter analyze
flutter test
```

## Cloud Development

- Work in feature branches.
- Open pull requests into `main`.
- CI must pass before merge.
- Production deploy runs only from `main` after successful checks, or manually through GitHub Actions.
- Use separate development/test databases for cloud development. Do not connect Codex Cloud tasks to the production database.

## Deployment

Production deploy expects GitHub Actions secrets:

- `PROD_SSH_HOST`
- `PROD_SSH_PORT`
- `PROD_SSH_USER`
- `PROD_SSH_KEY`
- `PROD_SSH_KNOWN_HOSTS`
- `PROD_DEPLOY_PATH`
- `PROD_APP_URL`

On the server, keep production environment in:

```text
$PROD_DEPLOY_PATH/shared/.env
```

Releases are unpacked into:

```text
$PROD_DEPLOY_PATH/releases/<commit_sha>
```

`$PROD_DEPLOY_PATH/current` points to the active release.
