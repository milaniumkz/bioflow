#!/usr/bin/env sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${1:?Usage: restore-postgres.sh backups/file.sql}"

psql "$DATABASE_URL" < "$1"
