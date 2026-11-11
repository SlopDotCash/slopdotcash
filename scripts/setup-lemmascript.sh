#!/usr/bin/env bash
# Install only the pinned local prover, after checking the official archive.
set -euo pipefail
cd "$(dirname "$0")/.."

version=4.11.0
case "$(uname -s):$(uname -m)" in
  Darwin:arm64)
    artifact="dafny-${version}-arm64-macos-13.zip"
    digest=c90c75e7d5db9c6ccbb7127840dfe43f0ac938b039a7ebed146d8ead383a572f
    ;;
  Linux:x86_64)
    artifact="dafny-${version}-x64-ubuntu-22.04.zip"
    digest=a46a9ff7cdd720f7955854c78e95df13f4cfe6b80691b05f8654fe19e8267179
    ;;
  *)
    echo "Unsupported automatic install platform. Supply official Dafny ${version} on PATH." >&2
    exit 1
    ;;
esac

if [ -e .tools/dafny ]; then
  [ -x .tools/dafny/dafny/dafny ] || {
    echo 'Existing local Dafny installation is incomplete; refusing to replace it.' >&2
    exit 1
  }
  .tools/dafny/dafny/dafny --version | grep -E '^4\.11\.0([+[:space:]]|$)' >/dev/null
else
  mkdir -p .tools
  # CI caches this verified archive; it is reused only while its digest matches.
  archive=".tools/dafny-${version}.zip"
  staging=$(mktemp -d "$PWD/.tools/dafny-install.XXXXXX")
  trap 'rm -rf "$staging"' EXIT
  sha256() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
  if [ -f "$archive" ] && [ "$(sha256 "$archive")" = "$digest" ]; then
    echo "Reusing verified Dafny ${version} archive."
  else
    rm -f "$archive"
    curl --fail --location --retry 6 --retry-delay 10 --retry-all-errors \
      --retry-max-time 300 \
      "https://github.com/dafny-lang/dafny/releases/download/v${version}/${artifact}" \
      --output "$staging/dafny.zip"
    [ "$(sha256 "$staging/dafny.zip")" = "$digest" ] || {
      echo 'Dafny archive checksum mismatch.' >&2
      exit 1
    }
    mv "$staging/dafny.zip" "$archive"
  fi
  unzip -q "$archive" -d "$staging/extracted"
  [ ! -e .tools/dafny ] || {
    echo 'A concurrent installation created .tools/dafny; refusing to replace it.' >&2
    exit 1
  }
  mv "$staging/extracted" .tools/dafny
fi

node_modules/.bin/lsc version
.tools/dafny/dafny/dafny --version
echo 'Local LemmaScript and Dafny tools are ready.'
