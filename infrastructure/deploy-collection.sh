#!/usr/bin/env bash
set -euo pipefail
umask 077
release=${1:?Release directory required}
root=/opt/collection-live
shared=$root/shared
domain=${COLLECTION_DOMAIN:-release.109.235.118.171.sslip.io}
[[ "$release" == "$root/releases/"* ]] || { echo 'Refusing a release outside the isolated Collection directory' >&2; exit 1; }
[[ "$domain" =~ ^[a-z0-9.-]+$ ]] || exit 1
# Identify only the existing public proxy. No legacy database, users, or application containers are changed.
legacy=${LEGACY_NGINX_CONTAINER:-bioflow-test-nginx-1}
docker inspect "$legacy" >/dev/null
mkdir -p "$shared/secrets" "$shared/downloads" "$shared/backups" "$shared/certbot-work" "$shared/certbot-logs"
chmod 700 "$shared/secrets" "$shared/backups"
mkdir -p "$shared/downloads/tutorials"
chmod 755 "$shared/downloads/tutorials"
test -s "$shared/secrets/firebase-service-account.json" || { echo 'Firebase service account must be installed through the encrypted configuration step' >&2; exit 1; }
if [ ! -f "$shared/.env.collection" ]; then
  python3 - "$shared/.env.collection" "$shared" "$domain" <<'PY'
from pathlib import Path
import secrets,sys
p=Path(sys.argv[1]);v={'COLLECTION_SHARED_DIR':sys.argv[2],'COLLECTION_DOMAIN':sys.argv[3]}
for key in ['COLLECTION_DB_PASSWORD','COLLECTION_JWT_ACCESS_SECRET','COLLECTION_JWT_REFRESH_SECRET','COLLECTION_QR_SIGNING_SECRET']:v[key]=secrets.token_urlsafe(48)
p.write_text('\n'.join(key+'='+value for key,value in v.items())+'\n');p.chmod(0o600)
PY
fi
export COLLECTION_SHARED_DIR=$shared COLLECTION_DOMAIN=$domain COLLECTION_IMAGE_TAG=$(basename "$release")
compose=(docker compose -p collection-live --env-file "$shared/.env.collection" -f "$release/docker-compose.collection.yml")
if docker ps --filter label=com.docker.compose.project=collection-live --filter label=com.docker.compose.service=postgres --format '{{.ID}}' | read -r existing_db; then
  "${compose[@]}" exec -T postgres pg_dump -U collection -d collection_live -Fc > "$shared/backups/collection-$(date -u +%Y%m%dT%H%M%SZ).dump"
fi
"${compose[@]}" build
"${compose[@]}" up -d --wait --wait-timeout 180 postgres redis
"${compose[@]}" run --rm --no-deps backend sh -c 'npm run prisma:deploy -w @bioflow/backend && npm run bootstrap:collection -w @bioflow/backend && cd apps/backend && npx tsx prisma/opening-collection.ts'
"${compose[@]}" up -d --wait --wait-timeout 240 backend web gateway
# Refresh cached upstream addresses when an application container was replaced.
"${compose[@]}" exec -T gateway nginx -s reload
edge=collection-live_edge
docker network inspect "$edge" >/dev/null
docker network connect "$edge" "$legacy" 2>/dev/null || docker inspect -f '{{json .NetworkSettings.Networks}}' "$legacy" | python3 -c 'import json,sys; assert "collection-live_edge" in json.load(sys.stdin)'
# Obtain existing proxy mount paths without reading any environment secrets.
mounts=$(docker inspect -f '{{json .Mounts}}' "$legacy")
config=$(python3 -c 'import json,sys; print(next(x["Source"] for x in json.load(sys.stdin) if x["Destination"]=="/etc/nginx/nginx.conf"))' <<< "$mounts")
certs=$(python3 -c 'import json,sys; print(next(x["Source"] for x in json.load(sys.stdin) if x["Destination"]=="/etc/letsencrypt"))' <<< "$mounts")
acme=$(python3 -c 'import json,sys; print(next(x["Source"] for x in json.load(sys.stdin) if x["Destination"]=="/acme"))' <<< "$mounts")
backup="$shared/backups/proxy-$(date -u +%Y%m%dT%H%M%SZ).conf"
cp "$config" "$backup"
restore_proxy() { cat "$backup" > "$config"; docker exec "$legacy" nginx -t && docker exec "$legacy" nginx -s reload; echo 'New proxy route failed; restored previous proxy configuration. Databases were not restored or reset.' >&2; }
trap restore_proxy ERR
python3 "$release/infrastructure/collection-proxy.py" "$config" "$domain" challenge
docker exec "$legacy" nginx -t
docker exec "$legacy" nginx -s reload
if ! command -v certbot >/dev/null; then export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y certbot; fi
certbot certonly --non-interactive --agree-tos --register-unsafely-without-email --webroot -w "$acme" --config-dir "$certs" --work-dir "$shared/certbot-work" --logs-dir "$shared/certbot-logs" --cert-name "$domain" -d "$domain"
python3 "$release/infrastructure/collection-proxy.py" "$config" "$domain" tls
docker exec "$legacy" nginx -t
docker exec "$legacy" nginx -s reload
curl --fail --silent --show-error --retry 6 --retry-all-errors --retry-delay 2 --resolve "$domain:443:127.0.0.1" "https://$domain/api/v1/health"
curl --fail --silent --show-error --retry 6 --retry-all-errors --retry-delay 2 --resolve "$domain:443:127.0.0.1" "https://$domain/collection" >/dev/null
ln -sfn "$release" "$root/current"
printf '%s\n' "$COLLECTION_IMAGE_TAG" > "$release/DEPLOYED_COMMIT"
# Renewal has its own timer and reloads only the public proxy after renewal.
cat > /etc/systemd/system/collection-cert-renew.service <<UNIT
[Unit]
Description=Renew Collection live TLS certificate
After=docker.service
[Service]
Type=oneshot
ExecStart=/usr/bin/certbot renew --quiet --cert-name $domain --config-dir $certs --work-dir $shared/certbot-work --logs-dir $shared/certbot-logs --deploy-hook /opt/collection-live/current/infrastructure/renew-collection-cert.sh
UNIT
cat > /etc/systemd/system/collection-cert-renew.timer <<'UNIT'
[Unit]
Description=Check Collection TLS renewal twice a day
[Timer]
OnCalendar=*-*-* 03,15:35:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
UNIT
cat > /etc/systemd/system/collection-proxy-reconcile.service <<'UNIT'
[Unit]
Description=Preserve Collection route after a debug proxy restart
After=docker.service
[Service]
Type=oneshot
ExecStart=/opt/collection-live/current/infrastructure/reconcile-collection-proxy.sh
UNIT
cat > /etc/systemd/system/collection-proxy-reconcile.timer <<'UNIT'
[Unit]
Description=Watch separate Collection route
[Timer]
OnBootSec=60
OnUnitActiveSec=60
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now collection-cert-renew.timer collection-proxy-reconcile.timer
trap - ERR
printf 'Collection live deployed at https://%s/collection; legacy database untouched.\n' "$domain"
