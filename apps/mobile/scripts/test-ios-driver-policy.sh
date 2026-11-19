#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
swiftc "$root/ios/Runner/DriverPointPolicy.swift" "$root/test/native/driver_point_policy_test.swift" -o "$build/driver-policy-tests"
"$build/driver-policy-tests"
