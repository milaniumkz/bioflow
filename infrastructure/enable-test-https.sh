#!/usr/bin/env bash
set -euo pipefail
umask 077
domain=bio.app.kz
expected=109.235.118.171
resolved=$(getent ahostsv4 "$domain" | awk '{print $1}' | sort -u || true)
if [ "$resolved" != "$expected" ]; then
  echo 'HTTPS blocked: add DNS A record bio.app.kz -> 109.235.118.171 and wait for propagation. No server configuration changed.'
  exit 2
fi
root=/opt/bioflow-test
shared=$root/shared
release=$(readlink -f "$root/current")
export BIOFLOW_SHARED_DIR=$shared BIOFLOW_IMAGE_TAG=$(cat "$release/DEPLOYED_COMMIT")
[[ "$BIOFLOW_IMAGE_TAG" =~ ^[0-9a-f]{40}$ ]]
compose=(docker compose -p bioflow-test --env-file "$shared/server.env" -f "$release/docker-compose.test-server.yml" -f "$shared/https.compose.yml")
work=$(mktemp -d "$root/backups/https-config.XXXXXX")
cp "$shared/server.env" "$work/server.env"
for name in https.compose.yml nginx-https.conf; do
  [ ! -f "$shared/$name" ] || cp "$shared/$name" "$work/$name"
done
rollback() {
  cp "$work/server.env" "$shared/server.env"
  for name in https.compose.yml nginx-https.conf; do
    if [ -f "$work/$name" ]; then cp "$work/$name" "$shared/$name"; else rm -f "$shared/$name"; fi
  done
  recovery=(docker compose -p bioflow-test --env-file "$shared/server.env" -f "$release/docker-compose.test-server.yml")
  [ ! -f "$shared/https.compose.yml" ] || recovery+=(-f "$shared/https.compose.yml")
  "${recovery[@]}" up -d --no-deps backend nginx
  echo 'HTTPS configuration failed; restored previous application/proxy configuration. Database was not restored or reset.'
}
trap rollback ERR
mkdir -p "$shared/acme/.well-known/acme-challenge" "$shared/letsencrypt" "$shared/certbot-work" "$shared/certbot-logs"
chmod 755 "$shared/acme" "$shared/acme/.well-known" "$shared/acme/.well-known/acme-challenge"
# Preserve the current HTTP application while issuing the certificate.
python3 - "$release/infrastructure/nginx/test-server.conf" "$shared/nginx-https.conf" <<'PY'
from pathlib import Path
import sys
s=Path(sys.argv[1]).read_text().replace('    listen 80;', '    listen 80;\n    location ^~ /.well-known/acme-challenge/ { root /acme; }')
Path(sys.argv[2]).write_text(s)
PY
cat > "$shared/https.compose.yml" <<'YAML'
services:
  nginx:
    ports: ["80:80", "443:443"]
    volumes:
      - ${BIOFLOW_SHARED_DIR}/nginx-https.conf:/etc/nginx/nginx.conf:ro
      - ${BIOFLOW_SHARED_DIR}/letsencrypt:/etc/letsencrypt:ro
      - ${BIOFLOW_SHARED_DIR}/acme:/acme:ro
YAML
"${compose[@]}" run --rm --no-deps nginx nginx -t
"${compose[@]}" up -d --no-deps nginx
if ! command -v certbot >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y certbot
fi
certbot certonly --non-interactive --agree-tos --register-unsafely-without-email --webroot -w "$shared/acme" \
  --config-dir "$shared/letsencrypt" --work-dir "$shared/certbot-work" --logs-dir "$shared/certbot-logs" \
  --cert-name "$domain" -d "$domain"
cp "$(dirname "$0")/nginx/test-server-https.conf" "$shared/nginx-https.conf"
"${compose[@]}" run --rm --no-deps nginx nginx -t
python3 - "$shared/server.env" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);lines=p.read_text().splitlines();updates={'WEB_ORIGIN':'https://bio.app.kz,http://109.235.118.171','S3_PUBLIC_ENDPOINT':'https://bio.app.kz'}
result=[]
for line in lines:
    key=line.split('=',1)[0]
    result.append(key+'='+updates.pop(key) if key in updates else line)
result.extend(key+'='+value for key,value in updates.items())
p.write_text('\n'.join(result)+'\n');p.chmod(0o600)
PY
"${compose[@]}" up -d --no-deps --wait --wait-timeout 180 backend nginx
"${compose[@]}" exec -T nginx nginx -s reload
curl --fail --silent --show-error --resolve "$domain:443:127.0.0.1" "https://$domain/api/v1/health" >/dev/null
curl --fail --silent --show-error --resolve "$domain:443:127.0.0.1" "https://$domain/" >/dev/null
# The hook must already be part of the deployed release so future renewals survive release changes.
test -x "$release/infrastructure/renew-test-https.sh"
cat > /etc/systemd/system/bioflow-test-cert-renew.service <<'UNIT'
[Unit]
Description=Renew BIOFLOW test HTTPS certificate
After=docker.service
[Service]
Type=oneshot
ExecStart=/usr/bin/certbot renew --quiet --config-dir /opt/bioflow-test/shared/letsencrypt --work-dir /opt/bioflow-test/shared/certbot-work --logs-dir /opt/bioflow-test/shared/certbot-logs --deploy-hook /opt/bioflow-test/current/infrastructure/renew-test-https.sh
UNIT
cat > /etc/systemd/system/bioflow-test-cert-renew.timer <<'UNIT'
[Unit]
Description=Check BIOFLOW certificate renewal twice daily
[Timer]
OnCalendar=*-*-* 03,15:10:00 Asia/Yekaterinburg
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now bioflow-test-cert-renew.timer
trap - ERR
printf 'HTTPS enabled: https://%s/; certificates renew automatically. Previous configuration retained in %s\n' "$domain" "$work"
