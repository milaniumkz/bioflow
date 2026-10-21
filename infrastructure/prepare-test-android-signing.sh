#!/usr/bin/env bash
# Protected main deployment only. Never publish/upload this private test key.
set -euo pipefail
output=${1:?Temporary destination is required}
source "$(dirname -- "${BASH_SOURCE[0]}")/ci-ssh.sh"
umask 077
remote_key=/opt/bioflow-test/shared/private-signing/android-debug.keystore
bioflow_ssh 'install -d -m 700 /opt/bioflow-test/shared/private-signing'
if ! bioflow_ssh 'test -s /opt/bioflow-test/shared/private-signing/android-debug.keystore'; then
  keytool -genkeypair -noprompt -keystore "$output" -storetype JKS \
    -storepass android -keypass android -alias androiddebugkey \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -dname 'CN=BIOFLOW Test, O=BIOFLOW, C=KZ' >/dev/null 2>&1
  incoming="/opt/bioflow-test/shared/private-signing/incoming-${GITHUB_RUN_ID:?}.keystore"
  bioflow_scp "$output" "$PROD_SSH_USER@$PROD_SSH_HOST:$incoming"
  # A hard link creates the persistent key only when no key exists; never replace it.
  bioflow_ssh "chmod 600 '$incoming'; ln '$incoming' '$remote_key' 2>/dev/null || test -s '$remote_key'; rm -f '$incoming'"
fi
bioflow_scp "$PROD_SSH_USER@$PROD_SSH_HOST:$remote_key" "$output"
chmod 600 "$output"
keytool -list -keystore "$output" -storepass android -alias androiddebugkey >/dev/null 2>&1
