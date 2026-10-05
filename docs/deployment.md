# Deployment

Local:

```bash
cp .env.example .env
npm install
npm run prisma:generate
docker compose up -d postgres redis minio
npm run prisma:migrate
npm run seed
npm run dev:backend
npm run dev:web
```

Useful URLs:

- API: `http://localhost:4000/api/v1`
- Swagger: `http://localhost:4000/api/docs`
- Health: `http://localhost:4000/api/v1/health`
- Web: `http://localhost:3000`

Docker:

```bash
docker compose up --build
```

Nginx proxy is exposed locally at `http://localhost:8080`.
Compose includes healthchecks for PostgreSQL, Redis, MinIO, backend, and web before routing through Nginx. It also creates the private MinIO `bioflow` bucket and runs Prisma migrations before starting the backend container. Docker builds use `.dockerignore` to keep local build artifacts, dependencies, backups, logs, and secrets out of the build context.

Production checklist:

- Replace all secrets from `.env.example`.
- Set `WEB_ORIGIN`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and `QR_SIGNING_SECRET`; backend startup fails in production when any are missing or placeholder values.
- Configure HTTPS in front of Nginx.
- Configure S3-compatible storage and private bucket policy.
- Set `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, and `S3_REGION`; local development can use MinIO from `docker-compose.yml`.
- Run migrations before app rollout.
- CI should pass lint, tests, backend open-handle detection, OpenAPI export, production build, audit, Compose config validation, and backend/web Docker builds.
- Run `infrastructure/backup-postgres.sh` from a trusted environment.
- Restore with `infrastructure/restore-postgres.sh backups/file.sql`.
- Follow `infrastructure/rollback.md` for release rollback.
- Keep signing keys, SMTP credentials, S3 keys, Firebase/APNs and mobile store credentials outside Git.
