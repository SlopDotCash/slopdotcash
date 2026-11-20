#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# SLOP_ESCROW_FEATURES is set only by test-e2e.sh; the public deploy script never sets it.
anchor build -p slop_escrow --no-idl -- --tools-version v1.52 -- --locked ${SLOP_ESCROW_FEATURES:+--features "$SLOP_ESCROW_FEATURES"}
anchor idl build -p slop_escrow --out target/idl/slop_escrow.json
