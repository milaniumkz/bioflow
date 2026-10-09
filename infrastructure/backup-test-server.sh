#!/usr/bin/env bash
set -euo pipefail
umask 077
root=/opt/bioflow-test
release=$(readlink -f "$root/current")
export BIOFLOW_SHARED_DIR=$root/shared BIOFLOW_IMAGE_TAG=$(cat "$release/DEPLOYED_COMMIT")
compose=(docker compose -p bioflow-test --env-file "$root/shared/server.env" -f "$release/docker-compose.test-server.yml")
if [ -f "$root/shared/https.compose.yml" ]; then compose+=(-f "$root/shared/https.compose.yml"); fi
stamp=$(date -u +%Y%m%dT%H%M%SZ)
base=$root/backups/bioflow-test-$stamp
mkdir -p "$root/backups"
"${compose[@]}" exec -T postgres pg_dump -U bioflow_test -d bioflow_test -Fc > "$base.dump.tmp"
"${compose[@]}" exec -T postgres pg_restore --list < "$base.dump.tmp" >/dev/null
mv "$base.dump.tmp" "$base.dump"
# Stop only the object store while taking its volume snapshot, then restart it
# even if tar fails. No application, database or user data is deleted.
trap '"${compose[@]}" start s3 >/dev/null' EXIT
"${compose[@]}" stop s3 >/dev/null
docker run --rm -v bioflow-test_s3_data:/data:ro -v "$root/backups:/backups" alpine:3.23 sh -c "tar -czf /backups/bioflow-test-$stamp-files.tgz.tmp -C /data ."
mv "$base-files.tgz.tmp" "$base-files.tgz"
"${compose[@]}" start s3 >/dev/null
trap - EXIT
sha256sum "$base.dump" "$base-files.tgz" > "$base.sha256"
printf 'Test database and file backup validated: %s\n' "$stamp"
