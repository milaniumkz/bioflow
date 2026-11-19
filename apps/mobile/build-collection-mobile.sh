#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
role=${1:-collection}
platform=${2:-android}
mode=${3:-debug}
format=${4:-}
[[ "$role" == collection || "$role" == driver ]] || { echo 'Role must be collection or driver' >&2; exit 1; }
[[ "$platform" == android || "$platform" == ios ]] || { echo 'Platform must be android or ios' >&2; exit 1; }
case "$platform:$mode:$format" in
  android:debug:|android:profile:|android:release:) format=apk ;;
  ios:debug:|ios:profile:|ios:release:) format=ios ;;
  android:release:appbundle|ios:release:ipa) ;;
  *) echo 'Use release appbundle for Google Play or release ipa for Apple' >&2; exit 1 ;;
esac
API_URL=${API_URL:-https://release.109.235.118.171.sslip.io/api/v1}
WEB_URL=${WEB_URL:-https://release.109.235.118.171.sslip.io}
[[ "$API_URL" == https://* && "$WEB_URL" == https://* ]] || { echo 'HTTPS URLs are required' >&2; exit 1; }
: "${FIREBASE_CONFIG_FILE:?Set the path to the public Android google-services.json or matching iOS GoogleService-Info.plist}"
config=$(mktemp)
trap 'rm -f "$config"' EXIT
python3 scripts/firebase-config.py --role "$role" --platform "$platform" --firebase-file "$FIREBASE_CONFIG_FILE" --api-url "$API_URL" --web-url "$WEB_URL" --output "$config"
flutter pub get
flutter analyze
flutter test
# Flutter tests register the debug-only integration_test plugin. Regenerate the
# plugin registry before a release so that it cannot reference that debug code.
if [[ "$mode" == release ]]; then
  flutter clean
  flutter pub get
fi
if [[ "$platform" == android ]]; then
  if [[ "$mode" == release ]]; then test -f android/key.properties || { echo 'Provide the owner release signing key' >&2; exit 1; }; fi
  COLLECTION_DRIVER_BUILD=$([[ "$role" == driver ]] && echo true || echo false) \
  COLLECTION_ROLE_BUILD=$([[ "$role" == collection ]] && echo true || echo false) \
    flutter build "$format" --"$mode" --target "lib/main_${role}.dart" --dart-define-from-file="$config"
else
  [[ "$(uname -s)" == Darwin ]] || { echo 'iOS builds require macOS and Xcode; project and schemes are prepared' >&2; exit 1; }
  args=()
  [[ "${IOS_NO_CODESIGN:-false}" != true ]] || args+=(--no-codesign)
  if [[ "$format" == ipa && -n "${IOS_EXPORT_OPTIONS_PLIST:-}" ]]; then
    args+=(--export-options-plist "$IOS_EXPORT_OPTIONS_PLIST")
  fi
  flutter build "$format" --"$mode" --flavor "$role" --target "lib/main_${role}.dart" --dart-define-from-file="$config" "${args[@]}"
fi
