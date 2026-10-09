#!/usr/bin/env bash
set -euo pipefail
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
sdk_root=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
adb_bin=${sdk_root:+$sdk_root/platform-tools/adb}
if [ -z "$adb_bin" ]; then adb_bin=$(command -v adb); fi
emulator_serial=$("$adb_bin" devices | awk 'NR > 1 && $2 == "device" {print $1}')
[[ "$emulator_serial" =~ ^emulator-[0-9]+$ ]] || { echo 'Exactly one disposable emulator is required'; exit 2; }
python3 "$repo_root/infrastructure/android-network-test-control.py" > "${RUNNER_TEMP:?}/android-network-control.log" 2>&1 &
control_pid=$!
cleanup() {
  kill "$control_pid" 2>/dev/null || true
  "$adb_bin" -s "$emulator_serial" shell svc wifi enable >/dev/null 2>&1 || true
  "$adb_bin" -s "$emulator_serial" shell svc data enable >/dev/null 2>&1 || true
}
trap cleanup EXIT
ready=false
for attempt in $(seq 1 30); do
  kill -0 "$control_pid" 2>/dev/null || { echo 'Emulator control failed to start'; exit 1; }
  if python3 -c 'import socket; socket.create_connection(("127.0.0.1",4200), timeout=0.2).close()' 2>/dev/null; then
    ready=true; break
  fi
  sleep 0.2
done
[ "$ready" = true ] || { echo 'Emulator network control did not become ready'; exit 1; }
cd "$repo_root/apps/mobile"
flutter drive --driver=test_driver/integration_test.dart --target=integration_test/user_journeys_test.dart --dart-define=API_URL=http://10.0.2.2:4100/api/v1
