#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
build_mode=${1:-debug}
API_URL=${API_URL:-https://release.109.235.118.171.sslip.io/api/v1}
[[ "$API_URL" == https://* ]] || { echo 'Collection Driver requires an HTTPS API' >&2; exit 1; }
if [[ "$build_mode" == release ]]; then
  test -f android/key.properties || { echo 'Provide the owner signing configuration in ignored android/key.properties' >&2; exit 1; }
elif [[ "$build_mode" != debug ]]; then
  echo 'Usage: build-driver-android.sh [debug|release]' >&2
  exit 1
fi
flutter pub get
flutter analyze
flutter test
COLLECTION_DRIVER_BUILD=true flutter build apk --"$build_mode" --target lib/main_driver.dart --dart-define="API_URL=$API_URL"
