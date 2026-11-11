#!/usr/bin/env bash
# Keep the separate Collection virtual host when the legacy debug proxy is recreated.
set -euo pipefail
umask 077
legacy=bioflow-test-nginx-1
root=/opt/collection-live
[ -L "$root/current" ] || exit 0
[ -f "$root/shared/.env.collection" ] || exit 0
domain=$(python3 - "$root/shared/.env.collection" <<'PY'
import sys
print(next(line.split('=',1)[1].strip() for line in open(sys.argv[1]) if line.startswith('COLLECTION_DOMAIN=')))
PY
)
[[ "$domain" =~ ^[a-z0-9.-]+$ ]]
mounts=$(docker inspect -f '{{json .Mounts}}' "$legacy")
config=$(python3 -c 'import json,sys; print(next(x["Source"] for x in json.load(sys.stdin) if x["Destination"]=="/etc/nginx/nginx.conf"))' <<< "$mounts")
changed=false
if ! docker inspect -f '{{json .NetworkSettings.Networks}}' "$legacy" | python3 -c 'import json,sys; assert "collection-live_edge" in json.load(sys.stdin)'; then
  docker network connect collection-live_edge "$legacy"
  changed=true
fi
if ! rg -q '# BEGIN COLLECTION LIVE' "$config" 2>/dev/null; then
  # grep is used on remote servers where ripgrep might not be installed.
  if ! grep -q '# BEGIN COLLECTION LIVE' "$config"; then
    backup=$(mktemp "$root/shared/backups/proxy-reconcile.XXXXXX")
    cp "$config" "$backup"
    python3 "$root/current/infrastructure/collection-proxy.py" "$config" "$domain" tls
    if ! docker exec "$legacy" nginx -t; then cat "$backup" > "$config"; exit 1; fi
    changed=true
  fi
fi
if [ "$changed" = true ]; then docker exec "$legacy" nginx -t && docker exec "$legacy" nginx -s reload; fi
