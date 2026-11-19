#!/usr/bin/env bash
set -euo pipefail
ipa=${1:?Usage: verify-ios-store.sh IPA collection\|driver}
role=${2:?Role required}
case "$role" in
  collection) bundle=kz.milanium.collection ;;
  driver) bundle=kz.milanium.collection.driver ;;
  *) echo 'Unknown role' >&2; exit 1 ;;
esac
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
unzip -q "$ipa" -d "$tmp"
app="$tmp/Payload/Runner.app"
codesign --verify --deep --strict "$app"
codesign -d --entitlements :- "$app" > "$tmp/entitlements.plist" 2>/dev/null
security cms -D -i "$app/embedded.mobileprovision" > "$tmp/profile.plist"
python3 - "$tmp" "$bundle" "$role" <<'PY'
import pathlib, plistlib, sys
root = pathlib.Path(sys.argv[1])
read = lambda p: plistlib.loads(p.read_bytes())
entitlements = read(root / 'entitlements.plist')
profile = read(root / 'profile.plist')
info = read(root / 'Payload/Runner.app/Info.plist')
identifier = profile['Entitlements']['application-identifier']
assert info['CFBundleIdentifier'] == sys.argv[2], 'Wrong app bundle'
assert identifier.endswith('.' + sys.argv[2]), 'Wrong provisioning profile'
assert entitlements['application-identifier'] == identifier, 'Signing identity mismatch'
assert entitlements.get('aps-environment') == 'production', 'Missing production APNs entitlement'
assert profile['Entitlements'].get('aps-environment') == 'production', 'Profile cannot deliver production push'
assert not entitlements.get('get-task-allow', True), 'Debug entitlement in store package'
if sys.argv[3] == 'collection':
    assert 'location' not in info.get('UIBackgroundModes', []), 'Staff app requests background location'
    assert not any(k.startswith('NSLocation') for k in info), 'Staff app requests location permission'
else:
    assert 'location' in info.get('UIBackgroundModes', []), 'Driver background tracking is missing'
print('Verified', info['CFBundleIdentifier'], info['CFBundleShortVersionString'], 'build', info['CFBundleVersion'], 'with production APNs')
PY
