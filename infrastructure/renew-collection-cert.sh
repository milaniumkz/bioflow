#!/usr/bin/env bash
set -euo pipefail
docker exec bioflow-test-nginx-1 nginx -t
docker exec bioflow-test-nginx-1 nginx -s reload
