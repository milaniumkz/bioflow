#!/usr/bin/env bash
set -euo pipefail
umask 077
root=/opt/bioflow-test
release=$(readlink -f "$root/current")
sha=$(cat "$release/DEPLOYED_COMMIT")
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || exit 2
archive=$(find "$root/backups" -maxdepth 1 -name 'bioflow-test-*-files.tgz' -type f | sort -r | head -n 1)
if [ -z "$archive" ]; then
  bash "$release/infrastructure/backup-test-server.sh"
  archive=$(find "$root/backups" -maxdepth 1 -name 'bioflow-test-*-files.tgz' -type f | sort -r | head -n 1)
fi
[[ "$archive" =~ ^/opt/bioflow-test/backups/bioflow-test-[0-9]{8}T[0-9]{6}Z-files\.tgz$ ]] || { echo 'No paired database/file backup'; exit 1; }
base=${archive%-files.tgz}
sha256sum --check "$base.sha256"
tar -tzf "$archive" >/dev/null
suffix=$(date -u +%Y%m%dT%H%M%SZ)-$$
db=bioflow-restore-db-$suffix
s3=bioflow-restore-s3-$suffix
network=bioflow-restore-net-$suffix
volume=bioflow-restore-files-$suffix
probe_volume=bioflow-restore-probe-$suffix
work=$(mktemp -d /tmp/bioflow-restore-verify.XXXXXX)
cleanup() {
  docker rm -f "$db" "$s3" >/dev/null 2>&1 || true
  docker volume rm "$volume" "$probe_volume" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
# Only disposable resources created by this invocation are restored or removed.
docker run -d --name "$db" --label bioflow.restore-verification=true --network none --memory 512m \
  --tmpfs /var/lib/postgresql/data:rw,size=512m \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_USER=verify -e POSTGRES_DB=restore_verify postgres:16-alpine >/dev/null
for attempt in $(seq 1 60); do
  if docker exec "$db" pg_isready -U verify -d restore_verify >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec -i "$db" pg_restore --exit-on-error --no-owner --no-acl -U verify -d restore_verify < "$base.dump"
invalid=$(docker exec "$db" psql -U verify -d restore_verify -Atc "SELECT count(*) FROM pg_constraint WHERE contype='f' AND NOT convalidated")
[ "$invalid" = 0 ] || { echo 'Restored foreign keys are not validated'; exit 1; }
docker exec "$db" psql -U verify -d restore_verify -Atc 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL' > "$work/migrations.count"
[ "$(cat "$work/migrations.count")" -gt 0 ]
docker exec "$db" psql -U verify -d restore_verify -Atc 'SELECT COALESCE(json_agg(json_build_object('\''key'\'',key,'\''size'\'',size)), '\''[]'\''::json) FROM "File" WHERE "verifiedAt" IS NOT NULL' > "$work/manifest.json"
docker network create --label bioflow.restore-verification=true "$network" >/dev/null
docker volume create --label bioflow.restore-verification=true "$volume" >/dev/null
docker run --rm --network none -v "$volume:/restored" -v "$archive:/backup.tgz:ro" alpine:3.23 tar -xzf /backup.tgz -C /restored
docker run -d --name "$s3" --network "$network" --network-alias s3 --memory 512m \
  --label bioflow.restore-verification=true -v "$volume:/data" -v "$root/shared/s3.json:/etc/restore-s3.json:ro" \
  chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d \
  server -dir=/data -master.volumeSizeLimitMB=100 -volume.max=16 -s3 -s3.config=/etc/restore-s3.json -ip=s3 -ip.bind=0.0.0.0 >/dev/null
verified=false
for attempt in $(seq 1 30); do
  if docker run --rm --network "$network" --env-file "$root/shared/server.env" \
    -v "$work:/verification:ro" -v "$(dirname "$0")/verify-restored-files.cjs:/app/verify-restored-files.cjs:ro" \
    "bioflow-test-backend:$sha" node /app/verify-restored-files.cjs > "$work/files-result.json" 2>/dev/null; then
    verified=true; break
  fi
  sleep 2
done
[ "$verified" = true ] || { echo 'Restored S3 files could not be verified'; exit 1; }
printf 'Database restore PASS; validated foreign keys; applied migrations: %s\n' "$(cat "$work/migrations.count")"
cat "$work/files-result.json"
# Exercise a nonempty file restore even when the business snapshot has no files.
# Upload only to the isolated restored S3, then archive and restore its own volume.
docker run --rm --network "$network" --env-file "$root/shared/server.env" \
  -v "$work:/verification" -v "$(dirname "$0")/create-restore-probe.cjs:/app/create-restore-probe.cjs:ro" \
  "bioflow-test-backend:$sha" node /app/create-restore-probe.cjs
docker stop "$s3" >/dev/null
docker run --rm --network none -v "$volume:/data:ro" -v "$work:/verification" alpine:3.23 \
  tar -czf /verification/probe-files.tgz -C /data .
docker volume create --label bioflow.restore-verification=true "$probe_volume" >/dev/null
docker run --rm --network none -v "$probe_volume:/restored" -v "$work:/verification:ro" alpine:3.23 \
  tar -xzf /verification/probe-files.tgz -C /restored
docker rm "$s3" >/dev/null
docker run -d --name "$s3" --network "$network" --network-alias s3 --memory 512m \
  --label bioflow.restore-verification=true -v "$probe_volume:/data" -v "$root/shared/s3.json:/etc/restore-s3.json:ro" \
  chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d \
  server -dir=/data -master.volumeSizeLimitMB=100 -volume.max=16 -s3 -s3.config=/etc/restore-s3.json -ip=s3 -ip.bind=0.0.0.0 >/dev/null
verified=false
for attempt in $(seq 1 30); do
  if docker run --rm --network "$network" --env-file "$root/shared/server.env" \
    -v "$work:/verification:ro" -v "$(dirname "$0")/verify-restored-files.cjs:/app/verify-restored-files.cjs:ro" \
    "bioflow-test-backend:$sha" node /app/verify-restored-files.cjs > "$work/probe-result.json" 2>/dev/null; then
    verified=true; break
  fi
  sleep 2
done
[ "$verified" = true ] || { echo 'Nonempty disposable file restore failed'; exit 1; }
printf 'Nonempty disposable file archive/restore and expected content checksum PASS: '
cat "$work/probe-result.json"
printf 'Backup snapshot verified: %s\n' "$(basename "$base")"
