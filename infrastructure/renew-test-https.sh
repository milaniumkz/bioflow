#!/usr/bin/env bash
set -euo pipefail
root=/opt/bioflow-test
release=$(readlink -f "$root/current")
export BIOFLOW_SHARED_DIR=$root/shared BIOFLOW_IMAGE_TAG=$(cat "$release/DEPLOYED_COMMIT")
docker compose -p bioflow-test --env-file "$root/shared/server.env" -f "$release/docker-compose.test-server.yml" -f "$root/shared/https.compose.yml" exec -T nginx nginx -t
docker compose -p bioflow-test --env-file "$root/shared/server.env" -f "$release/docker-compose.test-server.yml" -f "$root/shared/https.compose.yml" exec -T nginx nginx -s reload
