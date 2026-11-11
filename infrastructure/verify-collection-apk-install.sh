#!/usr/bin/env bash
# Run only on a disposable Android emulator; never on a user's device.
set -euo pipefail
: "${COLLECTION_APK_TEST_DIR:?}"
evidence="$COLLECTION_APK_TEST_DIR/evidence"
mkdir -p "$evidence"
adb shell getprop ro.build.version.release
adb shell getprop ro.product.cpu.abi
for name in Collection Collection-Driver; do
  package=kz.milanium.collection
  [[ "$name" != Collection-Driver ]] || package=kz.milanium.collection_driver
  echo "Fresh install: $name"
  adb install "$COLLECTION_APK_TEST_DIR/new/$name.apk"
  adb shell dumpsys package "$package" | sed -n '/versionCode=/p; /versionName=/p'
  # Only emulator-owned test installations are removed to test the old upgrade.
  adb uninstall "$package"
  echo "Install previous release, then upgrade: $name"
  adb install "$COLLECTION_APK_TEST_DIR/old/$name.apk"
  adb install -r "$COLLECTION_APK_TEST_DIR/new/$name.apk"
  adb logcat -c
  adb shell monkey -p "$package" -c android.intent.category.LAUNCHER 1
  sleep 5
  adb shell pidof "$package"
  adb exec-out screencap -p > "$evidence/$name.png"
  adb shell uiautomator dump /sdcard/collection-install-ui.xml >/dev/null
  adb pull /sdcard/collection-install-ui.xml "$evidence/$name.xml" >/dev/null
  adb logcat -d -b crash > "$evidence/$name-crash.log"
  if grep -Fq "Process: $package," "$evidence/$name-crash.log"; then cat "$evidence/$name-crash.log"; exit 1; fi
  adb shell am force-stop "$package"
  echo "Installation, upgrade and launch succeeded: $name"
done
