#!/usr/bin/env bash
set -euo pipefail
# This whole controller is confined to an emulator and the tutorial_spec database.
[[ "$DATABASE_URL" == *'/collection_tutorial_spec'* ]]
adb root
adb wait-for-device
adb shell setprop persist.sys.locale ru-RU
adb shell stop
adb shell start
for attempt in {1..40}; do
  if adb shell service check activity 2>/dev/null | grep -q 'found'; then break; fi
  sleep 1
done
adb shell settings put system show_touches 1
adb shell settings put global window_animation_scale 0.5
adb shell settings put global transition_animation_scale 0.5
adb reverse tcp:4200 tcp:4200
"$RUNNER_TEMP/tutorial-env/bin/python" infrastructure/tutorials/native-control.py > "$RUNNER_TEMP/tutorial-native-control.log" 2>&1 &
control_pid=$!
cleanup(){ kill "$control_pid" 2>/dev/null || true; adb reverse --remove tcp:4200 >/dev/null 2>&1 || true; }
trap cleanup EXIT
for attempt in {1..40}; do curl -fsS http://127.0.0.1:4200/ -o /dev/null && break; sleep 1; done
cd apps/mobile
COLLECTION_DRIVER_BUILD=true flutter drive --driver=test_driver/integration_test.dart --target=integration_test/driver_tutorial_test.dart --dart-define=API_URL=http://10.0.2.2:4199/api/v1 --dart-define=WEB_URL=http://10.0.2.2:3040
