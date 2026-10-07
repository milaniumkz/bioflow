#!/usr/bin/env bash
set -euo pipefail
release_dir=${1:?Usage: deploy-release.sh RELEASE_DIR SHARED_DIR BACKUP_DIR}
shared_dir=${2:?Shared directory is required}
backup_dir=${3:?Backup directory is required}
for required in .env.production certificates/fullchain.pem certificates/privkey.pem; do
  test -f "$shared_dir/$required" || { printf 'Missing production file: %s\n' "$required" >&2; exit 1; }
done
mkdir -p "$backup_dir" "$shared_dir/secrets"
cp "$shared_dir/.env.production" "$release_dir/.env.production"
ln -sfn "$shared_dir/certificates" "$release_dir/certificates"
ln -sfn "$shared_dir/secrets" "$release_dir/secrets"
docker run --rm --env-file "$release_dir/.env.production" -e BACKUP_DIR=/backups -v "$backup_dir:/backups" -v "$release_dir/infrastructure/backup-postgres.sh:/backup.sh:ro" postgres:16-alpine sh /backup.sh
cd "$release_dir"
docker compose -p bioflow-production -f docker-compose.production.yml build
docker compose -p bioflow-production -f docker-compose.production.yml up -d --wait --wait-timeout 180 backend web
# Validate the TLS configuration before starting or reloading the public proxy.
docker compose -p bioflow-production -f docker-compose.production.yml run --rm --no-deps nginx nginx -t
docker compose -p bioflow-production -f docker-compose.production.yml up -d nginx
