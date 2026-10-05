#!/usr/bin/env sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
mkdir -p backups
pg_dump "$DATABASE_URL" > "backups/bioflow-$(date -u +%Y%m%dT%H%M%SZ).sql"
