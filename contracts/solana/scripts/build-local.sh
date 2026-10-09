#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
anchor build --no-idl -- --tools-version v1.52 -- --locked
anchor idl build --out target/idl/slop_escrow.json
