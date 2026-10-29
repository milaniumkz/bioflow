#!/usr/bin/env bash
set -euo pipefail
umask 077
domain=${1:-collection.109.235.118.171.sslip.io}
[[ "$domain" == collection.109.235.118.171.sslip.io || "$domain" == bio.app.kz ]] || { echo "Unsupported HTTPS hostname"; exit 2; }
expected=109.235.118.171
# The provider maps its server hostname to localhost in /etc/hosts. Check public
# DNS over verified HTTPS so that a valid public A record is not rejected by NSS.
if ! resolved=$(python3 - "$domain" <<'PY'
import json, urllib.request, sys
request=urllib.request.Request('https://cloudflare-dns.com/dns-query?name='+sys.argv[1]+'&type=A', headers={'Accept':'application/dns-json'})
try:
    result=json.load(urllib.request.urlopen(request, timeout=20))
    if result.get('Status') not in (0, 3):
        raise ValueError('DNS resolver error')
    print('\n'.join(sorted({answer['data'] for answer in result.get('Answer', []) if answer.get('type') == 1})))
except Exception:
    raise SystemExit(1)
PY
); then
  echo 'HTTPS blocked: public DNS query failed. No server configuration changed.'
  exit 2
fi
if [ "$resolved" != "$expected" ]; then
  echo "HTTPS blocked: DNS A record $domain must point to $expected. No server configuration changed."
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
python3 - "$(dirname "$0")/nginx/test-server-https.conf" "$shared/nginx-https.conf" "$domain" <<'PY'
from pathlib import Path
import sys
source=Path(sys.argv[1]).read_text().replace('bio.app.kz', sys.argv[3])
# Browser entry over the IP also lands on the secure camera/GPS origin. Existing
# Android HTTP API clients keep their explicit /api route during migration.
first, rest=source.split('  server {', 2)[1:]
# Keep old native WebViews and their static assets on their trusted origin.
# Normal browser entry is redirected to the secure hostname.
first=first.replace('    location / {', '    location = / {\n      if ($arg_mobile != "1") { return 308 https://'+sys.argv[3]+'$request_uri; }\n      proxy_pass http://web:3000;\n      proxy_set_header Host $host;\n      proxy_set_header X-Forwarded-Proto $scheme;\n    }\n    location / {', 1)
Path(sys.argv[2]).write_text('events { worker_connections 1024; }\nhttp {\n  server_tokens off;\n  client_max_body_size 20m;\n  server {'+first+'  server {'+rest)
PY
"${compose[@]}" run --rm --no-deps nginx nginx -t
python3 - "$shared/server.env" "$domain" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);lines=p.read_text().splitlines();updates={'WEB_ORIGIN':'https://'+sys.argv[2]+',http://109.235.118.171','S3_PUBLIC_ENDPOINT':'https://'+sys.argv[2]}
result=[]
for line in lines:
    key=line.split('=',1)[0]
    result.append(key+'='+updates.pop(key) if key in updates else line)
result.extend(key+'='+value for key,value in updates.items())
p.write_text('\n'.join(result)+'\n');p.chmod(0o600)
PY
# VAPID keys remain outside releases; never print or rotate an existing pair.
if ! grep -q '^WEB_PUSH_PRIVATE_KEY=' "$shared/server.env"; then
  keys=$("${compose[@]}" exec -T backend node -e 'const c=require("node:crypto").createECDH("prime256v1");c.generateKeys();const p=c.getPrivateKey();process.stdout.write(JSON.stringify({publicKey:c.getPublicKey().toString("base64url"),privateKey:Buffer.concat([Buffer.alloc(Math.max(0,32-p.length)),p]).toString("base64url")}))')
  WEB_PUSH_KEYS="$keys" python3 - "$shared/server.env" "$domain" <<'PY'
import json,os,sys
from pathlib import Path
p=Path(sys.argv[1]);keys=json.loads(os.environ['WEB_PUSH_KEYS'])
with p.open('a') as f:
    f.write('WEB_PUSH_PUBLIC_KEY='+keys['publicKey']+'\nWEB_PUSH_PRIVATE_KEY='+keys['privateKey']+'\nWEB_PUSH_SUBJECT=https://'+sys.argv[2]+'\n')
p.chmod(0o600)
PY
  unset keys
fi
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
