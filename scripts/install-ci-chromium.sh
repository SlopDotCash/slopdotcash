#!/usr/bin/env bash
# Chromium 157 fixes no-store streaming completion (Playwright #42742).
# Pin official Chrome for Testing bytes; leave application transport unchanged.
set -euo pipefail
test "$#" -eq 1
destination="$1"
version=157.0.8103.15
digest=563526b19c119adaad4fbc603395a905d6dd637541dd8ed70635b18ac1bb8a53
archive="$(mktemp)"
trap 'rm -f "$archive"' EXIT
curl --fail --location --retry 2 --max-time 180 \
  "https://storage.googleapis.com/chrome-for-testing-public/$version/linux64/chrome-headless-shell-linux64.zip" \
  --output "$archive"
printf '%s  %s\n' "$digest" "$archive" | sha256sum --check --status
mkdir -p "$destination"
unzip -q -o "$archive" -d "$destination"
"$destination/chrome-headless-shell-linux64/chrome-headless-shell" --version
