#!/usr/bin/env bash
# Pinned GitHub Actions Linux x86_64 test toolchain; no production keys or services.
set -euo pipefail
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { echo 'Linux x86_64 required' >&2; exit 1; }
: "${RUNNER_TEMP:?Run in an isolated GitHub Actions job}"
: "${GITHUB_PATH:?GitHub Actions PATH file required}"
: "${GITHUB_ENV:?GitHub Actions environment file required}"
# Anchor CLI's hidapi dependency links libudev on Linux. The hosted runner
# already supplies pkg-config; OpenSSL builds through Anchor's locked dependencies.
sudo apt-get update
sudo apt-get install --no-install-recommends -y libudev-dev
install_dir="$RUNNER_TEMP/slop-solana-tools"
mkdir -p "$install_dir"
archive="$install_dir/solana.tar.bz2"
archive_size=298782636
archive_sha256=5da3359e296f1e6c13522b874317cb4cfe33e73301a9dc60b1e1435cc133b397
curl \
  --fail \
  --location \
  --connect-timeout 10 \
  --max-time 600 \
  --max-filesize "$archive_size" \
  --retry 5 \
  --retry-delay 2 \
  --retry-all-errors \
  --speed-limit 1024 \
  --speed-time 60 \
  --output "$archive" \
  https://github.com/anza-xyz/agave/releases/download/v2.1.21/solana-release-x86_64-unknown-linux-gnu.tar.bz2
[[ "$(stat -c '%s' "$archive")" == "$archive_size" ]] || {
  echo 'Agave archive size mismatch' >&2
  exit 1
}
printf '%s  %s\n' "$archive_sha256" "$archive" | sha256sum --check --status || {
  echo 'Agave archive checksum mismatch' >&2
  exit 1
}
tar -xjf "$archive" -C "$install_dir"
export PATH="$install_dir/solana-release/bin:$PATH"
printf '%s\n' "$install_dir/solana-release/bin" >> "$GITHUB_PATH"
[[ "$(solana --version)" == solana-cli\ 2.1.21* ]]
rustup toolchain install 1.89.0 --profile minimal
cargo +1.89.0 install --git https://github.com/coral-xyz/anchor --rev 1ebbe58158d089a2a40b5e35ebead5a10db9090d anchor-cli --locked --root "$install_dir/anchor"
export PATH="$install_dir/anchor/bin:$PATH"
printf '%s\n' "$install_dir/anchor/bin" >> "$GITHUB_PATH"
[[ "$(anchor --version)" == 'anchor-cli 0.32.1' ]]
# build-local.sh passes --tools-version v1.52; build-sbf installs its pinned SBF Rust.
# Agave 2.1.21 enumerates this directory before installing platform-tools.
mkdir -p "$HOME/.cache/solana"
# Host IDL compilation uses this fixed Rust toolchain as well.
printf '%s\n' 'RUSTUP_TOOLCHAIN=1.89.0' >> "$GITHUB_ENV"
