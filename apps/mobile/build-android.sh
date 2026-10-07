#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
build_mode=${1:-debug}
if [ "$build_mode" = release ]; then
  : "${API_URL:?Set the final HTTPS API_URL}"
  [[ "$API_URL" == https://* ]] || { echo 'Release API must use HTTPS' >&2; exit 1; }
  test -f android/key.properties || { echo 'Install the owner signing key and ignored android/key.properties before release' >&2; exit 1; }
else
  API_URL=${API_URL:-http://10.0.2.2:4000/api/v1}
fi
flutter pub get
flutter analyze
flutter test
flutter build apk --"$build_mode" --dart-define="API_URL=$API_URL" \
  --dart-define="FIREBASE_API_KEY=${FIREBASE_API_KEY:-}" \
  --dart-define="FIREBASE_APP_ID=${FIREBASE_APP_ID:-}" \
  --dart-define="FIREBASE_MESSAGING_SENDER_ID=${FIREBASE_MESSAGING_SENDER_ID:-}" \
  --dart-define="FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID:-}"
