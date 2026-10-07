#!/usr/bin/env bash
set -euo pipefail
# All operational logs go to stderr; stdout is reserved for encrypted transfer
# of the newly generated test account to the authenticated GitHub runner.
exec 3>&1
exec 1>&2
release=${1:?Release directory required}
sha=${2:?Image commit required}
base_url=${3:?Public test URL required}
[[ "$release" =~ ^/opt/bioflow-test/releases/[0-9a-f]{40}$ && "$sha" =~ ^[0-9a-f]{40}$ && "$base_url" = http://109.235.118.171 ]] || exit 2
root=/opt/bioflow-test
shared=$root/shared
umask 077
if ! command -v docker >/dev/null; then
  . /etc/os-release
  [[ "$ID" = ubuntu && "$VERSION_ID" = 24.04 ]] || { echo 'Automatic Docker installation supports Ubuntu24.04 only'; exit 1; }
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y docker.io docker-compose-v2 python3
  systemctl enable --now docker
fi
mkdir -p "$shared/downloads" "$root/backups"
chmod 700 "$shared" "$root/backups"
chmod 755 "$shared/downloads"
if [ ! -f "$shared/server.env" ]; then
  # Refuse to adopt an unknown service or database volume.
  if docker ps --format '{{.Ports}}' | grep -Eq '(0\.0\.0\.0|\[::\]):(80|9000)->'; then
    echo 'A public service already uses the requested test ports'; exit 1
  fi
  if docker volume inspect bioflow-test_postgres_data >/dev/null 2>&1; then
    echo 'Existing test database volume needs a migration review'; exit 1
  fi
  BIOFLOW_TEST_SHARED="$shared" BIOFLOW_TEST_BASE="$base_url" python3 - <<'PY'
import json, os, secrets
from pathlib import Path
p=Path(os.environ['BIOFLOW_TEST_SHARED']);base=os.environ['BIOFLOW_TEST_BASE']
db=secrets.token_hex(24);access=secrets.token_hex(12);secret=secrets.token_hex(32);owner=secrets.token_urlsafe(24)
env={'BIOFLOW_SHARED_DIR':str(p),'NODE_ENV':'production','POSTGRES_PASSWORD':db,
'DATABASE_URL':f'postgresql://bioflow_test:{db}@postgres:5432/bioflow_test?schema=public',
'REDIS_URL':'redis://redis:6379','JWT_ACCESS_SECRET':secrets.token_hex(32),
'JWT_REFRESH_SECRET':secrets.token_hex(32),'QR_SIGNING_SECRET':secrets.token_hex(32),
'S3_ENDPOINT':'http://s3:8333','S3_PUBLIC_ENDPOINT':base+':9000','S3_REGION':'us-east-1',
'S3_BUCKET':'bioflow-test','S3_ACCESS_KEY':access,'S3_SECRET_KEY':secret,'WEB_ORIGIN':base,
'BOOTSTRAP_ORGANIZATION_NAME':'BIOFLOW test','BOOTSTRAP_OWNER_EMAIL':'owner@bio.app.kz','BOOTSTRAP_OWNER_PASSWORD':owner}
(p/'server.env').write_text(''.join(f'{k}={v}\n' for k,v in env.items()))
(p/'server.env').chmod(0o600)
(p/'s3.json').write_text(json.dumps({'identities':[{'name':'bioflow-test','credentials':[{'accessKey':access,'secretKey':secret}],'actions':['Admin','Read','Write','List','Tagging']}]}))
(p/'s3.json').chmod(0o644)
PY
fi
export BIOFLOW_SHARED_DIR=$shared BIOFLOW_IMAGE_TAG=$sha
cd "$release"
compose=(docker compose -p bioflow-test --env-file "$shared/server.env" -f docker-compose.test-server.yml)
if "${compose[@]}" ps --status running --services | grep -qx postgres; then
  dump="$root/backups/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ).dump"
  "${compose[@]}" exec -T postgres pg_dump -U bioflow_test -d bioflow_test -Fc > "$dump"
  "${compose[@]}" exec -T postgres pg_restore --list < "$dump" >/dev/null
  sha256sum "$dump" > "$dump.sha256"
fi
"${compose[@]}" up -d --wait --wait-timeout 180 postgres redis s3
"${compose[@]}" up -d --wait --wait-timeout 240 backend web
ready=false
for attempt in $(seq 1 30); do
  if "${compose[@]}" exec -T backend node apps/backend/dist/files/init-bucket.js; then ready=true; break; fi
  sleep 2
done
[ "$ready" = true ] || exit 1
fresh_owner=false
if [ ! -f "$shared/owner-initialized" ]; then
  "${compose[@]}" run --rm --no-deps backend npm run bootstrap:production -w @bioflow/backend
  touch "$shared/owner-initialized"
  fresh_owner=true
fi
"${compose[@]}" run --rm --no-deps nginx nginx -t
"${compose[@]}" up -d nginx
if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
  ufw allow 80/tcp
  ufw allow 9000/tcp
fi
curl --fail --silent --show-error --retry 12 --retry-delay 3 "http://127.0.0.1/api/v1/health" >/dev/null
curl --fail --silent --show-error "http://127.0.0.1/" >/dev/null
ln -sfn "$release" "$root/current"
printf '%s\n' "$sha" > "$release/DEPLOYED_COMMIT"
cat > /etc/systemd/system/bioflow-test-backup.service <<'UNIT'
[Unit]
Description=BIOFLOW test database and file backup
After=docker.service
[Service]
Type=oneshot
ExecStart=/bin/bash /opt/bioflow-test/current/infrastructure/backup-test-server.sh
UNIT
cat > /etc/systemd/system/bioflow-test-backup.timer <<'UNIT'
[Unit]
Description=Daily BIOFLOW test backup
[Timer]
OnCalendar=*-*-* 02:00:00 Asia/Yekaterinburg
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now bioflow-test-backup.timer
# Credentials are never printed to the job log. The runner encrypts this
# authenticated SSH response into an offline HTML artifact for the owner.
BIOFLOW_TEST_SHARED="$shared" BIOFLOW_TEST_BASE="$base_url" VERIFY_BOOTSTRAP_LOGIN="$fresh_owner" python3 - <<'PY' >&3
import json,os,urllib.request
from pathlib import Path
values=dict(line.split('=',1) for line in (Path(os.environ['BIOFLOW_TEST_SHARED'])/'server.env').read_text().splitlines())
if os.environ['VERIFY_BOOTSTRAP_LOGIN'] == 'true':
    base='http://127.0.0.1/api/v1'
    body=json.dumps({'email':values['BOOTSTRAP_OWNER_EMAIL'],'password':values['BOOTSTRAP_OWNER_PASSWORD']}).encode()
    request=urllib.request.Request(base+'/auth/login', data=body, headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=20) as response: token=json.load(response)['accessToken']
    with urllib.request.urlopen(urllib.request.Request(base+'/auth/me',headers={'Authorization':'Bearer '+token}),timeout=20) as response: profile=json.load(response)
    assert profile['mustChangePassword'] and 'users.manage' in profile['permissions']
    urllib.request.urlopen(urllib.request.Request(base+'/auth/logout-all',data=b'{}',headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'}),timeout=20).close()
print(json.dumps({'url':os.environ['BIOFLOW_TEST_BASE'],'email':values['BOOTSTRAP_OWNER_EMAIL'],'password':values['BOOTSTRAP_OWNER_PASSWORD']}))
PY
