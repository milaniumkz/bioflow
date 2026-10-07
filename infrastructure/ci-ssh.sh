#!/usr/bin/env bash
# Source from GitHub Actions. Credentials must be supplied as protected env vars.
set -euo pipefail
: "${PROD_SSH_HOST:?Set the SSH host}"
PROD_SSH_PORT=${PROD_SSH_PORT:-22}
PROD_SSH_USER=${PROD_SSH_USER:-root}
[[ "$PROD_SSH_HOST" =~ ^[A-Za-z0-9.-]+$ && "$PROD_SSH_PORT" =~ ^[0-9]+$ && "$PROD_SSH_USER" =~ ^[A-Za-z0-9_-]+$ ]] || { echo 'Invalid SSH settings' >&2; exit 1; }
ssh_dir=$(mktemp -d)
chmod 700 "$ssh_dir"
trap 'rm -rf "$ssh_dir"' EXIT
if [ -z "${PROD_SSH_KNOWN_HOSTS:-}" ] && [ "$PROD_SSH_HOST" = 109.235.118.171 ]; then
  PROD_SSH_KNOWN_HOSTS=$(cat "$(dirname "${BASH_SOURCE[0]}")/ssh/bio-app.known_hosts")
fi
ssh_options=(-o ConnectTimeout=20 -o ServerAliveInterval=15 -o UserKnownHostsFile="$ssh_dir/known_hosts")
if [ -n "${PROD_SSH_KNOWN_HOSTS:-}" ]; then
  printf '%s\n' "$PROD_SSH_KNOWN_HOSTS" > "$ssh_dir/known_hosts"
  ssh_options+=(-o StrictHostKeyChecking=yes)
elif [ "${SSH_ALLOW_FIRST_CONNECTION:-false}" = true ]; then
  ssh_options+=(-o StrictHostKeyChecking=accept-new)
else
  echo 'Set PROD_SSH_KNOWN_HOSTS from the verified server fingerprint before deployment' >&2
  exit 1
fi
ssh_auth=()
if [ -n "${PROD_SSH_KEY:-}" ]; then
  printf '%s\n' "$PROD_SSH_KEY" > "$ssh_dir/key"
  chmod 600 "$ssh_dir/key"
  ssh_options+=(-i "$ssh_dir/key" -o IdentitiesOnly=yes -o BatchMode=yes)
elif [ -n "${SSHPASS:-}" ]; then
  command -v sshpass >/dev/null || { echo 'Install sshpass on the runner' >&2; exit 1; }
  export SSHPASS
  ssh_auth=(sshpass -e)
  ssh_options+=(-o PreferredAuthentications=password -o PubkeyAuthentication=no)
else
  echo 'Set protected PROD_SSH_KEY or PROD_SSH_PASSWORD in GitHub Actions secrets' >&2
  exit 1
fi
bioflow_ssh() { "${ssh_auth[@]}" ssh "${ssh_options[@]}" -p "$PROD_SSH_PORT" "$PROD_SSH_USER@$PROD_SSH_HOST" "$@"; }
bioflow_scp() { "${ssh_auth[@]}" scp "${ssh_options[@]}" -P "$PROD_SSH_PORT" "$@"; }
