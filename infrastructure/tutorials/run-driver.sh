#!/usr/bin/env bash
set -euo pipefail
# This whole controller is confined to an emulator and the tutorial_spec database.
[[ "$DATABASE_URL" == *'/collection_tutorial_spec'* ]]
adb root
adb wait-for-device
adb shell setprop persist.sys.locale ru-RU
adb shell setprop sys.boot_completed 0
adb shell stop
adb shell start
for attempt in {1..90}; do
  if [[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]] && adb shell settings get system system_locales >/dev/null 2>&1; then break; fi
  sleep 1
done
adb shell input keyevent 82
adb shell settings put system show_touches 1
adb shell settings put global window_animation_scale 0.5
adb shell settings put global transition_animation_scale 0.5
adb reverse tcp:4200 tcp:4200
"$RUNNER_TEMP/tutorial-env/bin/python" infrastructure/tutorials/native-control.py > "$RUNNER_TEMP/tutorial-native-control.log" 2>&1 &
control_pid=$!
cleanup(){ kill "$control_pid" 2>/dev/null || true; adb reverse --remove tcp:4200 >/dev/null 2>&1 || true; }
trap cleanup EXIT
for attempt in {1..40}; do curl -fsS http://127.0.0.1:4200/ -o /dev/null && break; sleep 1; done
# Publish bounded synthetic progress so stalled UI operations can be diagnosed.
progress(){
  while true; do
    { tail -n 65 "$RUNNER_TEMP/driver-tutorial-test.log" 2>/dev/null || true; tail -n 20 "$RUNNER_TEMP/tutorial-native-control.log" 2>/dev/null || true; } > work/native-tutorial-raw/progress.txt
    timeout 8 adb exec-out screencap -p > work/native-tutorial-raw/current-screen.png 2>/dev/null || true
    gh release upload "$TUTORIAL_CAPTURE_TAG" work/native-tutorial-raw/progress.txt work/native-tutorial-raw/current-screen.png --clobber >/dev/null 2>&1 || true
    sleep 25
  done
}
progress &
progress_pid=$!
trap 'kill "$progress_pid" 2>/dev/null || true; cleanup' EXIT
cd apps/mobile
COLLECTION_DRIVER_BUILD=true flutter drive --driver=test_driver/integration_test.dart --target=integration_test/driver_tutorial_test.dart --use-application-binary=build/app/outputs/flutter-apk/app-debug.apk --dart-define=API_URL=http://10.0.2.2:4199/api/v1 --dart-define=WEB_URL=http://10.0.2.2:3040 2>&1 | tee "$RUNNER_TEMP/driver-tutorial-test.log"
